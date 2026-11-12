//! Channel state for one IRC connection: turns incoming lines into events.

use crate::irc::{self, Msg};
use crate::store::Line;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

/// Mode letters and their name prefixes, highest first, until the server says otherwise.
const DEFAULT_PREFIX: [(char, char); 5] = [('q', '~'), ('a', '&'), ('o', '@'), ('h', '%'), ('v', '+')];
/// Channel modes that always take a parameter, and those that take one only when set.
const DEFAULT_PARAM_MODES: &str = "beIk";
const DEFAULT_SET_PARAM_MODES: &str = "l";
/// RFC 1459's limit for mode changes in one line, used until ISUPPORT names the server's own.
pub const DEFAULT_MODES_PER_LINE: usize = 3;
/// "MODES" with no number means no limit; one line still has to fit 512 bytes.
const UNLIMITED_MODES_PER_LINE: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BufferInfo {
    pub net: String,
    pub name: String,
    pub topic: String,
    pub members: Vec<String>,
    pub joined: bool,
    /// Name prefixes by nick, highest first ("@", "@+", "+"); nicks without any are left out.
    #[serde(default)]
    pub modes: BTreeMap<String, String>,
    /// Shared profile pictures by nick, from the picture link in their real name.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub avatars: BTreeMap<String, String>,
}

/// Where Lobby and Pulina keep profile pictures; a real name holding such a link shares that picture.
pub const AVATAR_BASE: &str = "https://chat.pulina.fi/a/";
const AVATAR_ID_LEN: usize = 16;
/// One WHO per joining nick at most this often, so a netsplit's rejoins cannot flood the server.
const WHO_GAP_MS: i64 = 2000;

/// The picture link in a real name, if it holds one of ours.
pub fn avatar_in(realname: &str) -> Option<String> {
    let start = realname.find(AVATAR_BASE)?;
    let id: String = realname[start + AVATAR_BASE.len()..].chars().take_while(char::is_ascii_hexdigit).collect();
    (id.len() == AVATAR_ID_LEN).then(|| format!("{AVATAR_BASE}{id}"))
}

/// What WHOIS told about a nick, sent as one piece once the server says it is done.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Whois {
    pub net: String,
    pub nick: String,
    pub found: bool,
    pub user: String,
    pub host: String,
    pub realname: String,
    pub server: String,
    pub server_info: String,
    pub channels: String,
    pub account: String,
    pub away: String,
    pub idle_secs: Option<u64>,
    pub signon: Option<i64>,
    pub secure: bool,
    pub oper: bool,
}

#[derive(Debug, PartialEq)]
pub enum Out {
    Line(Line),
    Buffer(BufferInfo),
    Me(String),
    /// Our own user@host, as the server shows it to others.
    Mask(String),
    Send(String),
    Whois(Whois),
    ModesPerLine(usize),
}

/// WHOIS replies, gathered into a `Whois` instead of shown as text.
const WHOIS_NUMERICS: [&str; 11] = ["301", "311", "312", "313", "317", "318", "319", "330", "338", "378", "671"];

#[derive(Default)]
struct Chan {
    name: String,
    topic: String,
    members: HashMap<String, String>,
    /// Name prefixes by lower-case nick, only for nicks that have one.
    modes: HashMap<String, String>,
    pending_names: Vec<(String, String)>,
}

/// What ISUPPORT (005) says about the server's channel modes.
struct Support {
    prefix: Vec<(char, char)>,
    param_modes: String,
    set_param_modes: String,
}

impl Default for Support {
    fn default() -> Self {
        Self { prefix: DEFAULT_PREFIX.to_vec(), param_modes: DEFAULT_PARAM_MODES.into(), set_param_modes: DEFAULT_SET_PARAM_MODES.into() }
    }
}

impl Support {
    fn symbol(&self, mode: char) -> Option<char> {
        self.prefix.iter().find(|(m, _)| *m == mode).map(|(_, s)| *s)
    }

    fn is_symbol(&self, c: char) -> bool {
        self.prefix.iter().any(|(_, s)| *s == c)
    }

    /// The symbols in `held`, in the server's order, highest first.
    fn ranked(&self, held: impl Fn(char) -> bool) -> String {
        self.prefix.iter().map(|(_, s)| *s).filter(|s| held(*s)).collect()
    }

    /// "(qaohv)~&@%+" into letter and symbol pairs.
    fn parse_prefix(value: &str) -> Option<Vec<(char, char)>> {
        let (letters, symbols) = value.strip_prefix('(')?.split_once(')')?;
        (letters.chars().count() == symbols.chars().count()).then(|| letters.chars().zip(symbols.chars()).collect())
    }
}

