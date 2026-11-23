use crate::agents::AgentSettings;
use crate::projects::project_policy::NetworkAccess;
use serde::{Deserialize, Serialize};

/// The choices that a new project starts with. Existing projects keep their own values.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct ProjectDefaults {
    pub(crate) agents: AgentSettings,
    pub(crate) network: NetworkAccess,
}

impl ProjectDefaults {
    // An unchanged record stays out of settings.json, so an earlier Tugboat can still read the file.
    pub(super) fn is_default(&self) -> bool {
        *self == Self::default()
    }

    // The agent hosts count toward the policy limit only when preparation creates the policy.
    pub(super) fn validate(&self) -> Result<(), String> {
        self.agents.codex.options.validate()?;
        self.network.validate()
    }
}

#[cfg(test)]
mod tests {
    use super::super::Settings;
    use super::*;
    use serde_json::json;

    fn defaults(value: serde_json::Value) -> Result<ProjectDefaults, serde_json::Error> {
        serde_json::from_value(value)
    }

    #[test]
    fn a_settings_file_without_project_defaults_reads_and_writes_the_default_values() {
        let mut document = serde_json::to_value(Settings::default()).unwrap();
        assert!(document.get("projectDefaults").is_none());
        document.as_object_mut().unwrap().remove("telemetry");
        let settings: Settings = serde_json::from_value(document).unwrap();
        assert!(settings.project_defaults.is_default());
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn selected_project_defaults_round_trip_with_stable_wire_names() {
        let selected = json!({
            "agents": {
                "claude": {"permissionMode": "manual", "attribution": "shown", "options": {"model": "claude-sonnet-5-5", "effort": "high", "fallbackModel": null, "appendSystemPrompt": null}},
                "codex": {"boundary": "workspace", "options": {"model": "gpt-6.2-sol", "reasoningEffort": "xhigh"}}
            },
            "network": {"publicInternet": false, "hosts": {"packageManagers": true, "additional": ["api.example.com"]}}
        });
        let mut settings = Settings {
            project_defaults: defaults(selected.clone()).unwrap(),
            ..Settings::default()
        };
        assert!(settings.validate().is_ok());
        let document = serde_json::to_value(&settings).unwrap();
        assert_eq!(document["projectDefaults"], selected);
        assert_eq!(
            serde_json::from_value::<Settings>(document).unwrap(),
            settings
        );
        settings.project_defaults = ProjectDefaults::default();
        assert!(serde_json::to_value(&settings)
            .unwrap()
            .get("projectDefaults")
            .is_none());
    }

    #[test]
    fn invalid_project_defaults_are_rejected() {
        let agents = json!({
            "claude": {"permissionMode": "auto", "attribution": "hidden", "options": {"model": null, "effort": null, "fallbackModel": null, "appendSystemPrompt": null}},
            "codex": {"boundary": "brig", "options": {"model": "gpt-6-luna", "reasoningEffort": "ultra"}}
        });
        let unsupported_effort = defaults(json!({ "agents": agents })).unwrap();
        let settings = Settings {
            project_defaults: unsupported_effort,
            ..Settings::default()
        };
        assert!(settings.validate().unwrap_err().contains("ultra"));
        for domain in ["*.example.com", "-a.com", "a..com"] {
            let invalid = defaults(json!({"network": {"publicInternet": false, "hosts": {"packageManagers": false, "additional": [domain]}}})).unwrap();
            let settings = Settings {
                project_defaults: invalid,
                ..Settings::default()
            };
            assert!(settings.validate().is_err(), "{domain}");
        }
        let many: Vec<String> = (0..65)
            .map(|index| format!("host{index}.example.com"))
            .collect();
        let crowded = defaults(json!({"network": {"publicInternet": false, "hosts": {"packageManagers": false, "additional": many}}})).unwrap();
        let settings = Settings {
            project_defaults: crowded,
            ..Settings::default()
        };
        assert!(settings.validate().unwrap_err().contains("64"));
        for unknown in [
            json!({"agents": {"claude": {"permissionMode": "auto"}}}),
            json!({"network": {"publicInternet": "yes"}}),
            json!({"theme": "dark"}),
        ] {
            assert!(defaults(unknown).is_err());
        }
    }
}
