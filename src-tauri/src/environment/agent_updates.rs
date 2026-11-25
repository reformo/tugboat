use super::{shared_runtime, CheckedProject};
use crate::{
    agents::{claude, codex, AgentCommand, AgentKind, SessionId},
    platform::{command, runtime},
    projects::{EnvironmentId, ProjectStage},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{atomic::AtomicBool, Arc, Mutex, OnceLock},
    time::Duration,
};
use tauri::AppHandle;

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Outcome {
    pub active: Option<String>,
    selected: Option<String>,
    pub(crate) result: String,
}

type Updates = HashMap<AgentKind, Outcome>;
type Boots = HashMap<EnvironmentId, (String, Updates)>;
static BOOTS: OnceLock<Mutex<Boots>> = OnceLock::new();

pub(crate) fn boot_id(checked: &CheckedProject) -> Result<String, String> {
    let args = shared_runtime::exec(
        &checked.project,
        "/usr/bin/cat",
        &["/proc/sys/kernel/random/boot_id"],
    );
    let id = checked.brig.checked(&args, None)?.stdout.trim().to_owned();
    SessionId::new(&id)?;
    Ok(id)
}

fn probes(checked: &CheckedProject, kind: AgentKind) -> Result<String, String> {
    let session = SessionId::generate()?;
    let settings = checked.project.agent_settings();
    let new_chat = AgentCommand::NewChat((kind == AgentKind::ClaudeCode).then_some(&session));
    let mut probes = Vec::new();
    for action in [new_chat, AgentCommand::Resume(&session)] {
        let command = match kind {
            AgentKind::Codex => codex::chat_command(action, &settings.codex)?,
            AgentKind::ClaudeCode => claude::command(action, &settings.claude)?,
        };
        probes.push(command.in_profile());
    }
    serde_json::to_string(&probes).map_err(|error| error.to_string())
}

pub(crate) fn run(
    checked: &CheckedProject,
    kind: AgentKind,
    boot: &str,
    mode: &str,
) -> Result<Outcome, String> {
    if mode == "update" && kind == AgentKind::ClaudeCode {
        shared_runtime::verify_mount(checked)?;
    }
    let brig = &checked.brig;
    if brig.shared_project_home(&checked.project)? != checked.paths.host_home {
        return Err("The agent installation path does not match the project.".into());
    }
    let helper = runtime::tool("agent-updater").ok_or("The bundled agent updater is missing.")?;
    let verifier = runtime::tool("cosign").ok_or("The bundled package verifier is missing.")?;
    let args = vec![
        mode.into(),
        kind.binary().into(),
        brig.state_directory()?
            .join("agent-packages")
            .to_string_lossy()
            .into_owned(),
        checked.paths.host_home.to_string_lossy().into_owned(),
        brig.executable.to_string_lossy().into_owned(),
        verifier.to_string_lossy().into_owned(),
        checked.project.reference(),
        boot.into(),
        probes(checked, kind)?,
        shared_runtime::legacy_evidence(checked, kind).to_string(),
    ];
    let output = command::run(
        &helper,
        &args,
        None,
        &brig.environment,
        Duration::from_secs(1200),
        &AtomicBool::new(false),
    )?;
    if output.timed_out || output.cancelled || output.output_exceeded {
        return Err("The agent package check was interrupted.".into());
    }
    if output.exit_code != Some(0) {
        return Err(output.stderr.trim().to_owned());
    }
    serde_json::from_str(&output.stdout).map_err(|_| "Invalid agent update result.".into())
}

pub(crate) fn verify(checked: &CheckedProject, kind: AgentKind) -> Result<(), String> {
    run(checked, kind, &boot_id(checked)?, "verify").map(|_| ())
}

pub(crate) fn start(checked: CheckedProject) -> Result<Updates, String> {
    if checked.project.stage != ProjectStage::EnvironmentReady {
        return Ok(HashMap::new());
    }
    let boot = boot_id(&checked)?;
    let id = checked.project.environment_id.clone();
    let boots = BOOTS.get_or_init(Default::default);
    let mut all = boots.lock().map_err(|error| error.to_string())?;
    if let Some((previous, updates)) = all.get(&id) {
        if previous == &boot {
            return Ok(updates.clone());
        }
    }
    let mut updates = Updates::new();
    let checked = Arc::new(checked);
    for kind in [AgentKind::Codex, AgentKind::ClaudeCode] {
        updates.insert(
            kind,
            Outcome {
                active: None,
                selected: None,
                result: "Checking".into(),
            },
        );
        let checked = checked.clone();
        let boot = boot.clone();
        let id = id.clone();
        std::thread::spawn(move || {
            let outcome = run(&checked, kind, &boot, "update").unwrap_or_else(|result| Outcome {
                active: None,
                selected: None,
                result,
            });
            let mut all = boots.lock().unwrap_or_else(|error| error.into_inner());
            if let Some((current, updates)) = all.get_mut(&id) {
                if current == &boot {
                    updates.insert(kind, outcome);
                }
            }
        });
    }
    all.insert(id, (boot, updates.clone()));
    Ok(updates)
}

#[tauri::command]
pub(crate) async fn agent_update_status(
    app: AppHandle,
    identifier: String,
    environment_id: EnvironmentId,
) -> Result<Updates, String> {
    tauri::async_runtime::spawn_blocking(move || {
        start(super::checked_environment(
            &app,
            &identifier,
            Some(&environment_id),
            None,
        )?)
    })
    .await
    .map_err(|error| error.to_string())?
}
