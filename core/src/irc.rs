//! IRC wire format: parsing incoming lines and building outgoing ones.

/// An IRC line is 512 bytes with its CRLF, and the server puts our address in front of what others get.
const LINE_BYTES: usize = 510;
/// Before the server has shown our address: the longest ident and host it may have.
const UNKNOWN_MASK_BYTES: usize = "!".len() + 10 + "@".len() + 63;
/// The address can still change after joining, as when Q hides it, so some bytes stay spare.
pub const SPARE_BYTES: usize = 16;
const MIN_TEXT_BYTES: usize = 100;
const ACTION_WRAP_BYTES: usize = "\u{1}ACTION \u{1}".len();

/// How much text one PRIVMSG to `target` can carry. `prefix` is "nick!user@host",
/// or the bare nick before the server has shown the rest.
pub fn text_room(prefix: &str, target: &str) -> usize {
    let mask = if prefix.contains('@') { 0 } else { UNKNOWN_MASK_BYTES };
    let around = ":".len() + prefix.len() + mask + " PRIVMSG ".len() + target.len() + " :".len();
    LINE_BYTES.saturating_sub(around + SPARE_BYTES).max(MIN_TEXT_BYTES)
}

#[derive(Debug, Clone, PartialEq)]
pub struct Msg {
    pub prefix: Option<String>,
    pub command: String,
    pub params: Vec<String>,
}

impl Msg {
    pub fn nick(&self) -> &str {
        let prefix = self.prefix.as_deref().unwrap_or("");
        prefix.split('!').next().unwrap_or("")
    }

    /// `user@host` part of the prefix, empty for servers.
    pub fn mask(&self) -> &str {
        let prefix = self.prefix.as_deref().unwrap_or("");
        prefix.split_once('!').map(|(_, rest)| rest).unwrap_or("")
    }

    pub fn param(&self, index: usize) -> &str {
        self.params.get(index).map(String::as_str).unwrap_or("")
    }
}

pub fn parse(line: &str) -> Option<Msg> {
    let mut rest = line.trim_end_matches(['\r', '\n']);

    if rest.starts_with('@') {
        rest = rest.split_once(' ')?.1;
    }

    let mut prefix = None;
    if let Some(stripped) = rest.strip_prefix(':') {
        let (p, r) = stripped.split_once(' ')?;
        prefix = Some(p.to_string());
        rest = r;
    }

    let rest = rest.trim_start();
    let (command, mut rest) = rest.split_once(' ').unwrap_or((rest, ""));
    if command.is_empty() {
        return None;
    }

    let mut params = Vec::new();
    while !rest.is_empty() {
        if let Some(trailing) = rest.strip_prefix(':') {
            params.push(trailing.to_string());
            break;
        }
        let (param, r) = rest.split_once(' ').unwrap_or((rest, ""));
        if !param.is_empty() {
            params.push(param.to_string());
        }
        rest = r;
    }

    Some(Msg { prefix, command: command.to_ascii_uppercase(), params })
}

pub fn is_channel(name: &str) -> bool {
    name.starts_with(['#', '&', '!', '+'])
}

/// Text of a CTCP ACTION (`/me`), if the message is one.
pub fn action(text: &str) -> Option<&str> {
    let inner = text.strip_prefix('\u{1}')?.trim_end_matches('\u{1}');
    inner.strip_prefix("ACTION ").or(if inner == "ACTION" { Some("") } else { None })
}

pub fn is_ctcp(text: &str) -> bool {
    text.starts_with('\u{1}')
}

/// Split text into pieces of at most `max` bytes, between words where it can.
pub fn split_text(text: &str, max: usize) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines().filter(|l| !l.is_empty()) {
        let mut rest = line;
        while rest.len() > max {
            let mut cut = max;
            while !rest.is_char_boundary(cut) {
                cut -= 1;
            }
            // A space in the later half is a word break; a long word is cut where it must.
            let (head, tail) = match rest[..cut].rfind(' ') {
                Some(space) if space > max / 2 => (&rest[..space], &rest[space + 1..]),
                _ => (&rest[..cut], &rest[cut..]),
            };
            out.push(head.to_string());
            rest = tail;
        }
        if !rest.is_empty() {
            out.push(rest.to_string());
        }
    }
    out
}

