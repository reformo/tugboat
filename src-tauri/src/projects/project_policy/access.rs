use crate::desktop::settings;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Registry hosts that common package managers use to download packages.
pub(crate) const PACKAGE_MANAGER_HOSTS: [&str; 12] = [
    "registry.npmjs.org",
    "registry.yarnpkg.com",
    "pypi.org",
    "files.pythonhosted.org",
    "crates.io",
    "index.crates.io",
    "static.crates.io",
    "proxy.golang.org",
    "sum.golang.org",
    "repo.packagist.org",
    "rubygems.org",
    "index.rubygems.org",
];
const MAXIMUM_HOSTS: usize = 64;

/// The egress rules of a policy that Tugboat can read and write without loss.
#[derive(Debug, PartialEq)]
pub(super) struct Egress {
    public_internet: bool,
    hosts: Vec<String>,
}

impl Egress {
    pub(super) fn read(document: &Value) -> Option<Self> {
        let egress = &document["spec"]["egress"];
        let public_internet = match egress["default"].as_str()? {
            "deny" => false,
            "allow" => true,
            _ => return None,
        };
        let other_spec = document["spec"]
            .as_object()?
            .keys()
            .any(|key| key != "egress");
        let other_egress = egress
            .as_object()?
            .keys()
            .any(|key| !["default", "allow"].contains(&key.as_str()));
        if other_spec || other_egress {
            return None;
        }
        Some(Self {
            public_internet,
            hosts: Self::read_hosts(&egress["allow"])?,
        })
    }

    fn read_hosts(rules: &Value) -> Option<Vec<String>> {
        if rules.is_null() {
            return Some(Vec::new());
        }
        rules
            .as_array()?
            .iter()
            .map(|rule| {
                let host = rule["host"].as_str()?;
                (rule.as_object()?.len() == 1 && settings::valid_host(host))
                    .then(|| host.to_owned())
            })
            .collect()
    }

    pub(super) fn public_internet(&self) -> bool {
        self.public_internet
    }

    pub(super) fn editor(&self, name: &str) -> Result<super::PolicyEditor, String> {
        super::PolicyEditor::egress(name, self.public_internet, &self.hosts)
    }
}

/// The network choices that the project settings show for one policy.
/// The default value denies public internet access and adds no hosts.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkAccess {
    public_internet: bool,
    hosts: AllowedHosts,
}

/// The destinations that the policy allows in addition to the default agent hosts.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AllowedHosts {
    package_managers: bool,
    additional: Vec<String>,
}

impl NetworkAccess {
    pub(super) fn observed(egress: &Egress, defaults: &[String]) -> Self {
        let package_managers = PACKAGE_MANAGER_HOSTS
            .iter()
            .all(|host| egress.hosts.iter().any(|allowed| allowed == host));
        let additional = egress
            .hosts
            .iter()
            .filter(|host| !defaults.contains(*host))
            .filter(|host| !(package_managers && PACKAGE_MANAGER_HOSTS.contains(&host.as_str())))
            .cloned()
            .collect();
        Self {
            public_internet: egress.public_internet,
            hosts: AllowedHosts {
                package_managers,
                additional,
            },
        }
    }

    /// Checks the domains and the limit without the agent hosts.
    pub(crate) fn validate(&self) -> Result<(), String> {
        self.egress(&[]).map(|_| ())
    }

    /// The default rule and the allowed hosts of a new project policy.
    pub(crate) fn rules(&self, defaults: &[String]) -> Result<(bool, Vec<String>), String> {
        let egress = self.egress(defaults)?;
        Ok((egress.public_internet, egress.hosts))
    }

