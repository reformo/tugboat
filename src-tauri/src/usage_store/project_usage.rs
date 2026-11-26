use super::{codecs, error, Environment, Store};
use crate::{agents::AgentKind, usage};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakdownRow {
    agent_kind: AgentKind,
    model: Option<String>,
    effort: Option<String>,
    usage: usage::Summary,
}

impl Store {
    pub(crate) fn usage_breakdown(
        &self,
        environment: &Environment,
    ) -> Result<Vec<BreakdownRow>, String> {
        self.verify()?;
        let Some(environment_key) = codecs::environment_key(&self.connection, environment)? else {
            return Ok(Vec::new());
        };
        // Include current and historical slots, as the dashboard total does.
        let mut statement = self
            .connection
            .prepare(
                "SELECT r.record_id, g.native_session_id FROM session_groups g
             JOIN session_records r ON r.session_key=g.session_key
             WHERE g.environment_key=?1 AND r.exclusion_root_id IS NULL
             ORDER BY g.native_session_id, r.variant_key",
            )
            .map_err(error)?;
        let mut records = statement.query([environment_key]).map_err(error)?;
        let mut groups = BTreeMap::<_, usage::Summary>::new();
        while let Some(record) = records.next().map_err(error)? {
            let record_id: i64 = record.get(0).map_err(error)?;
            let session_id: String = record.get(1).map_err(error)?;
            let turns = codecs::read_turns(&self.connection, record_id)?;
            add_turns(&mut groups, usage::own_turns(&turns, &session_id));
        }
        Ok(groups
            .into_iter()
            .map(|((model, effort), usage)| BreakdownRow {
                agent_kind: environment.agent_kind,
                model,
                effort,
                usage,
            })
            .collect())
    }
}

fn add_turns(
    groups: &mut BTreeMap<(Option<String>, Option<String>), usage::Summary>,
    turns: BTreeMap<String, usage::TurnUsage>,
) {
    for turn in turns.into_values() {
        if turn.requests.is_empty() {
            groups.entry((None, None)).or_default().unmeasured_turns += 1;
        }
        for request in turn.requests {
            let group = (request.model.clone(), request.effort.clone());
            groups.entry(group).or_default().add_request(&request);
        }
    }
}
