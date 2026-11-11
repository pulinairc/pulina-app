//! A channel's public log, loaded before connecting so its history has no hole.

use crate::store::{Line, Store};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Deserialize)]
pub struct Backlog {
    pub url: String,
    pub channel: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LogLine {
    pub ts: i64,
    pub nick: String,
    pub kind: String,
    pub text: String,
}

#[derive(Deserialize)]
struct Page {
    lines: Vec<LogLine>,
}

/// A first start loads this many; later starts fill in only what came since.
const FIRST_LINES: usize = 5000;
const TIMEOUT: Duration = Duration::from_secs(10);
/// The log knows minutes only, so a message sits up to this far from its live copy.
const SAME_LINE_MS: i64 = 120_000;

impl Backlog {
    /// Fetch and store what the log holds after the newest line here; how many were added.
    pub async fn fill(&self, store: &Store, net: &str, me: &str) -> Result<usize, String> {
        let newest = store.newest_ts(net, &self.channel).map_err(|e| e.to_string())?;
        let mut query = format!("limit={FIRST_LINES}");
        if let Some(ts) = newest {
            query.push_str(&format!("&after={}", ts - SAME_LINE_MS));
        }
        let lines = self.get(&query).await?;
        Ok(self.store_lines(store, net, me, newest, lines))
    }

    /// The newest `limit` lines, oldest first.
    pub async fn peek(&self, limit: usize) -> Result<Vec<LogLine>, String> {
        self.get(&format!("limit={limit}")).await
    }

    async fn get(&self, query: &str) -> Result<Vec<LogLine>, String> {
        let url = format!("{}?{query}", self.url);
        let client = crate::http().timeout(TIMEOUT).build().map_err(|e| e.to_string())?;
        let text = client
            .get(url)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|e| e.to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())?;
        let page: Page = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        Ok(page.lines)
    }

    fn store_lines(&self, store: &Store, net: &str, me: &str, newest: Option<i64>, lines: Vec<LogLine>) -> usize {
        let mut fresh = Vec::new();
        for l in lines {
            if !matches!(l.kind.as_str(), "msg" | "action") {
                continue;
            }
            let near_newest = newest.is_some_and(|n| l.ts <= n + SAME_LINE_MS);
            if near_newest && store.has_line(net, &self.channel, &l.nick, &l.text, l.ts - SAME_LINE_MS, l.ts + SAME_LINE_MS).unwrap_or(true)
            {
                continue;
            }
            let own = l.nick.eq_ignore_ascii_case(me);
            fresh.push(Line {
                net: net.into(),
                buffer: self.channel.clone(),
                ts: l.ts,
                kind: l.kind,
                nick: l.nick,
                text: l.text,
                own,
                ..Default::default()
            });
        }
        store.insert_all(&fresh).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn log(ts: i64, nick: &str, text: &str) -> LogLine {
        LogLine { ts, nick: nick.into(), kind: "msg".into(), text: text.into() }
    }

    #[test]
    fn adds_only_what_was_not_seen_live() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let live = Line {
            net: "P".into(),
            buffer: "#pulina".into(),
            ts: 1_000_030_000,
            kind: "msg".into(),
            nick: "otso".into(),
            text: "moi".into(),
            ..Default::default()
        };
        store.insert(&live).unwrap();
        let backlog = Backlog { url: String::new(), channel: "#pulina".into() };
        let newest = store.newest_ts("P", "#pulina").unwrap();
        assert_eq!(newest, Some(1_000_030_000));
        // The log has minutes only: the live line shows up 30 s earlier.
        let added = backlog.store_lines(
            &store,
            "P",
            "aurora",
            newest,
            vec![log(1_000_000_000, "otso", "moi"), log(1_000_060_000, "Aurora", "hei")],
        );
        assert_eq!(added, 1);
        let lines = store.history("P", "#pulina", i64::MAX, 10).unwrap();
        assert_eq!(lines.len(), 2);
        assert!(lines[1].own);
    }
}