/// Split a NAMES entry like "@+kaisla" into its prefixes and the nick.
fn split_name<'a>(support: &Support, name: &'a str) -> (String, &'a str) {
    let nick = name.trim_start_matches(|c| support.is_symbol(c));
    let held = &name[..name.len() - nick.len()];
    (support.ranked(|s| held.contains(s)), nick)
}

/// Numerics worth showing: everything except the connection burst and the ones handled above.
fn is_reply_numeric(cmd: &str) -> bool {
    const BURST: [&str; 17] =
        ["001", "002", "003", "004", "005", "250", "251", "252", "253", "254", "255", "265", "266", "372", "375", "376", "422"];
    cmd.len() == 3 && cmd.bytes().all(|b| b.is_ascii_digit()) && !BURST.contains(&cmd) && !matches!(cmd, "332" | "333" | "353" | "366")
}

// QuakeNet's limit, the shortest of the networks in use.
const NICK_MAX: usize = 15;

/// milla_ first, then milla2, milla3: cut short so the suffix still fits.
fn stand_in_nick(wanted: &str, tries: usize) -> String {
    let suffix = if tries == 1 { "_".to_string() } else { tries.to_string() };
    let base: String = wanted.chars().take(NICK_MAX - suffix.len()).collect();
    format!("{base}{suffix}")
}

pub struct Session {
    net: String,
    me: String,
    /// The nick asked for: taken at sign-on, another one stands in until it frees up.
    wanted: String,
    registered: bool,
    nick_tries: usize,
    chans: HashMap<String, Chan>,
    whois: HashMap<String, Whois>,
    support: Support,
    /// Picture links by lower-case nick, and the WHOs asked for them that have not ended yet.
    avatars: HashMap<String, String>,
    who_pending: HashSet<String>,
    who_seen: HashSet<String>,
    last_who: i64,
}

