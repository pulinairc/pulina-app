# lobby-server

lobby-server keeps your IRC history so the Lobby app can show it every time it starts. It runs on the machine where your IRC client runs (for example irssi in tmux on a shell host), connects to irssi's proxy on that machine, and writes every line to a SQLite file.

It does not connect to IRC networks itself. irssi stays in charge, and you can keep using irssi over SSH as before.

## Requirements

- A Linux machine with systemd where irssi runs all the time
- irssi with its proxy module (`irssiproxy`) turned on
- Rust 1.85 or newer, to build lobby-server
- SSH access to that machine from the computer where you run Lobby

## 1. Turn on irssi's proxy

Skip this if you already use irssiproxy.

In irssi:

```
/load proxy
/set irssiproxy_password a-long-random-password
/set irssiproxy_bind 127.0.0.1
/set irssiproxy_ports IRCnet=45000 Libera=45001
/save
```

- `irssiproxy_ports` gives each network in irssi its own port. Use the network names exactly as `/network list` shows them.
- `irssiproxy_bind 127.0.0.1` keeps the proxy reachable only from the same machine, which is all lobby-server needs.
- Add `load proxy` to `~/.irssi/startup` so it is on after irssi restarts.

The irssi documentation covers the proxy in more detail: [irssiproxy help](https://irssi.org/documentation/help/irssiproxy/).

## 2. Install Rust

If `rustc --version` says 1.85 or newer, skip this. Otherwise install a current Rust for your user only. This does not touch the system Rust:

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
```

## 3. Install lobby-server

```sh
git clone https://github.com/rollecode/lobby
cd lobby
./server/install.sh
```

The installer:

- builds lobby-server into `~/.local/bin`
- creates `~/.config/lobby-server/config.toml` with an example network
- creates a random token in `~/.config/lobby-server/token`, readable only by you
- adds a systemd user service, `lobby-server.service`, and enables it

## 4. Configure it

Put your password in a file only you can read:

```sh
printf '%s' 'a-long-random-password' > ~/.config/lobby-server/irssiproxy.pass
chmod 600 ~/.config/lobby-server/irssiproxy.pass
```

Then list one `[[network]]` per irssiproxy port in `~/.config/lobby-server/config.toml`:

```toml
nick = "yournick"
listen = "127.0.0.1:7667"

[[network]]
name = "IRCnet"
host = "127.0.0.1"
port = 45000
password_file = "~/.config/lobby-server/irssiproxy.pass"

[[network]]
name = "Libera"
host = "127.0.0.1"
port = 45001
password_file = "~/.config/lobby-server/irssiproxy.pass"
```

If irssiproxy listens on a host name instead of `127.0.0.1` (its `irssiproxy_bind` setting), use that name as `host`.

| Setting | Meaning |
|---------|---------|
| `nick` | Your nick, used until irssi tells the real one |
| `listen` | Where apps connect. Keep it on `127.0.0.1` |
| `token` or `token_file` | The secret apps must send. Defaults to `~/.config/lobby-server/token` |
| `allow_insecure` | Allow listening on a public address without TLS. Leave it off |
| `[[network]]` | `name`, `host`, `port`, and `password` or `password_file` |
| `[upload]` | Where attachments sent through lobby-server go, see next |

### Attachments

With an `[upload]` section, Lobby can send files through lobby-server (Settings, Files, Your lobby-server, or Automatic). The keys stay in this file and never reach the apps. Restart lobby-server after changing it.

A Cloudflare R2 bucket, or any S3 storage:

```toml
[upload]
kind = "s3"
endpoint = "https://ACCOUNT_ID.r2.cloudflarestorage.com"
region = "auto"
bucket = "files"
access_key = "..."
secret_key = "..."
public_url = "https://files.example.org"
```

For R2, make an API token with Object Read & Write on that bucket, and connect a custom domain to the bucket for `public_url`. The `r2.dev` address is rate limited and meant for testing.

Or a folder on this machine that your web server serves:

```toml
[upload]
kind = "folder"
dir = "/var/www/files"
public_url = "https://files.example.org"
```

Only pictures, PDFs and plain text are kept, each in a folder with a random name. Files can be up to 20 MB.

## 5. Start it

```sh
systemctl --user start lobby-server
loginctl enable-linger "$USER"
journalctl --user -u lobby-server -f
```

`enable-linger` keeps your user services running after you log out. The log should say `lobby-server listening on 127.0.0.1:7667`.

History is stored in `~/.local/share/lobby-server/history.db`, in a folder only you can read. That matters on shared shell hosts.

## 6. Connect the Lobby app

Copy the token to the computer where you run Lobby:

```sh
mkdir -p ~/.config/lobby
(umask 077 && ssh you@your-shell-host cat .config/lobby-server/token > ~/.config/lobby/server.token)
```

On macOS the folder is `~/Library/Application Support/lobby` instead of `~/.config/lobby`.

Then put this in Lobby's `config.toml`:

```toml
[server]
ssh = "you@your-shell-host"
token_file = "~/.config/lobby/server.token"
```

Lobby opens an SSH tunnel to the server with your usual SSH key and keeps it up. The key has to work without a prompt. Test that with:

```sh
ssh -o BatchMode=yes you@your-shell-host true
```

### Without SSH: a reverse proxy with TLS

If you want to reach lobby-server at an address of its own, for example from a phone later, put a web server with TLS in front of it and keep lobby-server on `127.0.0.1`.

Caddy:

```
lobby.example.org {
    reverse_proxy 127.0.0.1:7667
}
```

nginx, inside a `server` block that already has TLS:

```nginx
location / {
    proxy_pass http://127.0.0.1:7667;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 1h;
}
```

In Lobby's config, use `url = "wss://lobby.example.org"` instead of `ssh`.

## Updating

```sh
cd lobby
git pull
./server/install.sh
```

The installer keeps your config and token and restarts the service.

## Removing

```sh
systemctl --user disable --now lobby-server
rm ~/.config/systemd/user/lobby-server.service ~/.local/bin/lobby-server
rm -r ~/.config/lobby-server ~/.local/share/lobby-server
```

The last line deletes the stored history.

## Troubleshooting

- **`Rust ... is too old`**: install a current Rust with rustup (step 2), then run the installer again.
- **`disconnected: Connection refused`** in the log: irssiproxy is not listening on that host and port. Check `/set irssiproxy` in irssi.
- **A network connects but shows no channels**: irssi is not on any channels on that network.
- **Lobby says `lobby-server unreachable`**: check `systemctl --user status lobby-server`, and that `ssh -o BatchMode=yes you@your-shell-host true` works.
- **`wrong token`** in the log: the token in Lobby's config does not match `~/.config/lobby-server/token`.
