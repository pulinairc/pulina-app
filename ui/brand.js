// Pulina's name, links and icons over Lobby's; the look is brand.css.
export const BRAND = {
  name: 'Pulina',
  // The name for "Tervetuloa …" in Finnish.
  fiInto: 'Pulinaan',
  site: 'https://github.com/pulinairc/pulina-app',
  // Finnish until another language is picked in Settings.
  lang: 'fi',
  // Only #pulina on QuakeNet: the welcome asks the nick and nothing else.
  start: { network: 'QuakeNet', channels: '#pulina', only: true },
  welcome: 'Welcome to IRC chat',
  startNote: 'The #pulina history is kept in the background.',
  icons: [
    ['pulina-neon', 'Pulina neon'],
    ['terminal', 'Terminal'],
    ['pendant-lamp', 'Pendant lamp'],
    ['chatter', 'Chatter'],
  ],
};
