use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{de::IgnoredAny, Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Seek},
    net::SocketAddr,
    os::{fd::AsRawFd, unix::fs::OpenOptionsExt},
    path::Path,
};

const PAGE_SIZE: usize = 100;
const BATCH_SIZE: usize = 512;
const MAX_LINE: usize = 1024;
const SEGMENT_SIZE: u64 = 1024 * 1024;
const STORAGE_ERROR: &str = "Could not access the network activity records.";

pub(super) type Owner<'a> = (&'a str, &'a str);
pub(crate) type Cursor = (i64, i64);

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Direction {
    Incoming,
    Outgoing,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Protocol {
    Tcp,
    Udp,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Origin {
    Codex,
    ClaudeCode,
    GuestTerminal,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum ResultState {
    Connecting,
    Connected,
    Forwarded,
    Answered,
    Blocked,
    Failed,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Activity {
    time: i64,
    direction: Direction,
    endpoint: SocketAddr,
    protocol: Protocol,
    result: ResultState,
    sent: Option<u64>,
    received: Option<u64>,
    process: Option<String>,
    pid: Option<u32>,
    origin: Option<Origin>,
}

impl Activity {
    fn valid(&self) -> bool {
        (0..=253_402_300_799_999).contains(&self.time)
            && self.endpoint.port() != 0
            && self.process.as_ref().is_none_or(|name| {
                !name.is_empty()
                    && name.len() <= 64
                    && name
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"._-+".contains(&byte))
            })
            && self.pid.is_none_or(|pid| pid > 0)
            && [self.sent, self.received]
                .into_iter()
                .flatten()
                .all(|bytes| bytes <= (1 << 53) - 1)
    }
}

#[derive(Deserialize)]
struct Snapshot {
    id: String,
    revision: i64,
    #[serde(flatten)]
    activity: Activity,
    #[serde(flatten)]
    unrecognized: std::collections::BTreeMap<String, IgnoredAny>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Update {
    pub sequence: i64,
    pub project_id: String,
    pub environment_id: String,
    pub activity: Activity,
}

#[derive(Serialize)]
pub(crate) struct Page {
    rows: Vec<Activity>,
    next: Option<Cursor>,
    incomplete: bool,
}

fn identifier(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn storage_error(_: impl std::fmt::Display) -> String {
    STORAGE_ERROR.into()
}

fn open_segment(path: &Path) -> Result<File, String> {
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(storage_error)
}

fn mark_recording(database: &Connection, owner: Owner<'_>, incomplete: bool) -> Result<(), String> {
    database
        .execute(
            "INSERT INTO network_recording VALUES (?1, ?2, ?3)
         ON CONFLICT DO UPDATE SET incomplete=1 WHERE excluded.incomplete=1 AND incomplete=0",
            params![owner.0, owner.1, incomplete],
        )
        .map_err(storage_error)?;
    Ok(())
}

pub(super) fn source_running(directory: &Path) -> Result<bool, String> {
    let path = directory.join("recording");
    let file = match OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(storage_error(error)),
    };
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        return Ok(false);
    }
    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::WouldBlock {
        return Ok(true);
    }
    Err(storage_error(error))
}

pub(super) fn ingest(
    database: &mut Connection,
    owner: Owner<'_>,
    directory: &Path,
) -> Result<(), String> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(storage_error(error)),
    };
    let mut segments = Vec::new();
    for entry in entries {
        let entry = entry.map_err(storage_error)?;
        let name = entry.file_name();
        if name == "incomplete" {
            mark_recording(database, owner, true)?;
        }
        if name == "recording" && !source_running(directory)? && entry.path().is_file() {
            mark_recording(database, owner, true)?;
        }
        let Some(id) = name
            .to_str()
            .and_then(|name| name.strip_suffix(".jsonl"))
            .filter(|id| identifier(id))
        else {
            continue;
        };
        segments.push((id.to_owned(), entry.path()));
        if segments.len() > 64 {
            mark_recording(database, owner, true)?;
            break;
        }
    }
    // Give each segment a bounded turn. A busy gateway may keep one segment open.
    for (id, path) in segments {
        ingest_segment(database, owner, &id, &path)?;
    }
    Ok(())
}

fn ingest_segment(
    database: &mut Connection,
    owner: Owner<'_>,
    segment: &str,
    path: &Path,
) -> Result<(), String> {
    let file = open_segment(path)?;
    let metadata = file.metadata().map_err(storage_error)?;
    if !metadata.is_file() || metadata.len() > SEGMENT_SIZE {
        return mark_recording(database, owner, true);
    }
    // A published segment already holds this lock while its gateway can append.
    let sealed = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0;
    let offset: i64 = database.query_row(
        "SELECT byte_offset FROM network_ingestion WHERE project_id=?1 AND environment_id=?2 AND segment_id=?3",
        params![owner.0, owner.1, segment],
        |row| row.get(0),
    ).optional().map_err(storage_error)?.unwrap_or(0);
    let offset = u64::try_from(offset).map_err(storage_error)?;
    if offset > metadata.len() {
        return mark_recording(database, owner, true);
    }
    if offset == metadata.len() && !sealed {
        return mark_recording(database, owner, false);
    }
    let mut reader = BufReader::new(file);
    reader
        .seek(std::io::SeekFrom::Start(offset))
        .map_err(storage_error)?;
    let work = database
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage_error)?;
    let (next, incomplete) = import_lines(&work, owner, &mut reader, offset, sealed)?;
    mark_recording(&work, owner, incomplete)?;
    work.execute(
        "INSERT INTO network_ingestion VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT DO UPDATE SET byte_offset=excluded.byte_offset",
        params![owner.0, owner.1, segment, next as i64],
    )
    .map_err(storage_error)?;
    work.commit().map_err(storage_error)?;
    if sealed && next == metadata.len() {
        fs::remove_file(path).map_err(storage_error)?;
        database.execute(
            "DELETE FROM network_ingestion WHERE project_id=?1 AND environment_id=?2 AND segment_id=?3",
            params![owner.0, owner.1, segment],
        ).map_err(storage_error)?;
    }
    Ok(())
}

