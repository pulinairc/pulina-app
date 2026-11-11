# Pulina app privacy policy

Updated 11.11.2026.

The Pulina app collects nothing about you for analytics, ads or tracking. It talks to chat.pulina.fi only for the things listed below.

## What leaves your device

Only what you set up, and only to the place you pick:

- **Chat:** your nick and messages go to QuakeNet, the IRC network that hosts #pulina. Everyone on #pulina sees what you write there.
- **Channel history:** the app loads #pulina's public log from pulina.fi before you join.
- **Your picture:** if you pick a profile picture, it is stored on chat.pulina.fi so other Pulina and Lobby users see it. Its link goes into your IRC real name.
- **A pulina.fi account, if you apply for one:** the account name, a scrypt hash of your password, your email address and the words you write about yourself are stored on chat.pulina.fi. The email address is used only to tell you the account is approved and to reset a forgotten password; that mail goes out through Mailgun. Your password is checked against known data breaches with Have I Been Pwned's range API, which only ever sees the first five characters of the password's SHA-1 hash, never the password. An approved account keeps an always-on IRC connection on chat.pulina.fi that stores the channel's messages for you. Removing the account deletes all of it.
- **Link previews:** when a message holds a link, the app loads that page to show its title and picture.
- **Files you share:** go to the storage you choose in Settings. By default that is up.pulina.fi, which keeps them in Cloudflare R2. Anyone with a file's link can open it.
- **Now playing:** if you add a Last.fm username, the app asks Last.fm what that account is playing.
- **Updates:** the desktop apps check GitHub for a newer version.
- **Reports:** reporting a message opens your own mail app with the report. Nothing is sent unless you send that mail.

## What stays on your device

Settings, chat history, people's photos and colours you set, and blocked people stay on your device.

## Contact

rolle@dude.fi
