// What a fork such as the Pulina app changes: its name, where it links, its icons. Its look is brand.css.
// `lang` is the UI language until one is picked in Settings: 'en' or 'fi', English when left out.
// `start` presets the welcome's network and channels; `only: true` hides every other network choice;
// `sheet: true` makes the welcome one nick field, with a link to the other ways.
// `peek` is made-up talk for behind that welcome when there is no real channel log to show.
// With `host`, `network` is only the name shown for it.
// `welcome` replaces the welcome's "Welcome to Lobby" title.
// `startNote` replaces the history line under "Start chatting now" in the welcome.
// `quitName` and `fiQuitName` name the app in the default quit message ("Used …", "Käytin …").
// `channels` gives a channel its picture until someone picks another: { '#name': { photo } }.
// `upload` is the fork's own file host in catbox.moe's place: { url, name, note }, `url` taking the file as the POST body.
// `reportEmail` gets reported messages and Settings > About's "Report a problem".
export const BRAND = {
  name: 'Lobby',
  quitName: 'Lobby',
  fiQuitName: 'Lobbya',
  // The name for "Tervetuloa …" in Finnish.
  fiInto: 'Lobbyyn',
  site: 'https://github.com/rollecode/lobby',
  reportEmail: 'rolle@dude.fi',
  // The welcome is one nick field on QuakeNet; "Other ways to connect" has the rest.
  start: { network: 'QuakeNet', sheet: true },
  // Made-up talk, blurred behind that welcome.
  peek: [
    ['mira', 'morning all'],
    ['otso', 'morning! coffee first'],
    ['kaisla', 'anyone tried the new release yet?'],
    ['veera', 'yes, the shelf for links is great'],
    ['lumi', 'finally a client that keeps up with irssi'],
    ['otso', 'how does the history work when you are offline?'],
    ['mira', 'lobby-server keeps it, the app catches up when you open it'],
    ['jaska', 'nice, no more asking what did I miss'],
    ['kaisla', 'reactions too, look 👍'],
    ['veera', 'lunch soon?'],
    ['lumi', 'pizza place again?'],
    ['jaska', "sure, I'm in"],
    ['mira', 'see you there at 12'],
  ],
  // The first is the bundle's own icon, as src-tauri/icons/default.txt names it.
  icons: [
    ['pendant-lamp', 'Pendant lamp'],
    ['coffee-chat', 'Coffee chat'],
    ['teal-night', 'Teal night'],
    ['neon-night', 'Neon night'],
    ['sunset', 'Sunset'],
    ['mint-glass', 'Mint glass'],
    ['porcelain', 'Porcelain'],
    ['neon-glow', 'Neon glow'],
  ],
};