fn import_lines(
    database: &Connection,
    owner: Owner<'_>,
    reader: &mut impl BufRead,
    mut offset: u64,
    sealed: bool,
) -> Result<(u64, bool), String> {
    use std::io::Read;
    let mut bytes = Vec::with_capacity(MAX_LINE);
    let mut incomplete = false;
    for _ in 0..BATCH_SIZE {
        bytes.clear();
        let count = reader
            .take(MAX_LINE as u64)
            .read_until(b'\n', &mut bytes)
            .map_err(storage_error)?;
        if count == 0 {
            break;
        }
        if bytes.last() != Some(&b'\n') {
            if count < MAX_LINE && !sealed {
                break;
            }
            offset += count as u64;
            incomplete = true;
            // Scan the rest of an oversized line without retaining its bytes.
            offset += reader.skip_until(b'\n').map_err(storage_error)? as u64;
            continue;
        }
        offset += count as u64;
        let snapshot = serde_json::from_slice::<Snapshot>(&bytes);
        let Ok(snapshot) = snapshot else {
            incomplete = true;
            continue;
        };
        if !identifier(&snapshot.id)
            || snapshot.revision <= 0
            || !snapshot.unrecognized.is_empty()
            || !snapshot.activity.valid()
        {
            incomplete = true;
            continue;
        }
        let metadata = serde_json::to_string(&snapshot.activity).map_err(storage_error)?;
        database.execute(
            "INSERT INTO network_activity(project_id, environment_id, flow_id, time, revision, metadata)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(project_id, environment_id, flow_id) DO UPDATE SET
                 revision=excluded.revision, metadata=excluded.metadata
             WHERE excluded.revision > network_activity.revision AND excluded.time=network_activity.time",
            params![owner.0, owner.1, snapshot.id, snapshot.activity.time, snapshot.revision, metadata],
        ).map_err(storage_error)?;
    }
    Ok((offset, incomplete))
}

