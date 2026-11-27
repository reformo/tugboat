use super::{codecs, error, Environment, Store};
use crate::{agents::AgentKind, usage};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, ops::Range};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DateRangeInput {
    start_milliseconds: i64,
    end_exclusive_milliseconds: i64,
}

impl DateRangeInput {
    pub(crate) fn parse(self) -> Result<Range<DateTime<Utc>>, String> {
        let start = DateTime::from_timestamp_millis(self.start_milliseconds)
            .ok_or("Invalid start date.")?;
        let end = DateTime::from_timestamp_millis(self.end_exclusive_milliseconds)
            .ok_or("Invalid end date.")?;
        if start > end {
            return Err("The end date is before the start date.".into());
        }
        Ok(start..end)
    }
}

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
        date_range: Option<&Range<DateTime<Utc>>>,
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
            add_turns(
                &mut groups,
                usage::own_turns(&turns, &session_id),
                date_range,
            );
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
    date_range: Option<&Range<DateTime<Utc>>>,
) {
    for turn in turns.into_values() {
        if turn.requests.is_empty() && date_range.is_none() {
            groups.entry((None, None)).or_default().unmeasured_turns += 1;
        }
        for request in turn.requests {
            if date_range.is_some_and(|range| {
                !DateTime::parse_from_rfc3339(&request.at)
                    .is_ok_and(|time| range.contains(&time.to_utc()))
            }) {
                continue;
            }
            let group = (request.model.clone(), request.effort.clone());
            groups.entry(group).or_default().add_request(&request);
        }
    }
}
