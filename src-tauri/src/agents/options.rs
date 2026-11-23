use serde::{Deserialize, Serialize};

const MAXIMUM_MODEL_NAME: usize = 100;
const MAXIMUM_SYSTEM_PROMPT: usize = 4000;

/// A model alias or full model name that an agent accepts after its model option.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(try_from = "String", into = "String")]
pub struct ModelName(String);

impl TryFrom<String> for ModelName {
    type Error = String;

    // A leading dash would read as another command-line option.
    fn try_from(value: String) -> Result<Self, Self::Error> {
        let allowed = |character: char| {
            character.is_ascii_alphanumeric() || ".-_:/[]@".contains(character)
        };
        if value.is_empty()
            || value.len() > MAXIMUM_MODEL_NAME
            || value.starts_with('-')
            || !value.chars().all(allowed)
        {
            return Err(format!(
                "Use a model name with 1 to {MAXIMUM_MODEL_NAME} letters, digits, dots, dashes, underscores, colons, slashes or brackets."
            ));
        }
        Ok(Self(value))
    }
}

impl From<ModelName> for String {
    fn from(value: ModelName) -> Self {
        value.0
    }
}

impl ModelName {
    pub(crate) fn argument(&self) -> String {
        self.0.clone()
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

/// Extra instructions that Claude Code appends to its default system prompt.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(try_from = "String", into = "String")]
pub struct SystemPrompt(String);

impl TryFrom<String> for SystemPrompt {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let allowed = |character: char| !character.is_control() || "\n\t".contains(character);
        if value.trim().is_empty()
            || value.chars().count() > MAXIMUM_SYSTEM_PROMPT
            || !value.chars().all(allowed)
        {
            return Err(format!(
                "Use system prompt text with 1 to {MAXIMUM_SYSTEM_PROMPT} characters and no control characters."
            ));
        }
        Ok(Self(value))
    }
}

impl From<SystemPrompt> for String {
    fn from(value: SystemPrompt) -> Self {
        value.0
    }
}

impl SystemPrompt {
    // The joined form keeps text that starts with a dash as the option value.
    pub(crate) fn argument(&self, option: &str) -> String {
        format!("{option}={}", self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn model_names_accept_aliases_and_full_names_and_reject_option_like_values() {
        for valid in ["opus", "sonnet[1m]", "claude-opus-4-1-20250805", "gpt-5.1-codex", "org/model:v2"] {
            let name: ModelName = serde_json::from_value(json!(valid)).unwrap();
            assert_eq!(name.argument(), valid);
            assert_eq!(serde_json::to_value(&name).unwrap(), valid);
        }
        let long = "m".repeat(101);
        for invalid in ["", "-x", "--model", "opus sonnet", "opus;rm", "ö", long.as_str()] {
            assert!(serde_json::from_value::<ModelName>(json!(invalid)).is_err(), "{invalid}");
        }
    }

    #[test]
    fn system_prompts_keep_text_and_reject_empty_oversized_or_control_text() {
        let prompt: SystemPrompt =
            serde_json::from_value(json!("-Use Turkish.\nKeep answers short.")).unwrap();
        assert_eq!(
            prompt.argument("--append-system-prompt"),
            "--append-system-prompt=-Use Turkish.\nKeep answers short."
        );
        for invalid in [String::new(), "  \n".into(), "a\u{0}b".into(), "x".repeat(4001)] {
            assert!(serde_json::from_value::<SystemPrompt>(json!(invalid)).is_err());
        }
    }
}