pub(super) fn latest_sequence(database: &Connection) -> Result<i64, String> {
    database
        .query_row(
            "SELECT coalesce(max(sequence), 0) FROM network_activity",
            [],
            |row| row.get(0),
        )
        .map_err(storage_error)
}

pub(super) fn updates(database: &Connection, sequence: i64) -> Result<Vec<Update>, String> {
    let mut statement = database
        .prepare(
            "SELECT sequence, project_id, environment_id, metadata FROM network_activity
         WHERE sequence > ?1 ORDER BY sequence LIMIT 100",
        )
        .map_err(storage_error)?;
    let mut records = statement.query([sequence]).map_err(storage_error)?;
    let mut updates = Vec::new();
    while let Some(record) = records.next().map_err(storage_error)? {
        let metadata: String = record.get(3).map_err(storage_error)?;
        let activity: Activity = serde_json::from_str(&metadata).map_err(storage_error)?;
        if !activity.valid() {
            return Err(STORAGE_ERROR.into());
        }
        updates.push(Update {
            sequence: record.get(0).map_err(storage_error)?,
            project_id: record.get(1).map_err(storage_error)?,
            environment_id: record.get(2).map_err(storage_error)?,
            activity,
        });
    }
    Ok(updates)
}

pub(super) fn page(
    database: &Connection,
    owner: Owner<'_>,
    before: Option<Cursor>,
    active_without_source: bool,
) -> Result<Page, String> {
    let incomplete: Option<bool> = database
        .query_row(
            "SELECT incomplete FROM network_recording WHERE project_id=?1 AND environment_id=?2",
            params![owner.0, owner.1],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage_error)?;
    let before = before.unwrap_or((i64::MAX, i64::MAX));
    let mut statement = database
        .prepare(
            "SELECT time, sequence, metadata FROM network_activity
         WHERE project_id=?1 AND environment_id=?2 AND (time, sequence) < (?3, ?4)
         ORDER BY time DESC, sequence DESC LIMIT ?5",
        )
        .map_err(storage_error)?;
    let mut records = statement
        .query(params![
            owner.0,
            owner.1,
            before.0,
            before.1,
            PAGE_SIZE as i64 + 1
        ])
        .map_err(storage_error)?;
    let mut rows = Vec::with_capacity(PAGE_SIZE);
    let mut last = None;
    let mut next = None;
    while let Some(record) = records.next().map_err(storage_error)? {
        if rows.len() == PAGE_SIZE {
            next = last;
            break;
        }
        let metadata: String = record.get(2).map_err(storage_error)?;
        let activity: Activity = serde_json::from_str(&metadata).map_err(storage_error)?;
        if !activity.valid() {
            return Err(STORAGE_ERROR.into());
        }
        rows.push(activity);
        last = Some((
            record.get(0).map_err(storage_error)?,
            record.get(1).map_err(storage_error)?,
        ));
    }
    Ok(Page {
        rows,
        next,
        incomplete: incomplete.unwrap_or(false) || active_without_source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::io::Write;

    fn database() -> Connection {
        let database = Connection::open_in_memory().unwrap();
        database
            .execute_batch(include_str!(
                "../usage_store/migrations/004_network_activity.sql"
            ))
            .unwrap();
        database
    }

    fn sample(id: u64, time: i64, revision: i64, sent: u64) -> Value {
        json!({
            "id": format!("{id:032x}"), "revision": revision, "time": time, "direction": "outgoing",
            "endpoint": "203.0.113.8:443", "protocol": "tcp", "result": "connected",
            "sent": sent, "received": null, "process": "curl", "pid": 412, "origin": "codex",
        })
    }

    fn replay(database: &Connection, owner: Owner<'_>, snapshots: &[Value]) {
        let input = snapshots.iter().fold(String::new(), |mut input, line| {
            input.push_str(&line.to_string());
            input.push('\n');
            input
        });
        assert_eq!(
            import_lines(database, owner, &mut input.as_bytes(), 0, true)
                .unwrap()
                .0,
            input.len() as u64
        );
    }

    #[test]
    fn scopes_pages_and_replays_by_owner_with_monotonic_updates() {
        let database = database();
        let first = ("project-a", "environment-a");
        let second = ("project-b", "environment-b");
        replay(
            &database,
            first,
            &(0..103).map(|id| sample(id, 10, 1, id)).collect::<Vec<_>>(),
        );
        let last_new_flow = latest_sequence(&database).unwrap();
        replay(
            &database,
            first,
            &[sample(102, 10, 3, 300), sample(102, 10, 2, 200)],
        );
        assert!(updates(&database, last_new_flow).unwrap().is_empty());
        replay(&database, second, &[sample(102, 11, 1, 5)]);
        let new_flows = updates(&database, last_new_flow).unwrap();
        assert_eq!(new_flows.len(), 1);
        assert_eq!(new_flows[0].project_id, second.0);
        assert_eq!(new_flows[0].environment_id, second.1);

        let newest = page(&database, first, None, false).unwrap();
        assert_eq!(newest.rows.len(), 100);
        assert_eq!(newest.rows[0].sent, Some(300));
        assert_eq!(newest.rows[0].received, None);
        let older = page(&database, first, newest.next, false).unwrap();
        assert_eq!(older.rows.len(), 3);
        assert_eq!(older.rows.last().unwrap().sent, Some(0));
        assert!(older.next.is_none());
        assert_eq!(
            page(&database, second, None, false).unwrap().rows[0].sent,
            Some(5)
        );
        assert!(page(&database, (first.0, second.1), None, false)
            .unwrap()
            .rows
            .is_empty());
    }

    #[test]
    fn idle_and_sealed_sources_survive_reopen_without_retaining_unrecognized_data() {
        let directory =
            std::env::temp_dir().join(format!("tugboat-network-test-{}", std::process::id()));
        fs::create_dir(&directory).unwrap();
        let queue = directory.join("queue");
        fs::create_dir(&queue).unwrap();
        let path = queue.join(format!("{:032x}.jsonl", 1));
        let owner = ("project-a", "environment-a");
        let database_path = directory.join("records.sqlite");
        let mut database = Connection::open(&database_path).unwrap();
        database
            .execute_batch(include_str!(
                "../usage_store/migrations/004_network_activity.sql"
            ))
            .unwrap();
        assert!(!page(&database, owner, None, false).unwrap().incomplete);
        assert!(page(&database, owner, None, true).unwrap().incomplete);

        let mut source = File::create(&path).unwrap();
        assert_eq!(unsafe { libc::flock(source.as_raw_fd(), libc::LOCK_EX) }, 0);
        writeln!(source, "{}", sample(1, 30, 1, 0)).unwrap();
        let mut extra = sample(2, 31, 1, 0);
        extra["body"] = json!("SYNTHETIC_TUGBOAT_API_BODY_81F7A2B3");
        writeln!(source, "{extra}").unwrap();
        write!(source, "{{\"body\":\"SYNTHETIC_TUGBOAT_API_BODY_81F7A2B3\"").unwrap();
        ingest(&mut database, owner, &queue).unwrap();
        assert_eq!(page(&database, owner, None, false).unwrap().rows.len(), 1);
        assert!(page(&database, owner, None, false).unwrap().incomplete);
        drop(source);
        drop(database);

        let mut database = Connection::open(&database_path).unwrap();
        ingest(&mut database, owner, &queue).unwrap();
        ingest(&mut database, owner, &queue).unwrap();
        let page = page(&database, owner, None, false).unwrap();
        assert!(page.incomplete);
        assert_eq!(page.rows.len(), 1);
        let visible = serde_json::to_string(&page).unwrap();
        assert!(!visible.contains("SYNTHETIC_TUGBOAT_API_BODY_81F7A2B3"));
        drop(database);
        assert!(!fs::read(database_path)
            .unwrap()
            .windows(b"SYNTHETIC_TUGBOAT_API_BODY_81F7A2B3".len())
            .any(|window| window == b"SYNTHETIC_TUGBOAT_API_BODY_81F7A2B3"));
        assert!(!path.exists());
        fs::remove_dir_all(directory).unwrap();
    }
}
