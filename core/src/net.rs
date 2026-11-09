//! Channel state for one IRC connection: turns incoming lines into events.

use crate::irc::{self, Msg};
use crate::store::Line;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

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

pub struct Session {
    net: String,
    me: String,
    chans: HashMap<String, Chan>,
    whois: HashMap<String, Whois>,
    support: Support,
}

fn same(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

impl Session {
    pub fn new(net: &str, me: &str) -> Self {
        Self { net: net.to_string(), me: me.to_string(), chans: HashMap::new(), whois: HashMap::new(), support: Support::default() }
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
        Out::Buffer(BufferInfo { net: self.net.clone(), name: chan.name.clone(), topic: chan.topic.clone(), members, joined, modes })
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
                self.me = msg.param(0).to_string();
                vec![Out::Me(self.me.clone())]
            }
            "PRIVMSG" | "NOTICE" => self.on_message(msg, now),
            "005" => self.on_support(msg),
            "MODE" => {
                let key = msg.param(0).to_lowercase();
                if !self.apply_modes(&key, &msg.params[1..]) {
                    return vec![];
                }
                vec![self.info(&self.chans[&key], true)]
            }
            "JOIN" => {
                let name = msg.param(0).to_string();
                let key = name.to_lowercase();
                if is_me {
                    let chan = Chan { name: name.clone(), ..Default::default() };
                    let out = self.info(&chan, true);
                    self.chans.insert(key, chan);
                    return vec![out];
                }
                let Some(chan) = self.chans.get_mut(&key) else { return vec![] };
                chan.members.insert(nick.to_lowercase(), nick.clone());
                let name = chan.name.clone();
                vec![Out::Line(self.line(&name, "join", msg, "", now))]
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
                out
            }
            "NICK" => {
                let new = msg.param(0).to_string();
                let mut out = Vec::new();
                if is_me {
                    self.me = new.clone();
                    out.push(Out::Me(new.clone()));
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
                vec![self.info(&self.chans[&key], true)]
            }
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
            // Answers to commands (WHOIS, errors like "no such nick") as readable text.
            cmd if is_reply_numeric(cmd) => {
                let text = msg.params.iter().skip(1).cloned().collect::<Vec<_>>().join(" ");
                vec![Out::Line(self.line("", "info", msg, &text, now))]
            }
            _ => vec![],
        }
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
            "319" => w.channels = last.trim().to_string(),
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

        let (kind, text) = match irc::action(raw) {
            Some(text) => ("action", text),
            None if irc::is_ctcp(raw) => return vec![],
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
    fn routes_private_messages_and_actions() {
        let mut s = Session::new("net", "rolle");
        let out = feed(&mut s, ":mikko!m@h PRIVMSG rolle :hei");
        assert_eq!(lines(&out), vec![("mikko".into(), "msg".into(), "mikko".into())]);

        let out = feed(&mut s, ":rolle!r@h PRIVMSG mikko :moi");
        assert_eq!(lines(&out), vec![("mikko".into(), "msg".into(), "rolle".into())]);

        let out = feed(&mut s, ":mikko!m@h PRIVMSG #a :\u{1}ACTION waves\u{1}");
        assert_eq!(lines(&out), vec![("#a".into(), "action".into(), "mikko".into())]);

        let out = feed(&mut s, ":mikko!m@h PRIVMSG rolle :\u{1}VERSION\u{1}");
        assert!(out.is_empty());

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
        assert!(feed(&mut s, ":rolle!r@h MODE #a +b *!*@mikko").is_empty());
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
}
