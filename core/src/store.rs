//! Local history and link preview cache in one SQLite file.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Talker {
    pub nick: String,
    pub words: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BufferRef {
    pub net: String,
    pub buffer: String,
}

/// Someone you know: a photo, a colour and every nick or pattern they show up as.
/// `photo` is a small image as a data URL; `nicks` may hold `*` patterns or `ident@host`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Person {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub photo: String,
    pub nicks: Vec<String>,
}

pub struct Store(Mutex<Connection>);

const LINE_COLUMNS: &str = "id, net, buffer, ts, kind, nick, mask, text, own";
const CHAT_KINDS: &str = "('msg', 'action', 'notice')";

fn line_row(r: &rusqlite::Row) -> rusqlite::Result<Line> {
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
}

/// Nicks may hold `_`, which LIKE would read as any character.
fn like_escape(word: &str) -> String {
    word.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

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
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  photo TEXT NOT NULL,
  nicks TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
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
        let mut stmt = conn.prepare(&format!(
            "SELECT {LINE_COLUMNS} FROM lines WHERE net = ?1 AND buffer = ?2 COLLATE NOCASE AND id < ?3 ORDER BY id DESC LIMIT ?4"
        ))?;
        let mut lines = stmt.query_map(params![net, buffer, before, limit], line_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        lines.reverse();
        Ok(lines)
    }

    /// `limit` lines on each side of line `id` in its channel, the line itself included, oldest first.
    pub fn around(&self, net: &str, buffer: &str, id: i64, limit: i64) -> rusqlite::Result<Vec<Line>> {
        let mut lines = self.history(net, buffer, id + 1, limit + 1)?;
        let conn = self.conn();
        let mut stmt = conn.prepare(&format!(
            "SELECT {LINE_COLUMNS} FROM lines WHERE net = ?1 AND buffer = ?2 COLLATE NOCASE AND id > ?3 ORDER BY id LIMIT ?4"
        ))?;
        lines.extend(stmt.query_map(params![net, buffer, id, limit], line_row)?.collect::<rusqlite::Result<Vec<_>>>()?);
        Ok(lines)
    }

    /// Words said per person in a channel between two times, most first, like toptod counts them:
    /// messages and actions, a nick in any letter case counted as one.
    pub fn talkers(&self, net: &str, buffer: &str, since: i64, until: i64) -> rusqlite::Result<Vec<Talker>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT nick, text FROM lines WHERE net = ?1 AND buffer = ?2 COLLATE NOCASE AND ts >= ?3 AND ts < ?4 AND kind IN ('msg', 'action') ORDER BY id",
        )?;
        let mut by_nick: HashMap<String, Talker> = HashMap::new();
        for row in stmt.query_map(params![net, buffer, since, until], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (nick, text) = row?;
            let entry = by_nick.entry(nick.to_lowercase()).or_insert(Talker { nick, words: 0 });
            entry.words += text.split_whitespace().count() as i64;
        }
        let mut out: Vec<Talker> = by_nick.into_values().collect();
        out.sort_by(|a, b| b.words.cmp(&a.words).then_with(|| a.nick.cmp(&b.nick)));
        Ok(out)
    }

    /// Chat lines by others between two line ids, for unread counts beyond what an app has loaded.
    pub fn count_unread(&self, net: &str, buffer: &str, after: i64, before: i64) -> rusqlite::Result<i64> {
        self.conn().query_row(
            &format!(
                "SELECT COUNT(*) FROM lines WHERE net = ?1 AND buffer = ?2 COLLATE NOCASE AND id > ?3 AND id < ?4 AND own = 0 AND kind IN {CHAT_KINDS}"
            ),
            params![net, buffer, after, before],
            |r| r.get(0),
        )
    }

    /// Newest chat lines by others that contain any of `words`, newest first. Callers check word edges.
    pub fn containing(&self, words: &[String], before: i64, limit: i64) -> rusqlite::Result<Vec<Line>> {
        let words: Vec<String> = words.iter().filter(|w| !w.is_empty()).map(|w| format!("%{}%", like_escape(w))).collect();
        if words.is_empty() {
            return Ok(vec![]);
        }
        let any = (0..words.len()).map(|i| format!("text LIKE ?{} ESCAPE '\\'", i + 3)).collect::<Vec<_>>().join(" OR ");
        let conn = self.conn();
        let mut stmt = conn.prepare(&format!(
            "SELECT {LINE_COLUMNS} FROM lines WHERE own = 0 AND kind IN {CHAT_KINDS} AND id < ?1 AND ({any}) ORDER BY id DESC LIMIT ?2"
        ))?;
        let mut args: Vec<&dyn rusqlite::ToSql> = vec![&before, &limit];
        args.extend(words.iter().map(|w| w as &dyn rusqlite::ToSql));
        stmt.query_map(args.as_slice(), line_row)?.collect()
    }

    /// Chat lines in a channel that carry a web address, newest first.
    pub fn with_links(&self, net: &str, buffer: &str, before: i64, limit: i64) -> rusqlite::Result<Vec<Line>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(&format!(
            "SELECT {LINE_COLUMNS} FROM lines WHERE net = ?1 AND buffer = ?2 COLLATE NOCASE AND id < ?3
             AND kind IN {CHAT_KINDS} AND (text LIKE '%http://%' OR text LIKE '%https://%') ORDER BY id DESC LIMIT ?4"
        ))?;
        stmt.query_map(params![net, buffer, before, limit], line_row)?.collect()
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

    pub fn people(&self) -> rusqlite::Result<Vec<Person>> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT id, name, color, photo, nicks FROM people ORDER BY name COLLATE NOCASE")?;
        let rows = stmt.query_map([], |r| {
            let nicks: String = r.get(4)?;
            Ok(Person {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                photo: r.get(3)?,
                nicks: serde_json::from_str(&nicks).unwrap_or_default(),
            })
        })?;
        rows.collect()
    }

    /// Insert a new person (id 0) or replace an existing one. Returns the id.
    pub fn save_person(&self, p: &Person) -> rusqlite::Result<i64> {
        let conn = self.conn();
        let nicks = serde_json::to_string(&p.nicks).unwrap_or_else(|_| "[]".into());
        if p.id == 0 {
            conn.execute(
                "INSERT INTO people (name, color, photo, nicks) VALUES (?1, ?2, ?3, ?4)",
                params![p.name, p.color, p.photo, nicks],
            )?;
            return Ok(conn.last_insert_rowid());
        }
        conn.execute(
            "UPDATE people SET name = ?2, color = ?3, photo = ?4, nicks = ?5 WHERE id = ?1",
            params![p.id, p.name, p.color, p.photo, nicks],
        )?;
        Ok(p.id)
    }

    pub fn delete_person(&self, id: i64) -> rusqlite::Result<()> {
        self.conn().execute("DELETE FROM people WHERE id = ?1", params![id]).map(|_| ())
    }

    pub fn settings(&self) -> rusqlite::Result<HashMap<String, String>> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        self.conn().execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)", params![key, value]).map(|_| ())
    }

    pub fn preview_get(&self, url: &str) -> Option<String> {
        self.conn().query_row("SELECT json FROM previews WHERE url = ?1", params![url], |r| r.get(0)).optional().ok().flatten()
    }

    pub fn preview_put(&self, url: &str, json: &str, ts: i64) {
        let _ = self.conn().execute("INSERT OR REPLACE INTO previews (url, json, ts) VALUES (?1, ?2, ?3)", params![url, json, ts]);
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

    fn line(buffer: &str, kind: &str, text: &str, own: bool) -> Line {
        Line { net: "n".into(), buffer: buffer.into(), kind: kind.into(), text: text.into(), own, ..Default::default() }
    }

    #[test]
    fn finds_lines_around_one() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        for i in 0..10 {
            store.insert(&line(if i % 2 == 0 { "#a" } else { "#b" }, "msg", &i.to_string(), false)).unwrap();
        }
        let texts: Vec<_> = store.around("n", "#a", 5, 1).unwrap().into_iter().map(|l| l.text).collect();
        assert_eq!(texts, vec!["2", "4", "6"]);
    }

    #[test]
    fn counts_words_per_person_between_two_times() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let say = |nick: &str, kind: &str, text: &str, ts: i64| {
            store.insert(&Line { nick: nick.into(), ts, ..line("#a", kind, text, false) }).unwrap();
        };
        say("kaisla", "msg", "moi kaikki täällä", 100);
        say("Kaisla", "action", "heiluttaa", 150);
        say("otso", "msg", "moro", 120);
        say("otso", "notice", "ei lasketa tätä", 130);
        say("otso", "msg", "liian myöhään", 300);
        say("kaisla", "join", "", 110);
        let top = store.talkers("n", "#A", 100, 200).unwrap();
        assert_eq!(top, vec![Talker { nick: "kaisla".into(), words: 4 }, Talker { nick: "otso".into(), words: 1 }]);
    }

    #[test]
    fn counts_unread_between_two_lines() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        for i in 0..10 {
            store.insert(&line("#a", "msg", &i.to_string(), i == 3)).unwrap();
        }
        store.insert(&line("#a", "join", "x", false)).unwrap();
        store.insert(&line("#b", "msg", "x", false)).unwrap();
        // Ids 1..=12: after 1 and before 11 are ids 2..=10, less id 4 (own).
        assert_eq!(store.count_unread("n", "#A", 1, 11).unwrap(), 8);
        assert_eq!(store.count_unread("n", "#a", 10, i64::MAX).unwrap(), 0);
    }

    #[test]
    fn finds_mentions_and_links() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        store.insert(&line("#a", "msg", "moi Rolle_", false)).unwrap();
        store.insert(&line("#a", "msg", "rolleX ei", false)).unwrap();
        store.insert(&line("#a", "msg", "rolle_ itse", true)).unwrap();
        store.insert(&line("#a", "join", "rolle_", false)).unwrap();
        store.insert(&line("#a", "msg", "katso https://example.org", false)).unwrap();
        let found: Vec<_> = store.containing(&["rolle_".into()], i64::MAX, 10).unwrap().into_iter().map(|l| l.text).collect();
        assert_eq!(found, vec!["moi Rolle_"]);
        assert!(store.containing(&[], i64::MAX, 10).unwrap().is_empty());
        let links = store.with_links("n", "#A", i64::MAX, 10).unwrap();
        assert_eq!(links.len(), 1);
    }

    #[test]
    fn saves_people_and_settings() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let mut p = Person { name: "Kaisla".into(), nicks: vec!["kaisla".into(), "kaisla*".into()], ..Default::default() };
        p.id = store.save_person(&p).unwrap();
        p.color = "#ff9e64".into();
        store.save_person(&p).unwrap();
        assert_eq!(store.people().unwrap(), vec![p.clone()]);
        store.delete_person(p.id).unwrap();
        assert!(store.people().unwrap().is_empty());

        store.set_setting("reactions", "{}").unwrap();
        assert_eq!(store.settings().unwrap().get("reactions").map(String::as_str), Some("{}"));
    }
}
