use super::{AgentCommand, GuestCommand};

pub(crate) const NEW_CHAT_PERMISSION_MODE: &str = "auto";
pub(crate) const RESUME_PERMISSION_MODE: &str = "manual";

pub fn command(command: AgentCommand<'_>) -> Result<GuestCommand, String> {
    let arguments = match command {
        AgentCommand::Version => vec!["--version".into()],
        AgentCommand::LoginStatus => vec!["auth".into(), "status".into(), "--json".into()],
        #[cfg(test)]
        AgentCommand::Logout => vec!["auth".into(), "logout".into()],
        AgentCommand::NewChat(Some(session)) => vec![
            "--session-id".into(),
            session.argument(),
            "--permission-mode".into(),
            NEW_CHAT_PERMISSION_MODE.into(),
        ],
        AgentCommand::NewChat(None) => {
            return Err("Choose a UUID for the new Claude Code session.".into())
        }
        AgentCommand::Resume(session) => vec![
            "--resume".into(),
            session.argument(),
            "--permission-mode".into(),
            RESUME_PERMISSION_MODE.into(),
        ],
    };
    Ok(GuestCommand::new(
        crate::environment::shared_runtime::program(super::AgentKind::ClaudeCode),
        arguments,
    ))
}
