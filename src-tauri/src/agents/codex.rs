use super::options::ModelName;
use super::{AgentCommand, GuestCommand};
use serde::{Deserialize, Serialize};

pub(crate) const MODEL_OPTION: &str = "--model";
// Models without the ultra reasoning level, from the model list checked on 2026-11-23.
const MODELS_WITHOUT_ULTRA: [&str; 2] = ["gpt-6-luna", "gpt-5.6-luna"];
// Every chat shows these status line items, in new and resumed sessions.
const STATUS_LINE: &str = "tui.status_line=[\"model-with-reasoning\",\"context-remaining\",\"total-input-tokens\",\"total-output-tokens\",\"five-hour-limit\",\"weekly-limit\"]";

/// The boundary that limits Codex commands inside the guest.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Boundary {
    #[default]
    Brig,
    Workspace,
}

impl Boundary {
    pub(crate) fn is_brig(&self) -> bool {
        *self == Self::Brig
    }
}

/// The reasoning effort values that Tugboat passes as `model_reasoning_effort`.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReasoningEffort {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
    Ultra,
}

impl ReasoningEffort {
    fn argument(self) -> String {
        let value = match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Xhigh => "xhigh",
            Self::Max => "max",
            Self::Ultra => "ultra",
        };
        format!("model_reasoning_effort=\"{value}\"")
    }
}

/// Optional Codex arguments. An absent value keeps the Codex configuration.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    pub(crate) model: Option<ModelName>,
    pub(crate) reasoning_effort: Option<ReasoningEffort>,
}

impl Options {
    pub(crate) fn is_default(&self) -> bool {
        *self == Self::default()
    }

    pub(crate) fn validate(&self) -> Result<(), String> {
        let model = self.model.as_ref().map(ModelName::as_str);
        if self.reasoning_effort == Some(ReasoningEffort::Ultra)
            && model.is_some_and(|model| MODELS_WITHOUT_ULTRA.contains(&model))
        {
            return Err(format!(
                "{} does not support ultra reasoning. Select a different reasoning effort.",
                model.unwrap_or_default()
            ));
        }
        Ok(())
    }

    fn extend(&self, arguments: &mut Vec<String>) {
        if let Some(model) = &self.model {
            arguments.extend([MODEL_OPTION.into(), model.argument()]);
        }
        if let Some(effort) = self.reasoning_effort {
            arguments.extend(["-c".into(), effort.argument()]);
        }
    }
}

/// The project choices that Tugboat adds to a Codex chat command.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatSettings {
    pub(crate) boundary: Boundary,
    pub(crate) options: Options,
}

pub fn command(command: AgentCommand<'_>, boundary: Boundary) -> Result<GuestCommand, String> {
    chat_command(
        command,
        &ChatSettings {
            boundary,
            options: Options::default(),
        },
    )
}

pub fn chat_command(
    command: AgentCommand<'_>,
    settings: &ChatSettings,
) -> Result<GuestCommand, String> {
    let arguments = match command {
        #[cfg(test)]
        AgentCommand::Version => vec!["--version".into()],
        AgentCommand::LoginStatus => vec![
            "-c".into(),
            "cli_auth_credentials_store=\"file\"".into(),
            "login".into(),
            "status".into(),
        ],
        #[cfg(test)]
        AgentCommand::Logout => vec![
            "-c".into(),
            "cli_auth_credentials_store=\"file\"".into(),
            "logout".into(),
        ],
        AgentCommand::NewChat(None) => chat_arguments(Vec::new(), settings),
        AgentCommand::NewChat(Some(_)) => {
            return Err("Codex assigns its own new session ID.".into())
        }
        AgentCommand::Resume(session) => {
            chat_arguments(vec!["resume".into(), session.argument()], settings)
        }
    };
    Ok(GuestCommand::new(
        crate::environment::shared_runtime::program(super::AgentKind::Codex),
        arguments,
    ))
}

fn chat_arguments(session: Vec<String>, settings: &ChatSettings) -> Vec<String> {
    let boundary = settings.boundary;
    // A shared background daemon can retain credentials after its terminal exits.
    let mut arguments = vec!["--no-daemon".into()];
    arguments.extend(session);
    arguments.extend([
        "-c".into(),
        "cli_auth_credentials_store=\"file\"".into(),
        "-c".into(),
        "tui.terminal_title=[\"session-id\",\"status\"]".into(),
        "-c".into(),
        "check_for_update_on_startup=false".into(),
        "--sandbox".into(),
        match boundary {
            Boundary::Brig => "danger-full-access".into(),
            Boundary::Workspace => "workspace-write".into(),
        },
        "--ask-for-approval".into(),
        "never".into(),
    ]);
    if matches!(boundary, Boundary::Workspace) {
        arguments.extend([
            "-c".into(),
            "sandbox_workspace_write.network_access=false".into(),
        ]);
    }
    arguments.extend(["-c".into(), STATUS_LINE.into()]);
    settings.options.extend(&mut arguments);
    arguments
}