#[derive(Debug, PartialEq)]
pub struct Echo {
    pub buffer: String,
    pub kind: &'static str,
    pub text: String,
}

/// Turn what was typed into raw IRC lines, plus what to show locally.
/// `modes_per_line` is how many mode changes the server takes in one MODE line; `prefix` is
/// our own "nick!user@host", which sets how long a message may be.
pub fn outgoing(buffer: &str, input: &str, modes_per_line: usize, prefix: &str) -> Result<Vec<(String, Option<Echo>)>, String> {
    let say = |target: &str, text: &str| {
        split_text(text, text_room(prefix, target))
            .into_iter()
            .map(|t| (format!("PRIVMSG {target} :{t}"), Some(Echo { buffer: target.into(), kind: "msg", text: t })))
            .collect::<Vec<_>>()
    };

    let Some(command) = input.strip_prefix('/').filter(|c| !c.starts_with('/')) else {
        if buffer.is_empty() {
            return Err("Pick a channel first".into());
        }
        return Ok(say(buffer, input.strip_prefix('/').unwrap_or(input)));
    };

    let (name, rest) = command.split_once(' ').unwrap_or((command, ""));
    let rest = rest.trim();
    let raw = match name.to_lowercase().as_str() {
        "me" => {
            let room = text_room(prefix, buffer).saturating_sub(ACTION_WRAP_BYTES);
            return Ok(split_text(rest, room)
                .into_iter()
                .map(|t| (format!("PRIVMSG {buffer} :\u{1}ACTION {t}\u{1}"), Some(Echo { buffer: buffer.into(), kind: "action", text: t })))
                .collect());
        }
        "msg" | "query" => {
            let (target, text) = rest.split_once(' ').unwrap_or((rest, ""));
            return Ok(say(target, text));
        }
        "say" => return Ok(say(buffer, rest)),
        "notice" => {
            let (target, text) = rest.split_once(' ').unwrap_or((rest, ""));
            let echo = Echo { buffer: target.into(), kind: "notice", text: text.into() };
            return Ok(vec![(format!("NOTICE {target} :{text}"), Some(echo))]);
        }
        "join" | "j" => format!("JOIN {rest}"),
        "part" | "leave" | "wc" => format!("PART {buffer} :{rest}"),
        "topic" | "t" if rest.is_empty() => format!("TOPIC {buffer}"),
        "topic" | "t" => format!("TOPIC {buffer} :{rest}"),
        "whois" | "wi" => format!("WHOIS {rest}"),
        "away" if rest.is_empty() => "AWAY".into(),
        "away" => format!("AWAY :{rest}"),
        "invite" => format!("INVITE {rest} {buffer}"),
        "kick" | "k" => {
            let (nick, reason) = rest.split_once(' ').unwrap_or((rest, ""));
            format!("KICK {buffer} {nick} :{reason}")
        }
        "op" | "deop" | "voice" | "devoice" => {
            let mode = match name.to_lowercase().as_str() {
                "op" => "+o",
                "deop" => "-o",
                "voice" => "+v",
                _ => "-v",
            };
            let nicks: Vec<&str> = rest.split_whitespace().collect();
            // As many as the server takes in one line, like irssi's +vvvv: never one line per nick.
            return Ok(nicks
                .chunks(modes_per_line.max(1))
                .map(|part| (format!("MODE {buffer} {}{} {}", &mode[..1], mode[1..].repeat(part.len()), part.join(" ")), None))
                .collect());
        }
        "quit" | "exit" => return Err("Quit is disabled, it would disconnect irssi from the network".into()),
        "raw" | "quote" => rest.to_string(),
        _ => format!("{} {rest}", name.to_uppercase()).trim_end().to_string(),
    };
    Ok(vec![(raw, None)])
}

