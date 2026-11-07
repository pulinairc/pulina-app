//! IRC wire format: parsing incoming lines and building outgoing ones.

const MAX_TEXT_BYTES: usize = 400;

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

/// Split text into IRC-sized pieces on character boundaries.
pub fn split_text(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines().filter(|l| !l.is_empty()) {
        let mut chunk = String::new();
        for ch in line.chars() {
            if chunk.len() + ch.len_utf8() > MAX_TEXT_BYTES {
                out.push(std::mem::take(&mut chunk));
            }
            chunk.push(ch);
        }
        if !chunk.is_empty() {
            out.push(chunk);
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
pub fn outgoing(buffer: &str, input: &str) -> Result<Vec<(String, Option<Echo>)>, String> {
    let say = |target: &str, text: &str| {
        split_text(text)
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
            let echo = Echo { buffer: buffer.into(), kind: "action", text: rest.into() };
            return Ok(vec![(format!("PRIVMSG {buffer} :\u{1}ACTION {rest}\u{1}"), Some(echo))]);
        }
        "msg" | "query" => {
            let (target, text) = rest.split_once(' ').unwrap_or((rest, ""));
            return Ok(say(target, text));
        }
        "join" | "j" => format!("JOIN {rest}"),
        "part" | "leave" => format!("PART {buffer} :{rest}"),
        "topic" if rest.is_empty() => format!("TOPIC {buffer}"),
        "topic" => format!("TOPIC {buffer} :{rest}"),
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
        let parts = split_text(&long);
        assert!(parts.iter().all(|p| p.len() <= MAX_TEXT_BYTES));
        assert_eq!(parts.concat(), long);
        assert_eq!(split_text("one\ntwo"), vec!["one", "two"]);
    }

    #[test]
    fn builds_outgoing_lines() {
        let out = outgoing("#a", "hello").unwrap();
        assert_eq!(out[0].0, "PRIVMSG #a :hello");

        let out = outgoing("#a", "/me waves").unwrap();
        assert_eq!(out[0].0, "PRIVMSG #a :\u{1}ACTION waves\u{1}");
        assert_eq!(out[0].1.as_ref().unwrap().kind, "action");

        let out = outgoing("#a", "/msg mikko moi").unwrap();
        assert_eq!(out[0].1.as_ref().unwrap().buffer, "mikko");

        assert_eq!(outgoing("#a", "//not a command").unwrap()[0].0, "PRIVMSG #a :/not a command");
        assert_eq!(outgoing("#a", "/whois kaisla").unwrap()[0].0, "WHOIS kaisla");
        assert!(outgoing("#a", "/quit").is_err());
        assert!(outgoing("", "hello").is_err());
    }

    #[test]
    fn decodes_latin1() {
        assert_eq!(decode(b"p\xe4iv\xe4\xe4"), "päivää");
        assert_eq!(decode("päivää".as_bytes()), "päivää");
    }
}
