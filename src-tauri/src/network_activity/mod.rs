use crate::{
    desktop::{lifecycle, settings},
    environment::{shared_runtime, CheckedProject},
    platform::{brig::Brig, command, runtime},
    projects::{self, EnvironmentId, Registry},
    storage::data_location::{self, RecordsDirectory},
    usage_store,
};
use std::{
    fs::{self, DirBuilder},
    os::unix::fs::{DirBuilderExt, MetadataExt},
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

const GUEST_PROBE: &str = ".tugboat-network-attribution";

mod store;

fn spool_path(
    state: &Path,
    records: &RecordsDirectory,
    project: &projects::Project,
) -> Result<PathBuf, String> {
    project.validate()?;
    let cache = data_location::resolved_share(&state.join("agent-packages"))?;
    let directory = cache
        .join("network-activity")
        .join(records.id())
        .join(&project.id)
        .join(project.environment_id.to_string());
    if data_location::resolved_share(&directory)? != directory {
        return Err("The network activity queue path changed.".into());
    }
    Ok(directory)
}

fn private_directory(path: &Path) -> Result<(), String> {
    DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .map_err(|_| "Could not create the network activity queue.")?;
    let metadata =
        fs::symlink_metadata(path).map_err(|_| "Could not verify the network activity queue.")?;
    if !metadata.is_dir()
        || metadata.mode() & 0o077 != 0
        || metadata.uid() != unsafe { libc::geteuid() }
    {
        return Err("The network activity queue is not private.".into());
    }
    Ok(())
}

pub(crate) fn configure(
    brig: &mut Brig,
    records: &RecordsDirectory,
    project: &projects::Project,
) -> Result<(), String> {
    brig.require_private_cache([
        project.path.as_path(),
        brig.shared_project_home(project)?.as_path(),
    ])?;
    let directory = spool_path(&brig.state_directory()?, records, project)?;
    private_directory(&directory)?;
    brig.environment.insert(
        "TUGBOAT_NETWORK_ACTIVITY".into(),
        directory
            .to_str()
            .ok_or("Invalid network activity queue path.")?
            .into(),
    );
    brig.environment.insert(
        "TUGBOAT_NETWORK_SANDBOX".into(),
        format!("brig-{}-{}", project.profile, project.label),
    );
    Ok(())
}

pub(crate) fn start_attribution(checked: &CheckedProject) {
    if checked.settings.network == settings::Network::Offline {
        return;
    }
    let result = (|| {
        let source =
            runtime::data_directory(&runtime::directory().ok_or("The runtime is unavailable.")?)
                .ok_or("The runtime is unavailable.")?
                .join("network-attribution");
        let home = &checked.paths.host_home;
        if fs::canonicalize(home).ok().as_ref() != Some(home)
            || *home != checked.brig.shared_project_home(&checked.project)?
        {
            return Err("Could not verify the project guest home.".into());
        }
        let bytes = fs::read(source).map_err(|_| "Could not read the guest network probe.")?;
        crate::storage::write_bytes_with_mode(&home.join(GUEST_PROBE), &bytes, 0o700)?;
        let command = shared_runtime::exec(
            &checked.project,
            &format!("/root/{GUEST_PROBE}"),
            &["start"],
        );
        checked.brig.checked(&command, None)?;
        Ok::<_, String>(())
    })();
    if result.is_err() {
        if let Some(directory) = checked.brig.environment.get("TUGBOAT_NETWORK_ACTIVITY") {
            let _ =
                crate::storage::write_bytes_existing(&Path::new(directory).join("incomplete"), b"");
        }
    }
}

pub(crate) fn launch(
    checked: &CheckedProject,
    arguments: Vec<String>,
    origin: &'static str,
) -> std::process::Command {
    let mut command = crate::environment::command(checked, arguments);
    command.env("TUGBOAT_NETWORK_ORIGIN", origin);
    command
}

fn import_project(
    registry: &Registry,
    records: &RecordsDirectory,
    state: &Path,
    store: &mut usage_store::Store,
    identifier: &str,
    environment: &EnvironmentId,
) -> Result<(), String> {
    let project = registry.environment(identifier, environment)?;
    let directory = spool_path(state, records, &project)?;
    store::ingest(
        &mut store.connection,
        (&project.id, &environment.to_string()),
        &directory,
    )
}

pub(crate) fn monitor(app: AppHandle) {
    std::thread::spawn(move || {
        let Ok(state) = Brig::state_directory_for(&command::brig_environment()) else {
            return;
        };
        let Ok(store) = app.state::<usage_store::Runtime>().wait() else {
            return;
        };
        let mut sequence = store
            .with(|store| store::latest_sequence(&store.connection))
            .unwrap_or(0);
        loop {
            if !lifecycle::is_closing() {
                if let Ok(next) = scan_projects(&app, &state, &store, sequence) {
                    sequence = next;
                }
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}

fn scan_projects(
    app: &AppHandle,
    state: &Path,
    store: &usage_store::SharedStore,
    sequence: i64,
) -> Result<i64, String> {
    let records = data_location::records_directory(app)?;
    let registry = Registry::load(&records.path().join("projects.json"))?;
    for record in &registry.projects {
        if lifecycle::is_closing() {
            return Ok(sequence);
        }
        let _ = store.with(|store| {
            if !store.is_at(&records) {
                return Ok(());
            }
            import_project(
                &registry,
                &records,
                state,
                store,
                &record.id,
                &EnvironmentId::for_project(&record.id),
            )
        });
    }
    let updates = store.with(|store| {
        if !store.is_at(&records) {
            return Ok(Vec::new());
        }
        store::updates(&store.connection, sequence)
    })?;
    let mut next = sequence;
    for update in updates {
        next = update.sequence;
        let environment = EnvironmentId::for_project(&update.project_id);
        if environment.to_string() == update.environment_id
            && registry
                .environment(&update.project_id, &environment)
                .is_ok()
        {
            let _ = app.emit("network-activity-recorded", &update);
        }
    }
    Ok(next)
}

#[tauri::command]
pub(crate) async fn read_project_network_activity(
    app: AppHandle,
    identifier: String,
    environment_id: EnvironmentId,
    before: Option<store::Cursor>,
) -> Result<store::Page, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if before.is_some_and(|(time, sequence)| time < 0 || sequence <= 0) {
            return Err("Invalid network activity page.".into());
        }
        let records = data_location::records_directory(&app)?;
        let registry = Registry::load(&records.path().join("projects.json"))?;
        let project = registry.environment(&identifier, &environment_id)?;
        project.validate()?;
        let should_record = project.network != settings::Network::Offline
            && matches!(
                project.stage,
                projects::ProjectStage::EnvironmentStarting
                    | projects::ProjectStage::EnvironmentReady
            );
        let state = Brig::state_directory_for(&command::brig_environment())?;
        let directory = spool_path(&state, &records, &project)?;
        let recording = store::source_running(&directory)?;
        let store = app.state::<usage_store::Runtime>().wait()?;
        store.with(|store| {
            if !store.is_at(&records) {
                return Err("The records location changed. Read network activity again.".into());
            }
            if before.is_none() {
                store::ingest(
                    &mut store.connection,
                    (&project.id, &environment_id.to_string()),
                    &directory,
                )?;
            }
            store::page(
                &store.connection,
                (&project.id, &environment_id.to_string()),
                before,
                should_record && !recording,
            )
        })
    })
    .await
    .map_err(|_| "Could not read network activity.")?
}
