use super::*;
use serde_json::{json, Value};

const SESSION: &str = "1a5bc5b5-af21-432d-bf07-e2218dd9f9bf";

#[test]
fn agent_kinds_have_stable_wire_names() {
    assert_eq!(serde_json::to_value(AgentKind::Codex).unwrap(), "codex");
    assert_eq!(
        serde_json::to_value(AgentKind::ClaudeCode).unwrap(),
        "claude-code"
    );
    assert_eq!(
        serde_json::from_str::<AgentKind>("\"claude-code\"").unwrap(),
        AgentKind::ClaudeCode
    );
    for unsupported in ["ClaudeCode", "openai", "anthropic", "shell", ""] {
        assert!(serde_json::from_value::<AgentKind>(json!(unsupported)).is_err());
    }
}

#[test]
fn session_ids_reject_flags_paths_wrong_types_and_invalid_uuid_shapes() {
    let session = SessionId::new(SESSION).unwrap();
    assert_eq!(serde_json::to_value(&session).unwrap(), SESSION);
    assert_eq!(
        serde_json::from_value::<SessionId>(json!(SESSION)).unwrap(),
        session
    );
    for invalid in [
        "",
        "../history",
        "--resume",
        "1a5bc5b5-af21-432d-bf07-e2218dd9f9bf; touch /tmp/probe",
        "1a5bc5b5-af21-432d-bf07-e2218dd9f9bg",
        "1a5bc5b5af21432dbf07e2218dd9f9bf",
    ] {
        assert!(SessionId::new(invalid).is_err());
        assert!(serde_json::from_value::<SessionId>(json!(invalid)).is_err());
    }
    for invalid in [json!(null), json!(true), json!(12), json!({"id":SESSION})] {
        assert!(serde_json::from_value::<SessionId>(invalid).is_err());
    }
}

#[test]
fn codex_account_status_logout_and_version_commands_keep_the_file_store() {
    let cases = [
        (
            AgentCommand::Version,
            vec![
                "sh",
                "custom@a",
                crate::environment::shared_runtime::program(AgentKind::Codex),
                "--version",
            ],
        ),
        (
            AgentCommand::LoginStatus,
            vec![
                "sh",
                "custom@a",
                crate::environment::shared_runtime::program(AgentKind::Codex),
                "-c",
                "cli_auth_credentials_store=\"file\"",
                "login",
                "status",
            ],
        ),
        (
            AgentCommand::Logout,
            vec![
                "sh",
                "custom@a",
                crate::environment::shared_runtime::program(AgentKind::Codex),
                "-c",
                "cli_auth_credentials_store=\"file\"",
                "logout",
            ],
        ),
    ];
    for (request, expected) in cases {
        assert_eq!(
            AgentKind::Codex
                .command(request)
                .unwrap()
                .in_guest("custom@a".into()),
            expected
        );
    }
}

#[test]
fn codex_new_and_resumed_chats_preserve_current_arguments_in_both_boundary_modes() {
    let session = SessionId::new(SESSION).unwrap();
    for (boundary, sandbox) in [
        (codex::Boundary::Brig, "danger-full-access"),
        (codex::Boundary::Workspace, "workspace-write"),
    ] {
        let new = codex::command(AgentCommand::NewChat(None), boundary)
            .unwrap()
            .in_profile();
        let resumed = codex::command(AgentCommand::Resume(&session), boundary)
            .unwrap()
            .in_profile();
        assert_eq!(new[0], "--no-daemon");
        assert_eq!(&resumed[..3], &["--no-daemon", "resume", SESSION]);
        assert_eq!(&new[1..], &resumed[3..]);
        assert_eq!(
            &new[1..9],
            &[
                "-c",
                "cli_auth_credentials_store=\"file\"",
                "-c",
                "tui.terminal_title=[\"session-id\",\"status\"]",
                "--sandbox",
                sandbox,
                "--ask-for-approval",
                "never"
            ]
        );
        let status_line = [
            "-c",
            "tui.status_line=[\"model-with-reasoning\",\"context-remaining\",\"total-input-tokens\",\"total-output-tokens\",\"five-hour-limit\",\"weekly-limit\"]",
        ];
        let expected_tail: Vec<&str> = match boundary {
            codex::Boundary::Brig => status_line.to_vec(),
            codex::Boundary::Workspace => ["-c", "sandbox_workspace_write.network_access=false"]
                .into_iter()
                .chain(status_line)
                .collect(),
        };
        assert_eq!(&new[9..], expected_tail);
    }
    assert!(AgentKind::Codex
        .command(AgentCommand::NewChat(Some(&session)))
        .is_err());
}

