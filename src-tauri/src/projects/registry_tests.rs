use super::*;
use serde_json::{json, Value};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "tugboat-shared-registry-{}-{}",
            std::process::id(),
            NEXT_PROBE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        Self(root)
    }

    fn register(&self, registry: &mut Registry, name: &str) -> Project {
        let path = self.0.join(name);
        fs::create_dir(&path).unwrap();
        fs::write(path.join("marker"), name).unwrap();
        registry
            .register_with_defaults(&path, &settings::Settings::default())
            .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

pub(crate) fn former_v1(registry: &Registry) -> Value {
    let projects: Vec<_> = registry
        .project_views()
        .unwrap()
        .into_iter()
        .map(|project| {
            let mut value = serde_json::to_value(project).unwrap();
            let record = value.as_object_mut().unwrap();
            for field in [
                "environmentId",
                "agentKind",
                "network",
                "imageRef",
                "approvedPlan",
            ] {
                record.remove(field);
            }
            record.insert("profile".into(), json!("codex"));
            record.insert("label".into(), json!("former-codex"));
            value
        })
        .collect();
    json!({"schemaVersion": 1, "projects": projects})
}

pub(crate) fn former_environment(
    project: &Project,
    agent: AgentKind,
    profile: &str,
    owns: bool,
) -> Value {
    json!({
        "environmentId": EnvironmentId::for_agent(&project.id, agent), "agentKind":agent,
        "profile":profile, "label":format!("prior-{}", project.label), "network":"isolated",
        "policy":null, "stage":"selected", "ownsSession":owns, "ownsBinding":false,
        "policyDetached":false, "environmentVerified":false, "environmentAttempt":null, "removal":null
    })
}

pub(crate) fn former_record(
    registry: &Registry,
    identifier: &str,
    environments: Vec<Value>,
) -> Value {
    let mut value = serde_json::to_value(registry.record(identifier).unwrap()).unwrap();
    let record = value.as_object_mut().unwrap();
    record.remove("environment");
    record.insert("environments".into(), json!(environments));
    value
}

#[test]
fn both_agents_reopen_the_same_environment_and_only_one_record_is_written() {
    let fixture = Fixture::new();
    let file = fixture.0.join("projects.json");
    let mut registry = Registry::default();
    let first = fixture.register(&mut registry, "first");
    assert_eq!(first.image_ref, DEFAULT_ENVIRONMENT_IMAGE);
    assert_ne!(first.image_ref, PREVIOUS_ENVIRONMENT_IMAGE);
    let second = fixture.register(&mut registry, "second");
    let claude = registry
        .agent_environment(&first.id, &first.environment_id, AgentKind::ClaudeCode)
        .unwrap();
    assert_eq!(claude.environment_id, first.environment_id);
    assert_eq!(claude.reference(), first.reference());
    assert_eq!(claude.image_ref, first.image_ref);
    assert_eq!(claude.agent_kind, AgentKind::ClaudeCode);
    assert!(registry
        .agent_environment(&first.id, &second.environment_id, AgentKind::ClaudeCode)
        .is_err());
    assert!(registry
        .agent_environment(
            &first.id,
            &EnvironmentId::for_agent(&first.id, AgentKind::ClaudeCode),
            AgentKind::ClaudeCode
        )
        .is_err());
    registry.update(claude).unwrap();
    storage::write(&file, &registry).unwrap();
    let recorded: Value = storage::read(&file).unwrap().unwrap();
    assert_eq!(recorded["schemaVersion"], 3);
    assert!(recorded["projects"][0].get("environments").is_none());
    assert!(recorded["projects"][0]["environment"]
        .get("agentKind")
        .is_none());
    let mut reopened = Registry::load(&file).unwrap();
    let same = reopened
        .register_with_defaults(&first.path, &settings::Settings::default())
        .unwrap();
    assert_eq!(same.environment_id, first.environment_id);
    assert_eq!(same.reference(), first.reference());
    assert_eq!(reopened.projects.len(), 2);
}

#[test]
fn opening_the_library_waits_for_a_former_registry_and_reopens_the_published_record() {
    let fixture = Fixture::new();
    let file = fixture.0.join("projects.json");
    let mut registry = Registry::default();
    let project = fixture.register(&mut registry, "existing-project");
    let former =
        json!({"schemaVersion": 2, "projects":[former_record(&registry, &project.id, Vec::new())]});
    storage::write(&file, &former).unwrap();
    let before = fs::read(&file).unwrap();
    assert_eq!(
        Registry::load_after_reset(&file, || Err("Reset is waiting for cancellation.".into()))
            .err()
            .unwrap(),
        "Reset is waiting for cancellation."
    );
    assert_eq!(fs::read(&file).unwrap(), before);
    let active = Registry::load_after_reset(&file, || {
        let _writer = storage::lock(&file)?;
        storage::write(&file, &registry)
    })
    .unwrap();
    assert_eq!(
        active.project(&project.id).unwrap().environment_id,
        project.environment_id
    );
    Registry::load_after_reset(&file, || panic!("Fresh registry does not wait for usage."))
        .unwrap();
}

#[test]
fn a_stopped_environment_preserves_the_exact_approved_plan_across_reopen() {
    let fixture = Fixture::new();
    let file = fixture.0.join("projects.json");
    let mut registry = Registry::default();
    let mut project = fixture.register(&mut registry, "first");
    project.image_ref = PREVIOUS_ENVIRONMENT_IMAGE.into();
    project.stage = ProjectStage::Ready;
    project
        .begin_environment(EnvironmentAttempt::pending(
            "fixture".into(),
            1,
            "approved-plan".into(),
        ))
        .unwrap();
    project.stop_environment().unwrap();
    project.finish_stop().unwrap();
    registry.update(project.clone()).unwrap();
    storage::write(&file, &registry).unwrap();
    let reopened = Registry::load(&file).unwrap();
    for agent in reopened.agent_views(&project.id).unwrap() {
        assert_eq!(agent.image_ref, PREVIOUS_ENVIRONMENT_IMAGE);
        assert_eq!(agent.approved_plan.as_deref(), Some("approved-plan"));
        assert!(agent.environment_attempt.is_none());
    }
}

#[test]
fn version_one_source_preserves_the_folder_and_exact_retired_reference() {
    let fixture = Fixture::new();
    let file = fixture.0.join("projects.json");
    let mut registry = Registry::default();
    let project = fixture.register(&mut registry, "existing-project");
    storage::write(&file, &former_v1(&registry)).unwrap();
    let bytes = fs::read(&file).unwrap();
    let planned = transition::plan(&bytes, &settings::Settings::default())
        .unwrap()
        .unwrap();
    let retired = &planned.retired[0].environments[0];
    assert_eq!(retired.reference(), "codex@former-codex");
    assert_eq!(retired.image_ref, PREVIOUS_ENVIRONMENT_IMAGE);
    assert_eq!(
        retired.environment_id,
        EnvironmentId::for_agent(&project.id, AgentKind::Codex)
    );
    let shared = planned.registry.project(&project.id).unwrap();
    assert_eq!(shared.path, project.path);
    assert_eq!(shared.reference(), project.reference());
    assert_eq!(shared.image_ref, DEFAULT_ENVIRONMENT_IMAGE);
    assert_eq!(shared.approved_plan, None);
    assert_eq!(fs::read(file).unwrap(), bytes);
}

#[test]
fn one_time_plan_preserves_zero_one_and_two_registrations_and_requires_new_policy_review() {
    let fixture = Fixture::new();
    let file = fixture.0.join("projects.json");
    let mut registry = Registry::default();
    let zero = fixture.register(&mut registry, "zero");
    let one = fixture.register(&mut registry, "one");
    let two = fixture.register(&mut registry, "two");
    let mut external = former_environment(&one, AgentKind::ClaudeCode, "external", false);
    external["policy"] = json!({"name":"private-custom","owned":false,"fingerprint":"old-review"});
    let mut offline = former_environment(&two, AgentKind::Codex, "codex", true);
    offline["network"] = json!("offline");
    let source = json!({"schemaVersion":2, "projects":[
        former_record(&registry, &zero.id, vec![]),
        former_record(&registry, &one.id, vec![external]),
        former_record(&registry, &two.id, vec![offline, former_environment(&two, AgentKind::ClaudeCode,"claude",true)]),
    ]});
    storage::write(&file, &source).unwrap();
    let bytes = fs::read(&file).unwrap();
    assert!(Registry::load(&file).err().unwrap().contains("one-time"));
    let reset = transition::plan(&bytes, &settings::Settings::default())
        .unwrap()
        .unwrap();
    assert_eq!(fs::read(&file).unwrap(), bytes);
    assert_eq!(
        reset
            .retired
            .iter()
            .map(|record| record.environments.len())
            .collect::<Vec<_>>(),
        [0, 1, 2]
    );
    let prior = &reset.retired[1].environments[0];
    assert_eq!(prior.profile, "external");
    assert!(!prior.owns_session);
    assert_eq!(
        prior.policy.as_ref().unwrap().fingerprint.as_deref(),
        Some("old-review")
    );
    for (original, retired) in [zero, one, two].into_iter().zip(reset.retired) {
        let current = reset.registry.project(&original.id).unwrap();
        assert_eq!(retired.project_id, current.id);
        assert_eq!(retired.environment_id, current.environment_id);
        assert_eq!(current.path, original.path);
        assert_eq!(
            fs::read_to_string(current.path.join("marker")).unwrap(),
            original.name
        );
        assert_eq!(current.image_ref, DEFAULT_ENVIRONMENT_IMAGE);
        assert_eq!(current.stage, ProjectStage::Selected);
        assert!(current.approved_plan.is_none() && current.policy.is_none());
        if original.name == "two" {
            assert_eq!(current.network, settings::Network::Offline);
        }
    }
}

#[test]
fn agent_settings_default_to_current_behavior_and_survive_reopen_and_stale_updates() {
    use crate::agents::{
        claude::{Attribution, ChatSettings, PermissionMode},
        codex::{self, Boundary},
        AgentSettings,
    };
    let fixture = Fixture::new();
    let file = fixture.0.join("projects.json");
    let mut registry = Registry::default();
    let first = fixture.register(&mut registry, "first");
    let sibling = fixture.register(&mut registry, "sibling");
    assert_eq!(first.agent_settings(), AgentSettings::default());
    storage::write(&file, &registry).unwrap();
    let recorded: Value = storage::read(&file).unwrap().unwrap();
    for field in ["claudeAttribution", "claudePermissionMode", "codexBoundary", "claudeOptions", "codexOptions"] {
        assert!(recorded["projects"][0].get(field).is_none());
        assert!(serde_json::to_value(&first).unwrap().get(field).is_none());
    }

    let selected = AgentSettings {
        claude: ChatSettings {
            permission_mode: PermissionMode::Manual,
            attribution: Attribution::Shown,
            options: serde_json::from_value(json!({"model": "opus", "effort": "high"})).unwrap(),
        },
        codex: codex::ChatSettings {
            boundary: Boundary::Workspace,
            options: serde_json::from_value(json!({"reasoningEffort": "low"})).unwrap(),
        },
    };
    let stale = registry
        .agent_environment(&first.id, &first.environment_id, AgentKind::ClaudeCode)
        .unwrap();
    registry
        .set_agent_settings(&first.id, &first.environment_id, selected.clone())
        .unwrap();
    registry.update(stale).unwrap();
    storage::write(&file, &registry).unwrap();
    let recorded: Value = storage::read(&file).unwrap().unwrap();
    assert_eq!(recorded["projects"][0]["claudeAttribution"], "shown");
    assert_eq!(recorded["projects"][0]["claudePermissionMode"], "manual");
    assert_eq!(recorded["projects"][0]["codexBoundary"], "workspace");
    assert_eq!(
        recorded["projects"][0]["claudeOptions"],
        json!({"model": "opus", "effort": "high", "fallbackModel": null, "appendSystemPrompt": null})
    );
    assert_eq!(
        recorded["projects"][0]["codexOptions"],
        json!({"model": null, "reasoningEffort": "low"})
    );
    let reopened = Registry::load(&file).unwrap();
    for agent in [AgentKind::Codex, AgentKind::ClaudeCode] {
        let project = reopened
            .agent_environment(&first.id, &first.environment_id, agent)
            .unwrap();
        assert_eq!(project.agent_settings(), selected);
    }
    let sibling = reopened
        .environment(&sibling.id, &sibling.environment_id)
        .unwrap();
    assert_eq!(sibling.agent_settings(), AgentSettings::default());

    let before = registry.clone();
    assert!(registry
        .set_agent_settings(&first.id, &sibling.environment_id, AgentSettings::default())
        .is_err());
    assert!(registry
        .set_agent_settings("missing", &first.environment_id, AgentSettings::default())
        .is_err());
    let mut unsupported = AgentSettings::default();
    unsupported.codex.options =
        serde_json::from_value(json!({"model": "gpt-6-luna", "reasoningEffort": "ultra"})).unwrap();
    assert!(registry
        .set_agent_settings(&first.id, &first.environment_id, unsupported)
        .unwrap_err()
        .contains("ultra"));
    assert_eq!(
        serde_json::to_value(&registry).unwrap(),
        serde_json::to_value(&before).unwrap()
    );
    for (field, value) in [
        ("claudeAttribution", "visible"),
        ("claudePermissionMode", "bypassPermissions"),
        ("codexBoundary", "none"),
        ("claudeOptions", "opus"),
    ] {
        let mut invalid = serde_json::to_value(&before).unwrap();
        invalid["projects"][0][field] = json!(value);
        storage::write(&file, &invalid).unwrap();
        assert!(Registry::load(&file).is_err());
    }
}

#[test]
fn malformed_old_identity_and_unknown_new_state_are_rejected_without_writes() {
    let fixture = Fixture::new();
    let file = fixture.0.join("projects.json");
    let mut registry = Registry::default();
    let project = fixture.register(&mut registry, "project");
    let mut environment = former_environment(&project, AgentKind::Codex, "codex", true);
    environment["environmentId"] = json!("b".repeat(32));
    let old = json!({"schemaVersion":2,"projects":[former_record(&registry, &project.id, vec![environment])]});
    assert!(transition::plan(
        &serde_json::to_vec(&old).unwrap(),
        &settings::Settings::default()
    )
    .is_err());
    let mut current = serde_json::to_value(&registry).unwrap();
    current["projects"][0]["environment"]["stage"] = json!("unknown");
    storage::write(&file, &current).unwrap();
    let bytes = fs::read(&file).unwrap();
    assert!(Registry::load(&file).is_err());
    assert_eq!(fs::read(&file).unwrap(), bytes);
}

#[test]
fn an_active_record_cannot_select_an_old_profile_or_a_sibling_reference() {
    let fixture = Fixture::new();
    let file = fixture.0.join("projects.json");
    let mut registry = Registry::default();
    let project = fixture.register(&mut registry, "project");
    let sibling = fixture.register(&mut registry, "sibling");
    for (profile, label) in [
        ("codex", project.label.as_str()),
        ("tugboat-claude", project.label.as_str()),
        (ENVIRONMENT_PROFILE, sibling.label.as_str()),
    ] {
        let mut saved = serde_json::to_value(&registry).unwrap();
        saved["projects"][0]["environment"]["profile"] = json!(profile);
        saved["projects"][0]["environment"]["label"] = json!(label);
        storage::write(&file, &saved).unwrap();
        let bytes = fs::read(&file).unwrap();
        assert!(Registry::load(&file)
            .err()
            .unwrap()
            .contains("does not match this shared project"));
        assert_eq!(fs::read(&file).unwrap(), bytes);
        let mut replaced = project.clone();
        replaced.profile = profile.into();
        replaced.label = label.into();
        assert!(registry.update(replaced).is_err());
    }
    assert_eq!(
        registry.project(&project.id).unwrap().reference(),
        project.reference()
    );
}

#[test]
fn a_new_project_starts_with_the_project_defaults_and_a_known_project_keeps_its_choices() {
    let fixture = Fixture::new();
    let mut registry = Registry::default();
    let existing = fixture.register(&mut registry, "existing");
    let mut defaults = settings::Settings {
        network: settings::Network::Offline,
        ..settings::Settings::default()
    };
    defaults.project_defaults = serde_json::from_value(json!({"agents": {
        "claude": {"permissionMode": "manual", "attribution": "shown", "options": {"model": "claude-sonnet-5-5"}},
        "codex": {"boundary": "workspace", "options": {"reasoningEffort": "high"}}
    }}))
    .unwrap();
    let path = fixture.0.join("added");
    fs::create_dir(&path).unwrap();
    let added = registry.register_with_defaults(&path, &defaults).unwrap();
    assert_eq!(added.network, settings::Network::Offline);
    assert_eq!(added.agent_settings(), defaults.project_defaults.agents);
    assert_eq!(
        registry.project(&added.id).unwrap().agent_settings(),
        defaults.project_defaults.agents
    );
    let reopened = registry
        .register_with_defaults(&existing.path, &defaults)
        .unwrap();
    assert_eq!(reopened.network, existing.network);
    assert_eq!(
        reopened.agent_settings(),
        crate::agents::AgentSettings::default()
    );
}
