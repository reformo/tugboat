use super::{error, RecordsDirectory, APPLICATION_ID, SCHEMA_VERSION};
use rusqlite::{Connection, TransactionBehavior};

const CHANGE_IDENTITY: &str = include_str!("../migrations/002_project_identity.sql");
const ADD_REQUEST_EFFORT: &str = include_str!("../migrations/003_request_effort.sql");

pub(super) const ADD_NETWORK_ACTIVITY: &str = include_str!("../migrations/004_network_activity.sql");

pub(super) fn verified_version(
    connection: &Connection,
    records: &RecordsDirectory,
) -> Result<i64, String> {
    let application: i64 = connection
        .query_row("PRAGMA application_id", [], |row| row.get(0))
        .map_err(error)?;
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(error)?;
    if application != APPLICATION_ID || !(1..=SCHEMA_VERSION).contains(&version) {
        return Err("This usage database belongs to another application or schema version.".into());
    }
    let identity: String = connection
        .query_row(
            "SELECT records_directory_id FROM store_identity WHERE singleton=1",
            [],
            |row| row.get(0),
        )
        .map_err(error)?;
    if identity != records.id() {
        return Err("This usage database belongs to a different records folder.".into());
    }
    Ok(version)
}

pub(super) fn check_references(database: &Connection) -> Result<(), String> {
    let healthy: String = database
        .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
        .map_err(error)?;
    let orphan: bool = database
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_foreign_key_check)",
            [],
            |row| row.get(0),
        )
        .map_err(error)?;
    if healthy != "ok" || orphan {
        return Err(
            "Usage storage contains invalid data or broken references. Review the records folder."
                .into(),
        );
    }
    Ok(())
}

pub(super) fn has_legacy_imports(database: &Connection) -> Result<bool, String> {
    database.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='legacy_imports')", [], |row| row.get(0)).map_err(error)
}

pub(super) fn upgrade(database: &mut Connection, records: &RecordsDirectory) -> Result<(), String> {
    database
        .execute_batch("PRAGMA foreign_keys=OFF;")
        .map_err(error)?;
    let transaction = database
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    let version = verified_version(&transaction, records)?;
    if version == 1 {
        migrate_v1(&transaction)?;
    }
    if version < 3 {
        transaction.execute_batch(ADD_REQUEST_EFFORT).map_err(error)?;
    }
    if version < SCHEMA_VERSION {
        transaction.execute_batch(ADD_NETWORK_ACTIVITY).map_err(error)?;
        check_references(&transaction)?;
    }
    transaction.commit().map_err(error)?;
    database
        .execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(error)
}

fn migrate_v1(transaction: &Connection) -> Result<(), String> {
    transaction.execute_batch(CHANGE_IDENTITY).map_err(error)?;
    if has_legacy_imports(transaction)? {
        let empty: bool = transaction
            .query_row(
                "SELECT NOT EXISTS(SELECT 1 FROM legacy_imports)",
                [],
                |row| row.get(0),
            )
            .map_err(error)?;
        if empty {
            transaction
                .execute_batch("DROP TABLE legacy_imports;")
                .map_err(error)?;
        }
    }
    Ok(())
}