#[test]
fn claude_commands_match_the_live_cli_contract_and_require_a_new_session_id() {
    let session = SessionId::new(SESSION).unwrap();
    let settings = claude::settings_document(claude::Attribution::Hidden);
    for (request, expected) in [
        (AgentCommand::Version, vec!["--version"]),
        (AgentCommand::LoginStatus, vec!["auth", "status", "--json"]),
        (AgentCommand::Logout, vec!["auth", "logout"]),
        (
            AgentCommand::NewChat(Some(&session)),
            vec![
                "--session-id",
                SESSION,
                "--permission-mode",
                "auto",
                "--settings",
                settings.as_str(),
            ],
        ),
        (
            AgentCommand::Resume(&session),
            vec![
                "--resume",
                SESSION,
                "--permission-mode",
                "auto",
                "--settings",
                settings.as_str(),
            ],
        ),
    ] {
        let command = AgentKind::ClaudeCode
            .command(request)
            .unwrap()
            .in_guest("tugboat-claude@a".into());
        assert_eq!(
            &command[..3],
            &[
                "sh",
                "tugboat-claude@a",
                crate::environment::shared_runtime::program(AgentKind::ClaudeCode)
            ]
        );
        assert_eq!(&command[3..], expected);
        assert!(!command
            .iter()
            .any(|argument| argument.contains("bypass") || argument == "--fork-session"));
    }
    assert!(AgentKind::ClaudeCode
        .command(AgentCommand::NewChat(None))
        .is_err());
}

#[test]
fn claude_attribution_is_hidden_by_default_and_shown_only_when_selected() {
    let session = SessionId::new(SESSION).unwrap();
    assert_eq!(claude::Attribution::default(), claude::Attribution::Hidden);
    for (value, attribution) in [
        ("hidden", claude::Attribution::Hidden),
        ("shown", claude::Attribution::Shown),
    ] {
        assert_eq!(serde_json::to_value(attribution).unwrap(), value);
        assert_eq!(
            serde_json::from_value::<claude::Attribution>(json!(value)).unwrap(),
            attribution
        );
    }
    for unsupported in ["Hidden", "true", "", "off"] {
        assert!(serde_json::from_value::<claude::Attribution>(json!(unsupported)).is_err());
    }
    let hidden: Value =
        serde_json::from_str(&claude::settings_document(claude::Attribution::Hidden)).unwrap();
    assert_eq!(hidden["attribution"], json!({"commit": "", "pr": ""}));
    let shown: Value =
        serde_json::from_str(&claude::settings_document(claude::Attribution::Shown)).unwrap();
    assert!(shown.get("attribution").is_none());
    for request in [
        AgentCommand::NewChat(Some(&session)),
        AgentCommand::Resume(&session),
    ] {
        let settings = claude::ChatSettings {
            attribution: claude::Attribution::Shown,
            ..claude::ChatSettings::default()
        };
        let arguments = claude::command(request, &settings).unwrap().in_profile();
        let document = arguments
            .windows(2)
            .find(|pair| pair[0] == "--settings")
            .map(|pair| serde_json::from_str::<Value>(&pair[1]).unwrap())
            .unwrap();
        assert!(document.get("attribution").is_none());
        assert!(document.get("statusLine").is_some());
    }
    for request in [AgentCommand::Version, AgentCommand::LoginStatus] {
        let arguments = claude::command(request, &claude::ChatSettings::default())
            .unwrap()
            .in_profile();
        assert!(!arguments.iter().any(|argument| argument == "--settings"));
    }
}

#[test]
fn every_claude_chat_shows_the_tugboat_status_line() {
    let document: Value =
        serde_json::from_str(&claude::settings_document(claude::Attribution::Hidden)).unwrap();
    let status_line = &document["statusLine"];
    assert_eq!(status_line["type"], "command");
    assert_eq!(status_line["padding"], 0);
    let command = status_line["command"].as_str().unwrap();
    let script = include_str!("claude_status_line.py");
    assert!(!script.contains('\''), "the shell command wraps the script in single quotes");
    assert_eq!(command, format!("python3 -c '{script}' 2>/dev/null"));
    for field in [
        "\"model\", \"display_name\"",
        "\"effort\", \"level\"",
        "\"context_window\", \"total_input_tokens\"",
        "\"context_window\", \"total_output_tokens\"",
        "\"context_window\", \"remaining_percentage\"",
        "\"rate_limits\", window, \"used_percentage\"",
    ] {
        assert!(script.contains(field), "{field}");
    }
}