/// Bytes from the server as text: UTF-8, falling back to Latin-1 for old clients.
pub fn decode(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_privmsg() {
        let m = parse(":jaska!jaska@example.net PRIVMSG #linux :hello there\r\n").unwrap();
        assert_eq!(m.nick(), "jaska");
        assert_eq!(m.mask(), "jaska@example.net");
        assert_eq!(m.command, "PRIVMSG");
        assert_eq!(m.params, vec!["#linux", "hello there"]);
    }

    #[test]
    fn parses_tags_and_no_prefix() {
        let m = parse("@time=2026-01-01T00:00:00Z PING :server").unwrap();
        assert_eq!(m.prefix, None);
        assert_eq!(m.command, "PING");
        assert_eq!(m.param(0), "server");

        let m = parse(":irc.example 353 rolle = #linux :@op +voice plain").unwrap();
        assert_eq!(m.params.len(), 4);
        assert_eq!(m.param(3), "@op +voice plain");
    }

    #[test]
    fn handles_actions_and_splitting() {
        assert_eq!(action("\u{1}ACTION waves\u{1}"), Some("waves"));
        assert_eq!(action("hello"), None);

        let long = "ä".repeat(300);
        let parts = split_text(&long, 400);
        assert!(parts.iter().all(|p| p.len() <= 400));
        assert_eq!(parts.concat(), long);
        assert_eq!(split_text("one\ntwo", 400), vec!["one", "two"]);
    }

    #[test]
    fn fills_the_line_and_splits_between_words() {
        let room = text_room("rolle!~rolle@a.example.net", "#pulina");
        assert_eq!(room, 510 - ":rolle!~rolle@a.example.net PRIVMSG #pulina :".len() - SPARE_BYTES);
        let unknown = text_room("rolle", "#pulina");
        assert!(unknown < room);
        let words = "sana ".repeat(120);
        let parts = split_text(words.trim(), 100);
        assert!(parts.iter().all(|p| p.len() <= 100 && !p.starts_with(' ') && p.ends_with("sana")));
        assert_eq!(parts.join(" "), words.trim());
    }

    fn typed(buffer: &str, input: &str) -> Result<Vec<(String, Option<Echo>)>, String> {
        outgoing(buffer, input, crate::net::DEFAULT_MODES_PER_LINE, "rolle")
    }

    #[test]
    fn builds_outgoing_lines() {
        let out = typed("#a", "hello").unwrap();
        assert_eq!(out[0].0, "PRIVMSG #a :hello");

        let out = typed("#a", "/me waves").unwrap();
        assert_eq!(out[0].0, "PRIVMSG #a :\u{1}ACTION waves\u{1}");
        assert_eq!(out[0].1.as_ref().unwrap().kind, "action");

        let out = typed("#a", "/msg mikko moi").unwrap();
        assert_eq!(out[0].1.as_ref().unwrap().buffer, "mikko");

        assert_eq!(typed("#a", "//not a command").unwrap()[0].0, "PRIVMSG #a :/not a command");
        assert_eq!(typed("#a", "/whois kaisla").unwrap()[0].0, "WHOIS kaisla");
        assert!(typed("#a", "/quit").is_err());
        assert_eq!(typed("#a", "/wc").unwrap()[0].0, "PART #a :");
        assert_eq!(typed("#a", "/op kaisla jaska").unwrap()[0].0, "MODE #a +oo kaisla jaska");
        let lines: Vec<String> = outgoing("#a", "/voice a b c d e", 2, "rolle").unwrap().into_iter().map(|(raw, _)| raw).collect();
        assert_eq!(lines, ["MODE #a +vv a b", "MODE #a +vv c d", "MODE #a +v e"]);
        assert_eq!(typed("#a", "/kick jaska bye now").unwrap()[0].0, "KICK #a jaska :bye now");
        assert_eq!(typed("#a", "/away").unwrap()[0].0, "AWAY");
        assert_eq!(typed("#a", "/say /me is literal").unwrap()[0].0, "PRIVMSG #a :/me is literal");
        assert_eq!(typed("#a", "/wi kaisla").unwrap()[0].0, "WHOIS kaisla");
        assert!(typed("", "hello").is_err());
    }

    #[test]
    fn decodes_latin1() {
        assert_eq!(decode(b"p\xe4iv\xe4\xe4"), "päivää");
        assert_eq!(decode("päivää".as_bytes()), "päivää");
    }
}
