use super::{valid_directory_id, Location, PendingLocation};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum ChangeKind {
    Move,
    Locate,
    UseExisting(String),
}

impl ChangeKind {
    pub(super) fn for_selection(
        locate: bool,
        existing_directory_id: Option<String>,
    ) -> Result<Self, &'static str> {
        match existing_directory_id {
            Some(id) if !locate && valid_directory_id(&id) => Ok(Self::UseExisting(id)),
            Some(_) => Err("Invalid existing records folder identity."),
            None => Ok(Self::from(locate)),
        }
    }
}

impl From<bool> for ChangeKind {
    fn from(locate: bool) -> Self {
        if locate {
            return Self::Locate;
        }
        Self::Move
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(from = "bool", into = "bool")]
pub(super) enum MarkerState {
    Incomplete,
    Complete,
}

impl From<bool> for MarkerState {
    fn from(complete: bool) -> Self {
        if complete {
            return Self::Complete;
        }
        Self::Incomplete
    }
}
impl From<MarkerState> for bool {
    fn from(state: MarkerState) -> Self {
        state == MarkerState::Complete
    }
}

pub(super) enum MovePhase<'a> {
    Pending(&'a PendingLocation),
    Cleanup(&'a PathBuf),
    Stable,
}

impl Location {
    pub(super) fn phase(&self) -> MovePhase<'_> {
        if let Some(pending) = &self.pending {
            return MovePhase::Pending(pending);
        }
        if let Some(previous) = &self.previous_directory {
            return MovePhase::Cleanup(previous);
        }
        MovePhase::Stable
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn typed_location_states_keep_the_existing_boolean_wire_format() {
        for value in [false, true] {
            let marker: MarkerState = serde_json::from_value(value.into()).unwrap();
            assert_eq!(serde_json::to_value(marker).unwrap(), value);
            let record = serde_json::json!({ "directory": "/records", "locate": value });
            let pending: PendingLocation = serde_json::from_value(record.clone()).unwrap();
            assert_eq!(pending.kind, ChangeKind::from(value));
            assert_eq!(serde_json::to_value(pending).unwrap(), record);
        }
        assert!(serde_json::from_str::<MarkerState>("1").is_err());
    }

    #[test]
    fn existing_records_require_an_identity_and_cannot_be_a_reconnection() {
        let id = "a".repeat(32);
        let selection = serde_json::json!({ "directory": "/records", "locate": false, "existingDirectoryId": id });
        let pending: PendingLocation = serde_json::from_value(selection.clone()).unwrap();
        assert_eq!(pending.kind, ChangeKind::UseExisting(id));
        assert_eq!(serde_json::to_value(pending).unwrap(), selection);
        assert!(ChangeKind::for_selection(false, Some("invalid".into())).is_err());
        assert!(ChangeKind::for_selection(true, Some("a".repeat(32))).is_err());
    }
}
