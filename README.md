<p align="center">
  <img src="docs/logo.png" width="96" alt="Pulina">
</p>

<h1 align="center">Pulina app for #pulina on QuakeNet</h1>

<p align="center">
  <a href="https://github.com/pulinairc/pulina-app/actions/workflows/check.yml"><img src="https://img.shields.io/github/actions/workflow/status/pulinairc/pulina-app/check.yml?branch=main&style=for-the-badge&label=build" alt="Build"></a>
  <a href="https://github.com/pulinairc/pulina-app/releases/latest"><img src="https://img.shields.io/github/v/release/pulinairc/pulina-app?style=for-the-badge&color=0b7a55&label=release" alt="Latest release"></a>
  <a href="https://github.com/rollecode/lobby"><img src="https://img.shields.io/badge/fork_of-Lobby-c2185b?style=for-the-badge" alt="Fork of Lobby"></a>
  <a href="https://www.rust-lang.org"><img src="https://img.shields.io/badge/Rust-CE422B?style=for-the-badge&logo=rust&logoColor=white" alt="Rust"></a>
  <a href="https://tauri.app"><img src="https://img.shields.io/badge/Tauri-24C8D8?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri"></a>
</p>

<p align="center">
  The chat app for <a href="https://www.pulina.fi">#pulina</a> on QuakeNet, made for that one channel.<br>
  Pick a nick and you are in, on your computer or your phone. In Finnish, or in English if you like.
</p>

<p align="center">
  <img src="docs/pulina.webp" width="760" alt="Pulina in Finnish: #pulina on QuakeNet, a question answered and cheered with reactions, a jump to #kahvi through the channel search, and the highlights list">
</p>

## Features

### 👋 In without setup

The welcome asks for a nick and takes you to #pulina on QuakeNet. No server, no config file, no other networks.

### 🇫🇮 Finnish first

Pulina speaks Finnish out of the box. English is one switch away in Settings.

### 💬 Grouped chat

One face and name per person, their lines stacked under it. Links become cards; pictures, videos and audio play inline.

### 😂 Reactions and replies

Sent as plain IRC, `nick: 😂` and `nick: text`, and shown as reactions and quotes, so everyone on other clients still reads them.

### 📥 Highlights

Lines that name you, from all channels, in one list. Mark them done, filter them, and jump to where each was said.

### 📣 Notifications your way

Per channel, every message or only highlights, for the app icon count and for notifications. Name people and words that always notify you.

### 🗃️ Channel shelf

The links and pictures posted in a channel, each a jump back into the conversation.

### 👑 Most active

Today's talkers by words, and yesterday's top three where a new day starts.

### ⌨️ IRC commands and keys

`/whois`, `/names` and the rest, a `/` menu, numbered channels and jump keys.

### 🔄 Updates by themselves

On Mac, Windows and the Linux AppImage, Pulina installs new versions itself, or asks first if you prefer.

### 📱 Platforms

Linux, macOS, Windows and Android. iPhone follows through TestFlight.

## Built on Lobby

Pulina is [Lobby](https://github.com/rollecode/lobby) with Pulina's name, look and language, locked to #pulina on QuakeNet. For other networks, servers and [lobby-server](https://github.com/rollecode/lobby#lobby-server), use Lobby.

Pulina's own changes live in a few files: `ui/brand.js` (name, icons, the welcome's #pulina preset, the default language), `ui/brand.css` (the pulina.fi colours), `src-tauri/icons` and the app's identity in `src-tauri/tauri.conf.json`.

Every night a workflow merges the newest Lobby into Pulina. A clean merge goes straight to `main`, and a new Lobby version releases Pulina too. When Lobby changes its own workflows or touches the same lines as Pulina, an issue asks for a merge by hand.

## Installation

Download the latest build from [Releases](https://github.com/pulinairc/pulina-app/releases/latest):

| System | File |
|--------|------|
| Debian, Ubuntu | `.deb`, install with `sudo apt install ./Pulina_*.deb` |
| Other Linux | `.AppImage`, make it executable and run it |
| macOS (Apple silicon) | `.dmg` |
| Windows | `-setup.exe` |
| Android | `.apk`, open it on the phone and allow installing from your browser |

The macOS build is not signed. After moving Pulina to Applications, run `xattr -dr com.apple.quarantine /Applications/Pulina.app` once, or macOS refuses to open it. The Windows installer is not signed either: on the SmartScreen warning, choose More info, then Run anyway.

<details>
<summary><strong>Building from source</strong></summary>

The same as Lobby: see [Installation](https://github.com/rollecode/lobby#installation) in Lobby's README, with this repository in place of Lobby's.

</details>
