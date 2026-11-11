// What a fork such as the Pulina app changes: its name, where it links, its icons. Its look is brand.css.
// `lang` is the UI language until one is picked in Settings: 'en' or 'fi', English when left out.
// `start` presets the welcome's network and channels; `only: true` hides every other network choice.
// With `host`, `network` is only the name shown for it.
// `welcome` replaces the welcome's "Welcome to Lobby" title.
// `startNote` replaces the history line under "Start chatting now" in the welcome.
// `quitName` and `fiQuitName` name the app in the default quit message ("Used …", "Käytin …").
// `channels` gives a channel its picture until someone picks another: { '#name': { photo } }.
// `reportEmail` gets reported messages and Settings > About's "Report a problem".
export const BRAND = {
  name: 'Lobby',
  quitName: 'Lobby',
  fiQuitName: 'Lobbya',
  // The name for "Tervetuloa …" in Finnish.
  fiInto: 'Lobbyyn',
  site: 'https://github.com/rollecode/lobby',
  reportEmail: 'rolle@dude.fi',
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
