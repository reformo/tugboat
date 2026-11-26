CREATE TABLE IF NOT EXISTS network_activity (
    sequence INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    flow_id TEXT NOT NULL,
    time INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    metadata TEXT NOT NULL,
    UNIQUE (project_id, environment_id, flow_id)
);
CREATE INDEX IF NOT EXISTS network_activity_page
    ON network_activity(project_id, environment_id, time DESC, sequence DESC);
CREATE TABLE IF NOT EXISTS network_ingestion (
    project_id TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    segment_id TEXT NOT NULL,
    byte_offset INTEGER NOT NULL,
    PRIMARY KEY (project_id, environment_id, segment_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS network_recording (
    project_id TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    incomplete INTEGER NOT NULL,
    PRIMARY KEY (project_id, environment_id)
) WITHOUT ROWID;
PRAGMA user_version = 4;