    pub(super) fn egress(&self, defaults: &[String]) -> Result<Egress, String> {
        if let Some(host) = self
            .hosts
            .additional
            .iter()
            .find(|host| !settings::valid_host(host))
        {
            return Err(format!(
                "\"{host}\" is not a valid domain. Use lowercase letters, digits, hyphens and dots."
            ));
        }
        let packages = PACKAGE_MANAGER_HOSTS
            .iter()
            .filter(|_| self.hosts.package_managers)
            .map(|host| (*host).to_owned());
        let mut hosts: Vec<String> = Vec::new();
        for host in defaults.iter().cloned().chain(packages) {
            if !hosts.contains(&host) {
                hosts.push(host);
            }
        }
        for host in &self.hosts.additional {
            if !hosts.contains(host) {
                hosts.push(host.clone());
            }
        }
        if hosts.len() > MAXIMUM_HOSTS {
            return Err(format!(
                "A project policy can allow at most {MAXIMUM_HOSTS} domains, including agent and package manager domains."
            ));
        }
        Ok(Egress {
            public_internet: self.public_internet,
            hosts,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn defaults() -> Vec<String> {
        vec!["api.anthropic.com".into(), "chatgpt.com".into()]
    }

    fn access(value: Value) -> NetworkAccess {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn simple_deny_and_allow_policies_are_editable_and_others_are_read_only() {
        let denied = json!({"spec":{"egress":{"default":"deny","allow":[{"host":"chatgpt.com"}]}}});
        assert_eq!(
            Egress::read(&denied),
            Some(Egress {
                public_internet: false,
                hosts: vec!["chatgpt.com".into()]
            })
        );
        let public = json!({"spec":{"egress":{"default":"allow"}}});
        assert_eq!(
            Egress::read(&public),
            Some(Egress {
                public_internet: true,
                hosts: Vec::new()
            })
        );
        for complex in [
            json!({"spec":{"egress":{"default":"deny","allow":[{"cidr":"0.0.0.0/0"}]}}}),
            json!({"spec":{"egress":{"default":"deny"},"routes":[{}]}}),
            json!({"spec":{"egress":{"default":"allow","deny":[{"host":"example.com"}]}}}),
            json!({"spec":{"egress":{"default":"deny","allow":[{"host":"*.example.com"}]}}}),
            json!({"spec":{"egress":{"default":"deny","allow":[{"host":"example.com","cidr":"10.0.0.0/8"}]}}}),
            json!({"spec":{"egress":{"default":"open"}}}),
            json!({"spec":{"egress":{"allow":[]}}}),
            json!({"spec":{}}),
        ] {
            assert_eq!(Egress::read(&complex), None, "{complex}");
        }
    }

    #[test]
    fn observed_access_separates_default_package_manager_and_additional_hosts() {
        let mut hosts = defaults();
        hosts.extend(PACKAGE_MANAGER_HOSTS.iter().map(|host| (*host).to_owned()));
        hosts.push("example.com".into());
        let egress = Egress {
            public_internet: false,
            hosts,
        };
        assert_eq!(
            serde_json::to_value(NetworkAccess::observed(&egress, &defaults())).unwrap(),
            json!({"publicInternet": false, "hosts": {"packageManagers": true, "additional": ["example.com"]}})
        );
        let partial = Egress {
            public_internet: true,
            hosts: vec!["api.anthropic.com".into(), "pypi.org".into()],
        };
        assert_eq!(
            serde_json::to_value(NetworkAccess::observed(&partial, &defaults())).unwrap(),
            json!({"publicInternet": true, "hosts": {"packageManagers": false, "additional": ["pypi.org"]}})
        );
    }

    #[test]
    fn requested_access_always_keeps_default_hosts_and_round_trips() {
        let requested = access(json!({
            "publicInternet": true,
            "hosts": {"packageManagers": true, "additional": ["example.com", "chatgpt.com", "example.com"]}
        }));
        let egress = requested.egress(&defaults()).unwrap();
        assert!(egress.public_internet());
        assert_eq!(&egress.hosts[..2], &defaults()[..]);
        assert_eq!(egress.hosts.last().unwrap(), "example.com");
        assert_eq!(egress.hosts.len(), 2 + PACKAGE_MANAGER_HOSTS.len() + 1);
        let observed = NetworkAccess::observed(&egress, &defaults());
        assert_eq!(
            serde_json::to_value(observed).unwrap(),
            json!({"publicInternet": true, "hosts": {"packageManagers": true, "additional": ["example.com"]}})
        );
        let closed = access(json!({"publicInternet": false, "hosts": {"packageManagers": false, "additional": []}}));
        assert_eq!(
            closed.egress(&defaults()).unwrap(),
            Egress {
                public_internet: false,
                hosts: defaults()
            }
        );
    }

    #[test]
    fn new_policy_rules_start_closed_and_follow_the_selected_defaults() {
        assert_eq!(
            NetworkAccess::default().rules(&defaults()).unwrap(),
            (false, defaults())
        );
        let open = access(json!({"publicInternet": true, "hosts": {"packageManagers": false, "additional": ["example.com"]}}));
        let (public_internet, hosts) = open.rules(&defaults()).unwrap();
        assert!(public_internet);
        assert_eq!(hosts, ["api.anthropic.com", "chatgpt.com", "example.com"]);
        let invalid = access(json!({"publicInternet": false, "hosts": {"packageManagers": false, "additional": ["*.example.com"]}}));
        assert!(invalid.validate().is_err());
        assert!(invalid.rules(&defaults()).is_err());
    }

    #[test]
    fn invalid_oversized_and_malformed_requests_are_rejected() {
        for host in ["Example.com", "*.example.com", "example", "exa mple.com", "-example.com", ""] {
            let request = access(json!({"publicInternet": false, "hosts": {"packageManagers": false, "additional": [host]}}));
            assert!(request.egress(&defaults()).unwrap_err().contains("not a valid domain"));
        }
        let many: Vec<String> = (0..63).map(|index| format!("host-{index}.example.com")).collect();
        let request = access(json!({"publicInternet": false, "hosts": {"packageManagers": false, "additional": many}}));
        assert!(request.egress(&defaults()).unwrap_err().contains("at most 64"));
        for malformed in [
            json!({"publicInternet": "yes", "hosts": {"packageManagers": false, "additional": []}}),
            json!({"publicInternet": false, "hosts": {"packageManagers": false}}),
            json!({"publicInternet": false, "hosts": {"packageManagers": false, "additional": []}, "secrets": []}),
            json!({"publicInternet": false}),
        ] {
            assert!(serde_json::from_value::<NetworkAccess>(malformed).is_err());
        }
    }
}