#[test]
fn claude_options_add_only_selected_arguments_after_the_settings() {
    let session = SessionId::new(SESSION).unwrap();
    let settings: claude::ChatSettings = serde_json::from_value(json!({
        "permissionMode": "auto",
        "attribution": "shown",
        "options": {
            "model": "opus",
            "effort": "xhigh",
            "fallbackModel": "sonnet",
            "appendSystemPrompt": "-Answer in Turkish."
        }
    }))
    .unwrap();
    assert_eq!(
        settings.options.required_options(),
        ["--model", "--effort", "--fallback-model", "--append-system-prompt"]
    );
    let arguments = claude::command(AgentCommand::Resume(&session), &settings)
        .unwrap()
        .in_profile();
    assert_eq!(
        &arguments[6..],
        [
            "--model",
            "opus",
            "--effort",
            "xhigh",
            "--fallback-model",
            "sonnet",
            "--append-system-prompt=-Answer in Turkish."
        ]
    );
    assert!(claude::Options::default().required_options().is_empty());
    for effort in ["low", "medium", "high", "xhigh", "max"] {
        assert!(serde_json::from_value::<claude::Effort>(json!(effort)).is_ok());
    }
    for invalid in ["High", "minimal", "", "none"] {
        assert!(serde_json::from_value::<claude::Effort>(json!(invalid)).is_err());
    }
}

#[test]
fn codex_options_add_the_model_and_reasoning_effort_to_new_and_resumed_chats() {
    let session = SessionId::new(SESSION).unwrap();
    let settings: codex::ChatSettings = serde_json::from_value(json!({
        "boundary": "brig",
        "options": {"model": "gpt-5.1-codex", "reasoningEffort": "high"}
    }))
    .unwrap();
    for request in [AgentCommand::NewChat(None), AgentCommand::Resume(&session)] {
        let arguments = codex::chat_command(request, &settings).unwrap().in_profile();
        assert_eq!(
            &arguments[arguments.len() - 4..],
            ["--model", "gpt-5.1-codex", "-c", "model_reasoning_effort=\"high\""]
        );
        assert!(arguments.iter().any(|argument| argument.starts_with("tui.status_line=")));
    }
    for effort in ["low", "medium", "high", "xhigh", "max", "ultra"] {
        let parsed: codex::Options =
            serde_json::from_value(json!({"model": null, "reasoningEffort": effort})).unwrap();
        let settings = codex::ChatSettings { boundary: codex::Boundary::Brig, options: parsed };
        let arguments = codex::chat_command(AgentCommand::NewChat(None), &settings)
            .unwrap()
            .in_profile();
        assert_eq!(
            arguments.last().unwrap(),
            &format!("model_reasoning_effort=\"{effort}\"")
        );
    }
    for invalid in ["minimal", "High", "", "none"] {
        assert!(serde_json::from_value::<codex::ReasoningEffort>(json!(invalid)).is_err());
    }
}

#[test]
fn ultra_reasoning_is_refused_only_for_models_without_it() {
    let options = |model: Value, effort: &str| -> codex::Options {
        serde_json::from_value(json!({"model": model, "reasoningEffort": effort})).unwrap()
    };
    for model in ["gpt-6-luna", "gpt-5.6-luna"] {
        assert!(options(json!(model), "ultra")
            .validate()
            .unwrap_err()
            .contains("does not support ultra"));
        assert!(options(json!(model), "max").validate().is_ok());
    }
    for model in [json!("gpt-6.2-sol"), json!("gpt-6.2-astra"), Value::Null] {
        assert!(options(model, "ultra").validate().is_ok());
    }
}

#[test]
fn claude_permission_mode_is_auto_by_default_and_manual_only_when_selected() {
    let session = SessionId::new(SESSION).unwrap();
    assert_eq!(
        claude::PermissionMode::default(),
        claude::PermissionMode::Auto
    );
    for (value, mode) in [
        ("auto", claude::PermissionMode::Auto),
        ("manual", claude::PermissionMode::Manual),
    ] {
        assert_eq!(serde_json::to_value(mode).unwrap(), value);
        assert_eq!(mode.argument(), value);
        assert_eq!(
            serde_json::from_value::<claude::PermissionMode>(json!(value)).unwrap(),
            mode
        );
    }
    for unsupported in ["Auto", "default", "bypassPermissions", "", "true"] {
        assert!(serde_json::from_value::<claude::PermissionMode>(json!(unsupported)).is_err());
    }
    let manual = claude::ChatSettings {
        permission_mode: claude::PermissionMode::Manual,
        attribution: claude::Attribution::Shown,
        options: claude::Options::default(),
    };
    let settings = claude::settings_document(claude::Attribution::Shown);
    for (request, option) in [
        (AgentCommand::NewChat(Some(&session)), "--session-id"),
        (AgentCommand::Resume(&session), "--resume"),
    ] {
        assert_eq!(
            claude::command(request, &manual).unwrap().in_profile(),
            [option, SESSION, "--permission-mode", "manual", "--settings", settings.as_str()]
        );
    }
}

