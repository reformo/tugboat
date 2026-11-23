use crate::{
    desktop::settings::{self, Settings},
    platform::brig::{self, Brig},
    projects::{self, EnvironmentId, Project, Projects, Registry},
    storage, terminal,
};
use access::{Egress, NetworkAccess};
pub(crate) use editor::PolicyEditor;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

mod access;
mod editor;
mod state;
use state::PolicyState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyView {
    project_id: String,
    environment_id: EnvironmentId,
    document: serde_json::Value,
    fingerprint: String,
    editable: bool,
    attached: bool,
    access: Option<NetworkAccess>,
    default_hosts: Vec<String>,
    public_internet_restricted: bool,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Save,
    Attach,
    Detach,
    Accept,
}

pub(crate) fn sole_binding(list: &str, policy: &str, project: &Project) -> bool {
    let mut selected = false;
    let mut found = false;
    for line in list.lines() {
        if !line.starts_with(char::is_whitespace) {
            selected = line.split_whitespace().next() == Some(policy);
            found |= selected;
            continue;
        }
        if selected && line.trim() != format!("bound to: {} -n {}", project.profile, project.label)
        {
            return false;
        }
    }
    found
}

fn view(
    brig: &Brig,
    project: &Project,
    settings: &Settings,
    private_records: &[PathBuf],
) -> Result<PolicyView, String> {
    let link = project
        .policy
        .as_ref()
        .ok_or("Prepare the project policy first.")?;
    let document = brig.policy(&link.name)?.ok_or("Policy not found.")?;
    let plan = brig.plan(project, settings)?;
    crate::projects::project_github_access::verify_plan(brig, project, &plan)?;
    crate::storage::data_location::require_private_plan_records(private_records, &plan)?;
    let attached = plan["data"]["policies"]
        .as_array()
        .is_some_and(|policies| policies.iter().any(|name| name == &link.name));
    let egress = Egress::read(&document);
    let defaults = crate::environment::preparation::allowed_hosts(settings);
    // Brig takes the strictest default of all bound policies, so another policy can deny the rest.
    let public_internet_restricted = attached
        && egress.as_ref().is_some_and(Egress::public_internet)
        && plan["data"]["egress"]["default"] != "allow";
    let list = brig.checked(&["policy".into(), "ls".into()], None)?;
    Ok(PolicyView {
        project_id: project.id.clone(),
        environment_id: project.environment_id.clone(),
        fingerprint: brig::fingerprint(&document)?,
        editable: link.owned
            && egress.is_some()
            && sole_binding(&list.stdout, &link.name, project),
        access: egress
            .as_ref()
            .map(|egress| NetworkAccess::observed(egress, &defaults)),
        default_hosts: defaults,
        public_internet_restricted,
        document,
        attached,
    })
}

