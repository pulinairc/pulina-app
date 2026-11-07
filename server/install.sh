#!/bin/sh
# Install lobby-server for the current user: binary, config, token and a systemd user service.
# Run it on the machine where irssi runs. Needs Rust (https://rustup.rs).
set -eu

PREFIX="${PREFIX:-$HOME/.local}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
CONFIG_DIR="$CONFIG_HOME/lobby-server"
UNIT_DIR="$CONFIG_HOME/systemd/user"
UNIT="lobby-server.service"
REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)

MIN_RUST_MINOR=85
PATH="$HOME/.cargo/bin:$PATH"

if ! command -v cargo >/dev/null 2>&1; then
  echo "lobby-server is built from source and needs Rust: https://rustup.rs"
  exit 1
fi

RUST_VERSION=$(rustc --version | cut -d' ' -f2)
if [ "$(echo "$RUST_VERSION" | cut -d. -f2)" -lt "$MIN_RUST_MINOR" ]; then
  echo "Rust $RUST_VERSION is too old, 1.$MIN_RUST_MINOR or newer is needed."
  echo "Install a current one for your user with rustup: https://rustup.rs"
  exit 1
fi

echo "Building lobby-server..."
cargo install --locked --quiet --path "$REPO_DIR/server" --root "$PREFIX"

mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

if [ ! -s "$CONFIG_DIR/token" ]; then
  (umask 077 && head -c 32 /dev/urandom | base64 | tr -d '/+=\n' > "$CONFIG_DIR/token")
  echo "Created a token in $CONFIG_DIR/token"
fi

NEW_CONFIG=no
if [ ! -f "$CONFIG_DIR/config.toml" ]; then
  NEW_CONFIG=yes
  cat > "$CONFIG_DIR/config.toml" <<EOF
# lobby-server config. Every network is one irssiproxy port on this machine.
nick = "$USER"
listen = "127.0.0.1:7667"

[[network]]
name = "IRCnet"
host = "127.0.0.1"
port = 45000
# password_file = "~/.config/lobby-server/irssiproxy.pass"
EOF
fi

mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/$UNIT" <<EOF
[Unit]
Description=lobby-server, IRC history for the Lobby app
After=network-online.target

[Service]
ExecStart=$PREFIX/bin/lobby-server
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable "$UNIT" >/dev/null

if [ "$NEW_CONFIG" = yes ]; then
  echo
  echo "Next: add your irssiproxy ports to $CONFIG_DIR/config.toml, then run"
  echo "  systemctl --user start $UNIT"
else
  systemctl --user restart "$UNIT"
  echo "lobby-server restarted."
fi

if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
  echo
  echo "To keep it running after you log out:"
  echo "  loginctl enable-linger $USER"
fi

echo
echo "Logs:  journalctl --user -u $UNIT -f"
echo "Token for the Lobby app: $CONFIG_DIR/token"