#[test]
fn agent_settings_use_stable_wire_names_and_reject_unknown_values() {
    let defaults = AgentSettings::default();
    assert_eq!(
        serde_json::to_value(defaults).unwrap(),
        json!({
            "claude": {"permissionMode": "auto", "attribution": "hidden", "options": {"model": null, "effort": null, "fallbackModel": null, "appendSystemPrompt": null}},
            "codex": {"boundary": "brig", "options": {"model": null, "reasoningEffort": null}}
        })
    );
    let selected = json!({
        "claude": {"permissionMode": "manual", "attribution": "shown", "options": {"model": "opus", "effort": "max", "fallbackModel": null, "appendSystemPrompt": "Be brief."}},
        "codex": {"boundary": "workspace", "options": {"model": null, "reasoningEffort": "xhigh"}}
    });
    let settings: AgentSettings = serde_json::from_value(selected.clone()).unwrap();
    assert_eq!(settings.claude.permission_mode, claude::PermissionMode::Manual);
    assert_eq!(settings.codex.boundary, codex::Boundary::Workspace);
    assert_eq!(serde_json::to_value(settings).unwrap(), selected);
    let options = |claude: Value, codex: Value| json!({
        "claude": {"permissionMode": "auto", "attribution": "hidden", "options": claude},
        "codex": {"boundary": "brig", "options": codex}
    });
    let no_codex = json!({"model": null, "reasoningEffort": null});
    for invalid in [
        options(json!({"model": "-x", "effort": null, "fallbackModel": null, "appendSystemPrompt": null}), no_codex.clone()),
        options(json!({"model": null, "effort": "turbo", "fallbackModel": null, "appendSystemPrompt": null}), no_codex.clone()),
        options(json!({"model": null, "effort": null, "fallbackModel": null, "appendSystemPrompt": " "}), no_codex.clone()),
        options(json!({"model": null, "effort": null, "fallbackModel": null, "appendSystemPrompt": null, "theme": "dark"}), no_codex.clone()),
        options(json!({"model": null, "effort": null, "fallbackModel": null, "appendSystemPrompt": null}), json!({"model": "a b", "reasoningEffort": null})),
        json!({"claude": {"permissionMode": "auto", "attribution": "hidden"}}),
        json!({"claude": {"permissionMode": "auto"}, "codex": {"boundary": "brig"}}),
        json!({"claude": {"permissionMode": "auto", "attribution": "hidden"}, "codex": {"boundary": "none"}}),
        json!({"claude": {"permissionMode": "auto", "attribution": "hidden", "model": "x"}, "codex": {"boundary": "brig"}}),
        json!({"claude": {"permissionMode": "auto", "attribution": "hidden"}, "codex": {"boundary": "brig"}, "extra": true}),
    ] {
        assert!(serde_json::from_value::<AgentSettings>(invalid).is_err());
    }
}

#[test]
fn version_checks_accept_captured_program_responses_and_reject_wrong_programs() {
    assert!(AgentKind::Codex
        .validate_version("codex-cli 0.167.0\n")
        .is_ok());
    assert!(AgentKind::Codex
        .validate_version("codex-cli 0.167.0-alpha.1")
        .is_ok());
    assert!(AgentKind::ClaudeCode
        .validate_version("2.1.318 (Claude Code)\n")
        .is_ok());
    for invalid in [
        "",
        "not a version",
        "codex-cli",
        "codex-cli 1.2",
        "codex-cli 1.2.3\nother output",
        "2.1 (Claude Code)",
        "2.1.318 (Another CLI)",
    ] {
        assert!(AgentKind::Codex.validate_version(invalid).is_err());
        assert!(AgentKind::ClaudeCode.validate_version(invalid).is_err());
    }
    assert!(AgentKind::Codex
        .validate_version("2.1.318 (Claude Code)")
        .is_err());
    assert!(AgentKind::ClaudeCode
        .validate_version("codex-cli 0.167.0")
        .is_err());
}
