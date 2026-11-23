use super::Action;
use crate::{
    agents::{claude as claude_agent, AgentCommand, AgentKind, SessionId},
    environment::{shared_runtime, CheckedProject},
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Authentication {
    logged_in: bool,
}

pub(super) fn signed_in(checked: &CheckedProject) -> Result<bool, String> {
    // Brig 0.5.2 keeps `exec` for plain output; `sh` allocates a guest terminal.
    let arguments = AgentKind::ClaudeCode
        .command(AgentCommand::LoginStatus)?
        .in_output(checked.project.reference());
    let output = checked.brig.run(&arguments, Some(&checked.project.path))?;
    read_authentication(&output)
}

fn read_authentication(output: &crate::platform::command::CommandOutput) -> Result<bool, String> {
    if output.timed_out || output.cancelled || output.output_exceeded {
        return Err(
            "Claude sign-in status could not be verified. Check this environment and try again."
                .into(),
        );
    }
    let authentication: Authentication = serde_json::from_str(&output.stdout)
        .map_err(|_| "Claude returned an unsupported sign-in response.")?;
    if output.exit_code != Some(i32::from(!authentication.logged_in)) {
        return Err("Claude sign-in status failed. Check this environment and try again.".into());
    }
    Ok(authentication.logged_in)
}

fn supports_permission_mode(help: &str, mode: &str) -> bool {
    let Some((_, options)) = help.split_once("--permission-mode") else {
        return false;
    };
    options
        .lines()
        .take_while(|line| !line.trim_start().starts_with('-'))
        .flat_map(str::split_whitespace)
        .any(|word| word.trim_matches(['"', '\'', ',', '[', ']', '(', ')']) == mode)
}

pub(super) fn arguments(
    checked: &CheckedProject,
    action: Action,
    session: Option<&SessionId>,
) -> Result<Vec<String>, String> {
    use crate::agent_sessions::launch::{Admission, LaunchMode};
    let mode = match action {
        Action::Shell => LaunchMode::Shell,
        _ => LaunchMode::Chat,
    };
    let mut admission = Admission::begin(
        &checked.project,
        AgentKind::ClaudeCode,
        mode,
        "Prepare the selected Claude environment first.",
    )?;
    let require_session = || session.ok_or("Choose a Claude chat session ID.");
    let command = match action {
        Action::Shell => return admission.prepare(vec!["sh".into(), checked.project.reference()]),
        Action::NewChat => AgentCommand::NewChat(Some(require_session()?)),
        Action::Resume => AgentCommand::Resume(require_session()?),
    };
    admission.online(
        &checked.settings.network,
        "Claude sign-in and chats are unavailable in offline mode.",
    )?;
    admission.authorize(
        signed_in(checked)?,
        "Sign in with Claude in Settings, Providers.",
    )?;
    let help = checked.brig.checked(
        &[
            "exec".into(),
            checked.project.reference(),
            "--".into(),
            shared_runtime::program(AgentKind::ClaudeCode).into(),
            "--help".into(),
        ],
        None,
    )?;
    let settings = checked.project.agent_settings().claude;
    let mode = settings.permission_mode.argument();
    if !help.stdout.contains("--session-id")
        || !help.stdout.contains("--resume")
        || !supports_permission_mode(&help.stdout, mode)
    {
        return Err(format!(
            "Guest Claude does not support the required session and {mode} permission options."
        ));
    }
    if !help.stdout.contains(claude_agent::SETTINGS_OPTION) {
        return Err(
            "Guest Claude does not support the settings option that sets the status line and Git attribution.".into(),
        );
    }
    if let Some(option) = settings
        .options
        .required_options()
        .into_iter()
        .find(|option| !help.stdout.contains(option))
    {
        return Err(format!(
            "Guest Claude does not support {option}. Clear this option in Project settings → Agents."
        ));
    }
    admission.capabilities()?;
    let command = claude_agent::command(command, &settings)?;
    let arguments = shared_runtime::interactive(&checked.project, command);
    admission.prepare(arguments)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incomplete_authentication_commands_do_not_publish_a_signed_in_status() {
        for interrupted in [0, 1, 2] {
            let output = crate::platform::command::CommandOutput {
                stdout: "{\"loggedIn\":true}".into(),
                stderr: "synthetic-private-detail".into(),
                exit_code: Some(0),
                timed_out: interrupted == 0,
                cancelled: interrupted == 1,
                output_exceeded: interrupted == 2,
            };
            let error = read_authentication(&output).unwrap_err();
            assert!(error.contains("could not be verified"));
            assert!(!error.contains("synthetic-private-detail"));
        }
    }
}
