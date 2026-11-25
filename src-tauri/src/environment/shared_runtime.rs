use super::{codex_package, CheckedProject};
use crate::{
    agents::{AgentKind, GuestCommand},
    projects::{Project, LEGACY_ENVIRONMENT_IMAGE, PREVIOUS_ENVIRONMENT_IMAGE},
};

use serde::Serialize;

const CLAUDE_PROGRAM: &str = "/usr/local/bin/claude";
const PREVIOUS_CLAUDE_SHA256: &str =
    "53a0d7e219d7b0804ecba5dbc002745e89f786cc946d2de85a6470d5b2d1fb06";

const DEFAULT_CLAUDE_SHA256: &str =
    "98d56f6ffe53469767a74864a38eaf359d62ef557a8de1b1ad524d61a66ec119";

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Versions {
    pub(crate) codex: String,
    pub(crate) claude_code: String,
}

pub(crate) fn program(kind: AgentKind) -> &'static str {
    match kind {
        AgentKind::Codex => "/root/.tugboat-active-codex/bin/codex",
        AgentKind::ClaudeCode => "/root/.tugboat-active-claude/claude",
    }
}

pub(super) fn legacy_evidence(checked: &CheckedProject, kind: AgentKind) -> serde_json::Value {
    use serde_json::json;
    let (version, checksum) = match checked.project.image_ref.as_str() {
        PREVIOUS_ENVIRONMENT_IMAGE => ("2.1.318", PREVIOUS_CLAUDE_SHA256),
        LEGACY_ENVIRONMENT_IMAGE => ("2.1.326", DEFAULT_CLAUDE_SHA256),
        _ => return json!({}),
    };
    match kind {
        AgentKind::ClaudeCode => json!({(version): checksum}),
        AgentKind::Codex => json!({
            "0.172.0": include_str!("../../profiles/codex-0.172.0.manifest"),
            "0.171.0": include_str!("../../../resources/agent-updater/legacy-codex-0.171.0.manifest"),
        }),
    }
}

pub(crate) fn interactive(project: &Project, command: GuestCommand) -> Vec<String> {
    command.in_guest(project.reference())
}

pub(crate) fn exec(project: &Project, program: &str, arguments: &[&str]) -> Vec<String> {
    let mut command = vec![
        "exec".into(),
        project.reference(),
        "--".into(),
        program.into(),
    ];
    command.extend(arguments.iter().map(|argument| (*argument).to_owned()));
    command
}

pub(crate) fn install_codex(checked: &CheckedProject) -> Result<(), String> {
    if checked.paths.host_home != checked.brig.shared_project_home(&checked.project)? {
        return Err("The Codex guest installation path does not match this project.".into());
    }
    let running = super::listed_as_running(&checked.brig, &checked.project)?;
    codex_package::install(&checked.brig, &checked.paths.host_home, running)
}

pub(crate) fn verify_codex(checked: &CheckedProject) -> Result<(), String> {
    super::agent_updates::verify(checked, AgentKind::Codex)
}

pub(crate) fn pinned_versions(image: &str) -> Result<Versions, String> {
    let claude_code = match image {
        PREVIOUS_ENVIRONMENT_IMAGE => "2.1.318 (Claude Code)",
        LEGACY_ENVIRONMENT_IMAGE => "2.1.326 (Claude Code)",
        _ => return Err("The guest image has no approved Claude Code release.".into()),
    };
    Ok(Versions {
        codex: codex_package::VERSION.into(),
        claude_code: claude_code.into(),
    })
}

pub(crate) fn verify_versions(checked: &CheckedProject) -> Result<Versions, String> {
    codex_package::verify(&checked.paths.host_home)?;
    verify_stock_claude(checked)?;
    let version = |kind: AgentKind| {
        let program = match kind {
            AgentKind::Codex => codex_package::PROGRAM,
            AgentKind::ClaudeCode => CLAUDE_PROGRAM,
        };
        let arguments = exec(&checked.project, program, &["--version"]);
        checked
            .brig
            .checked(&arguments, None)
            .map(|output| output.stdout.trim().to_owned())
    };
    let versions = Versions {
        codex: version(AgentKind::Codex)?,
        claude_code: version(AgentKind::ClaudeCode)?,
    };
    if versions != pinned_versions(&checked.project.image_ref)? {
        return Err("The guest did not run both pinned agent versions.".into());
    }
    Ok(versions)
}

pub(crate) fn verify_claude(checked: &CheckedProject) -> Result<(), String> {
    verify_mount(checked)?;
    super::agent_updates::verify(checked, AgentKind::ClaudeCode)
}

pub(crate) fn verify_mount(checked: &CheckedProject) -> Result<(), String> {
    let mounts = checked.brig.checked(
        &exec(
            &checked.project,
            "/usr/bin/findmnt",
            &["-n", "-o", "TARGET,FSTYPE", "-T", "/brig/claude"],
        ),
        None,
    )?;
    if mounts.stdout.trim() != "/brig/claude tmpfs" {
        return Err("The guest Claude access directory is not mounted on temporary memory.".into());
    }
    Ok(())
}

pub(crate) fn verify_stock_claude(checked: &CheckedProject) -> Result<(), String> {
    verify_mount(checked)?;
    let expected = match checked.project.image_ref.as_str() {
        PREVIOUS_ENVIRONMENT_IMAGE => PREVIOUS_CLAUDE_SHA256,
        LEGACY_ENVIRONMENT_IMAGE => DEFAULT_CLAUDE_SHA256,
        _ => return Err("The guest image has no approved Claude executable.".into()),
    };
    let executable = checked.brig.checked(
        &exec(&checked.project, "/usr/bin/sha256sum", &[CLAUDE_PROGRAM]),
        None,
    )?;
    if executable.stdout.split_whitespace().next() != Some(expected) {
        return Err(
            "The guest Claude executable changed. Prepare the verified guest again.".into(),
        );
    }
    Ok(())
}