pub(crate) fn change(
    brig: &Brig,
    file: &Path,
    settings: &Settings,
    identifier: &str,
    environment_id: &EnvironmentId,
    expected: &str,
    action: Action,
    access: Option<NetworkAccess>,
    private_records: &[PathBuf],
) -> Result<Project, String> {
    let _file_guard = storage::lock(file)?;
    let mut registry = Registry::load(file)?;
    let mut project = registry.environment(identifier, environment_id)?;
    project.require_active()?;
    if matches!(
        project.stage,
        crate::projects::ProjectStage::EnvironmentStarting
            | crate::projects::ProjectStage::Stopping
    ) {
        return Err("Wait for the environment operation before changing its policy.".into());
    }
    project.check_path()?;
    let current = view(brig, &project, settings, private_records)?;
    if current.fingerprint != expected {
        return Err("The policy changed. Read the current document again.".into());
    }
    let list = brig.json(&["--json".into(), "ls".into()], "SandboxList", None)?;
    let sandboxes = list["data"]["sandboxes"]
        .as_array()
        .ok_or("The Brig state is missing.")?;
    if sandboxes
        .iter()
        .any(|sandbox| sandbox["ref"] == project.reference() && sandbox["state"] != "stopped")
    {
        return Err("Stop the Brig environment before changing its policy.".into());
    }
    let link = project.policy.clone().ok_or("Policy record is missing.")?;
    let state = PolicyState::observed(current.editable, current.attached, project.owns_binding);
    state.authorize(action)?;
    if state.already_applied(action) {
        let detached = matches!(action, Action::Detach);
        if project.policy_detached != detached
            || project.stage == crate::projects::ProjectStage::EditingPolicy
        {
            state.complete(&mut project, action);
            registry.update(project.clone())?;
            storage::write(file, &registry)?;
        }
        return Ok(project);
    }
    let requested = requested_egress(action, access.as_ref(), settings, &project)?;
    state.begin(&mut project, action);
    registry.update(project.clone())?;
    storage::write(file, &registry)?;
    if let Some(egress) = &requested {
        let editor = egress.editor(&link.name)?;
        let mut editing = Brig {
            executable: brig.executable.clone(),
            environment: brig.environment.clone(),
        };
        for key in ["EDITOR", "VISUAL"] {
            editing
                .environment
                .insert(key.into(), editor.executable.to_string_lossy().into_owned());
        }
        editing.environment.insert(
            "BRIG_DESKTOP_POLICY_SOURCE".into(),
            editor.source.to_string_lossy().into_owned(),
        );
        editing.checked(&["policy".into(), "edit".into(), link.name.clone()], None)?;
        let document = brig
            .policy(&link.name)?
            .ok_or("Could not read the saved policy.")?;
        if Egress::read(&document).as_ref() != Some(egress) {
            return Err("The saved policy does not match the requested network access.".into());
        }
        project
            .policy
            .as_mut()
            .ok_or("Policy record is missing.")?
            .fingerprint = Some(brig::fingerprint(&document)?);
    }
    if matches!(action, Action::Attach | Action::Detach) {
        // Save ownership before attach so an interrupted operation can be recovered.
        if state.claim_attachment(&mut project, action) {
            registry.update(project.clone())?;
            storage::write(file, &registry)?;
        }
        brig.checked(
            &[
                "policy".into(),
                if matches!(action, Action::Attach) {
                    "attach"
                } else {
                    "detach"
                }
                .into(),
                link.name,
                project.profile.clone(),
                "-n".into(),
                project.label.clone(),
            ],
            None,
        )?;
    }
    if matches!(action, Action::Accept) {
        let plan = brig.plan(&project, settings)?;
        brig::validate_plan(&plan, &project, settings)?;
        project
            .policy
            .as_mut()
            .ok_or("Policy record is missing.")?
            .fingerprint = Some(current.fingerprint);
    }
    state.complete(&mut project, action);
    registry.update(project.clone())?;
    storage::write(file, &registry)?;
    Ok(project)
}

fn requested_egress(
    action: Action,
    access: Option<&NetworkAccess>,
    settings: &Settings,
    project: &Project,
) -> Result<Option<Egress>, String> {
    if !matches!(action, Action::Save) {
        return Ok(None);
    }
    let access = access.ok_or("Choose the network access to save.")?;
    let egress = access.egress(&crate::environment::preparation::allowed_hosts(settings))?;
    if egress.public_internet()
        && crate::projects::project_github_access::approved_policy(project).is_some()
    {
        return Err("Revoke GitHub access before you allow all public internet access. The GitHub access policy denies other destinations.".into());
    }
    Ok(Some(egress))
}

#[tauri::command]
pub async fn read_project_policy(
    app: AppHandle,
    identifier: String,
    environment_id: Option<EnvironmentId>,
) -> Result<PolicyView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let registry = Registry::load(&projects::file(&app)?)?;
        crate::storage::data_location::validate_project_records(&app, &registry)?;
        let project = registry.resolve_environment(&identifier, environment_id.as_ref())?;
        let settings = project.settings(settings::load(&settings::file(&app)?)?)?;
        let brig = crate::environment::brig_for_project(&app, &project, &settings)?;
        view(
            &brig,
            &project,
            &settings,
            &crate::storage::data_location::protected_directories(&app)?,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn change_project_policy(
    app: AppHandle,
    projects: State<'_, Projects>,
    identifier: String,
    environment_id: Option<EnvironmentId>,
    fingerprint: String,
    action: Action,
    access: Option<NetworkAccess>,
) -> Result<Project, String> {
    let lock = projects.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|error| error.to_string())?;
        let registry = Registry::load(&projects::file(&app)?)?;
        crate::storage::data_location::validate_project_records(&app, &registry)?;
        let project = registry.resolve_environment(&identifier, environment_id.as_ref())?;
        // The same guest processes that stop_project ends. A Mac terminal does not use the guest policy.
        if terminal::terminal_sessions(identifier.clone())
            .iter()
            .any(|process| process.stops_with_environment(&project.id, &project.environment_id))
        {
            return Err(
                "End this environment's terminal processes and stop it before changing its policy."
                    .into(),
            );
        }
        let settings = project.settings(settings::load(&settings::file(&app)?)?)?;
        let brig = crate::environment::brig_for_project(&app, &project, &settings)?;
        change(
            &brig,
            &projects::file(&app)?,
            &settings,
            &identifier,
            &project.environment_id,
            &fingerprint,
            action,
            access,
            &crate::storage::data_location::protected_directories(&app)?,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}
