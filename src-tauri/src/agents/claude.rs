use super::options::{ModelName, SystemPrompt};
use super::{AgentCommand, GuestCommand};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

pub(crate) const SETTINGS_OPTION: &str = "--settings";
const PERMISSION_MODE_OPTION: &str = "--permission-mode";
const MODEL_OPTION: &str = "--model";
const EFFORT_OPTION: &str = "--effort";
const FALLBACK_MODEL_OPTION: &str = "--fallback-model";
const APPEND_SYSTEM_PROMPT_OPTION: &str = "--append-system-prompt";
const STATUS_LINE_SCRIPT: &str = include_str!("claude_status_line.py");

/// The Claude Code permission mode for new and resumed chats.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PermissionMode {
    #[default]
    Auto,
    Manual,
}

impl PermissionMode {
    pub(crate) fn is_auto(&self) -> bool {
        *self == Self::Auto
    }

    pub(crate) fn argument(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Manual => "manual",
        }
    }
}

/// The attribution text that Claude Code adds to Git commits and pull requests.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Attribution {
    #[default]
    Hidden,
    Shown,
}

impl Attribution {
    pub(crate) fn is_hidden(&self) -> bool {
        *self == Self::Hidden
    }
}

/// The effort levels that `claude --effort` accepts.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Effort {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

impl Effort {
    fn argument(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Xhigh => "xhigh",
            Self::Max => "max",
        }
    }
}

/// Optional Claude Code arguments. An absent value keeps the Claude Code default.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    pub(crate) model: Option<ModelName>,
    pub(crate) effort: Option<Effort>,
    pub(crate) fallback_model: Option<ModelName>,
    pub(crate) append_system_prompt: Option<SystemPrompt>,
}

impl Options {
    pub(crate) fn is_default(&self) -> bool {
        *self == Self::default()
    }

    /// The guest help text must list each option that a selected value uses.
    pub(crate) fn required_options(&self) -> Vec<&'static str> {
        [
            (self.model.is_some(), MODEL_OPTION),
            (self.effort.is_some(), EFFORT_OPTION),
            (self.fallback_model.is_some(), FALLBACK_MODEL_OPTION),
            (self.append_system_prompt.is_some(), APPEND_SYSTEM_PROMPT_OPTION),
        ]
        .into_iter()
        .filter_map(|(selected, option)| selected.then_some(option))
        .collect()
    }

    fn extend(&self, arguments: &mut Vec<String>) {
        if let Some(model) = &self.model {
            arguments.extend([MODEL_OPTION.into(), model.argument()]);
        }
        if let Some(effort) = self.effort {
            arguments.extend([EFFORT_OPTION.into(), effort.argument().into()]);
        }
        if let Some(model) = &self.fallback_model {
            arguments.extend([FALLBACK_MODEL_OPTION.into(), model.argument()]);
        }
        if let Some(prompt) = &self.append_system_prompt {
            arguments.push(prompt.argument(APPEND_SYSTEM_PROMPT_OPTION));
        }
    }
}

/// The project choices that Tugboat adds to a Claude Code chat command.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatSettings {
    pub(crate) permission_mode: PermissionMode,
    pub(crate) attribution: Attribution,
    pub(crate) options: Options,
}

// Every chat gets the Tugboat status line. Command-line settings take priority over files.
pub(crate) fn settings_document(attribution: Attribution) -> String {
    let mut settings = Map::new();
    settings.insert(
        "statusLine".into(),
        json!({
            "type": "command",
            "command": format!("python3 -c '{STATUS_LINE_SCRIPT}' 2>/dev/null"),
            "padding": 0
        }),
    );
    if attribution.is_hidden() {
        settings.insert("attribution".into(), json!({"commit": "", "pr": ""}));
    }
    Value::Object(settings).to_string()
}

impl ChatSettings {
    fn chat_arguments(&self, mut arguments: Vec<String>) -> Vec<String> {
        arguments.extend([
            PERMISSION_MODE_OPTION.into(),
            self.permission_mode.argument().into(),
            SETTINGS_OPTION.into(),
            settings_document(self.attribution),
        ]);
        self.options.extend(&mut arguments);
        arguments
    }
}

pub fn command(command: AgentCommand<'_>, settings: &ChatSettings) -> Result<GuestCommand, String> {
    let arguments = match command {
        AgentCommand::Version => vec!["--version".into()],
        AgentCommand::LoginStatus => vec!["auth".into(), "status".into(), "--json".into()],
        #[cfg(test)]
        AgentCommand::Logout => vec!["auth".into(), "logout".into()],
        AgentCommand::NewChat(Some(session)) => {
            settings.chat_arguments(vec!["--session-id".into(), session.argument()])
        }
        AgentCommand::NewChat(None) => {
            return Err("Choose a UUID for the new Claude Code session.".into())
        }
        AgentCommand::Resume(session) => {
            settings.chat_arguments(vec!["--resume".into(), session.argument()])
        }
    };
    Ok(GuestCommand::new(
        crate::environment::shared_runtime::program(super::AgentKind::ClaudeCode),
        arguments,
    ))
}
