//! Local history and link preview cache in one SQLite file.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Line {
    pub id: i64,
    pub net: String,
    pub buffer: String,
    pub ts: i64,
    pub kind: String,
    pub nick: String,
    pub mask: String,
    pub text: String,
    pub own: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BufferRef {
    pub net: String,
    pub buffer: String,
}

pub struct Store(Mutex<Connection>);

const SCHEMA: &str = "
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS lines (
  id INTEGER PRIMARY KEY,
  net TEXT NOT NULL,
  buffer TEXT NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  nick TEXT NOT NULL,
  mask TEXT NOT NULL,
  text TEXT NOT NULL,
  own INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lines_buffer ON lines (net, buffer COLLATE NOCASE, id);
CREATE TABLE IF NOT EXISTS previews (
  url TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  ts INTEGER NOT NULL
);
";

impl Store {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self(Mutex::new(conn)))
    }

    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn insert(&self, l: &Line) -> rusqlite::Result<i64> {
        let conn = self.conn();
        conn.execute(
            "INSERT INTO lines (net, buffer, ts, kind, nick, mask, text, own) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![l.net, l.buffer, l.ts, l.kind, l.nick, l.mask, l.text, l.own],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Latest `limit` lines before `before` (an id), oldest first.
    pub fn history(&self, net: &str, buffer: &str, before: i64, limit: i64) -> rusqlite::Result<Vec<Line>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, net, buffer, ts, kind, nick, mask, text, own FROM lines
             WHERE net = ?1 AND buffer = ?2 COLLATE NOCASE AND id < ?3
             ORDER BY id DESC LIMIT ?4",
        )?;
        let rows = stmt.query_map(params![net, buffer, before, limit], |r| {
            Ok(Line {
                id: r.get(0)?,
                net: r.get(1)?,
                buffer: r.get(2)?,
                ts: r.get(3)?,
                kind: r.get(4)?,
                nick: r.get(5)?,
                mask: r.get(6)?,
                text: r.get(7)?,
                own: r.get(8)?,
            })
        })?;
        let mut lines = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        lines.reverse();
        Ok(lines)
    }

    pub fn recent_buffers(&self, since: i64) -> rusqlite::Result<Vec<BufferRef>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT net, buffer FROM lines WHERE ts > ?1 AND buffer != ''
             GROUP BY net, buffer COLLATE NOCASE ORDER BY MIN(id)",
        )?;
        let rows = stmt.query_map(params![since], |r| Ok(BufferRef { net: r.get(0)?, buffer: r.get(1)? }))?;
        rows.collect()
    }

    pub fn preview_get(&self, url: &str) -> Option<String> {
        self.conn()
            .query_row("SELECT json FROM previews WHERE url = ?1", params![url], |r| r.get(0))
            .optional()
            .ok()
            .flatten()
    }

    pub fn preview_put(&self, url: &str, json: &str, ts: i64) {
        let _ = self.conn().execute(
            "INSERT OR REPLACE INTO previews (url, json, ts) VALUES (?1, ?2, ?3)",
            params![url, json, ts],
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_is_oldest_first_and_case_insensitive() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        for i in 0..5 {
            let line = Line { net: "n".into(), buffer: "#Linux".into(), ts: i, text: i.to_string(), ..Default::default() };
            store.insert(&line).unwrap();
        }
        let lines = store.history("n", "#linux", i64::MAX, 3).unwrap();
        let texts: Vec<_> = lines.iter().map(|l| l.text.as_str()).collect();
        assert_eq!(texts, vec!["2", "3", "4"]);
        assert_eq!(store.recent_buffers(-1).unwrap().len(), 1);
    }
}
