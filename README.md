# Lobby

A small, modern IRC client for Linux and macOS. One reading column, grouped messages, link previews, and a window that is happy to live in the corner of your screen.

Built for use behind a bouncer such as irssiproxy, so it connects with just a host, port and password.

## Status

Early prototype. It connects, shows channels as a strip of tabs, groups messages by person, previews links and keeps its own local history.

Not yet: profile photos and nick aliases, attachments, emoji picker, reactions, notifications, TLS.

## Running

You need Rust and the Tauri system libraries (on Linux, `webkit2gtk-4.1`).

```sh
cd src-tauri
cargo run
```

On first start Lobby writes a config template and tells you where it is:

- Linux: `~/.config/lobby/config.toml`
- macOS: `~/Library/Application Support/lobby/config.toml`

```toml
nick = "yournick"

[[network]]
name = "IRCnet"
host = "irc.example.org"
port = 6667
password_file = "~/.config/lobby/ircnet.pass"
```

## Keys

- `Alt+1` to `Alt+9`: jump to a channel
- `Alt+Left` and `Alt+Right`, or `Ctrl+PageUp` and `Ctrl+PageDown`: previous and next channel
- `Tab`: complete a nick
- `Up` in an empty input: bring back the last message

Commands work as in other clients: `/me`, `/msg`, `/join`, `/part`, `/topic`, and anything else is sent as is. `/quit` is disabled, because through a bouncer it would disconnect the bouncer from the network.

## Tests

```sh
cd src-tauri && cargo test
node --test tests/lib.test.mjs
```

## Licence

MIT