fn same(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

impl Session {
    pub fn new(net: &str, me: &str) -> Self {
        Self {
            net: net.to_string(),
            me: me.to_string(),
            wanted: me.to_string(),
            registered: false,
            nick_tries: 0,
            chans: HashMap::new(),
            whois: HashMap::new(),
            support: Support::default(),
            avatars: HashMap::new(),
            who_pending: HashSet::new(),
            who_seen: HashSet::new(),
            last_who: i64::MIN / 2,
        }
    }

    fn line(&self, buffer: &str, kind: &str, msg: &Msg, text: &str, now: i64) -> Line {
        Line {
            id: 0,
            net: self.net.clone(),
            buffer: buffer.to_string(),
            ts: now,
            kind: kind.to_string(),
            nick: msg.nick().to_string(),
            mask: msg.mask().to_string(),
            text: text.to_string(),
            own: same(msg.nick(), &self.me),
        }
    }

    fn info(&self, chan: &Chan, joined: bool) -> Out {
        let mut members: Vec<String> = chan.members.values().cloned().collect();
        members.sort_by_key(|m| m.to_lowercase());
        let modes = chan.modes.iter().filter_map(|(key, held)| Some((chan.members.get(key)?.clone(), held.clone()))).collect();
        let avatars = chan.members.iter().filter_map(|(key, nick)| Some((nick.clone(), self.avatars.get(key)?.clone()))).collect();
        Out::Buffer(BufferInfo {
            net: self.net.clone(),
            name: chan.name.clone(),
            topic: chan.topic.clone(),
            members,
            joined,
            modes,
            avatars,
        })
    }

    /// ISUPPORT: the name prefixes, which modes take a parameter, and how many fit one line.
    fn on_support(&mut self, msg: &Msg) -> Vec<Out> {
        let mut out = Vec::new();
        let tokens = msg.params.iter().skip(1).take(msg.params.len().saturating_sub(2));
        for token in tokens {
            let (name, value) = token.split_once('=').unwrap_or((token, ""));
            match name {
                "PREFIX" => {
                    if let Some(prefix) = Support::parse_prefix(value) {
                        self.support.prefix = prefix;
                    }
                }
                "CHANMODES" => {
                    let kinds: Vec<&str> = value.split(',').collect();
                    if kinds.len() >= 3 {
                        self.support.param_modes = format!("{}{}", kinds[0], kinds[1]);
                        self.support.set_param_modes = kinds[2].to_string();
                    }
                }
                "MODES" => out.push(Out::ModesPerLine(value.parse().unwrap_or(UNLIMITED_MODES_PER_LINE))),
                _ => {}
            }
        }
        out
    }

    /// Apply a channel MODE line to the name prefixes. True when any prefix changed.
    fn apply_modes(&mut self, key: &str, params: &[String]) -> bool {
        let Some(chan) = self.chans.get_mut(key) else { return false };
        let Some((changes, args)) = params.split_first() else { return false };
        let mut args = args.iter();
        let mut adding = true;
        let mut changed = false;
        for mode in changes.chars() {
            match mode {
                '+' => adding = true,
                '-' => adding = false,
                _ => {
                    if let Some(symbol) = self.support.symbol(mode) {
                        let Some(nick) = args.next() else { continue };
                        let nick = nick.to_lowercase();
                        let held = chan.modes.remove(&nick).unwrap_or_default();
                        let next = self.support.ranked(|s| if s == symbol { adding } else { held.contains(s) });
                        if !next.is_empty() {
                            chan.modes.insert(nick, next);
                        }
                        changed = true;
                    } else if self.support.param_modes.contains(mode) || (adding && self.support.set_param_modes.contains(mode)) {
                        args.next();
                    }
                }
            }
        }
        changed
    }

    /// The wanted nick back once whoever held it leaves or changes away from it.
    fn win_back(&self, gone: &str) -> Option<Out> {
        (self.registered && same(gone, &self.wanted) && !same(&self.me, &self.wanted)).then(|| Out::Send(format!("NICK {}", self.wanted)))
    }

    /// Channels a nick is on, as display names.
    fn chans_with(&self, nick: &str) -> Vec<String> {
        let key = nick.to_lowercase();
        self.chans.values().filter(|c| c.members.contains_key(&key)).map(|c| c.name.clone()).collect()
    }

    pub fn handle(&mut self, msg: &Msg, now: i64) -> Vec<Out> {
        let nick = msg.nick().to_string();
        let is_me = same(&nick, &self.me);

        match msg.command.as_str() {
            "PING" => vec![Out::Send(format!("PONG :{}", msg.param(0)))],
            "001" => {
                self.registered = true;
                self.me = msg.param(0).to_string();
                vec![Out::Me(self.me.clone())]
            }
            // Nick in use, or held for a while after a split: without another one the server cuts the link.
            "433" | "437" if !self.registered => {
                self.nick_tries += 1;
                self.me = stand_in_nick(&self.wanted, self.nick_tries);
                vec![Out::Send(format!("NICK {}", self.me))]
            }
            "PRIVMSG" | "NOTICE" => self.on_message(msg, now),
            "005" => self.on_support(msg),
            "MODE" => {
                let key = msg.param(0).to_lowercase();
                let Some(chan) = self.chans.get(&key) else { return vec![] };
                let name = chan.name.clone();
                let mut out = vec![Out::Line(self.line(&name, "mode", msg, &msg.params[1..].join(" "), now))];
                if self.apply_modes(&key, &msg.params[1..]) {
                    out.push(self.info(&self.chans[&key], true));
                }
                out
            }
            "JOIN" => {
                let name = msg.param(0).to_string();
                let key = name.to_lowercase();
                if is_me {
                    let chan = Chan { name: name.clone(), ..Default::default() };
                    let out = self.info(&chan, true);
                    self.chans.insert(key, chan);
                    return vec![out, Out::Mask(msg.mask().to_string()), Out::Line(self.line(&name, "join", msg, "", now))];
                }
                let Some(chan) = self.chans.get_mut(&key) else { return vec![] };
                chan.members.insert(nick.to_lowercase(), nick.clone());
                let name = chan.name.clone();
                let mut out = vec![Out::Line(self.line(&name, "join", msg, "", now))];
                out.extend(self.ask_who(&nick, now));
                out
            }
            "PART" => {
                let key = msg.param(0).to_lowercase();
                if is_me {
                    let Some(chan) = self.chans.remove(&key) else { return vec![] };
                    return vec![self.info(&chan, false)];
                }
                let Some(chan) = self.chans.get_mut(&key) else { return vec![] };
                chan.members.remove(&nick.to_lowercase());
                chan.modes.remove(&nick.to_lowercase());
                let name = chan.name.clone();
                vec![Out::Line(self.line(&name, "part", msg, msg.param(1), now))]
            }
            "KICK" => {
                let key = msg.param(0).to_lowercase();
                let victim = msg.param(1).to_string();
                let Some(chan) = self.chans.get_mut(&key) else { return vec![] };
                chan.members.remove(&victim.to_lowercase());
                chan.modes.remove(&victim.to_lowercase());
                let name = chan.name.clone();
                let mut line = self.line(&name, "kick", msg, msg.param(2), now);
                line.text = format!("{nick}: {}", msg.param(2));
                line.nick = victim.clone();
                line.own = same(&victim, &self.me);
                let mut out = vec![Out::Line(line)];
                if same(&victim, &self.me)
                    && let Some(chan) = self.chans.remove(&key)
                {
                    out.push(self.info(&chan, false));
                }
                out
            }
            "QUIT" => {
                let names = self.chans_with(&nick);
                let mut out = Vec::new();
                for name in names {
                    if let Some(chan) = self.chans.get_mut(&name.to_lowercase()) {
                        chan.members.remove(&nick.to_lowercase());
                        chan.modes.remove(&nick.to_lowercase());
                    }
                    out.push(Out::Line(self.line(&name, "quit", msg, msg.param(0), now)));
                }
                out.extend(self.win_back(&nick));
                out
            }
            "NICK" => {
                let new = msg.param(0).to_string();
                let mut out = Vec::new();
                if is_me {
                    // A nick picked after sign-on is the one wanted from now on.
                    self.me = new.clone();
                    self.wanted = new.clone();
                    out.push(Out::Me(new.clone()));
                }
                if let Some(url) = self.avatars.remove(&nick.to_lowercase()) {
                    self.avatars.insert(new.to_lowercase(), url);
                }
                for name in self.chans_with(&nick) {
                    if let Some(chan) = self.chans.get_mut(&name.to_lowercase()) {
                        chan.members.remove(&nick.to_lowercase());
                        chan.members.insert(new.to_lowercase(), new.clone());
                        if let Some(held) = chan.modes.remove(&nick.to_lowercase()) {
                            chan.modes.insert(new.to_lowercase(), held);
                        }
                    }
                    out.push(Out::Line(self.line(&name, "nick", msg, &new, now)));
                }
                if !is_me {
                    out.extend(self.win_back(&nick));
                }
                out
            }
            "TOPIC" => {
                let key = msg.param(0).to_lowercase();
                let Some(chan) = self.chans.get_mut(&key) else { return vec![] };
                chan.topic = msg.param(1).to_string();
                let name = chan.name.clone();
                let line = self.line(&name, "topic", msg, msg.param(1), now);
                let info = self.info(&self.chans[&key], true);
                vec![Out::Line(line), info]
            }
            "332" => {
                let key = msg.param(1).to_lowercase();
                let Some(chan) = self.chans.get_mut(&key) else { return vec![] };
                chan.topic = msg.param(2).to_string();
                vec![self.info(&self.chans[&key], true)]
            }
            "353" => {
                let key = msg.param(2).to_lowercase();
                if let Some(chan) = self.chans.get_mut(&key) {
                    let support = &self.support;
                    let names = msg.param(3).split_whitespace().map(|n| {
                        let (held, nick) = split_name(support, n);
                        (held, nick.to_string())
                    });
                    chan.pending_names.extend(names);
                }
                vec![]
            }
            "366" => {
                let key = msg.param(1).to_lowercase();
                let Some(chan) = self.chans.get_mut(&key) else { return vec![] };
                let names = std::mem::take(&mut chan.pending_names);
                chan.modes = names.iter().filter(|(held, _)| !held.is_empty()).map(|(held, n)| (n.to_lowercase(), held.clone())).collect();
                chan.members = names.into_iter().map(|(_, n)| (n.to_lowercase(), n)).collect();
                let name = chan.name.clone();
                self.who_pending.insert(key.clone());
                vec![Out::Send(format!("WHO {name}")), self.info(&self.chans[&key], true)]
            }
            // WHO answers asked for the picture links in real names; a WHO typed by hand still shows.
            "352" if !self.who_pending.is_empty() => {
                let nick = msg.param(5).to_lowercase();
                let realname = msg.params.last().and_then(|p| p.split_once(' ')).map_or("", |(_, r)| r);
                self.who_seen.insert(nick.clone());
                match avatar_in(realname) {
                    Some(url) => self.avatars.insert(nick, url),
                    None => self.avatars.remove(&nick),
                };
                vec![]
            }
            "315" if self.who_pending.remove(&msg.param(1).to_lowercase()) => self.chans.values().map(|c| self.info(c, true)).collect(),
            "ERROR" => vec![Out::Line(self.line("", "status", msg, msg.param(0), now))],
            // 301 also answers a message to someone away; only a WHOIS in progress takes it.
            cmd if WHOIS_NUMERICS.contains(&cmd) && (cmd != "301" || self.whois.contains_key(&msg.param(1).to_lowercase())) => {
                self.on_whois(msg)
            }
            "401" if self.whois.contains_key(&msg.param(1).to_lowercase()) => {
                self.whois.remove(&msg.param(1).to_lowercase());
                let text = msg.params.iter().skip(1).cloned().collect::<Vec<_>>().join(" ");
                let gone = Whois { net: self.net.clone(), nick: msg.param(1).to_string(), ..Default::default() };
                vec![Out::Whois(gone), Out::Line(self.line("", "info", msg, &text, now))]
            }
            // A message the channel refused (not joined, moderated, banned) belongs in that channel, not the server window.
            "404" => {
                let text = msg.params.iter().skip(2).cloned().collect::<Vec<_>>().join(" ");
                vec![Out::Line(self.line(msg.param(1), "info", msg, &text, now))]
            }
            // Answers to commands (WHOIS, errors like "no such nick") as readable text.
            cmd if is_reply_numeric(cmd) => {
                let text = msg.params.iter().skip(1).cloned().collect::<Vec<_>>().join(" ");
                vec![Out::Line(self.line("", "info", msg, &text, now))]
            }
            _ => vec![],
        }
    }

    /// A WHO for one joining nick, unless known already or one was asked a moment ago.
    fn ask_who(&mut self, nick: &str, now: i64) -> Option<Out> {
        let key = nick.to_lowercase();
        if self.who_seen.contains(&key) || now - self.last_who < WHO_GAP_MS {
            return None;
        }
        self.last_who = now;
        self.who_pending.insert(key);
        Some(Out::Send(format!("WHO {nick}")))
    }

    fn on_whois(&mut self, msg: &Msg) -> Vec<Out> {
        let nick = msg.param(1);
        let key = nick.to_lowercase();
        if msg.command == "318" {
            return self.whois.remove(&key).map(Out::Whois).into_iter().collect();
        }
        let w = self.whois.entry(key).or_insert_with(|| Whois {
            net: self.net.clone(),
            nick: nick.to_string(),
            found: true,
            ..Default::default()
        });
        let last = msg.params.last().map(String::as_str).unwrap_or("");
        match msg.command.as_str() {
            "311" => {
                w.user = msg.param(2).to_string();
                w.host = msg.param(3).to_string();
                w.realname = last.to_string();
            }
            "312" => {
                w.server = msg.param(2).to_string();
                w.server_info = last.to_string();
            }
            "313" => w.oper = true,
            "317" => {
                w.idle_secs = msg.param(2).parse().ok();
                w.signon = msg.param(3).parse().ok();
            }
            "319" => {
                if !w.channels.is_empty() {
                    w.channels.push(' ');
                }
                w.channels.push_str(last.trim());
            }
            "330" => w.account = msg.param(2).to_string(),
            "301" => w.away = last.to_string(),
            "671" => w.secure = true,
            _ => {}
        }
        vec![]
    }

    fn on_message(&mut self, msg: &Msg, now: i64) -> Vec<Out> {
        let target = msg.param(0);
        let raw = msg.param(1);
        let from = msg.nick();
        let notice = msg.command == "NOTICE";

        let ctcp;
        let (kind, text) = match irc::action(raw) {
            Some(text) => ("action", text),
            None if irc::is_ctcp(raw) => {
                ctcp = ctcp_line(raw, notice, from, irc::is_channel(target));
                (ctcp.0, ctcp.1.as_str())
            }
            None if notice => ("notice", raw),
            None => ("msg", raw),
        };

        let buffer = if irc::is_channel(target) {
            target
        } else if notice || msg.mask().is_empty() {
            ""
        } else if same(from, &self.me) {
            target
        } else {
            from
        };

        vec![Out::Line(self.line(buffer, kind, msg, text, now))]
    }
}

/// A CTCP request, reply or DCC offer said in words. irssi answers requests and takes DCC itself,
/// so these only tell what happened.
fn ctcp_line(raw: &str, reply: bool, from: &str, to_channel: bool) -> (&'static str, String) {
    let inner = raw.trim_matches('\u{1}');
    let (command, rest) = inner.split_once(' ').unwrap_or((inner, ""));
    let command = command.to_ascii_uppercase();
    if reply {
        let rest = if rest.is_empty() { String::new() } else { format!(": {rest}") };
        return ("ctcp", format!("answered {command}{rest}"));
    }
    if command != "DCC" {
        let whose = if to_channel { "the channel for" } else { "for your" };
        return ("ctcp", format!("asked {whose} {command}"));
    }
    let (kind, args) = rest.split_once(' ').unwrap_or((rest, ""));
    let text = match kind.to_ascii_uppercase().as_str() {
        "SEND" => {
            let (name, tail) = match args.strip_prefix('"') {
                Some(quoted) => quoted.split_once('"').unwrap_or((quoted, "")),
                None => args.split_once(' ').unwrap_or((args, "")),
            };
            let size = tail.split_whitespace().nth(2).and_then(|n| n.parse::<u64>().ok());
            let size = size.map(|n| format!(" ({})", file_size(n))).unwrap_or_default();
            format!("offers a file: {name}{size}. Take it in irssi with /dcc get {from}")
        }
        "CHAT" => format!("asks for a DCC chat. Answer it in irssi with /dcc chat {from}"),
        other => format!("sent a DCC {other}"),
    };
    ("dcc", text)
}

/// 2621440 as "2,5 MB".
fn file_size(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut size = bytes as f64;
    let mut unit = 0;
    while size >= 1024.0 && unit < UNITS.len() - 1 {
        size /= 1024.0;
        unit += 1;
    }
    let shown = if unit == 0 { format!("{size}") } else { format!("{size:.1}").trim_end_matches(".0").replace('.', ",") };
    format!("{shown} {}", UNITS[unit])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(s: &mut Session, line: &str) -> Vec<Out> {
        s.handle(&irc::parse(line).unwrap(), 1)
    }

    fn lines(outs: &[Out]) -> Vec<(String, String, String)> {
        outs.iter()
            .filter_map(|o| match o {
                Out::Line(l) => Some((l.buffer.clone(), l.kind.clone(), l.nick.clone())),
                _ => None,
            })
            .collect()
    }

    fn sent(outs: &[Out]) -> Vec<String> {
        outs.iter()
            .filter_map(|o| match o {
                Out::Send(l) => Some(l.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn takes_another_nick_when_taken_and_wins_it_back() {
        let mut s = Session::new("net", "milla");
        assert_eq!(sent(&feed(&mut s, ":srv 433 * milla :Nickname is already in use.")), vec!["NICK milla_"]);
        assert_eq!(sent(&feed(&mut s, ":srv 433 * milla_ :Nickname is already in use.")), vec!["NICK milla2"]);
        let mut long = Session::new("net", "fifteencharsabc");
        assert_eq!(sent(&feed(&mut long, ":srv 433 * fifteencharsabc :in use")), vec!["NICK fifteencharsab_"]);

        feed(&mut s, ":srv 001 milla2 :Welcome");
        assert!(sent(&feed(&mut s, ":srv 433 milla2 rolle :Nickname is already in use.")).is_empty());

        feed(&mut s, ":milla2!m@h JOIN #pulina");
        feed(&mut s, ":srv 353 milla2 = #pulina :milla2 milla");
        assert_eq!(sent(&feed(&mut s, ":milla!m@other QUIT :bye")), vec!["NICK milla"]);
        feed(&mut s, ":milla2!m@h NICK milla");
        assert!(sent(&feed(&mut s, ":kaisla!k@h QUIT :bye")).is_empty());

        feed(&mut s, ":milla!m@h NICK mimmi");
        feed(&mut s, ":milla!x@y JOIN #pulina");
        assert!(sent(&feed(&mut s, ":milla!x@y QUIT :bye")).is_empty());
    }

    #[test]
    fn routes_quits_and_nicks_to_shared_channels() {
        let mut s = Session::new("net", "rolle");
        feed(&mut s, ":rolle!r@h JOIN #a");
        feed(&mut s, ":rolle!r@h JOIN #B");
        feed(&mut s, ":srv 353 rolle = #a :@rolle kaisla jaska");
        feed(&mut s, ":srv 366 rolle #a :End");
        feed(&mut s, ":kaisla!s@h JOIN #b");

        let out = feed(&mut s, ":kaisla!s@h NICK Kaisla_");
        let mut got = lines(&out);
        got.sort();
        assert_eq!(got, vec![("#B".into(), "nick".into(), "kaisla".into()), ("#a".into(), "nick".into(), "kaisla".into())]);

        let out = feed(&mut s, ":Kaisla_!s@h QUIT :bye");
        assert_eq!(lines(&out).len(), 2);

        let out = feed(&mut s, ":jaska!j@h QUIT :bye");
        assert_eq!(lines(&out), vec![("#a".into(), "quit".into(), "jaska".into())]);
    }

    #[test]
    fn own_join_shows_and_a_refused_message_lands_in_its_channel() {
        let mut s = Session::new("net", "rolle");
        let out = feed(&mut s, ":rolle!r@h JOIN #a");
        assert_eq!(lines(&out), vec![("#a".into(), "join".into(), "rolle".into())]);

        let out = feed(&mut s, ":srv 404 rolle #b :Cannot send to channel");
        assert_eq!(lines(&out), vec![("#b".into(), "info".into(), "srv".into())]);
    }

    #[test]
    fn reads_picture_links_from_who_replies() {
        let mut s = Session::new("net", "rolle");
        feed(&mut s, ":rolle!r@h JOIN #a");
        feed(&mut s, ":srv 353 rolle = #a :rolle kaisla jaska");
        let out = feed(&mut s, ":srv 366 rolle #a :End");
        assert!(out.iter().any(|o| matches!(o, Out::Send(l) if l == "WHO #a")));
        assert!(feed(&mut s, ":srv 352 rolle #a ka h srv kaisla H :0 Kaisla https://chat.pulina.fi/a/0123456789abcdef").is_empty());
        assert!(feed(&mut s, ":srv 352 rolle #a ja h srv jaska H :0 Lobby").is_empty());
        let out = feed(&mut s, ":srv 315 rolle #a :End of /WHO list.");
        let Some(Out::Buffer(info)) = out.first() else { panic!("no buffer info") };
        assert_eq!(info.avatars.get("kaisla").map(String::as_str), Some("https://chat.pulina.fi/a/0123456789abcdef"));
        assert!(!info.avatars.contains_key("jaska"));
        // A WHO typed by hand still shows as text.
        assert_eq!(lines(&feed(&mut s, ":srv 352 rolle #a ja h srv jaska H :0 Lobby")).len(), 1);
    }

    #[test]
    fn finds_only_whole_picture_links() {
        assert_eq!(
            avatar_in("x https://chat.pulina.fi/a/0123456789abcdef y").as_deref(),
            Some("https://chat.pulina.fi/a/0123456789abcdef")
        );
        assert_eq!(avatar_in("https://chat.pulina.fi/a/0123"), None);
        assert_eq!(avatar_in("Lobby"), None);
    }

    #[test]
    fn routes_private_messages_and_actions() {
        let mut s = Session::new("net", "rolle");
        let out = feed(&mut s, ":mikko!m@h PRIVMSG rolle :hei");
        assert_eq!(lines(&out), vec![("mikko".into(), "msg".into(), "mikko".into())]);

        let out = feed(&mut s, ":rolle!r@h PRIVMSG mikko :moi");
        assert_eq!(lines(&out), vec![("mikko".into(), "msg".into(), "rolle".into())]);

        let out = feed(&mut s, ":mikko!m@h PRIVMSG #a :\u{1}ACTION waves\u{1}");
        assert_eq!(lines(&out), vec![("#a".into(), "action".into(), "mikko".into())]);

        let out = feed(&mut s, ":irc.example NOTICE * :Looking up your hostname");
        assert_eq!(lines(&out), vec![("".into(), "notice".into(), "irc.example".into())]);
    }

    #[test]
    fn shows_command_replies_but_not_the_burst() {
        let mut s = Session::new("net", "rolle");
        assert!(feed(&mut s, ":srv 001 rolle :Welcome").iter().all(|o| matches!(o, Out::Me(_))));
        assert!(feed(&mut s, ":srv 375 rolle :- motd").is_empty());
        let out = feed(&mut s, ":srv 401 rolle nobody :No such nick/channel");
        assert_eq!(lines(&out), vec![("".into(), "info".into(), "srv".into())]);
    }

    fn modes(outs: &[Out]) -> Vec<(String, String)> {
        let Some(Out::Buffer(info)) = outs.last() else { return vec![] };
        info.modes.iter().map(|(n, m)| (n.clone(), m.clone())).collect()
    }

    fn pairs(list: &[(&str, &str)]) -> Vec<(String, String)> {
        list.iter().map(|(n, m)| (n.to_string(), m.to_string())).collect()
    }

    #[test]
    fn tracks_name_prefixes_through_names_mode_and_nick() {
        let mut s = Session::new("net", "rolle");
        feed(&mut s, ":rolle!r@h JOIN #a");
        feed(&mut s, ":srv 353 rolle = #a :@+kaisla +jaska mikko @rolle");
        let out = feed(&mut s, ":srv 366 rolle #a :End");
        assert_eq!(modes(&out), pairs(&[("jaska", "+"), ("kaisla", "@+"), ("rolle", "@")]));

        let out = feed(&mut s, ":rolle!r@h MODE #a +o-v mikko jaska");
        assert_eq!(modes(&out), pairs(&[("kaisla", "@+"), ("mikko", "@"), ("rolle", "@")]));

        // A ban's mask and a limit's number are not nicks.
        let out = feed(&mut s, ":rolle!r@h MODE #a +b *!*@mikko");
        assert_eq!(lines(&out), vec![("#a".into(), "mode".into(), "rolle".into())]);
        assert_eq!(out.len(), 1);
        let out = feed(&mut s, ":rolle!r@h MODE #a +lv 10 mikko");
        assert_eq!(modes(&out), pairs(&[("kaisla", "@+"), ("mikko", "@+"), ("rolle", "@")]));

        feed(&mut s, ":mikko!m@h NICK Mikko_");
        let out = feed(&mut s, ":rolle!r@h MODE #a -o kaisla");
        assert_eq!(modes(&out), pairs(&[("Mikko_", "@+"), ("kaisla", "+"), ("rolle", "@")]));

        feed(&mut s, ":Mikko_!m@h PART #a");
        let out = feed(&mut s, ":rolle!r@h MODE #a -v kaisla");
        assert_eq!(modes(&out), pairs(&[("rolle", "@")]));

        assert!(feed(&mut s, ":rolle MODE rolle +i").is_empty());
    }

    #[test]
    fn reads_prefixes_and_mode_limit_from_isupport() {
        let mut s = Session::new("net", "rolle");
        let out = feed(&mut s, ":srv 005 rolle PREFIX=(ov)@+ CHANMODES=beI,k,l,imnpst MODES=4 :are supported by this server");
        assert_eq!(out, vec![Out::ModesPerLine(4)]);
        feed(&mut s, ":rolle!r@h JOIN #a");
        feed(&mut s, ":srv 353 rolle = #a :@rolle %odd");
        let out = feed(&mut s, ":srv 366 rolle #a :End");
        let Some(Out::Buffer(info)) = out.last() else { panic!("no buffer") };
        assert!(info.members.contains(&"%odd".to_string()));
        assert_eq!(feed(&mut s, ":srv 005 rolle MODES :are supported"), vec![Out::ModesPerLine(UNLIMITED_MODES_PER_LINE)]);
    }

    #[test]
    fn answers_ping() {
        let mut s = Session::new("net", "rolle");
        assert_eq!(feed(&mut s, "PING :abc"), vec![Out::Send("PONG :abc".into())]);
    }

    #[test]
    fn gathers_whois_into_one_event() {
        let mut s = Session::new("Net", "me");
        assert!(feed(&mut s, ":srv 311 me kaisla ka example.net * :Kaisla Example").is_empty());
        assert!(feed(&mut s, ":srv 319 me kaisla :@#rust #tea ").is_empty());
        assert!(feed(&mut s, ":srv 317 me kaisla 300 1700000000 :seconds idle, signon time").is_empty());
        let out = feed(&mut s, ":srv 318 me kaisla :End of /WHOIS list.");
        let Out::Whois(w) = &out[0] else { panic!("no whois") };
        assert_eq!((w.user.as_str(), w.host.as_str(), w.realname.as_str()), ("ka", "example.net", "Kaisla Example"));
        assert_eq!((w.channels.as_str(), w.idle_secs, w.found), ("@#rust #tea", Some(300), true));
        assert!(feed(&mut s, ":srv 301 me kaisla :away from a message").iter().all(|o| matches!(o, Out::Line(_))));
    }
    #[test]
    fn shows_ctcp_and_dcc() {
        let mut s = Session::new("Net", "rolle");
        let text = |outs: Vec<Out>| match &outs[..] {
            [Out::Line(l)] => (l.buffer.clone(), l.kind.clone(), l.text.clone()),
            _ => panic!("expected one line"),
        };
        assert_eq!(
            text(feed(&mut s, ":mikko!m@h PRIVMSG rolle :\u{1}VERSION\u{1}")),
            ("mikko".into(), "ctcp".into(), "asked for your VERSION".into())
        );
        assert_eq!(
            text(feed(&mut s, ":mikko!m@h NOTICE rolle :\u{1}VERSION irssi 1.4.5\u{1}")),
            ("".into(), "ctcp".into(), "answered VERSION: irssi 1.4.5".into())
        );
        assert_eq!(
            text(feed(&mut s, ":mikko!m@h PRIVMSG rolle :\u{1}DCC SEND \"loma kuva.jpg\" 3232235777 5000 2621440\u{1}")),
            ("mikko".into(), "dcc".into(), "offers a file: loma kuva.jpg (2,5 MB). Take it in irssi with /dcc get mikko".into())
        );
        assert_eq!(
            text(feed(&mut s, ":mikko!m@h PRIVMSG rolle :\u{1}DCC CHAT chat 3232235777 5001\u{1}")).2,
            "asks for a DCC chat. Answer it in irssi with /dcc chat mikko"
        );
        assert_eq!(
            text(feed(&mut s, ":mikko!m@h PRIVMSG #a :\u{1}PING 123\u{1}")),
            ("#a".into(), "ctcp".into(), "asked the channel for PING".into())
        );
    }

    /// Servers split a long channel list over several 319 lines.
    #[test]
    fn keeps_every_whois_channel_line() {
        let mut s = Session::new("Net", "me");
        feed(&mut s, ":srv 311 me kaisla ka example.net * :Kaisla");
        feed(&mut s, ":srv 319 me kaisla :@#rust #tea");
        feed(&mut s, ":srv 319 me kaisla :#pulina +#linux");
        let out = feed(&mut s, ":srv 318 me kaisla :End of /WHOIS list.");
        let Out::Whois(w) = &out[0] else { panic!("no whois") };
        assert_eq!(w.channels, "@#rust #tea #pulina +#linux");
    }
}
