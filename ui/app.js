import { BRAND } from './brand.js';
import { chooseLang, currentLang, LANGS, startLang, t, tv } from './i18n.js';
import {
  CHAT_KINDS,
  colonOpensPicker,
  notifyAdvice,
  popupSpot,
  EVENT_KINDS,
  clock,
  commandMatches,
  continues,
  dayLabel,
  defaultShortcuts,
  ANIMALS,
  animalFor,
  colonQuery,
  comboLabel,
  comboMods,
  comboOf,
  colorFromRgb,
  convertEmoticons,
  emojiSearch,
  formatWhois,
  span,
  ago,
  byActivity,
  fadeFor,
  TALKING_MS,
  modeAction,
  peopleGroups,
  quietFor,
  botNicks,
  wordList,
  nickMatches,
  looseMatch,
  npLine,
  messageRoom,
  nickQuery,
  isCommand,
  splitNicks,
  duration,
  isChannel,
  mentions,
  nickColor,
  parseAddress,
  replyTarget,
  boxHeight,
  anchorShift,
  quotedText,
  personFor,
  parseReaction,
  sameDay,
  GROUP_GAP_MS,
  shortUrl,
  stripFormatting,
  summarize,
  tokenize,
  youtube,
  mediaKind,
  directLink,
  inboxSplit,
  maskParts,
  maskWords,
  OFFENSIVE_WORDS,
  reportMail,
} from './lib.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { openUrl } = window.__TAURI__.opener;

const MAX_LINES = 2000;
const BOTTOM_SLACK_PX = 48;
const LAST_BUFFER_KEY = 'lobby.current';
const FIRST_PICK_DELAY_MS = 400;
const QUICK_REACTIONS = ['👍', '😂', '❤️', '🔥', '😮'];
/** How many of your most used emojis the hover row and the long-press sheet offer. */
const QUICK_REACTION_COUNT = 5;
const REACTION_SETTING = 'reactions';
// Emoji helpers in the message box, on unless turned off.
const EMOTICON_SETTING = 'emoticons';
// Tab completes nicks either way; these only choose when the list opens by itself.
const NICK_MENU_SETTINGS = { at: 'nick_menu_at', word: 'nick_menu_word' };
const HOVER_CARD_SETTING = 'hover_cards';
const HOVER_CARD_WAIT_SETTING = 'hover_card_wait';
const BOTS_SETTING = 'bots';
const HIGHLIGHT_WORDS_SETTING = 'highlightWords';
// On unless turned off: a private message counts as a highlight, in Highlights, the count and notifications.
const PM_HIGHLIGHT_SETTING = 'pmHighlights';
/** A bot's answer joins the command it follows only this soon after it. */
const BOT_ANSWER_MS = 60 * 1000;
const SHORTCODE_SETTING = 'shortcodes';
const PHOTO_PX = 160;
const PHOTO_QUALITY = 0.85;
const COLOR_SAMPLE_PX = 24;
const ROUND_SAMPLE_PX = 32;
// The largest square inside a circle is 1/√2 of its width; a little less avoids the rim.
const ROUND_INNER = 0.7;
// Colours offered for people, purple left out.
const SWATCHES = ['#f7768e', '#ff9e64', '#e0af68', '#9ece6a', '#73daca', '#7dcfff', '#bb9af7', '#d6d6da'];
const PERSON_ICON =
  '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
const DICE_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/></svg>';
const CAMERA_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
// A "nick: text" line shows the nick's previous message as a quote when it is this recent.
const REPLY_WINDOW_MS = 30 * 60 * 1000;
// A follow-up line without "nick:" still goes to the same person within this gap.
const THREAD_GAP_MS = 5 * 60 * 1000;
// How a reply shows: 'quote' bubble only, 'both' bubble and nick, 'nick' only.
const REPLY_STYLE_SETTING = 'replyStyle';
const REPLY_STYLES = ['quote', 'both', 'nick'];

function replyStyle() {
  const style = state.settings[REPLY_STYLE_SETTING];
  return REPLY_STYLES.includes(style) ? style : 'quote';
}
const QUOTE_CHARS = 120;
const READ_SETTING = 'read';
const READ_SAVE_DELAY_MS = 1500;
// Leave this much of the earlier chat visible above the "New" line when opening at it.
const SEPARATOR_MARGIN_PX = 48;
// Server answers (WHOIS, errors) show in the open window when a command was sent this recently.
const COMMAND_ANSWER_MS = 15000;

const $ = (id) => document.getElementById(id);
const el = {
  title: $('title'),
  chanIcon: $('chan-icon'),
  chanName: $('chan-name'),
  chanMeta: $('chan-meta'),
  chanNet: $('chan-net'),
  unread: $('unread'),
  gear: $('gear'),
  pill: $('pill'),
  inboxPill: $('inbox-pill'),
  inbox: $('inbox'),
  inboxList: $('inbox-list'),
  inboxFilter: $('inbox-filter'),
  inboxFreshTab: $('inbox-fresh-tab'),
  inboxArchiveTab: $('inbox-archive-tab'),
  inboxAll: $('inbox-all'),
  inboxFoot: $('inbox-foot'),
  openInbox: $('open-inbox'),
  views: $('views'),
  shelf: $('shelf'),
  shelfLatest: $('shelf-latest'),
  windowBar: $('window-bar'),
  windowWhen: $('window-when'),
  windowBack: $('window-back'),
  status: $('status'),
  statusText: $('status-text'),
  statusAction: $('status-action'),
  splash: $('splash'),
  splashLight: $('splash-light'),
  splashLamp: $('splash-lamp'),
  welcome: $('welcome'),
  welcomeWays: $('welcome-ways'),
  welcomeQuick: $('welcome-quick'),
  welcomeNext: $('welcome-next'),
  welcomeBack: $('welcome-back'),
  welcomeNick: $('welcome-nick'),
  welcomeNets: $('welcome-nets'),
  welcomeHost: $('welcome-host'),
  welcomeChans: $('welcome-chans'),
  welcomeError: $('welcome-error'),
  checklist: $('checklist'),
  checklistCount: $('checklist-count'),
  checklistFill: $('checklist-fill'),
  checklistItems: $('checklist-items'),
  checklistHide: $('checklist-hide'),
  updateBar: $('update-bar'),
  updateText: $('update-text'),
  updateRestart: $('update-restart'),
  updateClose: $('update-close'),
  updateSection: $('update-section'),
  updateAutoRow: $('update-auto-row'),
  updateAuto: $('update-auto'),
  updateCheck: $('update-check'),
  updateResult: $('update-result'),
  updateAsk: $('update-ask'),
  updateAskTitle: $('update-ask-title'),
  updateAskText: $('update-ask-text'),
  updateNotes: $('update-notes'),
  updateAskAutoRow: $('update-ask-auto-row'),
  updateAskAuto: $('update-ask-auto'),
  updateSkip: $('update-skip'),
  updateLater: $('update-later'),
  updateInstall: $('update-install'),
  toast: $('toast'),
  log: $('log'),
  col: $('col'),
  logwrap: $('logwrap'),
  form: $('composer'),
  input: $('input'),
  jumpUnread: $('jump-unread'),
  jumpLatest: $('jump-latest'),
  jumpLatestLabel: $('jump-latest-label'),
  markRead: $('mark-read'),
  unreadCount: $('unread-count'),
  notifyToggle: $('notify-toggle'),
  notifyTest: $('notify-test'),
  notifyState: $('notify-state'),
  notifyFix: $('notify-fix'),
  notifyResult: $('notify-result'),
  notifyGuide: $('notify-guide'),
  notifyGuideText: $('notify-guide-text'),
  notifyGuideGo: $('notify-guide-go'),
  notifyGuideLater: $('notify-guide-later'),
  emoticonToggle: $('emoticon-toggle'),
  replyStyle: $('reply-style'),
  botsField: $('bots-field'),
  highlightField: $('highlight-field'),
  channelAlerts: $('channel-alerts'),
  notifyNicksField: $('notify-nicks-field'),
  notifyWordsField: $('notify-words-field'),
  quitField: $('quit-field'),
  shortcodeToggle: $('shortcode-toggle'),
  iconChoices: $('icon-choices'),
  textSize: $('text-size'),
  textSizeNumber: $('text-size-number'),
  textSizeReset: $('text-size-reset'),
  shortcutList: $('shortcut-list'),
  shortcutReset: $('shortcut-reset'),
  emojiBtn: $('emoji-btn'),
  attachBtn: $('attach-btn'),
  attachFile: $('attach-file'),
  uploadUrl: $('upload-url'),
  npBtn: $('np-btn'),
  room: $('room'),
  npCard: $('np-card'),
  npCover: $('np-cover'),
  npTitle: $('np-title'),
  npArtist: $('np-artist'),
  npLine: $('np-line'),
  npSend: $('np-send'),
  npEdit: $('np-edit'),
  lastfmUser: $('lastfm-user'),
  lastfmKey: $('lastfm-key'),
  npFormat: $('np-format'),
  uploadVia: $('upload-via'),
  sftpKey: $('sftp-key'),
  sftpCopy: $('sftp-copy'),
  settingsTabs: $('settings-tabs'),
  settingsSave: $('settings-save'),
  slash: $('slash'),
  replying: $('replying'),
  people: $('people'),
  peopleTitle: $('people-title'),
  peopleBack: $('people-back'),
  peopleList: $('people-list-view'),
  peopleItems: $('people-list'),
  personNew: $('person-new'),
  personEdit: $('person-edit'),
  personPhoto: $('person-photo'),
  personPhotoRemove: $('person-photo-remove'),
  personFile: $('person-file'),
  personName: $('person-name'),
  personColor: $('person-color'),
  personColors: $('person-colors'),
  personNicks: $('person-nicks'),
  personNick: $('person-nick'),
  personDelete: $('person-delete'),
  replyNick: $('reply-nick'),
  replyText: $('reply-text'),
  replyClose: $('reply-close'),
  switcher: $('switcher'),
  filter: $('filter'),
  list: $('list'),
  settings: $('settings'),
  settingsClose: $('settings-close'),
  connections: $('connections'),
  configPath: $('config-path'),
  openConnection: $('open-connection'),
  connection: $('connection'),
  connectionState: $('connection-state'),
  connectionStateText: $('connection-state-text'),
  connectionForm: $('connection-form'),
  connectionClose: $('connection-close'),
  connectionAbout: $('connection-about'),
  connectionError: $('connection-error'),
  connSsh: $('conn-ssh'),
  connSshPort: $('conn-ssh-port'),
  connPort: $('conn-port'),
  connKey: $('conn-key'),
  connCopy: $('conn-copy'),
  connUrl: $('conn-url'),
  connToken: $('conn-token'),
  connNick: $('conn-nick'),
  connNetworks: $('conn-networks'),
  connAddNet: $('conn-add-net'),
  serverNets: $('server-nets'),
  serverNetsHint: $('server-nets-hint'),
  serverNetNew: $('server-net-new'),
  serverNetAdd: $('server-net-add'),
  langChoices: $('lang-choices'),
  maskToggle: $('mask-toggle'),
  filterField: $('filter-field'),
  blockedList: $('blocked-list'),
  aboutReport: $('about-report'),
  report: $('report'),
  reportQuote: $('report-quote'),
  reportNote: $('report-note'),
  reportBlock: $('report-block'),
  reportBlockLabel: $('report-block-label'),
  reportTo: $('report-to'),
  reportCancel: $('report-cancel'),
  reportSend: $('report-send'),
};

// A dialog opens with focus on itself, not on its first button: WebKit draws the keyboard ring on a
// button focused without a key press. Tab still reaches every button, ring and all.
const nativeShowModal = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function showModal() {
  nativeShowModal.call(this);
  if (!document.activeElement?.matches('input, textarea, select')) {
    this.focus();
  }
};

startLang(BRAND.lang ?? 'en');
// A fork made for one channel, such as Pulina, hides every network choice.
const ONLY = Boolean(BRAND.start?.only);
document.documentElement.toggleAttribute('data-only', ONLY);
// The one-field welcome: a fork's own channel, or Lobby's QuakeNet start.
const SHEET = ONLY || Boolean(BRAND.start?.sheet);
document.documentElement.toggleAttribute('data-sheet', SHEET);
translatePage();
nameSharedHost();

/** A fork's own file host, in catbox.moe's place in Settings. */
function nameSharedHost() {
  if (!BRAND.upload) {
    return;
  }
  const shared = document.querySelector('input[name="upload-via"][value="catbox"] + span');
  shared.firstChild.nodeValue = BRAND.upload.name;
  shared.querySelector('small').textContent = t(BRAND.upload.note);
  document.querySelector('input[name="upload-via"][value="auto"] + span small').textContent = t(
    'Your lobby-server first, then your own file host, then {name}',
    { name: BRAND.upload.name },
  );
}

/** The page's own text and labels in the chosen language, once at start. */
function translatePage() {
  if (currentLang() === 'en') {
    return;
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.trim().replace(/\s+/g, ' ');
    const said = text && t(text);
    if (said && said !== text) {
      const [lead] = node.nodeValue.match(/^\s*/);
      const [trail] = node.nodeValue.match(/\s*$/);
      node.nodeValue = lead + said + trail;
    }
  }
  for (const attr of ['placeholder', 'aria-label', 'data-tip', 'title']) {
    for (const node of document.body.querySelectorAll(`[${attr}]`)) {
      node.setAttribute(attr, t(node.getAttribute(attr)));
    }
  }
}

const state = { networks: [], buffers: new Map(), current: null, me: {}, masks: {}, conn: {}, configPath: '', people: [], settings: {} };
const previews = new Map();
let view = null;
let completion = null;
let lastSent = '';
let picked = 0;

// The system comes from the app itself: an iPhone's web view also calls itself Mac OS X.
const PLATFORM = { value: 'linux' };

const key = (net, name) => `${net}\u0000${name.toLowerCase()}`;
const label = (b) => b.name || b.net;
/** The message box's hint: some languages say a channel, a person and a network differently. */
const messageHint = (b) => tv('Message {name}', b.name === '' ? 'network' : isChannel(b.name) ? '' : 'person', { name: label(b) });
const isPrivate = (b) => b.name !== '' && !isChannel(b.name);

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) {
    node.className = cls;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

// Who a nick is: their person's name, colour and photo when one matches.

// Colours read from photos, worked out once per photo and kept for the session.
// Photos as shown, and their colours: worked out once per photo and kept for the session.
const photoInfos = new Map();

function photoInfo(photo) {
  if (photoInfos.has(photo)) {
    return photoInfos.get(photo);
  }
  photoInfos.set(photo, { src: photo, color: null });
  squarePhoto(photo).then(async (src) => {
    photoInfos.set(photo, { src, color: await colorOfPhoto(src) });
    refreshForPhotos();
  });
  return photoInfos.get(photo);
}

// Many photos finish at once (the People list loads them all): redraw once, after they settle.
const PHOTO_REFRESH_DELAY_MS = 250;
let photoRefreshTimer = null;

function refreshForPhotos() {
  clearTimeout(photoRefreshTimer);
  photoRefreshTimer = setTimeout(() => {
    renderHeader();
    redrawKeepingScroll();
    if (peopleListShown()) {
      renderPeople();
    }
  }, PHOTO_REFRESH_DELAY_MS);
}

/** Redraw the chat without moving what the reader is looking at. */
function redrawKeepingScroll() {
  const pinned = atBottom();
  const spot = pinned ? null : topSpot();
  renderLog();
  if (pinned) {
    toBottom();
  } else if (toSpot(spot)) {
    stuck = false;
    noteAnchor();
  }
}

function photoColorOf(photo) {
  return photoInfo(photo).color;
}

/** The photo as shown: round avatars are zoomed to fill the squircle. */
function shownPhoto(photo) {
  return photo ? photoInfo(photo).src : '';
}

/** A person's colour: their own pick, else from their photo, else from the nick. */
function personColor(person, nick) {
  return person?.color || (person?.photo && photoColorOf(person.photo)) || nickColor(nick);
}

// A fork with accounts keeps each account's picture; the app signed in with one shares its own photo there.
async function shareOwnPhoto(photo) {
  if (!BRAND.accounts) {
    return;
  }
  try {
    const picture = photo ? await invoke('share_avatar', { photo }) : '';
    const answer = await invoke('account_call', { action: 'picture', body: { picture } });
    if (answer?.error === 'no_account') {
      return;
    }
    if (answer?.error) {
      throw answer.error;
    }
    renderStatus(t('Others see your picture now.'));
    loadAccountPictures();
  } catch (err) {
    renderStatus(t('Could not share your picture: {error}', { error: err }));
  }
}

// Account pictures by the nick each account's own connection holds right now; your own photo of someone wins.
const sharedAvatars = new Map();
const PICTURES_EVERY_MS = 60 * 1000;

async function loadAccountPictures() {
  const list = await invoke('account_call', { action: 'pictures', body: {} }).catch(() => null);
  if (!list?.pictures) {
    return;
  }
  const before = JSON.stringify([...sharedAvatars]);
  sharedAvatars.clear();
  for (const [nick, url] of Object.entries(list.pictures)) {
    sharedAvatars.set(nick.toLowerCase(), url);
  }
  if (JSON.stringify([...sharedAvatars]) !== before) {
    renderLog();
    renderHeader();
    renderNicklist();
  }
}

if (BRAND.accounts) {
  loadAccountPictures();
  setInterval(loadAccountPictures, PICTURES_EVERY_MS);
}

function identity(nick, mask = '') {
  const person = personFor(state.people, nick, mask);
  return {
    person,
    name: person?.name || nick,
    color: personColor(person, nick),
    photo: shownPhoto(person?.photo) || sharedAvatars.get(nick.toLowerCase()) || '',
  };
}

function avatar(nick, mask, cls = 'av') {
  const who = identity(nick, mask);
  const av = h('div', cls);
  if (who.photo) {
    av.classList.add('photo');
    const img = h('img');
    img.src = who.photo;
    img.alt = '';
    av.append(img);
  } else {
    animalInto(av, nick, who.color);
  }
  return av;
}

/** No photo: an animal on a soft gradient of the person's colour. */
function animalInto(node, nick, color) {
  node.classList.add('animal');
  node.textContent = shownAnimal(nick);
  node.style.background = `linear-gradient(color-mix(in srgb, ${color} 45%, white), ${color})`;
  return node;
}

// Your own animal can be picked; everyone else keeps the one their nick gives.
const ANIMAL_SETTING = 'animal';
const ROLL_STEPS = 7;
const ROLL_STEP_MS = 45;

function isMyNick(nick) {
  const n = nick.toLowerCase();
  return n === onboarding?.connection?.nick?.toLowerCase() || Object.values(state.me).some((m) => m?.toLowerCase() === n);
}

function shownAnimal(nick) {
  const mine = isMyNick(nick) && (onboarding?.plan.animal || state.settings[ANIMAL_SETTING]);
  return mine || animalFor(nick);
}

const randomAnimal = () => ANIMALS[Math.floor(Math.random() * ANIMALS.length)];

/** A short slot-machine spin through animals, landing on a new one with a pop. */
async function rollAnimal(node) {
  let pick = node.textContent;
  while (pick === node.textContent) {
    pick = randomAnimal();
  }
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (let i = 0; i < ROLL_STEPS; i += 1) {
      node.textContent = randomAnimal();
      await new Promise((r) => setTimeout(r, ROLL_STEP_MS + i * 12));
    }
  }
  node.textContent = pick;
  node.classList.remove('rolled');
  node.offsetWidth;
  node.classList.add('rolled');
  return pick;
}

// Read markers: the last line id seen per channel, stored as a setting so every device agrees.

const readMap = {};
let readSaveTimer = null;

function lastId(b) {
  for (let i = b.lines.length - 1; i >= 0; i -= 1) {
    if (b.lines[i].id) {
      return b.lines[i].id;
    }
  }
  return 0;
}

/** This device's first run: nothing it has never shown counts as unread here. */
const FRESH_DEVICE_KEY = 'lobby.readSeeded';
const FRESH_DEVICE = (() => {
  try {
    const fresh = !localStorage.getItem(FRESH_DEVICE_KEY);
    localStorage.setItem(FRESH_DEVICE_KEY, '1');
    return fresh;
  } catch {
    return false;
  }
})();
const seededHere = new Set();

function saveReadSoon() {
  clearTimeout(readSaveTimer);
  readSaveTimer = setTimeout(flushRead, READ_SAVE_DELAY_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    flushRead();
  }
});

/** Save the read markers now, so other devices hear of it before this one sleeps. */
function flushRead() {
  if (readSaveTimer === null) {
    return;
  }
  clearTimeout(readSaveTimer);
  readSaveTimer = null;
  saveSetting(READ_SETTING, JSON.stringify(readMap));
}

function markRead(b) {
  b.unreadGap = 0;
  const last = lastId(b);
  if (last > (readMap[b.key] || 0)) {
    readMap[b.key] = last;
    saveReadSoon();
  }
  if (b.unread || b.mention) {
    b.unread = 0;
    b.mention = false;
    renderHeader();
  }
}

/** Count what is newer than the read marker; a channel never seen before counts as read. */
function recountUnread(b) {
  if (readMap[b.key] === undefined) {
    // Nothing loaded yet: marking 0 here would make all of the history, once it arrives, unread.
    if (lastId(b)) {
      readMap[b.key] = lastId(b);
    }
    return;
  }
  const seen = readMap[b.key];
  const fresh = b.lines.filter((l) => l.id > seen && CHAT_KINDS.has(l.kind) && !l.own && !isMuffled(l));
  b.unread = (b.unreadGap || 0) + fresh.length;
  b.mention = fresh.length > 0 && fresh.some(forMe);
}

function applyReadSetting(value) {
  let incoming = {};
  try {
    incoming = JSON.parse(value || '{}');
  } catch {
    /* keep what we have */
  }
  for (const [k, id] of Object.entries(incoming)) {
    readMap[k] = Math.max(readMap[k] || 0, id);
  }
  for (const b of state.buffers.values()) {
    if (b.key !== state.current) {
      recountUnread(b);
    }
  }
  // Read on another device: the open channel drops its New line too, once all of it is read there.
  const open = state.buffers.get(state.current);
  if (open && view && (readMap[open.key] || 0) >= lastId(open) && (open.unread || view.separator)) {
    markCurrentRead();
  }
  renderHeader();
}

// Buffers

function buffer(net, name) {
  const k = key(net, name);
  const existing = state.buffers.get(k);
  if (existing) {
    return existing;
  }

  const b = {
    key: k,
    net,
    name,
    lines: [],
    ids: new Set(),
    unread: 0,
    mention: false,
    topic: '',
    members: new Set(),
    modes: new Map(),
    joined: false,
  };
  state.buffers.set(k, b);
  loadHistory(b);
  renderHeader();
  if (k === openWhenJoined) {
    openWhenJoined = null;
    select(k);
  }
  if (!state.current && state.started) {
    scheduleFirstPick();
  }
  return b;
}

async function loadHistory(b) {
  const lines = await invoke('history', { net: b.net, buffer: b.name }).catch(() => []);
  // First time this channel is seen anywhere, or on this device: its old history counts as read,
  // even when another device left an older marker. An empty answer sets nothing: the public log may
  // still be on its way, and it is old talk too.
  const newest = lines.reduce((max, l) => Math.max(max, l.id || 0), 0);
  const firstHere = FRESH_DEVICE && !seededHere.has(b.key);
  if ((readMap[b.key] === undefined || firstHere) && newest) {
    seededHere.add(b.key);
    readMap[b.key] = Math.max(readMap[b.key] || 0, newest);
    saveReadSoon();
  }
  const fresh = lines.filter((l) => !b.ids.has(l.id));
  for (const l of fresh) {
    noteSpoke(l);
  }
  // A full page may leave a hole between it and older lines held, like after events were missed,
  // so older lines go: they are still in the history, and counted while unread.
  const full = lines.length >= HISTORY_PAGE;
  const held = b.lines.length;
  if (full) {
    b.lines = b.lines.filter((l) => !l.id || l.id >= lines[0].id);
  }
  const dropped = b.lines.length !== held;
  b.lines = [...b.lines, ...fresh].sort((x, y) => (x.id || Infinity) - (y.id || Infinity)).slice(-MAX_LINES);
  b.ids = new Set(b.lines.map((l) => l.id).filter(Boolean));
  await countGap(b, full);
  recountUnread(b);
  if (state.current !== b.key) {
    renderHeader();
  } else if (fresh.length || dropped) {
    // Lines from the server must not move a reader who has jumped up, to a highlight say.
    const spot = atBottom() ? null : topSpot();
    renderLog();
    if (toSpot(spot)) {
      stuck = false;
      noteAnchor();
    }
  } else {
    updateJumps();
  }
}

/** lobby-server's history page (`HISTORY_PAGE` in core/src/hub.rs). */
const HISTORY_PAGE = 300;

/**
 * Unread lines older than what is loaded: thousands of them can wait while only the newest
 * page is held, and the counts and the jump to the first unread still have to know.
 */
async function countGap(b, more) {
  const seen = readMap[b.key];
  const first = b.lines.find((l) => l.id)?.id;
  b.unreadGap = 0;
  if (!more || seen === undefined || !first || seen >= first) {
    return;
  }
  b.unreadGap = await invoke('count_unread', { net: b.net, buffer: b.name, after: seen, before: first }).catch(() => 0);
}

function trackMembers(b, l) {
  if (l.kind === 'join') {
    b.members.add(l.nick);
  }
  if (l.kind === 'part' || l.kind === 'quit' || l.kind === 'kick') {
    b.members.delete(l.nick);
    b.modes.delete(l.nick);
  }
  if (l.kind === 'nick') {
    b.members.delete(l.nick);
    b.members.add(l.text);
    const held = b.modes.get(l.nick);
    b.modes.delete(l.nick);
    if (held) {
      b.modes.set(l.text, held);
    }
    renameSpoke(b.net, l.nick, l.text);
  }
}

/** A muted nick keeps its mute through a nick change, and loses it by highlighting me. */
function followMute(l) {
  if (!isMutedNick(l.nick)) {
    return;
  }
  if (l.kind === 'nick') {
    setKey(MUTED_NICKS_SETTING, l.nick.toLowerCase(), false);
    setKey(MUTED_NICKS_SETTING, l.text.toLowerCase(), true);
    return;
  }
  if (CHAT_KINDS.has(l.kind) && !l.own && mentions(l.text, myWords(l.net))) {
    setNickMuted(l.nick, false);
    localNote(t('{nick} highlighted you and is no longer muted', { nick: l.nick }));
  }
}

function onLine(l) {
  if (l.kind === 'info' && Date.now() - lastCommandAt < COMMAND_ANSWER_MS && view) {
    const pinned = atBottom();
    el.col.append(h('div', 'events info', l.text));
    if (pinned) {
      toBottom();
    }
  }
  const b = buffer(l.net, l.buffer);
  if (l.id && b.ids.has(l.id)) {
    return;
  }
  if (l.id) {
    b.ids.add(l.id);
  }
  // Before the line is kept, so a highlight that unmutes is drawn once, as a new line.
  followMute(l);
  b.lines.push(l);
  if (b.lines.length > MAX_LINES) {
    const gone = b.lines.shift();
    if (gone.id > (readMap[b.key] ?? Infinity) && CHAT_KINDS.has(gone.kind) && !gone.own) {
      b.unreadGap = (b.unreadGap || 0) + 1;
    }
  }
  trackMembers(b, l);
  noteSpoke(l);
  if (b.key === state.current) {
    schedulePeople();
  }
  if (isMuffled(l)) {
    return;
  }

  const visible = state.current === b.key;
  if (visible && !b.window) {
    queueLive(l);
    splashReady();
  }
  if (b.window && CHAT_KINDS.has(l.kind) && !l.own) {
    b.windowAfter = (b.windowAfter || 0) + 1;
    if (visible) {
      updateJumps();
    }
  }
  // Nothing is marked read on its own: only the Mark as read button does that.
  if (!CHAT_KINDS.has(l.kind) || l.own) {
    return;
  }

  b.unread += 1;
  if (isHighlight(l)) {
    inbox.lines.set(l.id, l);
    renderInbox();
  }
  const mentioned = forMe(l);
  if (mentioned) {
    b.mention = true;
  }
  const wanted = mentioned || keySet(NOTIFY_ALL_SETTING).has(b.key) || notifyMatch()(l);
  if (wanted && !isHidden(b) && !(visible && document.hasFocus())) {
    notify(b, l);
  }
  headerSoon();
}

let headerFrame = 0;

function headerSoon() {
  if (headerFrame) {
    return;
  }
  headerFrame = requestAnimationFrame(() => {
    headerFrame = 0;
    renderHeader();
  });
}

function onBuffer(info) {
  const b = buffer(info.net, info.name);
  b.topic = info.topic;
  b.joined = info.joined;
  b.members = new Set(info.members);
  b.modes = new Map(Object.entries(info.modes || {}));
  b.chanModes = info.chan_modes || {};
  b.lists = info.lists || {};
  b.modeKinds = info.mode_kinds || '';
  renderHeader();
  if (el.settings.open && settingsTab === 'channel') {
    renderChannelTools();
  }
}

/** Channels in list order, without hidden ones: what the keys step through and number. */
function ordered() {
  return sortedBuffers().filter((b) => !isHidden(b));
}

function sortedBuffers() {
  const kind = (b) => (b.name === '' ? 2 : isPrivate(b) ? 1 : 0);
  const netIndex = (b) => {
    const i = state.networks.indexOf(b.net);
    return i === -1 ? 99 : i;
  };
  return [...state.buffers.values()].sort((a, b) => netIndex(a) - netIndex(b) || kind(a) - kind(b) || label(a).localeCompare(label(b)));
}

// Header

const CHANNELS_SETTING = 'channels';
const MUTED_SETTING = 'muted';
const HIDDEN_SETTING = 'hidden';
// Channels where every message, not only highlights, counts on the app icon or notifies.
const BADGE_ALL_SETTING = 'badgeAll';
const NOTIFY_ALL_SETTING = 'notifyAll';
// People and words that notify and count on the app icon in every channel, without highlighting.
const NOTIFY_NICKS_SETTING = 'notifyNicks';
const NOTIFY_WORDS_SETTING = 'notifyWords';

// Ignored nicks, lower-case, as irssi's /ignore: their lines are left out everywhere. Filter words hide whole messages.
const BLOCKED_SETTING = 'blocked';
const FILTER_WORDS_SETTING = 'filterWords';
// Offensive words show as •••, off unless turned on.
const MASK_SETTING = 'maskOffensive';

function isIgnored(nick) {
  return keySet(BLOCKED_SETTING).has((nick || '').toLowerCase());
}

// Muted nicks, lower-case: kept in this app only, nothing goes to IRC. Hidden like ignored ones
// until they highlight me, which unmutes them.
const MUTED_NICKS_SETTING = 'mutedNicks';

function isMutedNick(nick) {
  return keySet(MUTED_NICKS_SETTING).has((nick || '').toLowerCase());
}

function setNickMuted(nick, on) {
  setKey(MUTED_NICKS_SETTING, nick.toLowerCase(), on);
  closePeopleMenu();
  nicklist.picked.clear();
  refilter();
  renderNicklist();
}

/** Left out of the chat, highlights, shelf, counts and notifications. */
function isMuffled(l) {
  return (
    isIgnored(l.nick) ||
    isMutedNick(l.nick) ||
    (!l.own && CHAT_KINDS.has(l.kind) && mentions(l.text, wordList(state.settings[FILTER_WORDS_SETTING])))
  );
}

/** Text as it is shown, never as it is sent. */
function shownText(text) {
  return state.settings[MASK_SETTING] === 'on' ? maskWords(text, OFFENSIVE_WORDS) : text;
}

/** Text for the chat itself: masked words go under spoiler dust instead of dots. */
function shownNodes(text) {
  if (state.settings[MASK_SETTING] !== 'on') {
    return [text];
  }
  return maskParts(text, OFFENSIVE_WORDS).map(([piece, masked]) => (masked ? spoiler(piece) : piece));
}

// Spoiler, the same as ~/bot's (apps/neai-web spoiler.tsx): the word sits under fine drifting dust
// seeded from its real character boxes; a tap dissolves the dust outward while the word fades in,
// and another tap puts it back. The loop runs only on screen and stops once fully revealed.
const SPOILER_MAX_PARTICLES = 5000;
const SPOILER_DENSITY = 0.32;
const SPOILER_VSPREAD = 0.45;
const SPOILER_FADE_MS = 420;
const SPOILER_SEED_TRIES = 30;
const easeOutCubic = (x) => 1 - (1 - x) ** 3;

function spoiler(word) {
  const host = h('span', 'spoiler is-hidden');
  host.setAttribute('role', 'button');
  host.tabIndex = 0;
  const text = h('span', 'spoiler-text', word);
  const canvas = document.createElement('canvas');
  canvas.className = 'spoiler-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.append(text, canvas);
  const state = { revealed: false };
  const label = () =>
    host.setAttribute('aria-label', state.revealed ? t('Revealed text, activate to hide it again') : t('Hidden text, activate to reveal'));
  label();
  let start = () => {};
  const toggle = (e) => {
    e.stopPropagation();
    state.revealed = !state.revealed;
    host.classList.toggle('is-revealed', state.revealed);
    host.classList.toggle('is-hidden', !state.revealed);
    label();
    canvas.style.display = 'block';
    start();
  };
  host.addEventListener('click', toggle);
  host.addEventListener('pointerdown', (e) => e.stopPropagation());
  host.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(e);
    }
  });
  requestAnimationFrame(() => {
    start = animateSpoiler(host, text, canvas, state);
  });
  return host;
}

function animateSpoiler(host, text, canvas, state) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    text.style.opacity = '1';
    return () => {};
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  let particles = [];
  let colour = '#fff';
  let w = 1;
  let hgt = 1;
  let raf = 0;
  let last = 0;
  let progress = 0;
  let onScreen = true;
  let seedTries = 0;

  const apply = () => {
    // With no dust nothing covers the word, so hiding it would leave a hole in the sentence.
    if (!particles.length) {
      text.style.opacity = '1';
      canvas.style.display = 'none';
      return;
    }
    text.style.opacity = String(easeOutCubic(progress));
    canvas.style.display = progress >= 1 ? 'none' : 'block';
  };

  const seed = () => {
    const box = host.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) {
      particles = [];
      apply();
      if (host.isConnected && seedTries < SPOILER_SEED_TRIES) {
        seedTries += 1;
        requestAnimationFrame(seed);
      }
      return;
    }
    seedTries = 0;
    w = Math.max(1, Math.ceil(box.width));
    hgt = Math.max(1, Math.ceil(box.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${hgt}px`;
    // In a wrapped inline element mobile WebKit puts the canvas on the first line only: measure
    // where it landed and move it onto the whole box.
    const prevDisplay = canvas.style.display;
    if (prevDisplay === 'none') {
      canvas.style.display = 'block';
    }
    canvas.style.transform = '';
    const cr = canvas.getBoundingClientRect();
    if (cr.width > 0.5) {
      const dx = box.left - cr.left;
      const dy = box.top - cr.top;
      canvas.style.transform = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 ? `translate(${dx}px, ${dy}px)` : '';
    }
    if (prevDisplay === 'none') {
      canvas.style.display = prevDisplay;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    colour = getComputedStyle(text).color;

    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const seeds = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue ?? '';
      for (let i = 0; i < value.length; i++) {
        if (/\s/.test(value[i])) {
          continue;
        }
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) {
          continue;
        }
        const inset = r.height * 0.16;
        const bandH = r.height - inset * 2;
        const count = Math.max(2, Math.round(r.width * bandH * SPOILER_DENSITY));
        const x0 = r.left - box.left;
        const y0 = r.top - box.top + inset;
        for (let k = 0; k < count; k++) {
          const bell = (Math.random() + Math.random() + Math.random()) / 3 - 0.5;
          seeds.push({ x: x0 + Math.random() * r.width, y: y0 + bandH * 0.5 + bell * bandH * (1 + SPOILER_VSPREAD * 2) });
        }
      }
    }
    const stride = Math.max(1, Math.ceil(seeds.length / SPOILER_MAX_PARTICLES));
    particles = seeds
      .filter((_, i) => i % stride === 0)
      .map((p) => {
        const angle = Math.random() * Math.PI * 2;
        return {
          x: p.x,
          y: p.y,
          dx: Math.cos(angle),
          dy: Math.sin(angle),
          size: Math.random() < 0.7 ? 0.5 : 1,
          base: 0.7 + Math.random() * 0.3,
          phase: Math.random() * Math.PI * 2,
          speed: 0.7 + Math.random() * 1.1,
          amp: 1.2 + Math.random() * 1.4,
        };
      });
  };

  const paint = (time) => {
    ctx.clearRect(0, 0, w, hgt);
    if (progress >= 1) {
      return;
    }
    const eased = easeOutCubic(progress);
    const spread = eased * 14;
    const fade = 1 - eased;
    ctx.fillStyle = colour;
    for (const p of particles) {
      const ph = p.phase + time * 0.004 * p.speed;
      ctx.globalAlpha = Math.min(1, p.base * (0.8 + 0.2 * Math.sin(ph)) * fade);
      ctx.fillRect(p.x + Math.sin(ph * 1.7) * p.amp + p.dx * spread, p.y + Math.cos(ph * 1.1) * p.amp + p.dy * spread, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  };

  const frame = (time) => {
    const dt = last ? time - last : 16;
    last = time;
    const target = state.revealed ? 1 : 0;
    if (progress !== target) {
      const step = dt / SPOILER_FADE_MS;
      progress = target > progress ? Math.min(target, progress + step) : Math.max(target, progress - step);
      apply();
    }
    paint(time);
    if (!host.isConnected || (progress >= 1 && target === 1)) {
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (raf || !onScreen) {
      return;
    }
    if (reduced) {
      progress = state.revealed ? 1 : 0;
      apply();
      paint(0);
      return;
    }
    last = 0;
    raf = requestAnimationFrame(frame);
  };

  seed();
  apply();
  start();

  const io = new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      if (!host.isConnected) {
        io.disconnect();
        ro.disconnect();
      }
      if (!onScreen) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else {
        start();
      }
    },
    { rootMargin: '120px 0px' },
  );
  io.observe(host);
  // The block around it reflows reliably; an inline span alone misses rewraps.
  const ro = new ResizeObserver(() => {
    seed();
    if (reduced) {
      paint(0);
    }
  });
  ro.observe(host);
  const block = host.parentElement?.closest('p, div, li') ?? host.parentElement;
  if (block && block !== host) {
    ro.observe(block);
  }
  return start;
}

function ignore(nick) {
  setKey(BLOCKED_SETTING, nick.toLowerCase(), true);
  refilter();
}

function unignore(nick) {
  setKey(BLOCKED_SETTING, nick.toLowerCase(), false);
  refilter();
}

/** Draw again whatever blocking, filtering or masking leaves out or changes. */
function refilter() {
  for (const b of state.buffers.values()) {
    if (b.key !== state.current) {
      recountUnread(b);
    }
  }
  renderLog();
  renderInbox();
  renderHeader();
  schedulePeople();
  recaps.clear();
  if (shelf.open) {
    renderShelf();
  }
  if (el.settings.open) {
    renderIgnored();
  }
}

function notifyMatch() {
  const nicks = new Set(wordList(state.settings[NOTIFY_NICKS_SETTING]));
  const words = wordList(state.settings[NOTIFY_WORDS_SETTING]);
  return (l) => nicks.has((l.nick || '').toLowerCase()) || mentions(l.text, words);
}

function keySet(setting) {
  try {
    return new Set(JSON.parse(state.settings[setting] || '[]'));
  } catch {
    return new Set();
  }
}

function setKey(setting, k, on) {
  const keys = keySet(setting);
  if (on) {
    keys.add(k);
  } else {
    keys.delete(k);
  }
  saveSetting(setting, JSON.stringify([...keys]));
}

/** Hidden channels are left out of everything but the Hidden group at the end of the channel list. */
function hiddenKeys() {
  try {
    return new Set(JSON.parse(state.settings[HIDDEN_SETTING] || '[]'));
  } catch {
    return new Set();
  }
}

function isHidden(b) {
  // A one-channel fork has no use for the network's own window.
  return hiddenKeys().has(b.key) || (ONLY && b.name === '');
}

function setHidden(b, hidden) {
  const keys = hiddenKeys();
  if (hidden) {
    keys.add(b.key);
  } else {
    keys.delete(b.key);
  }
  saveSetting(HIDDEN_SETTING, JSON.stringify([...keys]));
  renderHeader();
  renderList();
  renderInbox();
}

/** Muted channels add nothing to unread counts or jumps, except mentions. */
function mutedKeys() {
  try {
    return new Set(JSON.parse(state.settings[MUTED_SETTING] || '[]'));
  } catch {
    return new Set();
  }
}

function isMuted(b) {
  return mutedKeys().has(b.key);
}

/** Does this channel's unread deserve attention? */
function wantsAttention(b) {
  return attentionCount(b) > 0;
}

/** What a channel adds to the unread count: everything, or for a muted one only what names you. */
function attentionCount(b) {
  if (!b.unread || isHidden(b)) {
    return 0;
  }
  if (!isMuted(b)) {
    return b.unread;
  }
  if (!b.mention) {
    return 0;
  }
  const seen = readMap[b.key] ?? Infinity;
  return b.lines.filter((l) => l.id > seen && CHAT_KINDS.has(l.kind) && !l.own && !isMuffled(l) && forMe(l)).length || 1;
}

const BELL =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>';
const BELL_OFF =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.7 3.6A6 6 0 0 1 18 8c0 3 .6 5 1.4 6.4M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>';

// Each channel in the switcher has its bell at the end of the row.
function bellButton(b) {
  const muted = isMuted(b);
  const bell = h('button', 'row-bell');
  bell.type = 'button';
  bell.setAttribute('aria-pressed', String(muted));
  bell.setAttribute('aria-label', muted ? t('Unmute {name}', { name: label(b) }) : t('Mute {name}', { name: label(b) }));
  bell.dataset.tip = muted ? t('Unmute') : t('Mute');
  bell.append(svg(muted ? BELL_OFF : BELL));
  bell.addEventListener('click', () => setMuted(b, !muted));
  return bell;
}

const EYE =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 5.2A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m2 2 20 20"/></svg>';

function eyeButton(b) {
  const hidden = isHidden(b);
  const eye = h('button', 'row-bell row-eye');
  eye.type = 'button';
  eye.setAttribute('aria-pressed', String(hidden));
  eye.setAttribute('aria-label', hidden ? t('Show {name}', { name: label(b) }) : t('Hide {name}', { name: label(b) }));
  eye.dataset.tip = hidden ? t('Show in the list') : t('Hide from the list');
  eye.append(svg(hidden ? EYE_OFF : EYE));
  eye.addEventListener('click', () => setHidden(b, !hidden));
  return eye;
}

function setMuted(b, muted) {
  const keys = mutedKeys();
  if (muted) {
    keys.add(b.key);
  } else {
    keys.delete(b.key);
  }
  saveSetting(MUTED_SETTING, JSON.stringify([...keys]));
  renderHeader();
}

/** A channel's own picture and colour, set from its header icon. */
/** A channel's picture and colour as set here, else the one a fork ships for it. */
function channelLook(b) {
  let set = null;
  try {
    set = JSON.parse(state.settings[CHANNELS_SETTING] || '{}')[b.key];
  } catch {
    /* none set */
  }
  return set ?? BRAND.channels?.[b.name.toLowerCase()] ?? {};
}

function icon(b, node) {
  node.style.background = '';
  node.style.color = '';
  node.classList.remove('animal');
  node.replaceChildren();
  if (isPrivate(b)) {
    const who = identity(b.name);
    if (who.photo) {
      return photoInto(node, who.photo);
    }
    return animalInto(node, b.name, who.color);
  }
  const look = channelLook(b);
  if (look.photo) {
    return photoInto(node, shownPhoto(look.photo));
  }
  node.textContent = b.name === '' ? '~' : '#';
  if (look.color) {
    node.style.background = look.color;
    node.style.color = 'var(--bg)';
  }
  return node;
}

function photoInto(node, src) {
  const img = h('img');
  img.src = src;
  img.alt = '';
  node.append(img);
  return node;
}

// The app icon counts what the @ pill counts, highlights not yet checked off, plus unread private messages
// and every unread message in channels set to count them all.
let shownBadge = -1;

function badgeCount() {
  const every = keySet(BADGE_ALL_SETTING);
  const chosen = notifyMatch();
  let n = inboxParts().fresh.filter((l) => !every.has(key(l.net, l.buffer))).length;
  for (const b of state.buffers.values()) {
    if (isHidden(b) || !b.unread) {
      continue;
    }
    if (isPrivate(b) || every.has(b.key)) {
      n += b.unread;
      continue;
    }
    // Chosen people and words not already counted as highlights.
    const seen = readMap[b.key] ?? Infinity;
    n += b.lines.filter((l) => l.id > seen && CHAT_KINDS.has(l.kind) && !l.own && !isMuffled(l) && !forMe(l) && chosen(l)).length;
  }
  return n;
}

function updateBadge() {
  const n = badgeCount();
  if (n === shownBadge) {
    return;
  }
  shownBadge = n;
  invoke('set_badge', { count: n }).catch(() => {});
}

// A channel being joined (rejoined after a start, or picked in the welcome): its history may already
// show, but nothing can be sent there until the server has let you in.
const REJOIN_SETTING_PREFIX = 'rejoin.';
// The channel the welcome joins, opened as soon as the server lets you in.
let openWhenJoined = null;

function rememberedChannels(net) {
  try {
    return JSON.parse(state.settings[REJOIN_SETTING_PREFIX + net] || '[]').map((c) => c.toLowerCase());
  } catch {
    return [];
  }
}

function isJoining(b) {
  return (
    Boolean(b) && isChannel(b.name) && !b.joined && (openWhenJoined === b.key || rememberedChannels(b.net).includes(b.name.toLowerCase()))
  );
}

function renderJoining() {
  const b = state.buffers.get(state.current);
  const joining = isJoining(b);
  $('joining').hidden = !joining;
  el.input.disabled = joining;
  el.input.placeholder = b ? messageHint(b) : '';
  if (joining) {
    $('joining-text').textContent = t('Joining {name}…', { name: label(b) });
  }
}

function renderHeader() {
  renderJoining();
  updateBadge();
  renderChecklist();
  const b = state.buffers.get(state.current);
  if (b) {
    icon(b, el.chanIcon);
    el.chanName.textContent = label(b);
    // First line: the name in full, the network beside it. Second line: the topic.
    el.chanNet.textContent = `${b.net}${isMuted(b) ? ` · ${t('muted')}` : ''}`;
    const topic = isPrivate(b) ? t('private') : b.name === '' ? t('server messages') : stripFormatting(b.topic || '');
    el.chanMeta.textContent = topic;
    el.chanMeta.hidden = !topic;
    el.title.dataset.tip = b.topic || '';
    el.views.hidden = b.name === '';
  }
  schedulePeople();

  const others = [...state.buffers.values()].filter((x) => x.key !== state.current && wantsAttention(x));
  const total = others.reduce((n, x) => n + attentionCount(x), 0);
  el.unread.hidden = total === 0;
  // Phones show the number alone, so the channel name keeps its room.
  const unreadText = t('{n} unread', { n: total });
  el.unread.setAttribute('aria-label', unreadText);
  el.unread.replaceChildren(String(total), h('span', 'unread-word', unreadText.replace(String(total), '')));
  el.unread.classList.toggle(
    'mention',
    others.some((x) => x.mention),
  );
  document.title = total ? `${BRAND.name} (${total})` : BRAND.name;

  if (el.switcher.open) {
    renderList();
  }
}

// Connection trouble shows as one clear line under the header; other messages as a toast that goes away.
const TOAST_MS = 6000;
const UNREACHABLE = 'lobby-server unreachable';
let toastTimer = null;

function renderStatus(message) {
  if (message !== undefined) {
    showToast(message);
  } else if (el.toast.dataset.sticky) {
    hideToast();
  }
  renderConnection();
  if (el.settings.open) {
    renderSettings();
  }
}

function showToast(text) {
  clearTimeout(toastTimer);
  el.toast.textContent = text;
  el.toast.hidden = false;
  // A message ending in … is work in progress: it stays until the next one.
  const sticky = text.endsWith('…');
  el.toast.dataset.sticky = sticky ? '1' : '';
  if (!sticky) {
    toastTimer = setTimeout(hideToast, TOAST_MS);
  }
}

function hideToast() {
  el.toast.hidden = true;
  el.toast.dataset.sticky = '';
}

function connectionText() {
  if (state.setupError) {
    return { level: 'error', text: t('{app} is not connected to anything yet.', { app: BRAND.name }) };
  }
  if (state.serverDown) {
    return { level: 'warn', text: t("Can't reach lobby-server ({reason}). Trying again every few seconds.", { reason: state.serverDown }) };
  }
  const down = state.networks.filter((n) => state.conn[n] && state.conn[n] !== 'connected');
  if (!down.length) {
    return null;
  }
  if (down.every((n) => state.conn[n] === UNREACHABLE)) {
    return { level: 'warn', text: t("Can't reach lobby-server. Trying again every few seconds.") };
  }
  const connecting = down.filter((n) => state.conn[n] === 'connecting');
  const parts = [];
  if (connecting.length) {
    parts.push(t('Connecting to {networks}…', { networks: connecting.join(', ') }));
  }
  for (const n of down.filter((x) => !connecting.includes(x))) {
    const reason = state.conn[n].replace(/^disconnected:?\s*/, '').replace(/\s*\(os error \d+\)/, '');
    const why = reason && reason !== UNREACHABLE ? `${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : '';
    parts.push(
      why
        ? t('{network} is disconnected: {reason}. Trying again.', { network: n, reason: why })
        : t('{network} is disconnected. Trying again.', { network: n }),
    );
  }
  return { level: connecting.length === down.length ? 'info' : 'warn', text: parts.join(' ') };
}

function renderConnection() {
  if (el.connection.open) {
    renderConnectionStatus();
  }
  const c = connectionText();
  el.status.hidden = !c;
  if (!c) {
    return;
  }
  el.status.dataset.level = c.level;
  el.statusText.textContent = c.text;
  el.statusAction.textContent = c.level === 'error' ? t('Set up') : t('Connection');
}

function select(k) {
  const b = state.buffers.get(k);
  if (!b) {
    return;
  }
  if (state.current !== k) {
    closeNicklist();
    nicklist.picked.clear();
    const was = state.buffers.get(state.current);
    if (was) {
      // Untouched since it was opened there, the spot is kept as it was: measuring it again adds a
      // pixel of rounding on each switch, and the chat would creep up.
      const now = was.window ? null : readingSpot();
      was.spot = now && !movedByHand && was.shown ? was.shown : now;
      movedByHand = false;
      was.window = null;
      was.windowSeparator = null;
    }
  }
  state.current = k;
  try {
    localStorage.setItem(LAST_BUFFER_KEY, k);
  } catch {
    /* storage may be unavailable */
  }
  el.input.placeholder = messageHint(b);
  renderHeader();
  renderLog();
  if (shelf.open) {
    loadShelf();
  }
  renderRoom();
  el.input.focus();
}

function step(offset) {
  const list = ordered();
  const i = list.findIndex((b) => b.key === state.current);
  const next = list[(i + offset + list.length) % list.length];
  if (next) {
    select(next.key);
  }
}

// Switcher

let showHidden = false;
const CHANNEL_NUMBERS = 9;

// While the channel number modifier is held, the list shows each channel's number in place of its picture.
function showNumbers(e) {
  const fake = { key: 'x', code: 'KeyX', metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey };
  const held = comboMods(comboOf(fake, IS_MAC));
  document.body.classList.toggle('show-numbers', held !== '' && held === shortcuts().channelNumber);
}
document.addEventListener('keydown', showNumbers, true);
// Some systems still report a modifier as held on its own release, so letting go of any one hides them.
document.addEventListener(
  'keyup',
  (e) => ['Alt', 'Control', 'Meta', 'Shift'].includes(e.key) && document.body.classList.remove('show-numbers'),
  true,
);
window.addEventListener('blur', () => document.body.classList.remove('show-numbers'));

/** The list: channels, then hidden ones when opened or searched for. */
function matches() {
  const q = el.filter.value.trim().toLowerCase();
  const hit = (b) => !q || label(b).toLowerCase().includes(q) || b.net.toLowerCase().includes(q);
  const hidden = sortedBuffers().filter((b) => isHidden(b) && hit(b));
  return [...ordered().filter(hit), ...(showHidden || q ? hidden : [])];
}

function renderList() {
  const list = matches();
  picked = Math.min(picked, Math.max(list.length - 1, 0));
  const nodes = [];
  let net = null;
  let hiddenShown = false;
  const numbers = new Map(
    ordered()
      .slice(0, CHANNEL_NUMBERS)
      .map((b, i) => [b.key, String(i + 1)]),
  );
  list.forEach((b, i) => {
    if (isHidden(b) && !hiddenShown) {
      hiddenShown = true;
      net = null;
      nodes.push(hiddenToggle());
    }
    if (b.net !== net) {
      net = b.net;
      nodes.push(h('div', 'list-net', net));
    }
    const row = h('div', 'item-row');
    const item = h('button', 'item');
    item.type = 'button';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(i === picked));
    item.classList.toggle('current', b.key === state.current);
    item.classList.toggle('mention', b.mention);
    item.classList.toggle('muted', isMuted(b) || isHidden(b));
    const pic = icon(b, h('span', 'chan-icon'));
    if (numbers.has(b.key)) {
      pic.dataset.num = numbers.get(b.key);
    }
    item.append(pic, h('span', 'name', label(b)));
    if (wantsAttention(b)) {
      item.append(h('span', 'count', String(attentionCount(b))));
    }
    item.addEventListener('click', () => pick(b.key));
    row.append(item);
    // A server window can be hidden too; it has no bell, so a gap keeps the eyes in line.
    row.append(eyeButton(b), b.name === '' ? h('span', 'row-gap') : bellButton(b));
    nodes.push(row);
  });
  const hiddenCount = sortedBuffers().filter(isHidden).length;
  if (hiddenCount && !hiddenShown && !el.filter.value.trim()) {
    nodes.push(hiddenToggle());
  }
  el.list.replaceChildren(...nodes);
  el.list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

/** "Hidden · 3" at the end of the list opens and closes the hidden channels. */
function hiddenToggle() {
  const n = sortedBuffers().filter(isHidden).length;
  const b = h('button', 'list-hidden', t('Hidden · {n}', { n }));
  b.type = 'button';
  b.setAttribute('aria-expanded', String(showHidden));
  b.addEventListener('click', () => {
    showHidden = !showHidden;
    renderList();
  });
  return b;
}

function openSwitcher() {
  showHidden = false;
  el.filter.value = '';
  picked = 0;
  renderList();
  el.switcher.showModal();
  // On a phone the keyboard waits for a tap on the search.
  if (HOVER.matches) {
    el.filter.focus();
  }
}

function pick(k) {
  el.switcher.close();
  select(k);
}

el.title.addEventListener('click', openSwitcher);
el.chanIcon.addEventListener('click', (e) => {
  e.stopPropagation();
  const b = state.buffers.get(state.current);
  if (!b || b.name === '') {
    return;
  }
  if (isPrivate(b)) {
    openPerson(b.name, '');
  } else {
    editChannel(b);
  }
});
el.unread.addEventListener('click', jumpToUnreadChannel);
el.filter.addEventListener('input', () => {
  picked = 0;
  renderList();
});
el.filter.addEventListener('keydown', (e) => {
  const list = matches();
  if (e.key === 'ArrowDown') {
    picked = Math.min(picked + 1, list.length - 1);
  } else if (e.key === 'ArrowUp') {
    picked = Math.max(picked - 1, 0);
  } else if (e.key === 'Enter' && list[picked]) {
    // The same Enter would otherwise land in the message box as a new line.
    e.preventDefault();
    return pick(list[picked].key);
  } else {
    return;
  }
  e.preventDefault();
  renderList();
});
el.switcher.addEventListener('click', (e) => {
  if (e.target === el.switcher) {
    el.switcher.close();
  }
});

// Settings

function alertSwitch(b, setting, what) {
  const box = h('input', 'switch');
  box.type = 'checkbox';
  box.setAttribute('role', 'switch');
  box.setAttribute('aria-label', t('{what}: every message in {name}', { what, name: label(b) }));
  box.checked = keySet(setting).has(b.key);
  box.addEventListener('change', () => {
    setKey(setting, b.key, box.checked);
    renderHeader();
  });
  return box;
}

function renderChannelAlerts() {
  const rows = ordered()
    .filter((b) => isChannel(b.name))
    .map((b) => {
      const row = h('div', 'alert-row');
      row.append(
        h('span', 'alert-name', label(b)),
        alertSwitch(b, BADGE_ALL_SETTING, t('App icon')),
        alertSwitch(b, NOTIFY_ALL_SETTING, t('Notify')),
      );
      return row;
    });
  const head = h('div', 'alert-row alert-head');
  head.append(h('span', ''), h('span', '', t('App icon')), h('span', '', t('Notify')));
  el.channelAlerts.replaceChildren(...(rows.length ? [head, ...rows] : [h('p', 'hint', t('No channels yet.'))]));
}

function renderSettings() {
  el.notifyToggle.checked = notifyOn();
  renderNotifyState();
  el.emoticonToggle.checked = settingOn(EMOTICON_SETTING);
  $('nick-at-toggle').checked = settingOn(NICK_MENU_SETTINGS.at);
  $('nick-word-toggle').checked = settingOn(NICK_MENU_SETTINGS.word);
  $('hover-card-toggle').checked = settingOn(HOVER_CARD_SETTING);
  $('pm-highlight-toggle').checked = settingOn(PM_HIGHLIGHT_SETTING);
  $('hover-wait-toggle').checked = settingOn(HOVER_CARD_WAIT_SETTING);
  $('hover-wait-toggle').disabled = !settingOn(HOVER_CARD_SETTING);
  for (const r of el.replyStyle.querySelectorAll('input')) {
    r.checked = r.value === replyStyle();
  }
  // Both lists read the same way, separated by commas, however they were typed.
  el.botsField.value = commaList(state.settings[BOTS_SETTING]);
  el.highlightField.value = commaList(state.settings[HIGHLIGHT_WORDS_SETTING]);
  el.notifyNicksField.value = commaList(state.settings[NOTIFY_NICKS_SETTING]);
  el.notifyWordsField.value = commaList(state.settings[NOTIFY_WORDS_SETTING]);
  el.shortcodeToggle.checked = settingOn(SHORTCODE_SETTING);
  el.maskToggle.checked = state.settings[MASK_SETTING] === 'on';
  el.filterField.value = commaList(state.settings[FILTER_WORDS_SETTING]);
  renderIgnored();
  renderAboutReport();
  renderLangChoices();
  renderIconChoices();
  renderShortcuts();
  renderUploadSettings();
  renderChannelAlerts();
  renderUpdateSettings();
  listsAsked = '';
  renderChannelTools();
  el.lastfmUser.value = state.settings[LASTFM_USER_SETTING] || '';
  el.lastfmKey.value = state.settings[LASTFM_KEY_SETTING] || '';
  $('ai-key').value = state.settings[AI_KEY_SETTING] || '';
  $('ai-replies-toggle').checked = settingOn(AI_REPLIES_SETTING);
  el.npFormat.value = state.settings[NP_FORMAT_SETTING] || '';
  const rows = state.networks.map((n) => {
    const row = h('div', 'conn');
    const name = h('span', '', state.me[n] ? `${n} · ${state.me[n]}` : n);
    const st = state.conn[n] || 'waiting';
    row.append(name, h('span', `state${st === 'connected' ? ' ok' : ''}`, connState(st)));
    return row;
  });
  el.connections.replaceChildren(...(rows.length ? rows : [h('p', 'hint', t('No networks configured.'))]));
  el.configPath.textContent = state.configPath;
}

function renderIgnored() {
  const rows = [...keySet(BLOCKED_SETTING)].sort().map((nick) => {
    const row = h('div', 'conn');
    const undo = h('button', 'link-btn', t('Unignore'));
    undo.type = 'button';
    undo.setAttribute('aria-label', t('Unignore {nick}', { nick }));
    undo.addEventListener('click', () => unignore(nick));
    row.append(h('span', '', nick), undo);
    return row;
  });
  el.blockedList.replaceChildren(...(rows.length ? rows : [h('p', 'hint', t('Nobody is ignored.'))]));
}

/** Settings > About: "Report a problem: address", the address a mail link. */
function renderAboutReport() {
  const [before, after = ''] = t('Report a problem: {email}').split('{email}');
  const link = h('a', null, BRAND.reportEmail);
  link.href = `mailto:${BRAND.reportEmail}`;
  el.aboutReport.replaceChildren(before, link, after);
}

/** A network's state as the core reports it, in words. */
function connState(st) {
  const reason = /^disconnected:\s*(.+)$/.exec(st)?.[1];
  return reason ? t('disconnected: {reason}', { reason }) : t(st);
}

/** Settings > General > Language: the page loads again in the one picked. */
function renderLangChoices() {
  el.langChoices.replaceChildren(
    ...LANGS.map(([code, name]) => {
      const b = h('button', null, name);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(code === currentLang()));
      b.addEventListener('click', () => {
        if (code === currentLang()) {
          return;
        }
        chooseLang(code);
        location.reload();
      });
      return b;
    }),
  );
}

el.gear.addEventListener('click', () => {
  el.switcher.close();
  renderSettings();
  showSettingsTab(settingsTab);
  el.settings.showModal();
  el.settings.focus();
});

let settingsTab = 'general';

function showSettingsTab(tab) {
  settingsTab = tab;
  // The person editor has its own Save.
  el.settingsSave.hidden = tab === 'people';
  if (tab === 'people') {
    showList();
  }
  for (const b of el.settingsTabs.children) {
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  }
  for (const section of el.settings.querySelectorAll('section[data-tab]')) {
    section.classList.toggle('tab-off', section.dataset.tab !== tab);
  }
}

el.settingsTabs.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) {
    showSettingsTab(b.dataset.tab);
    el.settings.querySelector('.settings-body').scrollTop = 0;
  }
});
// Updates, the way Mac apps ask: with automatic updates on, the new version downloads quietly and a
// bar offers the restart (quitting installs it too). Otherwise a dialog asks once per version:
// skip it, be reminded tomorrow, or install. Where the app cannot replace itself, Install opens the
// download page instead.
const UPDATE_AUTO_KEY = 'lobby.updateAuto';
const UPDATE_SKIP_KEY = 'lobby.updateClosed';
const UPDATE_LATER_KEY = 'lobby.updateLater';
const UPDATE_LATER_MS = 24 * 60 * 60 * 1000;
const UPDATE_FIRST_MS = 20 * 1000;
const UPDATE_EVERY_MS = 60 * 60 * 1000;
const UPDATE_TICK_MS = 5 * 60 * 1000;
// Wall clock: timers stall while the computer sleeps. A failed check (a release still uploading) stays due.
const update = { found: null, ready: false, busy: false, dismissed: false, checkedAt: 0 };

function storedFlag(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function storeFlag(k, value) {
  try {
    localStorage.setItem(k, value);
  } catch {
    /* the default stays */
  }
}

function updatesAuto() {
  return storedFlag(UPDATE_AUTO_KEY) !== 'off';
}

function setUpdatesAuto(on) {
  storeFlag(UPDATE_AUTO_KEY, on ? 'on' : 'off');
  el.updateAuto.checked = on;
}

/** Not skipped, and not put off until later. */
function shouldAsk(version) {
  if (storedFlag(UPDATE_SKIP_KEY) === version) {
    return false;
  }
  const [later, until] = (storedFlag(UPDATE_LATER_KEY) || '').split('@');
  return later !== version || Date.now() > Number(until);
}

function renderUpdate() {
  const found = update.found;
  // The bar shows an update on its way in or ready; asking is the dialog's job.
  el.updateBar.hidden = !found || update.dismissed || !(update.busy || update.ready);
  if (el.updateBar.hidden) {
    return;
  }
  const name = `${BRAND.name} ${found.version}`;
  el.updateRestart.hidden = !update.ready;
  el.updateText.textContent = update.ready
    ? t('{name} is ready. Restart to start using it.', { name })
    : t('Downloading {name}…', { name });
}

async function installUpdate() {
  update.busy = true;
  update.dismissed = false;
  renderUpdate();
  try {
    await invoke('install_update');
    update.ready = true;
  } catch (e) {
    renderStatus(t('Update: {error}', { error: e }));
  }
  update.busy = false;
  renderUpdate();
}

function askUpdate(found) {
  el.updateAskTitle.textContent = t('A new version of {app} is out', { app: BRAND.name });
  el.updateAskText.textContent = t('{app} {version} is out. You have {current}.', {
    app: BRAND.name,
    version: found.version,
    current: appVersion,
  });
  // The changelog's "* Add x" lines, as a plain list.
  el.updateNotes.textContent = (found.notes || '').trim().replace(/^[*-] /gm, '• ');
  el.updateAskAutoRow.hidden = !found.installable;
  el.updateAskAuto.checked = updatesAuto();
  el.updateInstall.textContent = found.installable ? t('Install update') : t('Download');
  if (!el.updateAsk.open) {
    el.updateAsk.showModal();
  }
}

async function checkUpdate({ manual = false } = {}) {
  const found = await invoke('check_update');
  update.checkedAt = Date.now();
  update.found = found;
  if (found && !update.ready && !update.busy) {
    if (manual) {
      askUpdate(found);
    } else if (found.installable && updatesAuto()) {
      await installUpdate();
    } else if (shouldAsk(found.version)) {
      askUpdate(found);
    }
  }
  if (manual && update.ready) {
    update.dismissed = false;
  }
  renderUpdate();
  return found;
}

function checkUpdateWhenDue() {
  if (update.busy || update.ready || Date.now() - update.checkedAt < UPDATE_EVERY_MS) {
    return;
  }
  checkUpdate().catch(() => {});
}

setTimeout(checkUpdateWhenDue, UPDATE_FIRST_MS);
setInterval(checkUpdateWhenDue, UPDATE_TICK_MS);
window.addEventListener('focus', checkUpdateWhenDue);

el.updateRestart.addEventListener('click', () => invoke('restart').catch((e) => renderStatus(t('Update: {error}', { error: e }))));
el.updateClose.addEventListener('click', () => {
  update.dismissed = true;
  renderUpdate();
});

el.updateSkip.addEventListener('click', () => {
  storeFlag(UPDATE_SKIP_KEY, update.found.version);
  el.updateAsk.close();
});
el.updateLater.addEventListener('click', () => {
  storeFlag(UPDATE_LATER_KEY, `${update.found.version}@${Date.now() + UPDATE_LATER_MS}`);
  el.updateAsk.close();
});
el.updateInstall.addEventListener('click', () => {
  el.updateAsk.close();
  if (!update.found.installable) {
    return openUrl(`${BRAND.site}/releases/tag/v${update.found.version}`);
  }
  setUpdatesAuto(el.updateAskAuto.checked);
  installUpdate();
});

function renderUpdateSettings() {
  // iPhone updates come from the App Store.
  el.updateSection.hidden = PLATFORM.value === 'ios';
  el.updateAuto.checked = updatesAuto();
  invoke('can_install_updates')
    .then((can) => {
      el.updateAutoRow.hidden = !can;
    })
    .catch(() => {});
}

el.updateAuto.addEventListener('change', () => setUpdatesAuto(el.updateAuto.checked));

/** Settings' button and the Mac menu's Check for Updates: always answers, even for a skipped version. */
async function checkUpdateNow() {
  el.updateResult.hidden = false;
  el.updateResult.textContent = t('Checking…');
  try {
    const found = await checkUpdate({ manual: true });
    const name = found && `${BRAND.name} ${found.version}`;
    el.updateResult.textContent = !found
      ? t('{name} is up to date.', { name: `${BRAND.name} ${appVersion}`.trim() })
      : update.ready
        ? t('{name} is ready. Restart to start using it.', { name })
        : t('{name} is out.', { name });
    if (!found && !el.settings.open) {
      showToast(el.updateResult.textContent);
    }
  } catch (e) {
    el.updateResult.textContent = t('Could not check: {error}', { error: e });
    if (!el.settings.open) {
      showToast(el.updateResult.textContent);
    }
  }
}

el.updateCheck.addEventListener('click', checkUpdateNow);

// About: the version and the commit it was built from, linked to that commit.
const REPO_URL = BRAND.site;

const QUIT_SETTING = 'quitMessage';
let appVersion = '';

/** "Used Lobby v1.8.3 · its GitHub page", in the app's language, unless the user wrote their own. */
function defaultQuit() {
  const fi = currentLang() === 'fi';
  const app = fi ? (BRAND.fiQuitName ?? `${BRAND.name}a`) : (BRAND.quitName ?? BRAND.name);
  return `${t('Used {app} v{version}', { app, version: appVersion })} · ${BRAND.site}`;
}

function syncQuit() {
  el.quitField.placeholder = defaultQuit();
  if (document.activeElement !== el.quitField) {
    el.quitField.value = state.settings[QUIT_SETTING] || '';
  }
  invoke('set_quit_message', { text: state.settings[QUIT_SETTING]?.trim() || defaultQuit() }).catch(() => {});
}

el.quitField.addEventListener('change', () => {
  saveSetting(QUIT_SETTING, el.quitField.value.trim());
  syncQuit();
});

async function showVersion() {
  const info = await invoke('app_info').catch(() => null);
  if (!info) {
    return;
  }
  appVersion = info.version;
  syncQuit();
  const link = $('about-version');
  link.textContent = `${BRAND.name} ${info.version}${info.commit ? `-${info.commit}` : ''}${info.date ? ` (${info.date})` : ''}`;
  link.href = info.commit ? `${REPO_URL}/commit/${info.commit}` : REPO_URL;
}

// Help > About on macOS: Settings, scrolled to the end.
function showAbout() {
  if (!el.settings.open) {
    el.gear.click();
  }
  showSettingsTab('about');
}

el.settingsClose.addEventListener('click', () => el.settings.close());

// Settings save as they change; Save finishes the field being typed in, and either way the button says "Saved".
const SAVED_SHOWN_MS = 1800;
let savedTimer = 0;

function flashSaved() {
  el.settingsSave.textContent = `✓ ${t('Saved')}`;
  el.settingsSave.classList.add('saved');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    el.settingsSave.textContent = t('Save');
    el.settingsSave.classList.remove('saved');
  }, SAVED_SHOWN_MS);
}

el.settingsSave.addEventListener('click', () => {
  document.activeElement?.blur();
  flashSaved();
});
el.settings.addEventListener('click', (e) => {
  if (e.target === el.settings) {
    el.settings.close();
  }
});
el.settings.addEventListener('close', () => el.input.focus());
// Not when the highlights inbox took over: on a phone that would raise the keyboard over it.
el.switcher.addEventListener('close', () => el.inbox.hidden && HOVER.matches && el.input.focus());
el.connection.addEventListener('close', () => el.input.focus());

// Log

function atBottom() {
  return el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < BOTTOM_SLACK_PX;
}

function toBottom() {
  el.log.scrollTop = el.log.scrollHeight;
}

// While a reaction row or message menu is open the chat holds still, so new messages
// do not carry it away from the pointer; closing it catches up.
function following() {
  return (atBottom() || glide !== 0) && !actionPanel;
}

function renderLog() {
  stopGlide();
  dropLive();
  el.col.replaceChildren();
  view = {
    lastLine: null,
    group: null,
    events: null,
    command: null,
    lastByNick: new Map(),
    lastToward: new Map(),
    byId: new Map(),
    separator: null,
    separatorAfter: null,
  };
  const b = state.buffers.get(state.current);
  if (!b) {
    return updateJumps();
  }
  // With unread lines older than what is loaded, the true New line is not here to show.
  view.separatorAfter = b.window ? (b.windowSeparator ?? null) : b.unreadGap ? null : (readMap[b.key] ?? lastId(b));
  // Straight to IRC there is no backlog: say where you are until someone speaks.
  if (!b.lines.length && isChannel(b.name)) {
    el.col.append(h('p', 'log-empty', t('You are on {channel}. New messages show up here.', { channel: b.name })));
  }
  for (const l of b.window ?? b.lines) {
    appendLine(l);
  }
  el.windowBar.hidden = !b.window;
  document.body.classList.toggle('windowed', Boolean(b.window));
  if (b.window) {
    stuck = false;
    countAfterWindow(b);
    el.windowWhen.textContent = t('Earlier: {day}', { day: dayLabel(b.window.find((l) => l.id === b.windowAt)?.ts ?? b.window[0].ts) });
    if (view.separator) {
      toSeparator();
    } else {
      centerLine(b.windowAt);
    }
  } else {
    if (!backToSpot(b)) {
      view.separator ? toSeparator() : toBottom();
    }
    // Pictures loading next must not move the chat before the first scroll event says where it is.
    stuck = atBottom();
    lastTop = el.log.scrollTop;
    noteAnchor();
  }
  updateJumps();
  if (!b.window) {
    addRecap(b);
  }
  if (b.lines.length) {
    splashReady();
  }
}

// Cold start: the lamp is lit and its beam drawn by CSS from the first frame, so a slow start never
// shows it dark. While loading the chat shows only inside the beam; once ready the light widens over it all.
const SPLASH_MIN_MS = 1300;
const SPLASH_MAX_MS = 3000;
const SPLASH_OPEN_MS = 650;
const SPLASH_OUT_MS = 450;
// The beam's hole grown to the whole window: same points as in the CSS, so it moves smoothly.
const SPLASH_ALL_OPEN = 'polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, 0 0, 100% 0, 100% 100%, 0 100%, 0 0)';
const splashStart = performance.now();
let splashDone = false;
setTimeout(splashReady, SPLASH_MAX_MS);

function splashReady() {
  if (splashDone) {
    return;
  }
  splashDone = true;
  setTimeout(openSplash, Math.max(0, SPLASH_MIN_MS - (performance.now() - splashStart)));
}

/** A CSS animation holds what it set, so its end state is copied inline before plain transitions take over. */
function settle(node) {
  const now = getComputedStyle(node);
  node.style.clipPath = now.clipPath;
  node.style.opacity = now.opacity;
  node.style.animation = 'none';
  node.getBoundingClientRect();
}

const CHAT_SHOWN_KEY = 'lobby.chatShown';

function openSplash() {
  storeFlag(CHAT_SHOWN_KEY, '1');
  const cover = el.splash;
  const light = el.splashLight;
  const lamp = el.splashLamp;
  const done = () => {
    cover.remove();
    light.remove();
    lamp.remove();
  };
  // Whatever a slow frame does, nothing of the splash outlives this.
  setTimeout(done, SPLASH_OPEN_MS + 400);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cover.style.opacity = lamp.style.opacity = light.style.opacity = '0';
    setTimeout(done, 250);
    return;
  }
  settle(cover);
  settle(light);
  cover.classList.add('opening');
  cover.style.transition = `clip-path ${SPLASH_OPEN_MS}ms cubic-bezier(.65,0,.35,1)`;
  cover.style.clipPath = SPLASH_ALL_OPEN;
  for (const node of [lamp, light]) {
    node.style.transition = `opacity ${SPLASH_OUT_MS}ms ease-in`;
    node.style.opacity = '0';
  }
  setTimeout(done, SPLASH_OPEN_MS + 50);
}

/** The line at the top of the chat when it is scrolled up, so coming back opens there. */
function readingSpot() {
  // A glide is on its way to the newest message.
  if (atBottom() || glide) {
    return null;
  }
  return topSpot();
}

function topSpot() {
  const rows = el.col.querySelectorAll('.text');
  const top = el.log.getBoundingClientRect().top;
  // Rows run top to bottom, so the first one still in view is found by halving.
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].getBoundingClientRect().bottom > top) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  const row = rows[lo];
  return row?.line ? { id: row.line.id, row, offset: row.getBoundingClientRect().top - top } : null;
}

function backToSpot(b) {
  const spot = b.spot;
  b.spot = null;
  b.shown = toSpot(spot) ? spot : null;
  return Boolean(b.shown);
}

function toSpot(spot) {
  const row = spot?.row?.isConnected ? spot.row : spot && [...el.col.querySelectorAll('.text')].find((r) => r.line?.id === spot.id);
  if (!row) {
    return false;
  }
  el.log.scrollTop += anchorShift(row.getBoundingClientRect().top - el.log.getBoundingClientRect().top - spot.offset);
  return true;
}

function toSeparator() {
  const top = view.separator.getBoundingClientRect().top - el.col.getBoundingClientRect().top;
  el.log.scrollTop = Math.max(0, top - SEPARATOR_MARGIN_PX);
}

function renderEvents(events) {
  const short = summarize(events.list);
  const full = summarize(events.list, true);
  events.node.textContent = events.open ? full : short;
  events.node.classList.toggle('expandable', short !== full);
  events.node.classList.toggle('open', Boolean(events.open));
}

/** Draw one line at the end of the chat; returns a row it added inside an existing group, if any. */
function appendLine(l) {
  if (isMuffled(l)) {
    return null;
  }
  const prev = view.lastLine;
  let fresh = null;

  // "nick: 😂" becomes a reaction: under the message you picked, else under that nick's last one.
  const reaction = l.kind === 'msg' ? parseReaction(l.text) : null;
  const reacted = reaction && (reactedTo(l, reaction) || view.lastByNick.get(reaction.nick.toLowerCase()));
  if (reacted) {
    addReaction(reacted, reaction.emoji, l.nick, l.own);
    return null;
  }

  if (!prev || !sameDay(prev.ts, l.ts)) {
    el.col.append(h('div', 'day', dayLabel(l.ts)));
    view.group = null;
    view.events = null;
  }

  const firstUnread = view.separatorAfter !== null && !view.separator && l.id > view.separatorAfter && CHAT_KINDS.has(l.kind) && !l.own;
  if (firstUnread) {
    view.separator = separatorNode();
    el.col.append(view.separator);
    view.group = null;
    view.events = null;
  }

  if (EVENT_KINDS.has(l.kind)) {
    if (!view.events) {
      view.events = { list: [], node: h('div', 'events') };
      el.col.append(view.events.node);
      const events = view.events;
      // A summary that counts instead of naming opens to the whole list on a click.
      events.node.addEventListener('click', () => {
        events.open = !events.open;
        renderEvents(events);
      });
    }
    view.events.list.push(l);
    renderEvents(view.events);
    view.events.node.dataset.tip = clock(l.ts);
    view.group = null;
  } else if (CHAT_KINDS.has(l.kind) && answersCommand(l, prev)) {
    // A bot answering the command just asked: inside that command's card.
    fresh = answerRow(l);
    view.command.answers.append(fresh);
    view.command.last = l;
  } else if (CHAT_KINDS.has(l.kind)) {
    view.events = null;
    view.command = null;
    const same = view.group && continues(view.group.last, l);
    if (l.kind === 'action' && !same) {
      // A /me on its own: a line of narration with the person's face, outside any group.
      narration(l);
      view.group = null;
    } else {
      if (!same) {
        view.group = newGroup(l);
      }
      // A /me right after the same person's message: a spark in their colour marks it.
      const r = row(l);
      if (l.kind === 'action') {
        r.classList.add('spark');
        r.style.setProperty('--tint', identity(l.nick, l.mask).color);
      }
      if (l.kind === 'msg' && isCommand(l.text)) {
        view.command = commandCard(r, l);
      }
      view.group.body.append(r);
      view.group.last = l;
      view.group.body.parentNode.dataset.last = l.ts;
      fresh = r;
    }
  } else {
    view.events = null;
    view.group = null;
    el.col.append(note(l));
  }

  view.lastLine = l;
  return fresh;
}

// Live lines are drawn once per frame, however many arrive: a burst of thousands costs one
// layout, not one per line.
let liveQueue = [];
let liveFrame = 0;

function queueLive(l) {
  liveQueue.push(l);
  liveFrame ||= requestAnimationFrame(flushLive);
}

function dropLive() {
  cancelAnimationFrame(liveFrame);
  liveFrame = 0;
  liveQueue = [];
}

function flushLive() {
  liveFrame = 0;
  const lines = liveQueue;
  liveQueue = [];
  if (!view || !lines.length) {
    return;
  }
  const pinned = following();
  const tail = el.col.lastElementChild;
  const fresh = [];
  for (const l of lines) {
    const row = appendLine(l);
    if (row) {
      fresh.push(row);
    }
  }
  fadeIn(tail, fresh, lines.length);
  // Your own message always brings the view down to it.
  if (lines.some((l) => l.own || l.nick === state.me[l.net])) {
    aimHeld = false;
    glideDown();
  } else if ((pinned || aimHeld) && aiming()) {
    holdForAim();
  } else if (pinned || aimHeld) {
    aimHeld = false;
    glideDown();
  }
  updateJumps();
}

// A mouse moving over the chat is on its way to a message's buttons: new lines wait below
// instead of sliding that message away, so a reaction never lands on the message that took its place.
const AIM_HOLD_MS = 1500;
let aimAt = 0;
let aimHeld = false;
let aimTimer = 0;

function aiming() {
  return performance.now() - aimAt < AIM_HOLD_MS;
}

function holdForAim() {
  aimHeld = true;
  clearTimeout(aimTimer);
  aimTimer = setTimeout(releaseAim, AIM_HOLD_MS);
}

function releaseAim() {
  clearTimeout(aimTimer);
  aimTimer = 0;
  if (!aimHeld) {
    return;
  }
  if (aiming() || actionPanel) {
    holdForAim();
    return;
  }
  aimHeld = false;
  glideDown();
  updateJumps();
}

el.col.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') {
    aimAt = performance.now();
  }
});
el.col.addEventListener('pointerleave', () => {
  aimAt = 0;
  releaseAim();
});
// Scrolling by hand takes over: the view stays where it is put.
el.col.addEventListener('wheel', () => {
  aimHeld = false;
});

// A new message fades in while the chat glides up to it. The glide moves the scroll position
// itself, so the chat never counts as scrolled away while it runs.
const ARRIVE_MS = 180;
const ARRIVALS_PER_FRAME = 4;
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
let glide = 0;

function calm() {
  return REDUCED_MOTION.matches || document.hidden;
}

function fadeIn(tail, fresh, count) {
  // A burst, like a backlog after reconnecting, just appears.
  if (calm() || count > ARRIVALS_PER_FRAME) {
    return;
  }
  const added = [...fresh];
  for (let n = tail ? tail.nextElementSibling : el.col.firstElementChild; n; n = n.nextElementSibling) {
    added.push(n);
  }
  // Stepped by hand: a CSS or Web Animations fade gets its own layer in WebKit, which sits on whole
  // device pixels and puts the line back half a pixel off when it ends, a visible nudge on a Mac.
  const start = performance.now();
  const step = (now) => {
    const p = Math.min((now - start) / ARRIVE_MS, 1);
    for (const n of added) {
      n.style.opacity = p < 1 ? String(1 - (1 - p) ** 2) : '';
    }
    if (p < 1) {
      requestAnimationFrame(step);
    }
  };
  for (const n of added) {
    n.style.opacity = '0';
  }
  requestAnimationFrame(step);
}

function glideDown() {
  cancelAnimationFrame(glide);
  glide = 0;
  if (calm()) {
    return toBottom();
  }
  const from = el.log.scrollTop;
  const start = performance.now();
  const step = (now) => {
    const p = Math.min((now - start) / ARRIVE_MS, 1);
    if (p >= 1) {
      // The real bottom can be a fraction of a pixel below the whole-pixel sum, which a later
      // toBottom() would show as a one-pixel nudge.
      glide = 0;
      return toBottom();
    }
    const to = el.log.scrollHeight - el.log.clientHeight;
    el.log.scrollTop = from + (to - from) * (1 - (1 - p) ** 3);
    glide = requestAnimationFrame(step);
  };
  glide = requestAnimationFrame(step);
}

function stopGlide() {
  cancelAnimationFrame(glide);
  glide = 0;
}

// Bot commands, asked and answered: "!seen milla" becomes a card, and the lines a known bot
// sends straight after it go inside, under the command.
function answersCommand(l, prev) {
  const c = view.command;
  return Boolean(
    c &&
      prev === c.last &&
      l.kind !== 'action' &&
      l.ts - c.asked.ts < BOT_ANSWER_MS &&
      botNicks(state.settings[BOTS_SETTING]).has(l.nick.toLowerCase()),
  );
}

function commandCard(r, l) {
  const card = h('div', 'cmd-card');
  const command = h('div', 'cmd');
  command.append(...r.childNodes);
  const answers = h('div', 'cmd-answers');
  card.append(command, answers);
  r.classList.add('command');
  r.append(card);
  return { answers, asked: l, last: l };
}

function answerRow(l) {
  const wrap = h('div', 'cmd-answer');
  const av = avatar(l.nick, l.mask);
  av.dataset.tip = identity(l.nick, l.mask).name;
  wrap.append(av, row(l));
  return wrap;
}

function newGroup(l) {
  const group = h('div', 'group');
  const who = identity(l.nick, l.mask);
  const av = avatar(l.nick, l.mask);
  av.dataset.tip = t('Edit person');
  av.addEventListener('click', () => openPerson(l.nick, l.mask));

  const body = h('div', 'gb');
  const head = h('div', 'hd');
  const name = h('span', 'nm', who.name);
  name.style.color = who.color;
  personTip(name, l.net, l.nick);
  name.addEventListener('click', () => openPerson(l.nick, l.mask));
  head.append(name);
  body.append(head);
  group.append(av, body);
  // What dropSeparator needs to join this group with the one before it.
  group.dataset.nick = l.nick.toLowerCase();
  group.dataset.first = l.ts;
  group.dataset.last = l.ts;
  el.col.append(group);
  return { body, last: l };
}

function narration(l) {
  const group = h('div', 'group narration');
  const av = avatar(l.nick, l.mask);
  av.dataset.tip = t('Edit person');
  av.addEventListener('click', () => openPerson(l.nick, l.mask));
  const body = h('div', 'gb');
  body.append(row(l));
  group.append(av, body);
  el.col.append(group);
}

function row(l) {
  const r = h('div', `text ${l.kind}`);
  r.classList.toggle('own', l.own || l.nick === state.me[l.net]);
  r.dataset.tip = clock(l.ts);
  r.line = l;

  // "nick: text" right after that nick spoke reads as a reply: show what it answers.
  let text = l.text;
  const addr = l.kind === 'msg' ? parseAddress(l.text) : null;
  // My own replies remember the exact line; anyone else's is guessed from what that nick said lately.
  const linkId = l.own && addr ? replyLinks()[linkKey(l.net, l.buffer, l.text)] : undefined;
  const hinted = (l.own && replyHints.get(l.text)) || (linkId && view.byId.get(linkId));
  const speaker = l.nick.toLowerCase();
  const guess = () => {
    const them = addr.nick.toLowerCase();
    return replyTarget(view.lastByNick.get(them), view.lastToward.get(`${them}>${speaker}`), l.ts, REPLY_WINDOW_MS);
  };
  const guessed = !hinted && addr && !linkId ? guess() : null;
  const quoted = hinted || (guessed && aiPicked(l, guessed)) || guessed;
  const me = state.me[l.net];
  if (addr && quoted && quoted.line !== l && (hinted || l.ts - quoted.line.ts < REPLY_WINDOW_MS)) {
    const style = replyStyle();
    if (style !== 'nick') {
      r.append(quoteNode(quoted));
      if (guessed) {
        askAiReply(l, addr);
      }
    }
    text = addr.rest;
    // The bubble already names who the line was for; without it the nick stays in front.
    if (style !== 'quote') {
      const forMe = me && addr.nick.toLowerCase() === me.toLowerCase();
      r.append(forMe ? h('span', 'mention', me) : nickRef(l.net, { value: addr.nick, nick: addr.nick }), ' ');
    }
  }
  replyHints.delete(l.text);
  // Lines meant for you get a dot in the margin.
  r.classList.toggle('for-me', !r.classList.contains('own') && CHAT_KINDS.has(l.kind) && mentions(l.text, myWords(l.net)));

  if (l.kind === 'action') {
    const who = identity(l.nick, l.mask);
    const name = h('span', 'act-nick', who.name);
    name.style.color = who.color;
    personTip(name, l.net, l.nick);
    r.append(name, ' ');
  }

  let firstUrl = null;
  const members = nicksOf(l);
  const tokens = tokenize(text, myWords(l.net)).flatMap((t) => (t.type === 'text' ? splitNicks(t.value, members) : [t]));
  for (const t of tokens) {
    if (t.type === 'url') {
      const a = h('a', 'link', shortUrl(t.value));
      a.href = t.value;
      a.dataset.tip = t.value;
      r.append(a);
      firstUrl ??= t.value;
    } else if (t.type === 'mention') {
      r.append(h('span', 'mention', t.value));
    } else if (t.type === 'nick') {
      r.append(nickRef(l.net, t));
    } else {
      r.append(...shownNodes(t.value));
    }
  }
  // A message that is only a link gets replaced by its card.
  r.dataset.onlyLink = String(tokens.length === 1 && tokens[0].type === 'url');
  if (firstUrl) {
    attachPreview(firstUrl, r);
  }
  // Who the line was for: its "nick:", or the one the same person's previous line was for.
  const prev = view.lastByNick.get(speaker);
  const to = addr ? addr.nick.toLowerCase() : prev?.line === view.lastLine && l.ts - prev.line.ts < THREAD_GAP_MS ? prev.to : undefined;
  view.lastByNick.set(speaker, { line: l, row: r, to });
  if (to) {
    view.lastToward.set(`${speaker}>${to}`, { line: l, row: r, to });
  }
  if (l.id) {
    view.byId.set(l.id, { line: l, row: r });
  }
  return r;
}

// Nicks named in a message: their own colour, and WHOIS on hover.

const WHOIS_FRESH_MS = 120000;
const WHOIS_WAIT_MS = 10000;
const whois = new Map();

/** The channel's other members, lower-case to spelling. */
function nicksOf(l) {
  const b = state.buffers.get(key(l.net, l.buffer));
  const me = (state.me[l.net] || '').toLowerCase();
  const out = new Map();
  for (const n of b?.members || []) {
    if (n.toLowerCase() !== me) {
      out.set(n.toLowerCase(), n);
    }
  }
  return out;
}

function nickRef(net, t) {
  const n = h('span', 'nick-ref', t.value);
  const color = identity(t.nick).color;
  n.style.color = color;
  n.style.setProperty('--tint', color);
  personTip(n, net, t.nick);
  return n;
}

/** Hovering this shows the person card for the nick. */
function personTip(node, net, nick) {
  node.dataset.person = '1';
  node.dataset.net = net;
  node.dataset.nick = nick;
}

/** What Lobby already knows about a nick: shown at once, WHOIS adds to it when it answers. */
function knownAbout(net, nick) {
  const low = nick.toLowerCase();
  let last = null;
  const chans = [];
  for (const b of state.buffers.values()) {
    if (b.net !== net) {
      continue;
    }
    if ([...b.members].some((m) => m.toLowerCase() === low)) {
      chans.push(b.name);
    }
    const l = b.lines.findLast((x) => x.nick?.toLowerCase() === low && CHAT_KINDS.has(x.kind));
    if (l && (!last || l.ts > last.ts)) {
      last = l;
    }
  }
  return { mask: last?.mask || '', chans, last };
}

/** The person tooltip: a card in their colour with what is known about them. */
function personCard(net, nick, { spoke = true } = {}) {
  const about = knownAbout(net, nick);
  const w = whois.get(key(net, nick))?.w;
  const who = identity(nick, about.mask);
  const card = h('div', 'pc');
  card.style.setProperty('--tint', who.color);

  const head = h('div', 'pc-head');
  const names = h('div', 'pc-names');
  names.append(h('div', 'pc-name', who.name));
  const mask = w?.found ? `${w.user}@${w.host}` : about.mask;
  const sub = [who.name !== nick && nick, mask].filter(Boolean).join(' · ');
  if (sub) {
    names.append(h('div', 'pc-sub', sub));
  }
  head.append(avatar(nick, about.mask, 'av pc-av'), names);
  card.append(head);

  const rows = [];
  if (w && !w.found) {
    rows.push([t('Now'), t('not online')]);
  }
  if (w?.realname && w.realname !== nick && w.realname !== who.name) {
    rows.push([t('Name'), w.realname]);
  }
  if (w?.account) {
    rows.push([t('Account'), w.account]);
  }
  // WHOIS lists every channel they are on; until it answers, only the ones shared with you are known.
  if (w?.channels) {
    rows.push([t('On'), w.channels]);
  } else if (about.chans.length) {
    rows.push([t('With you'), about.chans.join(' ')]);
  }
  if (spoke && about.last) {
    rows.push([t('Spoke'), ago(about.last.ts)]);
  }
  if (w?.idle_secs != null) {
    rows.push([t('Idle'), span(w.idle_secs)]);
  }
  if (w?.away) {
    rows.push([t('Away'), w.away]);
  }
  if (!rows.length) {
    return card;
  }
  const list = h('dl', 'pc-rows');
  for (const [label, value] of rows) {
    list.append(h('dt', null, label), h('dd', null, value));
  }
  card.append(list);
  return card;
}

// Asked when a person's card opens. irssi sends proxied lines through its flood queue, so a
// WHOIS for every row the pointer crossed held a MODE behind them for seconds.
function askWhois(n) {
  const k = key(n.dataset.net, n.dataset.nick);
  const known = whois.get(k);
  if (known && Date.now() - known.at < (known.pending ? WHOIS_WAIT_MS : WHOIS_FRESH_MS)) {
    return;
  }
  // Asked quietly: the card shows what is known until a fuller answer arrives.
  whois.set(k, { ...known, pending: true, at: Date.now() });
  const b = state.buffers.get(state.current);
  invoke('send', { net: n.dataset.net, buffer: b?.name || '', text: `/whois ${n.dataset.nick}` }).catch(() => whois.delete(k));
}

function onWhois(w) {
  const text = formatWhois(w);
  whois.set(key(w.net, w.nick), { w, at: Date.now() });
  if (tipFor?.dataset.person && tipFor.dataset.net === w.net && tipFor.dataset.nick.toLowerCase() === w.nick.toLowerCase()) {
    showTip(tipFor, tipX, { fresh: true });
  }
  // A /whois typed by hand shows its answer in the window, as before.
  if (manualWhois === w.nick.toLowerCase() && Date.now() - lastCommandAt < COMMAND_ANSWER_MS) {
    manualWhois = null;
    localNote(text.replaceAll('\n', ' · '));
  }
}

let manualWhois = null;

function quoteNode(target) {
  const q = h('button', 'quote');
  q.type = 'button';
  q.classList.toggle('mine', target.line.own || target.line.nick === state.me[target.line.net]);
  const name = h('span', 'quote-nick', target.line.nick);
  name.style.color = identity(target.line.nick, target.line.mask).color;
  q.append(name, h('span', 'quote-text', shownText(stripFormatting(quotedText(target.line.text))).slice(0, QUOTE_CHARS)));
  q.addEventListener('click', () => {
    if (!target.row?.isConnected) {
      return;
    }
    target.row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.row.classList.add('flash');
    setTimeout(() => target.row.classList.remove('flash'), 1200);
  });
  return q;
}

// AI, with the user's own OpenRouter key: which earlier message a reply answers, when the one who
// was answered said several things lately. Answers are kept per line, so a line is asked about once.

const AI_KEY_SETTING = 'aiKey';
const AI_REPLIES_SETTING = 'aiReplies';
const AI_REPLIES_KEY = 'lobby.aiReplies';
const AI_REPLIES_KEPT = 2000;
const AI_CONTEXT_LINES = 14;
const AI_PARALLEL = 2;
let aiReplies = {};
try {
  aiReplies = JSON.parse(localStorage.getItem(AI_REPLIES_KEY) || '{}');
} catch {
  /* start fresh */
}
const aiAsked = new Set();
const aiQueue = [];
let aiRunning = 0;

function aiOn(setting) {
  return Boolean(state.settings[AI_KEY_SETTING]) && settingOn(setting);
}

const aiLineKey = (l) => `${l.net}|${l.buffer.toLowerCase()}|${l.id}`;

/** The line AI said a reply answers, when it was asked before and that line is in view. */
function aiPicked(l, guessed) {
  const id = l.id && aiReplies[aiLineKey(l)];
  const picked = id && view.byId.get(id);
  return picked && picked.line.nick === guessed.line.nick ? picked : null;
}

/** The lines before `l` in its window, oldest first, as far back as a reply is looked for. */
function aiContext(l) {
  const lines = state.buffers.get(key(l.net, l.buffer))?.lines || [];
  const at = lines.lastIndexOf(l);
  const out = [];
  for (let i = at - 1; i >= 0 && out.length < AI_CONTEXT_LINES; i--) {
    const c = lines[i];
    if (l.ts - c.ts > REPLY_WINDOW_MS) {
      break;
    }
    if (CHAT_KINDS.has(c.kind) && c.id) {
      out.unshift(c);
    }
  }
  return out;
}

function askAiReply(l, addr) {
  if (!l.id || !aiOn(AI_REPLIES_SETTING) || aiLineKey(l) in aiReplies || aiAsked.has(aiLineKey(l))) {
    return;
  }
  const context = aiContext(l);
  const theirs = context.filter((c) => c.nick.toLowerCase() === addr.nick.toLowerCase());
  if (theirs.length < 2) {
    return;
  }
  aiAsked.add(aiLineKey(l));
  aiQueue.push({ l, addr, context });
  runAiQueue();
}

async function runAiQueue() {
  while (aiRunning < AI_PARALLEL && aiQueue.length) {
    const job = aiQueue.shift();
    aiRunning++;
    aiReply(job).finally(() => {
      aiRunning--;
      runAiQueue();
    });
  }
}

async function aiReply({ l, addr, context }) {
  const lines = context.map((c) => ({ nick: c.nick, text: stripFormatting(c.text) }));
  const at = await invoke('ai_reply', {
    key: state.settings[AI_KEY_SETTING],
    lines,
    from: l.nick,
    to: addr.nick,
    text: stripFormatting(addr.rest),
  }).catch(() => null);
  const picked = at === null || at === undefined ? null : context[at];
  if (!picked) {
    return;
  }
  aiReplies[aiLineKey(l)] = picked.id;
  const keys = Object.keys(aiReplies);
  for (const old of keys.slice(0, Math.max(0, keys.length - AI_REPLIES_KEPT))) {
    delete aiReplies[old];
  }
  try {
    localStorage.setItem(AI_REPLIES_KEY, JSON.stringify(aiReplies));
  } catch {
    /* kept for this run */
  }
  // The chat may have been drawn again while waiting: the line's quote as it is now.
  const target = view?.byId.get(picked.id);
  const shown = view?.byId.get(l.id)?.row.querySelector(':scope > .quote');
  if (target && shown) {
    shown.replaceWith(quoteNode(target));
  }
}

const aiKeyField = $('ai-key');
const aiKeyResult = $('ai-key-result');

const aiKeyTest = $('ai-key-test');
// Matches ai::KEY_REJECTED in Rust.
const KEY_REJECTED = 'rejected';

const KEY_CHECK_ICONS = {
  ok: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="tick" d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  fail: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  checking: '',
};
const LIMIT_PERIODS = {
  daily: '{left} of {limit} left today',
  weekly: '{left} of {limit} left this week',
  monthly: '{left} of {limit} left this month',
};

function dollars(n) {
  return new Intl.NumberFormat(currentLang() === 'fi' ? 'fi-FI' : 'en-US', { style: 'currency', currency: 'USD' }).format(n);
}

/** How much a working key may still spend. */
function keyBudget(info) {
  if (info.limit == null) {
    return t('{used} used, no spending limit', { used: dollars(info.usage) });
  }
  const vars = { left: dollars(info.limit_remaining ?? info.limit), limit: dollars(info.limit) };
  return t(LIMIT_PERIODS[info.limit_reset] ?? '{left} of {limit} left', vars);
}

function showKeyCheck(kind, title, detail = '') {
  aiKeyResult.hidden = false;
  aiKeyResult.className = `key-result ${kind}`;
  aiKeyField.closest('.key-row').dataset.check = kind;
  const icon = h('span', 'key-result-icon');
  icon.innerHTML = KEY_CHECK_ICONS[kind];
  const text = h('span', 'key-result-text');
  text.append(h('b', '', title));
  if (detail) {
    text.append(h('span', '', detail));
  }
  aiKeyResult.replaceChildren(icon, text);
}

/** Asks OpenRouter about the key in the field, saved or not. */
async function checkAiKey() {
  const key = aiKeyField.value.trim();
  if (!key) {
    showKeyCheck('fail', t('Paste a key first'));
    return;
  }
  showKeyCheck('checking', t('Checking the key…'));
  aiKeyTest.disabled = true;
  try {
    const info = await invoke('ai_check', { key });
    showKeyCheck('ok', t('Key works'), keyBudget(info));
  } catch (e) {
    if (String(e) === KEY_REJECTED) {
      showKeyCheck('fail', t('OpenRouter did not accept the key'), t('Check that you copied the whole key.'));
    } else {
      showKeyCheck('fail', t("Couldn't reach OpenRouter"), t('Check your connection and try again.'));
    }
  } finally {
    aiKeyTest.disabled = false;
  }
}

aiKeyField.addEventListener('change', () => {
  saveSetting(AI_KEY_SETTING, aiKeyField.value.trim());
  if (aiKeyField.value.trim()) {
    checkAiKey();
  }
});
aiKeyTest.addEventListener('click', checkAiKey);
$('ai-replies-toggle').addEventListener('change', (e) => saveSetting(AI_REPLIES_SETTING, e.target.checked ? 'on' : 'off'));

// Reactions and replies

const replyHints = new Map();
let replying = null;

// Which line each reply of mine answered, kept as a setting so it survives restarts and reaches my other devices.
const REPLY_LINKS_SETTING = 'replyLinks';
const REPLY_LINKS_KEEP = 200;

function replyLinks() {
  try {
    return JSON.parse(state.settings[REPLY_LINKS_SETTING] || '{}');
  } catch {
    return {};
  }
}

function linkKey(net, buffer, text) {
  return `${net}\n${buffer.toLowerCase()}\n${text}`;
}

function rememberReply(net, buffer, text, line) {
  if (!line.id) {
    return;
  }
  const links = replyLinks();
  links[linkKey(net, buffer, text)] = line.id;
  const keys = Object.keys(links);
  for (const k of keys.slice(0, Math.max(0, keys.length - REPLY_LINKS_KEEP))) {
    delete links[k];
  }
  saveSetting(REPLY_LINKS_SETTING, JSON.stringify(links));
}

function addReaction(target, emoji, nick, own) {
  target.reactions ??= new Map();
  const who = target.reactions.get(emoji) ?? new Set();
  who.add(nick);
  target.reactions.set(emoji, who);
  if (own) {
    target.mine ??= new Set();
    target.mine.add(emoji);
  }

  let box = target.row.querySelector(':scope > .reacts');
  if (!box) {
    box = h('div', 'reacts');
    target.row.append(box);
  }
  box.replaceChildren(
    ...[...target.reactions].map(([e, nicks]) => {
      const chip = h('button', 'react');
      chip.append(h('span', 'react-emoji', e));
      if (nicks.size > 1) {
        chip.append(h('span', 'react-count', String(nicks.size)));
      }
      chip.type = 'button';
      chip.dataset.tip = [...nicks].join(', ');
      chip.classList.toggle('mine', Boolean(target.mine?.has(e)));
      chip.addEventListener('click', () => react(target.line, e));
      return chip;
    }),
  );
}

function reactionCounts() {
  try {
    return JSON.parse(state.settings[REACTION_SETTING] || '{}');
  } catch {
    return {};
  }
}

function topReactions() {
  const counts = reactionCounts();
  const used = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([e]) => e);
  return [...new Set([...used, ...QUICK_REACTIONS])].slice(0, QUICK_REACTION_COUNT);
}

// Settings live on lobby-server (or locally in direct mode), so every device shares them.
function commaList(value) {
  return wordList(value).join(', ');
}

function highlightWords() {
  return wordList(state.settings[HIGHLIGHT_WORDS_SETTING]);
}

/** Your nick on that network and your highlight words. */
function myWords(net) {
  return [state.me[net], ...highlightWords()];
}

function saveSetting(key, value) {
  state.settings[key] = value;
  invoke('set_setting', { key, value })
    .then(() => el.settings.open && flashSaved())
    .catch((e) => renderStatus(String(e)));
}

function countReaction(emoji) {
  const counts = reactionCounts();
  counts[emoji] = (counts[emoji] || 0) + 1;
  saveSetting(REACTION_SETTING, JSON.stringify(counts));
}

// IRC only carries "nick: 😂", so the message you picked is remembered here: first until your
// own line comes back, then by its id, kept as a setting so other devices and restarts agree.
const REACTION_LINKS_SETTING = 'reactionLinks';
const REACTION_LINKS_MAX = 500;
const pendingReactions = new Map();

const reactionKey = (net, buffer, nick, emoji) => `${net}\n${buffer.toLowerCase()}\n${nick.toLowerCase()}\n${emoji}`;

function reactionLinks() {
  try {
    return JSON.parse(state.settings[REACTION_LINKS_SETTING] || '{}');
  } catch {
    return {};
  }
}

/** The message one of your own reaction lines was aimed at, when it is in view. */
function reactedTo(l, reaction) {
  if (!isMine(l)) {
    return null;
  }
  const key = reactionKey(l.net, l.buffer, reaction.nick, reaction.emoji);
  const pending = pendingReactions.get(key);
  if (pending && l.id) {
    pendingReactions.delete(key);
    const links = reactionLinks();
    links[l.id] = pending;
    const ids = Object.keys(links);
    for (const old of ids.slice(0, Math.max(0, ids.length - REACTION_LINKS_MAX))) {
      delete links[old];
    }
    saveSetting(REACTION_LINKS_SETTING, JSON.stringify(links));
  }
  const target = pending || (l.id && reactionLinks()[l.id]);
  return (target && view.byId.get(target)) || null;
}

async function react(line, emoji) {
  const b = state.buffers.get(state.current);
  if (!b) {
    return;
  }
  countReaction(emoji);
  if (line.id) {
    pendingReactions.set(reactionKey(b.net, b.name, line.nick, emoji), line.id);
  }
  try {
    await invoke('send', { net: b.net, buffer: b.name, text: `${line.nick}: ${emoji}` });
  } catch (e) {
    renderStatus(String(e));
  }
}

function startReply(line) {
  replying = line;
  el.replyNick.textContent = line.nick;
  el.replyNick.style.color = identity(line.nick, line.mask).color;
  el.replyText.textContent = shownText(stripFormatting(quotedText(line.text)));
  el.replying.hidden = false;
  el.input.focus();
  el.input.setSelectionRange(el.input.value.length, el.input.value.length);
}

function isMine(line) {
  return line.own || line.nick === state.me[line.net];
}

// Reporting: the user's mail app opens with the message, addressed to BRAND.reportEmail.
let reporting = null;

function openReport(line) {
  reporting = line;
  const name = h('span', 'quote-nick', line.nick);
  name.style.color = identity(line.nick, line.mask).color;
  el.reportQuote.replaceChildren(name, h('span', 'quote-text', shownText(stripFormatting(line.text))));
  el.reportNote.value = '';
  el.reportBlock.checked = true;
  el.reportBlockLabel.textContent = t('Ignore {nick} too', { nick: line.nick });
  el.reportTo.textContent = t('Send opens your mail app with the report to {email}.', { email: BRAND.reportEmail });
  el.report.showModal();
}

el.reportCancel.addEventListener('click', () => el.report.close());
el.reportSend.addEventListener('click', () => {
  const line = reporting;
  el.report.close();
  openUrl(reportMail(BRAND.reportEmail, line, el.reportNote.value)).catch((e) => renderStatus(String(e)));
  if (el.reportBlock.checked) {
    ignore(line.nick);
  }
});

function stopReply() {
  replying = null;
  el.replying.hidden = true;
}

// Hover menu: quick reactions on top, actions under them. One instance, moved to the hovered line.

const ICONS = {
  addReaction:
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.56"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/><path d="M19 2v6M16 5h6"/></svg>',
  reply:
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  moreV:
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
  moreH:
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
  copy: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>',
  person:
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c1-4 4-6 8-6s7 2 8 6"/></svg>',
  flag: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>',
  kick: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M9 8l-4 4 4 4"/><path d="M5 12h10"/></svg>',
  ignore:
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
  dock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/><path class="pane" d="M15 4h3a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-3z" fill="currentColor" stroke="none"/></svg>',
  close:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check:
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  external:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>',
  play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"/></svg>',
  pause:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
  sound:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
};

const actions = h('div', 'actions');
let actionPanel = null;

function hoveredLine() {
  return actions.parentElement?.line || null;
}

function menuButton(label, content, onClick, cls = 'act') {
  const b = h('button', cls);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.dataset.tip = label;
  if (content.startsWith('<')) {
    b.append(svg(content));
  } else {
    b.textContent = content;
  }
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const line = hoveredLine();
    if (line) {
      onClick(line, b);
    }
  });
  return b;
}

function closePanel() {
  if (!actionPanel) {
    return;
  }
  actionPanel.remove();
  actionPanel = null;
  if (stuck) {
    toBottom();
  }
}

function togglePanel(build) {
  const open = actionPanel?.dataset.kind === build.name;
  closePanel();
  if (open) {
    return;
  }
  actionPanel = build();
  actionPanel.dataset.kind = build.name;
  actions.append(actionPanel);
}

function quickRow() {
  const row = h('div', 'glass emoji-row quick-row');
  row.append(
    ...topReactions().map((e) =>
      menuButton(
        t('React {emoji}', { emoji: e }),
        e,
        (line) => {
          closePanel();
          react(line, e);
        },
        'act emoji',
      ),
    ),
    menuButton(t('More emojis'), ICONS.moreH, (line, button) => {
      openPicker(button, (e) => react(line, e));
    }),
  );
  return row;
}

function moreMenu() {
  const menu = h('div', 'glass more-menu');
  const item = (label, run) => {
    const b = h('button', 'menu-item', label);
    b.type = 'button';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const line = hoveredLine();
      closePanel();
      if (line) {
        run(line);
      }
    });
    return b;
  };
  const shown = hoveredLine();
  menu.append(...(shown ? lineChoices(shown) : []).map(([label, run]) => item(label, run)));
  return menu;
}

/** What the ⋮ menu offers for a line, the same on desktop and in the phone's long-press sheet. */
function lineChoices(line) {
  const choices = [
    [t('Reply'), startReply, ICONS.reply],
    [t('Copy text'), (l) => navigator.clipboard?.writeText(stripFormatting(l.text)), ICONS.copy],
    [t('Edit person'), (l) => openPerson(l.nick, l.mask), ICONS.person],
  ];
  if (!isMine(line)) {
    // Only a fork with its own admins takes reports; plain IRC has nobody to send them to.
    if (BRAND.reportMessages) {
      choices.push([t('Report message'), openReport, ICONS.flag]);
    }
    choices.push([t('Mute {name}', { name: line.nick }), (l) => setNickMuted(l.nick, true), EYE_OFF]);
    choices.push([t('Ignore {nick}', { nick: line.nick }), (l) => ignore(l.nick), ICONS.ignore]);
    const b = buffer(line.net, line.buffer);
    if (isChannel(line.buffer) && b.modes && myPowers(b).kick) {
      choices.push([t('Kick {nick}…', { nick: line.nick }), (l) => openKick(b, l.nick, false), ICONS.kick]);
    }
  }
  return choices;
}

function fillActions() {
  closePanel();
  const tools = h('div', 'glass action-row');
  tools.append(
    menuButton(t('Add reaction'), ICONS.addReaction, () => togglePanel(quickRow)),
    menuButton(t('Reply'), ICONS.reply, startReply),
    menuButton(t('More'), ICONS.moreV, () => togglePanel(moreMenu)),
  );
  actions.replaceChildren(tools);
}

// An open reaction row or menu stays with its message, even as new messages scroll it
// away under the pointer; a click outside it closes it.
el.col.addEventListener('pointerover', (e) => {
  const r = e.target.closest('.text');
  // A finger gets the long-press sheet instead of the hover bar.
  if (e.pointerType === 'touch' || !r?.line || actions.parentElement === r || (actionPanel && e.pointerType === 'mouse')) {
    return;
  }
  fillActions();
  r.append(actions);
});
// Touch: holding a message, as in Signal. The chat dims and blurs, the message lifts above it
// toward the middle of the screen, and the quick reactions arrive over it. A tap outside closes.
// Moving the finger or letting go early is a scroll or a tap, never a press.

const HOLD_MS = 400;
const HOLD_MOVE_PX = 10;
const SHEET_PILL_PX = 56;
const SHEET_MARGIN_PX = 12;
const SHEET_EXIT_MS = 420;
const press = { timer: 0, x: 0, y: 0, sheet: null, held: null };

function cancelPress() {
  clearTimeout(press.timer);
  press.timer = 0;
}

el.col.addEventListener('pointerdown', (e) => {
  const r = e.target.closest('.text');
  if (e.pointerType !== 'touch' || !r?.line) {
    return;
  }
  cancelPress();
  press.x = e.clientX;
  press.y = e.clientY;
  press.timer = setTimeout(() => {
    press.timer = 0;
    window.__TAURI__.haptics?.impactFeedback('medium').catch(() => {});
    openSheet(r);
  }, HOLD_MS);
});
el.col.addEventListener('pointermove', (e) => {
  if (press.timer && Math.hypot(e.clientX - press.x, e.clientY - press.y) > HOLD_MOVE_PX) {
    cancelPress();
  }
});
for (const type of ['pointerup', 'pointercancel']) {
  el.col.addEventListener(type, cancelPress);
}
// iOS starts its own text selection on a long press; never while a hold or the sheet is on.
document.addEventListener('selectstart', (e) => {
  if (press.timer || press.sheet) {
    e.preventDefault();
  }
});
// The system's own long-press menu would cover the sheet.
el.col.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.text') && matchMedia('(hover: none)').matches) {
    e.preventDefault();
  }
});

function openSheet(row) {
  closeSheet();
  // iOS may have started a text selection during the hold, and the keyboard would leave
  // the sheet half a screen: the sheet is the interaction now.
  document.getSelection()?.removeAllRanges();
  document.activeElement?.blur?.();
  row.classList.add('pressed');
  press.held = row;
  // A selection iOS began just as the hold fired, cleared once more after the sheet is up.
  requestAnimationFrame(() => document.getSelection()?.removeAllRanges());

  const line = row.line;
  const sheet = h('div', 'sheet');
  const dim = h('div', 'sheet-dim');
  const lifted = h('div', 'sheet-lift');
  const copy = row.cloneNode(true);
  copy.querySelector('.actions')?.remove();
  copy.classList.remove('pressed');
  lifted.append(copy);
  // As in Signal: the reactions above the message, everything else in a menu under it.
  const pill = h('div', 'glass sheet-pill');
  const pick = (run) => () => {
    closeSheet();
    run();
  };
  for (const emoji of topReactions()) {
    const b = h('button', 'sheet-react', emoji);
    b.type = 'button';
    b.setAttribute('aria-label', t('React {emoji}', { emoji }));
    b.addEventListener(
      'click',
      pick(() => react(line, emoji)),
    );
    pill.append(b);
  }
  const all = h('button', 'sheet-tool sheet-all');
  all.type = 'button';
  all.setAttribute('aria-label', t('More emojis'));
  all.append(svg(ICONS.moreH));
  all.addEventListener(
    'click',
    pick(() => openPicker(row, (e) => react(line, e))),
  );
  pill.append(all);
  const menu = h('div', 'glass sheet-menu');
  for (const [label, run, icon] of lineChoices(line)) {
    const b = h('button', 'sheet-item');
    b.type = 'button';
    b.append(svg(icon), h('span', null, label));
    b.addEventListener(
      'click',
      pick(() => run(line)),
    );
    menu.append(b);
  }
  dim.addEventListener('click', closeSheet);
  sheet.addEventListener('pointerdown', (e) => e.stopPropagation());
  sheet.addEventListener('touchmove', (e) => e.target === dim && e.preventDefault(), { passive: false });
  sheet.append(dim, lifted, pill, menu);
  document.body.append(sheet);
  press.sheet = sheet;

  // Measured against the page, which the keyboard shortens; `k` turns measured pixels into
  // style pixels when the window is zoomed for text size. The message rises toward the middle,
  // keeps room for the reactions above it and the menu under it, and scrolls inside when too tall.
  const k = sheet.getBoundingClientRect().width / sheet.offsetWidth || 1;
  const page = document.body.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  const above = (SHEET_PILL_PX + PICKER_GAP + SHEET_MARGIN_PX) * k;
  const below = menu.getBoundingClientRect().height + (PICKER_GAP + SHEET_MARGIN_PX) * k;
  const room = Math.max(48 * k, page.height - above - below);
  const height = Math.min(r.height, room);
  let dy = page.top + above + (room - height) / 2 - r.top;
  dy = Math.min(dy, page.bottom - below - height - r.top);
  dy = Math.max(dy, page.top + above - r.top);
  Object.assign(lifted.style, { left: `${r.left / k}px`, top: `${r.top / k}px`, width: `${r.width / k}px` });
  if (height < r.height) {
    lifted.style.height = `${height / k}px`;
    lifted.classList.add('scrolls');
  }
  const leftOf = (w) => Math.max(SHEET_MARGIN_PX, Math.min(r.left / k, page.width / k - w - SHEET_MARGIN_PX));
  Object.assign(pill.style, { left: `${leftOf(pill.offsetWidth)}px`, top: `${(r.top - (SHEET_PILL_PX + PICKER_GAP) * k) / k}px` });
  Object.assign(menu.style, { left: `${leftOf(menu.offsetWidth)}px`, top: `${(r.top + height + PICKER_GAP * k) / k}px` });
  sheet.style.setProperty('--rise', `${dy / k}px`);
  requestAnimationFrame(() => sheet.classList.add('lifted'));
}

function closeSheet() {
  const sheet = press.sheet;
  press.sheet = null;
  press.held?.classList.replace('pressed', 'released');
  const held = press.held;
  press.held = null;
  setTimeout(() => held?.classList.remove('released'), SHEET_EXIT_MS);
  if (!sheet) {
    return;
  }
  sheet.classList.add('closing');
  setTimeout(() => sheet.remove(), SHEET_EXIT_MS);
}

function hideActions() {
  closePanel();
  actions.remove();
}

// Leaving the chat, the window or its focus takes the hover menu away.
// A finger always "leaves" when lifted, so on touch only a tap elsewhere closes it.
el.log.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse') {
    hideActions();
  }
});
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest?.('.actions')) {
    return;
  }
  if (e.pointerType !== 'mouse' && !e.target.closest?.('.text')) {
    hideActions();
    return;
  }
  closePanel();
});
document.documentElement.addEventListener('mouseleave', hideActions);
window.addEventListener('blur', () => {
  hideActions();
  hideTip();
});

// People in the channel: the most active faces in a pill on the header, and the list it opens.
// The list puts ops first, then everyone by when they last spoke; picking several people gives
// or takes op and voice in as few MODE lines as the server allows.

const PILL_FACES = 5;
const DOCK_KEY = 'lobby.nicklist';
const VOICE = `<svg class="voiced" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" role="img" aria-label="${t('voice')}"><path d="M5 9v6M9 6v12M13 9v6M17 4v16"/></svg>`;
const CAN_OP = /[~&@]/;
const CAN_VOICE = /[~&@%]/;

/** When each nick last said something, per network: `net\nnick` to a timestamp. */
const spoke = new Map();
const nicklist = { el: null, menu: null, picked: new Set(), frame: 0, timer: 0, tab: 'people', today: null };

function spokeKey(net, nick) {
  return `${net}\n${nick.toLowerCase()}`;
}

function noteSpoke(l) {
  if (!l.nick || !CHAT_KINDS.has(l.kind)) {
    return;
  }
  const k = spokeKey(l.net, l.nick);
  if ((spoke.get(k) || 0) < l.ts) {
    spoke.set(k, l.ts);
  }
}

function renameSpoke(net, from, to) {
  const ts = spoke.get(spokeKey(net, from));
  if (ts) {
    spoke.set(spokeKey(net, to), ts);
  }
}

function spokeIn(net) {
  return (nick) => spoke.get(spokeKey(net, nick)) || 0;
}

function channelShown() {
  const b = state.buffers.get(state.current);
  return b && b.name !== '' && !isPrivate(b) ? b : null;
}

// Messages arrive in bursts: the pill redraws once per frame at most, and the list, which can
// hold a thousand people, at most every LIST_REDRAW_MS. Picking redraws it at once.
const LIST_REDRAW_MS = 1000;

function schedulePeople() {
  if (!nicklist.frame) {
    nicklist.frame = requestAnimationFrame(() => {
      nicklist.frame = 0;
      renderPill();
    });
  }
  if (nicklist.el && !nicklist.timer) {
    nicklist.timer = setTimeout(() => {
      nicklist.timer = 0;
      renderNicklist();
    }, LIST_REDRAW_MS);
  }
}

// Where the list lives: a drop-down from the pill, or a column beside the chat that stays
// (`side`), and whether that column is showing (`shown`). Kept per platform in the synced
// settings, which last: a phone's web storage can be lost when the system ends the app.
function dockSetting() {
  return `${DOCK_KEY}.${PLATFORM.value || 'desktop'}`;
}

// Until someone chooses, a window wide enough keeps the list open beside the chat.
const DOCK_DEFAULT_MIN_PX = 600;

function dockPrefs() {
  try {
    const saved = JSON.parse(state.settings[dockSetting()] || 'null');
    return saved || (innerWidth >= DOCK_DEFAULT_MIN_PX ? { side: true, shown: true } : {});
  } catch {
    return {};
  }
}

function saveDock(prefs) {
  saveSetting(dockSetting(), JSON.stringify(prefs));
}

const PEOPLE_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M3 19c.8-3.4 3.2-5 6-5s5.2 1.6 6 5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c1.8.6 2.8 2.2 3 5"/></svg>';

// The pill shows who is talking now, latest first; nobody talking leaves the people icon.
function renderPill() {
  const b = channelShown();
  el.pill.hidden = !b?.members.size;
  if (el.pill.hidden) {
    hideNicklist();
    return;
  }
  const spokeAt = spokeIn(b.net);
  const now = Date.now();
  const talking = byActivity(b.members, spokeAt).filter((n) => now - spokeAt(n) < TALKING_MS && !isMutedNick(n));
  const faces = h('span', 'pill-faces');
  faces.append(...talking.slice(0, PILL_FACES).map((n) => avatar(n, '')));
  el.pill.replaceChildren(talking.length ? faces : svg(PEOPLE_ICON));
  const vars = { n: b.members.size, talking: talking.length };
  const count = b.members.size === 1 ? t('{n} person, {talking} talking now', vars) : t('{n} people, {talking} talking now', vars);
  el.pill.setAttribute('aria-label', count);
  el.pill.dataset.tip = count;
  const dock = dockPrefs();
  if (dock.side && dock.shown && !nicklist.el) {
    openNicklist();
  }
  // Lit only while the drop-down hangs from it; a column beside the chat stands on its own.
  el.pill.setAttribute('aria-expanded', String(Boolean(nicklist.el) && !nicklist.el.classList.contains('docked')));
}

function openNicklist() {
  const side = Boolean(dockPrefs().side);
  nicklist.el = h('div', side ? 'nicklist docked' : 'glass nicklist');
  nicklist.el.setAttribute('role', side ? 'complementary' : 'dialog');
  nicklist.el.setAttribute('aria-label', t('People'));
  nicklist.el.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.body.append(nicklist.el);
  document.body.classList.toggle('docked', side);
  renderNicklist();
  renderPill();
}

/** Take the list off screen without changing where it lives. */
function hideNicklist() {
  closePeopleMenu();
  nicklist.picked.clear();
  if (!nicklist.el) {
    return;
  }
  nicklist.el.remove();
  nicklist.el = null;
  document.body.classList.remove('docked');
  el.pill.setAttribute('aria-expanded', 'false');
}

/** Close the drop-down; a docked column stays. */
function closeNicklist() {
  if (nicklist.el && !dockPrefs().side) {
    hideNicklist();
  }
}

function toggleDock() {
  saveDock({ side: !dockPrefs().side, shown: true });
  hideNicklist();
  openNicklist();
}

function renderNicklist() {
  const b = channelShown();
  if (!nicklist.el || !b) {
    return;
  }
  const now = Date.now();
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  for (const n of nicklist.picked) {
    if (!b.members.has(n)) {
      nicklist.picked.delete(n);
    }
  }
  const scroll = h('div', 'nl-scroll');
  const top = h('div', 'nl-top');
  const side = nicklist.el.classList.contains('docked');
  const dock = h('button', 'icon-btn nl-dock');
  dock.type = 'button';
  dock.setAttribute('aria-pressed', String(side));
  dock.setAttribute('aria-label', side ? t('Show as a drop-down') : t('Keep beside the chat'));
  dock.dataset.tip = side ? t('Show as a drop-down') : t('Keep beside the chat');
  dock.append(svg(ICONS.dock));
  dock.addEventListener('click', toggleDock);
  const total = b.members.size === 1 ? t('{n} person', { n: 1 }) : t('{n} people', { n: b.members.size });
  top.append(h('span', 'nl-total', total), dock);
  scroll.append(top, peopleTabs());
  if (nicklist.tab === 'today') {
    scroll.append(...todayRanking(b));
  } else {
    for (const g of peopleGroups([...b.members], b.modes, spokeIn(b.net), now, midnight, isMutedNick)) {
      const head = h('div', 'nl-head', `${g.title} · ${g.people.length}`);
      if (g.id === 'now') {
        head.prepend(h('span', 'live'));
      }
      scroll.append(head, ...g.people.map((p) => personRow(b, p, now)));
    }
  }
  const scrolled = nicklist.el.querySelector('.nl-scroll')?.scrollTop ?? 0;
  const bar = nicklist.tab === 'people' ? pickedBar(b) : null;
  nicklist.el.replaceChildren(scroll, ...(bar ? [bar] : []));
  scroll.scrollTop = scrolled;

  // Under the pill, or the full height beside the chat. Measured against the page like the
  // emoji picker: the window can be zoomed for text size, so `k` turns measured pixels back
  // into style pixels.
  const k = nicklist.el.getBoundingClientRect().width / nicklist.el.offsetWidth || 1;
  const below = side ? el.logwrap.getBoundingClientRect().top : el.pill.getBoundingClientRect().bottom + PICKER_GAP * k;
  nicklist.el.style.top = `${below / k}px`;
}

const HOVER = matchMedia('(hover: hover)');
const MUTED_FADE = 0.35;

function personRow(b, p, now) {
  const picked = nicklist.picked.has(p.nick);
  const who = identity(p.nick);
  const row = h('button', `nl-row${picked ? ' picked' : ''}`);
  row.type = 'button';
  row.setAttribute('aria-pressed', String(picked));
  row.style.setProperty('--fade', isMutedNick(p.nick) ? MUTED_FADE : fadeFor(p.ts, now));
  const face = h('span', 'nl-face');
  const check = h('span', 'nl-check');
  check.append(svg(ICONS.check));
  face.append(avatar(p.nick, ''), check);
  const name = h('span', 'nl-name', who.name);
  row.append(face, name);
  // Pointing at a row shows the person's card, as names in the chat do; the time is already in
  // the row. A tap on a touch screen picks the row instead.
  if (HOVER.matches) {
    personTip(row, b.net, p.nick);
    row.dataset.noSpoke = '1';
  }
  const quiet = isIgnored(p.nick) ? t('Ignored') : quietFor(p.ts, now);
  row.classList.toggle('blocked', isIgnored(p.nick));
  if (quiet) {
    row.append(h('span', 'nl-ago', quiet));
  }
  // The voice mark sits at the right edge, after the time.
  if (p.role === 'voice') {
    const mark = h('span', 'nl-mark');
    mark.append(svg(VOICE));
    row.append(mark);
  }
  row.addEventListener('click', () => {
    if (picked) {
      nicklist.picked.delete(p.nick);
    } else {
      nicklist.picked.add(p.nick);
    }
    renderNicklist();
  });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    peopleMenu(p.nick, e.clientX, e.clientY, row);
  });
  return row;
}

/** What I may do here: give op needs op, give voice needs half-op or more. */
function myPowers(b) {
  const mine = b.modes.get(state.me[b.net]) || '';
  // Half-ops kick and ban too on the networks that have them.
  return { op: CAN_OP.test(mine), voice: CAN_VOICE.test(mine), kick: CAN_VOICE.test(mine) };
}

const MODE_LABELS = { voice: ['Give voice', 'Take voice'], op: ['Give op', 'Take op'] };

function modeLabel(act, word) {
  return t(MODE_LABELS[word][act.give ? 0 : 1]);
}

function sendModes(b, act, word) {
  const command = `/${act.give ? '' : 'de'}${word} ${act.nicks.join(' ')}`;
  invoke('send', { net: b.net, buffer: b.name, text: command }).catch((e) => renderStatus(String(e)));
  nicklist.picked.clear();
  closePeopleMenu();
  renderNicklist();
}

function toggleIgnore(nick) {
  closePeopleMenu();
  nicklist.picked.clear();
  if (isIgnored(nick)) {
    unignore(nick);
  } else {
    ignore(nick);
  }
}

function message(b, nick) {
  closeNicklist();
  select(buffer(b.net, nick).key);
}

/** The person editor for a nick in the list: photo, colour, name and nicks. */
function editListed(b, nick) {
  closePeopleMenu();
  closeNicklist();
  nicklist.picked.clear();
  openPerson(nick, knownAbout(b.net, nick).mask);
}

function pickedBar(b) {
  const picked = [...nicklist.picked];
  if (!picked.length) {
    return null;
  }
  const bar = h('div', 'nl-bar');
  const top = h('div', 'nl-bar-top');
  const clear = h('button', 'icon-btn nl-clear');
  clear.type = 'button';
  clear.setAttribute('aria-label', t('Clear picks'));
  clear.dataset.tip = t('Clear');
  clear.append(svg(ICONS.close));
  clear.addEventListener('click', () => {
    nicklist.picked.clear();
    renderNicklist();
  });
  top.append(h('span', 'nl-count', t('{n} picked', { n: picked.length })), clear);
  const actions = h('div', 'nl-actions');
  const can = myPowers(b);
  for (const [word, symbol] of [
    ['voice', '+'],
    ['op', '@'],
  ]) {
    if (!can[word]) {
      continue;
    }
    const act = modeAction(picked, b.modes, symbol);
    const btn = h('button', `nl-act ${word}`, modeLabel(act, word));
    btn.type = 'button';
    btn.addEventListener('click', () => sendModes(b, act, word));
    actions.append(btn);
  }
  if (picked.length === 1) {
    const choices = [
      [t('Message'), () => message(b, picked[0])],
      [t('Edit'), () => editListed(b, picked[0])],
    ];
    if (picked[0] !== state.me[b.net]) {
      const muted = isMutedNick(picked[0]);
      choices.push([muted ? t('Unmute') : t('Mute'), () => setNickMuted(picked[0], !muted)]);
      choices.push([isIgnored(picked[0]) ? t('Unignore') : t('Ignore'), () => toggleIgnore(picked[0])]);
    }
    for (const [label, run] of choices) {
      const btn = h('button', 'nl-act plain', label);
      btn.type = 'button';
      btn.addEventListener('click', run);
      actions.append(btn);
    }
  }
  bar.append(top, actions);
  return bar;
}

// Right-click: acts on everyone picked when the row is one of them, else on that one person.
function peopleMenu(nick, x, y, row) {
  const b = channelShown();
  if (!b) {
    return;
  }
  closePeopleMenu();
  const targets = nicklist.picked.has(nick) ? [...nicklist.picked] : [nick];
  const menu = h('div', 'glass more-menu nl-menu');
  const item = (label, run) => {
    const btn = h('button', 'menu-item', label);
    btn.type = 'button';
    btn.addEventListener('click', run);
    menu.append(btn);
  };
  const can = myPowers(b);
  for (const [word, symbol] of [
    ['voice', '+'],
    ['op', '@'],
  ]) {
    if (can[word]) {
      const act = modeAction(targets, b.modes, symbol);
      const vars = { action: modeLabel(act, word), n: targets.length };
      const text = targets.length === 1 ? vars.action : act.give ? t('{action} to {n}', vars) : t('{action} from {n}', vars);
      item(text, () => sendModes(b, act, word));
    }
  }
  if (targets.length === 1) {
    item(t('Profile'), () => {
      closePeopleMenu();
      showProfile(row, b.net, nick);
    });
    item(t('Message'), () => message(b, nick));
    item(t('Edit person'), () => editListed(b, nick));
    if (nick !== state.me[b.net]) {
      const muted = isMutedNick(nick);
      item(muted ? t('Unmute {name}', { name: nick }) : t('Mute {name}', { name: nick }), () => setNickMuted(nick, !muted));
      item(isIgnored(nick) ? t('Unignore {nick}', { nick }) : t('Ignore {nick}', { nick }), () => toggleIgnore(nick));
      if (can.kick) {
        item(t('Kick {nick}…', { nick }), () => openKick(b, nick, false));
        item(t('Ban {nick}…', { nick }), () => openKick(b, nick, true));
      }
    }
  }
  if (nicklist.picked.size) {
    item(t('Clear picks'), () => {
      nicklist.picked.clear();
      closePeopleMenu();
      renderNicklist();
    });
  }
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.body.append(menu);
  // At the pointer, kept inside the page; `k` as in renderNicklist.
  const k = menu.getBoundingClientRect().width / menu.offsetWidth || 1;
  const page = document.body.getBoundingClientRect();
  const left = Math.min(x, page.right - menu.offsetWidth * k - PICKER_GAP);
  const top = Math.min(y, page.bottom - menu.offsetHeight * k - PICKER_GAP);
  menu.style.left = `${Math.max(left, PICKER_GAP) / k}px`;
  menu.style.top = `${Math.max(top, PICKER_GAP) / k}px`;
  nicklist.menu = menu;
}

function closePeopleMenu() {
  nicklist.menu?.remove();
  nicklist.menu = null;
}

// Op tools: kick with a reason, bans, and the channel's modes in Settings > Channel. Plain IRC
// commands, so they work on any network; QuakeNet's Q gets its own few buttons.

/** Bans by host, which a nick change does not get around; by nick only when no host is known. */
function banMaskFor(net, nick) {
  const mask = knownAbout(net, nick).mask || '';
  const w = whois.get(key(net, nick))?.w;
  const host = mask.split('@')[1] || w?.host || '';
  return host ? `*!*@${host}` : `${nick}!*@*`;
}

function onQuakeNet(net) {
  return /quakenet/i.test(net);
}

let kicking = null;

function openKick(b, nick, ban) {
  closePeopleMenu();
  closeNicklist();
  nicklist.picked.clear();
  kicking = { b, nick };
  $('kick-title').textContent = t('Kick {nick}', { nick });
  $('kick-reason').value = '';
  $('kick-ban').checked = ban;
  $('kick-ban-label').textContent = t('Ban too, so they cannot come back');
  renderKickMask();
  $('kick').showModal();
  $('kick-reason').focus();
}

function renderKickMask() {
  const { b, nick } = kicking;
  const p = $('kick-mask');
  p.hidden = !$('kick-ban').checked;
  p.textContent = t('Ban mask: {mask}', { mask: banMaskFor(b.net, nick) });
  $('kick-send').textContent = $('kick-ban').checked ? t('Kick and ban') : t('Kick');
}

$('kick-ban').addEventListener('change', renderKickMask);
$('kick-cancel').addEventListener('click', () => $('kick').close());
$('kick-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const { b, nick } = kicking;
  const reason = $('kick-reason').value.trim();
  $('kick').close();
  // The ban goes first, so a quick rejoin does not slip in between.
  const lines = $('kick-ban').checked ? [`/ban ${banMaskFor(b.net, nick)}`] : [];
  lines.push(`/kick ${nick} ${reason}`.trim());
  sendAll(b, lines);
});

async function sendAll(b, lines) {
  try {
    for (const text of lines) {
      await invoke('send', { net: b.net, buffer: b.name, text });
    }
  } catch (e) {
    renderStatus(String(e));
  }
}

// What the common channel modes do. Others show as their letter.
const FLAG_MODES = {
  n: 'No messages from outside the channel',
  t: 'Only ops change the topic',
  m: 'Moderated: only ops and voiced people speak',
  i: 'Invite only',
  s: 'Secret: hidden from channel lists',
  p: 'Private',
  r: 'Only people logged in to services join',
  M: 'Only people logged in to services speak',
  c: 'No colours',
  C: 'No CTCPs',
  N: 'No nick changes',
  T: 'No notices to the channel',
  D: 'Joins hidden until people speak',
  u: 'Quit and part messages hidden',
};

/** CHANMODES split into its four groups: lists, always-argument, set-argument and plain flags. */
function modeGroups(b) {
  const [lists = 'beI', always = 'k', onSet = 'l', flags = 'imnpst'] = (b.modeKinds || 'beI,k,l,imnpst').split(',');
  return { lists, always, onSet, flags };
}

let listsAsked = '';

function renderChannelTools() {
  const b = channelShown();
  const can = b?.modes ? myPowers(b) : {};
  $('chan-tab').hidden = !can.kick;
  if (!can.kick) {
    if (settingsTab === 'channel') {
      showSettingsTab('general');
    }
    return;
  }
  const modes = b.chanModes || {};
  const groups = modeGroups(b);
  $('chan-title').textContent = b.name;
  $('chan-role').textContent = can.op ? t('You are an operator here.') : t('You are a half-op here.');
  if (document.activeElement !== $('chan-topic')) {
    $('chan-topic').value = b.topic || '';
  }

  const letters = [...groups.flags].filter((m) => FLAG_MODES[m] || m in modes);
  $('chan-flags').replaceChildren(
    ...letters.map((m) => {
      const row = h('label', 'switch-row');
      const box = h('input', 'switch');
      box.type = 'checkbox';
      box.setAttribute('role', 'switch');
      box.checked = m in modes;
      box.disabled = !can.op;
      box.addEventListener('change', () => sendAll(b, [`/mode ${box.checked ? '+' : '-'}${m}`]));
      row.append(h('span', '', `${FLAG_MODES[m] ? t(FLAG_MODES[m]) : t('Mode {mode}', { mode: m })} (+${m})`), box);
      return row;
    }),
  );
  for (const [m, id] of [
    ['k', 'chan-key'],
    ['l', 'chan-limit'],
  ]) {
    const known = groups.always.includes(m) || groups.onSet.includes(m);
    $(id).closest('.chan-arg').hidden = !known;
    if (document.activeElement !== $(id)) {
      $(id).value = modes[m] ?? '';
    }
    $(`${id}-clear`).hidden = !(m in modes);
  }

  renderBanList(b, 'b', $('chan-bans'));
  const extra = { e: 'Ban exceptions', I: 'Invite exceptions' };
  const section = $('chan-lists');
  section.replaceChildren();
  for (const m of [...groups.lists].filter((x) => extra[x])) {
    const list = h('div');
    renderBanList(b, m, list);
    section.append(h('h3', '', t(extra[m])), list);
  }
  section.hidden = !section.childElementCount;
  $('chan-q').hidden = !onQuakeNet(b.net);

  // Lists come from the server once per opening; the MODE lines keep them current after that.
  const asked = `${b.key}`;
  if (listsAsked !== asked) {
    listsAsked = asked;
    askLists(b);
  }
}

function askLists(b) {
  const groups = modeGroups(b);
  sendAll(
    b,
    [...groups.lists].filter((m) => 'beI'.includes(m)).map((m) => `/mode +${m}`),
  );
}

function renderBanList(b, mode, into) {
  const entries = b.lists?.[mode];
  if (!entries) {
    into.replaceChildren(h('p', 'hint', t('Asking the server…')));
    return;
  }
  if (!entries.length) {
    into.replaceChildren(h('p', 'hint', t('None.')));
    return;
  }
  into.replaceChildren(
    ...entries.map((e) => {
      const row = h('div', 'chan-entry');
      const what = h('div', 'chan-entry-what');
      what.append(h('span', 'chan-entry-mask', e.mask));
      if (e.by) {
        const when = e.at ? ` · ${ago(e.at * 1000)}` : '';
        what.append(h('span', 'chan-entry-by', t('by {nick}', { nick: e.by }) + when));
      }
      const remove = h('button', 'link-btn', t('Remove'));
      remove.type = 'button';
      remove.addEventListener('click', () => sendAll(b, [`/mode -${mode} ${e.mask}`]));
      row.append(what, remove);
      return row;
    }),
  );
}

function withChannel(run) {
  return () => {
    const b = channelShown();
    if (b) {
      run(b);
    }
  };
}

$('chan-topic-save').addEventListener(
  'click',
  withChannel((b) => sendAll(b, [`/topic ${$('chan-topic').value.replace(/\s+/g, ' ').trim()}`])),
);
$('chan-key-set').addEventListener(
  'click',
  withChannel((b) => {
    const key = $('chan-key').value.trim().replace(/\s+/g, '');
    if (key) {
      // A new key replaces the old one only after the old one is taken off.
      const off = 'k' in (b.chanModes || {}) ? [`/mode -k ${b.chanModes.k || '*'}`] : [];
      sendAll(b, [...off, `/mode +k ${key}`]);
    }
  }),
);
$('chan-key-clear').addEventListener(
  'click',
  withChannel((b) => sendAll(b, [`/mode -k ${b.chanModes?.k || '*'}`])),
);
$('chan-limit-set').addEventListener(
  'click',
  withChannel((b) => {
    const n = Number.parseInt($('chan-limit').value, 10);
    if (n > 0) {
      sendAll(b, [`/mode +l ${n}`]);
    }
  }),
);
$('chan-limit-clear').addEventListener(
  'click',
  withChannel((b) => sendAll(b, ['/mode -l'])),
);
$('chan-ban-add').addEventListener(
  'click',
  withChannel((b) => {
    const typed = $('chan-ban-mask').value.trim();
    if (!typed) {
      return;
    }
    // A nick that is here is banned by its host; anything else as typed.
    const here = [...b.members].find((m) => m.toLowerCase() === typed.toLowerCase());
    sendAll(b, [`/ban ${here ? banMaskFor(b.net, here) : typed}`]);
    $('chan-ban-mask').value = '';
  }),
);
$('chan-bans-refresh').addEventListener(
  'click',
  withChannel((b) => askLists(b)),
);
$('chan-q-permban').addEventListener(
  'click',
  withChannel((b) => {
    const mask = $('chan-q-mask').value.trim();
    if (!mask) {
      return;
    }
    const reason = $('chan-q-reason').value.trim();
    sendAll(b, [`/msg Q permban ${b.name} ${mask} ${reason}`.trim()]);
    $('chan-q-mask').value = '';
    $('chan-q-reason').value = '';
  }),
);
$('chan-q-banlist').addEventListener(
  'click',
  withChannel((b) => sendAll(b, [`/msg Q banlist ${b.name}`])),
);
$('chan-q-op').addEventListener(
  'click',
  withChannel((b) => sendAll(b, [`/msg Q op ${b.name}`])),
);

el.pill.addEventListener('click', () => {
  const dock = dockPrefs();
  if (dock.side) {
    saveDock({ side: true, shown: !nicklist.el });
  }
  if (nicklist.el) {
    hideNicklist();
  } else {
    openNicklist();
  }
});
el.pill.addEventListener('pointerdown', (e) => e.stopPropagation());

// Phones: a swipe in from the right edge opens the people list.
const EDGE_ZONE_PX = 24;
const EDGE_SLOP_PX = 10;
// Let go past this share of the list's width, or flick, and it stays open.
const EDGE_OPEN_SHARE = 0.4;
const EDGE_FLICK_PX_MS = 0.5;
const EDGE_SETTLE_MS = 180;
let edgeSwipe = null;
document.addEventListener(
  'touchstart',
  (e) => {
    const t = e.touches[0];
    const fromEdge = e.touches.length === 1 && t.clientX > innerWidth - EDGE_ZONE_PX;
    edgeSwipe = fromEdge && !HOVER.matches && !el.pill.hidden && !nicklist.el ? { x: t.clientX, y: t.clientY, at: e.timeStamp } : null;
  },
  { passive: true },
);
document.addEventListener(
  'touchmove',
  (e) => {
    if (!edgeSwipe) {
      return;
    }
    const dx = edgeSwipe.x - e.touches[0].clientX;
    const dy = Math.abs(e.touches[0].clientY - edgeSwipe.y);
    if (!edgeSwipe.list && dy > Math.max(dx, EDGE_SLOP_PX)) {
      edgeSwipe = null;
      return;
    }
    if (!edgeSwipe.list && dx > EDGE_SLOP_PX) {
      startEdgeDrag();
    }
    if (edgeSwipe.list) {
      edgeSwipe.dx = dx;
      edgeSwipe.speed = (dx - (edgeSwipe.last ?? dx)) / Math.max(1, e.timeStamp - (edgeSwipe.lastAt ?? e.timeStamp));
      edgeSwipe.last = dx;
      edgeSwipe.lastAt = e.timeStamp;
      edgeSwipe.list.style.transform = `translateX(${Math.max(0, edgeSwipe.width - dx)}px)`;
    }
  },
  { passive: true },
);
document.addEventListener('touchend', endEdgeDrag, { passive: true });
document.addEventListener('touchcancel', endEdgeDrag, { passive: true });

// The list opens under the finger: off screen to the right, then moved along as the finger goes.
// The chat keeps its width until the list has settled, so nothing else moves while dragging.
function startEdgeDrag() {
  el.pill.click();
  const list = nicklist.el;
  if (!list) {
    edgeSwipe = null;
    return;
  }
  edgeSwipe.docked = document.body.classList.contains('docked');
  document.body.classList.remove('docked');
  edgeSwipe.width = list.offsetWidth;
  list.style.transition = 'none';
  list.style.transform = `translateX(${edgeSwipe.width}px)`;
  edgeSwipe.list = list;
}

function endEdgeDrag() {
  const swipe = edgeSwipe;
  edgeSwipe = null;
  if (!swipe?.list) {
    return;
  }
  const { list, width, docked } = swipe;
  const open = (swipe.dx ?? 0) > width * EDGE_OPEN_SHARE || (swipe.speed ?? 0) > EDGE_FLICK_PX_MS;
  list.style.transition = `transform ${EDGE_SETTLE_MS}ms ease-out`;
  list.style.transform = `translateX(${open ? 0 : width}px)`;
  setTimeout(() => {
    if (nicklist.el !== list) {
      return;
    }
    list.style.transition = '';
    list.style.transform = '';
    if (!open) {
      if (docked) {
        saveDock({ side: true, shown: false });
      }
      hideNicklist();
      return;
    }
    if (docked) {
      document.body.classList.add('rail-settle', 'docked');
      setTimeout(() => document.body.classList.remove('rail-settle'), EDGE_SETTLE_MS * 2);
    }
  }, EDGE_SETTLE_MS);
}

document.addEventListener('pointerdown', () => {
  if (nicklist.menu) {
    closePeopleMenu();
    return;
  }
  closeNicklist();
});
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Escape' || !nicklist.el || (dockPrefs().side && !nicklist.menu)) {
      return;
    }
    e.stopPropagation();
    if (nicklist.menu) {
      closePeopleMenu();
    } else {
      closeNicklist();
    }
  },
  true,
);

function note(l) {
  const said = {
    topic: t('{nick} changed the topic to “{topic}”', { nick: l.nick, topic: l.text }),
    ctcp: `${l.nick} ${l.text}`,
    dcc: `${l.nick} ${l.text}`,
  };
  const text = said[l.kind] ?? l.text;
  const n = h('div', 'events', text);
  n.dataset.tip = clock(l.ts);
  return n;
}

// Link previews

function getPreview(url) {
  if (!previews.has(url)) {
    previews.set(
      url,
      invoke('preview', { url }).catch(() => null),
    );
  }
  return previews.get(url);
}

async function attachPreview(url, rowNode) {
  const yt = youtube(url);
  if (yt) {
    await null; // the row is appended right after it is built
    return place(youtubeCard(url, yt), rowNode);
  }
  const p = await getPreview(url);
  if (!p || !rowNode.isConnected) {
    return;
  }
  // A page with only a title says nothing the link does not: no card.
  if (p.kind === 'page' && !p.image && !p.description) {
    return;
  }
  const cards = { image: imageCard, video: videoCard, audio: audioCard, page: pageCard };
  place((cards[p.kind] ?? pageCard)(p), rowNode);
}

function place(card, rowNode) {
  if (!rowNode.isConnected) {
    return;
  }
  // The chat's resize watcher keeps the newest message in view while the card and its picture load;
  // a pull to the bottom decided here would undo a jump made in between, such as to a highlight.
  if (rowNode.dataset.onlyLink === 'true') {
    rowNode.replaceWith(card);
  } else {
    rowNode.after(card);
  }
}

// Videos only play while they are on screen.
const onScreen = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      e.target.visible?.(e.isIntersecting);
    }
  },
  { threshold: 0.25 },
);

function openButton(url) {
  const b = h('button', 'glass media-open');
  b.type = 'button';
  b.dataset.tip = t('Open in browser');
  b.innerHTML = ICONS.external;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    openUrl(url);
  });
  return b;
}

const YT_PREVIEW = 'autoplay=1&mute=1&loop=1&controls=0&disablekb=1&iv_load_policy=3&playsinline=1&rel=0';

// YouTube's player, through Lobby's local page that gives it a Referer.
let playerBase = null;

function youtubeFrame(id, query) {
  const f = h('iframe');
  playerBase ??= invoke('player');
  playerBase.then((base) => (f.src = `${base}?v=${id}&${query}`));
  f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  f.allowFullscreen = true;
  return f;
}

/** YouTube's stand-in for a missing thumbnail is 120 px wide; a real hqdefault is 480. */
const YT_MISSING_WIDTH = 120;

function youtubeCard(url, { id, portrait }) {
  const box = h('div', `vid${portrait ? ' portrait' : ''}`);
  const poster = image(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, 'vid-poster');
  poster.loading = 'eager';
  box.append(poster, openButton(url));
  // A private or removed video has no thumbnail: YouTube answers with a small grey stand-in.
  const gone = () => {
    if (!box.classList.contains('playing') && box.isConnected) {
      onScreen.unobserve(box);
      box.replaceWith(pageCard({ url, site: 'youtube.com', title: t('Video not available'), description: t('Private or removed') }));
    }
  };
  poster.addEventListener('error', gone);
  poster.addEventListener('load', () => {
    if (poster.naturalWidth <= YT_MISSING_WIDTH) {
      gone();
    }
  });
  let preview = null;
  let failed = false;

  // The muted loop runs behind the still, which fades out once the loop really plays.
  box.visible = (on) => {
    if (failed || box.classList.contains('playing')) {
      return;
    }
    if (on && !preview) {
      preview = youtubeFrame(id, `${YT_PREVIEW}&playlist=${id}`);
      preview.className = 'vid-preview';
      box.prepend(preview);
    } else if (!on && preview) {
      preview.remove();
      preview = null;
      box.classList.remove('live');
    }
  };
  onScreen.observe(box);

  // Some videos refuse to play outside YouTube: they stay a still that opens YouTube.
  box.playerState = (state, frame) => {
    if (state === 'playing') {
      box.classList.add('live');
    }
    if (state !== 'error') {
      return;
    }
    failed = true;
    frame.remove();
    preview = null;
    box.classList.remove('live', 'playing');
    if (!poster.isConnected) {
      box.prepend(poster);
    }
    box.dataset.tip = t('Open on YouTube');
  };

  box.dataset.tip = t('Play with sound');
  box.addEventListener('click', () => {
    if (failed) {
      return openUrl(url);
    }
    if (box.classList.contains('playing')) {
      return;
    }
    onScreen.unobserve(box);
    preview?.remove();
    preview = null;
    poster.remove();
    delete box.dataset.tip;
    box.classList.add('playing');
    box.prepend(youtubeFrame(id, 'autoplay=1&playsinline=1&rel=0&iv_load_policy=3'));
  });

  getPreview(url).then((p) => {
    const title = p?.title?.replace(/ - YouTube$/, '');
    if (title) {
      box.append(h('span', 'vid-title', title));
    }
  });
  return box;
}

window.addEventListener('message', (e) => {
  const state = e.data?.lobbyPlayer;
  if (!state) {
    return;
  }
  const frame = [...document.querySelectorAll('.vid iframe')].find((f) => f.contentWindow === e.source);
  frame?.closest('.vid')?.playerState?.(state, frame);
});

function videoCard(p) {
  const box = h('div', 'vid native');
  const v = h('video');
  Object.assign(v, { src: directLink(p.url), muted: true, loop: true, playsInline: true, preload: 'metadata' });
  v.addEventListener('error', () => box.replaceWith(pageLink(p)));
  box.append(v, openButton(p.url));
  box.visible = (on) => {
    if (on) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  };
  onScreen.observe(box);

  box.dataset.tip = t('Play with sound');
  box.addEventListener('click', () => {
    if (box.classList.contains('playing')) {
      return;
    }
    delete box.dataset.tip;
    box.classList.add('playing');
    v.muted = false;
    v.controls = true;
    v.currentTime = 0;
    v.play().catch(() => {});
  });
  return box;
}

// A plain link for media the system cannot play.
function pageLink(p) {
  const a = h('a', 'link', shortUrl(p.url));
  a.href = p.url;
  return a;
}

function audioCard(p) {
  const box = h('div', 'aud');
  const audio = h('audio');
  Object.assign(audio, { src: directLink(p.url), preload: 'metadata' });
  const play = h('button', 'aud-play');
  play.type = 'button';
  play.innerHTML = ICONS.play;
  const name = h('a', 'aud-name', decodeURIComponent(p.title || '') || p.site);
  name.href = p.url;
  name.dataset.tip = p.url;
  const bar = h('div', 'aud-bar');
  const fill = h('i');
  bar.append(fill);
  const time = h('span', 'aud-time', '0:00');
  const main = h('div', 'aud-main');
  main.append(name, bar);
  box.append(play, main, time, audio);

  play.addEventListener('click', () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()));
  audio.addEventListener('play', () => (play.innerHTML = ICONS.pause));
  audio.addEventListener('pause', () => (play.innerHTML = ICONS.play));
  audio.addEventListener('loadedmetadata', () => (time.textContent = duration(audio.duration)));
  audio.addEventListener('timeupdate', () => {
    fill.style.width = `${(audio.currentTime / audio.duration) * 100 || 0}%`;
    time.textContent = duration(audio.paused && !audio.currentTime ? audio.duration : audio.currentTime);
  });
  audio.addEventListener('error', () => box.replaceWith(pageLink(p)));
  bar.addEventListener('click', (e) => {
    if (!audio.duration) {
      return;
    }
    const r = bar.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });
  return box;
}

function image(src, cls) {
  const img = h('img', cls);
  img.src = src;
  img.alt = '';
  img.loading = 'lazy';
  img.addEventListener('error', () => img.remove());
  return img;
}

function imageCard(p) {
  const a = h('a', 'pic');
  a.href = p.url;
  a.append(image(p.image));
  return a;
}

function pageCard(p) {
  const a = h('a', 'card');
  a.href = p.url;
  a.dataset.tip = p.url;
  const text = h('div', 'card-text');
  text.append(h('span', 'card-site', p.site || shortUrl(p.url)));
  if (p.title) {
    text.append(h('span', 'card-title', p.title));
  }
  if (p.description) {
    text.append(h('span', 'card-desc', p.description));
  }
  a.append(text);
  if (p.image) {
    const media = h('div', 'card-media');
    const img = image(p.image);
    img.addEventListener('error', () => media.remove());
    media.append(img);
    a.append(media);
  }
  return a;
}

// Composer

let lastCommandAt = 0;

function closeBuffer(b) {
  state.buffers.delete(b.key);
  if (state.current === b.key) {
    state.current = null;
    const next = ordered().find((x) => isChannel(x.name)) || ordered()[0];
    if (next) {
      select(next.key);
    } else {
      renderLog();
    }
  }
  renderHeader();
}

function localNote(text) {
  el.col.append(h('div', 'events info', text));
  toBottom();
}

/** Commands the app handles itself. Returns true when handled. */
async function runLocal(b, text) {
  const [cmd, ...args] = text.slice(1).split(' ');
  const rest = args.join(' ').trim();
  switch (cmd.toLowerCase()) {
    case 'wc':
    case 'close':
      if (isChannel(b.name) && b.joined) {
        await invoke('send', { net: b.net, buffer: b.name, text: '/part' });
      }
      closeBuffer(b);
      return true;
    case 'mute':
    case 'unmute':
      setMuted(b, cmd.toLowerCase() === 'mute');
      localNote(cmd.toLowerCase() === 'mute' ? t('{name} muted', { name: label(b) }) : t('{name} unmuted', { name: label(b) }));
      return true;
    case 'clear':
      b.lines = [];
      renderLog();
      return true;
    case 'query':
      if (!rest) {
        return true;
      }
      select(buffer(b.net, rest.split(' ')[0]).key);
      return true;
    // As irssi: /ignore lists, /ignore nick hides the nick, /unignore nick shows it again.
    case 'ignore':
    case 'unignore': {
      const nick = rest.split(' ')[0];
      if (!nick) {
        const list = [...keySet(BLOCKED_SETTING)].sort();
        localNote(list.length ? t('Ignored: {nicks}', { nicks: list.join(', ') }) : t('Nobody is ignored.'));
        return true;
      }
      const on = cmd.toLowerCase() === 'ignore';
      if (on) {
        ignore(nick);
      } else {
        unignore(nick);
      }
      localNote(on ? t('{nick} ignored', { nick }) : t('{nick} no longer ignored', { nick }));
      return true;
    }
    case 'names':
      localNote(t('{n} people: {names}', { n: b.members.size, names: [...b.members].sort((x, y) => x.localeCompare(y)).join(', ') }));
      return true;
    default:
      return false;
  }
}

async function send() {
  // A file's link sent without words keeps no space from the gap left in front of it.
  const typed = el.input.value.replace(/^ (?=https?:\/\/)/, '');
  const text = settingOn(EMOTICON_SETTING) ? convertEmoticons(typed) : typed;
  const b = state.buffers.get(state.current);
  if (!text.trim() || !b || isJoining(b)) {
    return;
  }
  // Too long for one IRC line: nothing goes until it is shortened.
  if ((roomLeft() ?? 0) < 0) {
    el.room.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }],
      { duration: 220 },
    );
    return;
  }
  hideSlash();
  try {
    if (text.startsWith('/') && !text.startsWith('//')) {
      lastCommandAt = Date.now();
      manualWhois = /^\/(?:whois|wi)\s+(\S+)/i.exec(text)?.[1].toLowerCase() ?? null;
      if (await runLocal(b, text)) {
        lastSent = text;
        el.input.value = '';
        return;
      }
    }
    // On IRC a reply is "nick: text"; the box shows only the text.
    let out = text;
    if (replying && !text.startsWith('/')) {
      const prefix = `${replying.nick}: `;
      if (!out.startsWith(prefix)) {
        out = prefix + out;
      }
      replyHints.set(out, { line: replying, row: findRow(replying) });
      rememberReply(b.net, b.name, out, replying);
    }
    await invoke('send', { net: b.net, buffer: b.name, text: out });
    lastSent = text;
    el.input.value = '';
    stopReply();
    renderStatus();
  } catch (e) {
    renderStatus(String(e));
  }
}

/**
 * Tab: the nicks that start with the word at the caret, one after another and round again,
 * "AnReal: ", "AnReali: ", "AnReal: ". The word is remembered until another key is pressed.
 */
function complete() {
  const b = state.buffers.get(state.current);
  if (!b) {
    return;
  }
  if (!completion) {
    const caret = el.input.selectionStart ?? el.input.value.length;
    const m = /(^|\s)@?([^\s@:,]*)$/u.exec(el.input.value.slice(0, caret));
    const list = nickMatches(m[2], nickCandidates(b), (n) => -spokeIn(b.net)(n), Number.POSITIVE_INFINITY);
    if (!list.length) {
      return;
    }
    completion = { start: m.index + m[1].length, end: caret, list, index: -1 };
  }
  completion.index = (completion.index + 1) % completion.list.length;
  putNick(completion.list[completion.index]);
}

/** Write a nick over the completion's span: "nick: " at the start of a message, "nick " elsewhere. */
function putNick(nick) {
  const { start, end } = completion;
  const value = el.input.value;
  const text = start === 0 ? `${nick}: ` : `${nick} `;
  el.input.value = `${value.slice(0, start)}${text}${value.slice(end)}`;
  completion.end = start + text.length;
  el.input.focus();
  el.input.setSelectionRange(completion.end, completion.end);
}

function findRow(line) {
  return [...el.col.querySelectorAll('.text')].find((r) => r.line === line) || null;
}

el.replyClose.addEventListener('click', () => {
  stopReply();
  el.input.focus();
});

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  send();
});

// The / menu

let slashItems = [];
let slashPick = 0;

function hideSlash() {
  el.slash.hidden = true;
  slashItems = [];
}

function renderSlash() {
  const items = menuEntries();
  if (!items.length) {
    return hideSlash();
  }
  slashItems = items;
  slashPick = Math.min(slashPick, items.length - 1);
  el.slash.replaceChildren(
    ...items.map((entry, i) => {
      const item = h('button', 'slash-item');
      item.type = 'button';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(i === slashPick));
      item.classList.toggle('nick-item', Boolean(entry.nick));
      item.append(...entry.parts);
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        entry.apply();
      });
      return item;
    }),
  );
  el.slash.hidden = false;
  el.slash.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

/** The / commands, or emoji for a ":word" before the caret. */
function menuEntries() {
  const commands = commandMatches(el.input.value);
  if (commands?.length) {
    return commands.map((c) => ({
      parts: [h('span', 'slash-name', `/${c.name}`), h('span', 'slash-args', t(c.args)), h('span', 'slash-desc', t(c.desc))],
      apply: () => applySlash(c),
    }));
  }
  const caret = el.input.selectionStart ?? el.input.value.length;
  const people = nickEntries(caret);
  if (people.length) {
    return people;
  }
  if (!settingOn(SHORTCODE_SETTING)) {
    return [];
  }
  const q = colonQuery(el.input.value.slice(0, caret));
  if (!q) {
    return [];
  }
  if (!pickerState.data) {
    emojiData().then(renderSlash);
    return [];
  }
  return emojiSearch(q, pickerState.data, reactionCounts()).map((hit) => {
    const code = h('span', 'slash-desc emoji-code');
    code.append(`:${hit.id.slice(0, hit.start)}`, h('b', null, hit.id.slice(hit.start, hit.end)), `${hit.id.slice(hit.end)}:`);
    return {
      parts: [h('span', 'slash-emoji', hit.native), code],
      apply: () => insertEmoji(hit.native, caret - q.length - 1, caret),
    };
  });
}

/**
 * People for the word at the caret, "@mi" or "mi", most recently active first. Picking one writes
 * "nick: " at the start of a message and "nick " elsewhere; the @ goes, IRC has no use for it.
 * Enter picks only after an @, so a plain word that happens to match still sends with Enter.
 */
const NICK_MENU_SIZE = 6;

/** Who is here, and who spoke here even if they have since left: answering someone who just
 * quit is common, and their nick usually comes back. Never yourself. */
function nickCandidates(b) {
  const seen = new Map([...b.members].map((n) => [n.toLowerCase(), n]));
  // Recent speakers who left, but not a nick its owner has since changed away from.
  const speakers = new Map();
  for (const l of b.lines) {
    if (l.kind === 'nick') {
      speakers.delete(l.nick.toLowerCase());
    } else if (CHAT_KINDS.has(l.kind) && l.nick) {
      speakers.set(l.nick.toLowerCase(), l.nick);
    }
  }
  for (const [low, nick] of speakers) {
    if (!seen.has(low)) {
      seen.set(low, nick);
    }
  }
  seen.delete((state.me[b.net] || '').toLowerCase());
  return [...seen.values()];
}

/** A pick from the list, which Tab then carries on from through the rest of the matches. */
function pickNick(list, nick, start, end) {
  completion = { start, end, list, index: list.indexOf(nick) };
  putNick(nick);
  hideSlash();
}

function nickEntries(caret) {
  const b = state.buffers.get(state.current);
  const q = b && b.name !== '' ? nickQuery(el.input.value.slice(0, caret)) : null;
  if (!q || !settingOn(q.at ? NICK_MENU_SETTINGS.at : NICK_MENU_SETTINGS.word)) {
    return [];
  }
  const all = nickMatches(q.word, nickCandidates(b), (n) => -spokeIn(b.net)(n), Number.POSITIVE_INFINITY);
  const nicks = all.slice(0, NICK_MENU_SIZE);
  // Already typed out in full: nothing left to suggest.
  if (!q.at && nicks.length === 1 && nicks[0].toLowerCase() === q.word.toLowerCase()) {
    return [];
  }
  return nicks.map((nick) => {
    const who = identity(nick);
    const name = h('span', 'slash-name', nick);
    name.style.color = who.color;
    const parts = [avatar(nick, ''), name];
    if (who.name !== nick) {
      parts.push(h('span', 'slash-desc', who.name));
    }
    return { parts, nick: true, enter: q.at, apply: () => pickNick(all, nick, q.start, caret) };
  });
}

/** Put an emoji where the colon or shortcode was, with a space after it. */
function insertEmoji(native, start, end) {
  countReaction(native);
  const value = el.input.value;
  el.input.value = `${value.slice(0, start)}${native} ${value.slice(end)}`;
  const caret = start + native.length + 1;
  el.input.focus();
  el.input.setSelectionRange(caret, caret);
  hideSlash();
}

function applySlash(c) {
  el.input.value = `/${c.name} `;
  hideSlash();
  el.input.focus();
  if (!c.args) {
    send();
  }
}

el.input.addEventListener('input', () => {
  emoticonsAsTyped();
  colonPicker();
  slashPick = 0;
  renderSlash();
  fitInput();
});

/** What is left of IRC's line limit, counting down as you type; red and below zero when too long. */
function roomLeft() {
  const b = state.buffers.get(state.current);
  if (!b || b.name === '' || !el.input.value.trim()) {
    return null;
  }
  return messageRoom(el.input.value, state.me[b.net] || '', b.name, state.masks[b.net]);
}

function renderRoom() {
  const room = roomLeft();
  el.room.hidden = room === null;
  el.room.textContent = room === null ? '' : String(room);
  el.room.classList.toggle('over', room !== null && room < 0);
  el.room.dataset.tip =
    room !== null && room < 0 ? t('Too long for one IRC message: shorten it, or send it in two') : t('Characters left in this IRC message');
}

// ":D " becomes 😀 the moment a space lands after it; sending converts a last one too.
function emoticonsAsTyped() {
  if (!settingOn(EMOTICON_SETTING)) {
    return;
  }
  const caret = el.input.selectionStart ?? 0;
  if (caret === 0 || !/\s/.test(el.input.value[caret - 1])) {
    return;
  }
  const next = convertEmoticons(el.input.value);
  if (next === el.input.value) {
    return;
  }
  const moved = caret + next.length - el.input.value.length;
  el.input.value = next;
  el.input.setSelectionRange(moved, moved);
}

// A colon at the start of a word opens the emoji picker; typing on closes it again.
let colonAt = null;

function colonPicker() {
  const caret = el.input.selectionStart ?? 0;
  const value = el.input.value;
  const fresh = colonOpensPicker(value, caret);
  if (fresh && settingOn(SHORTCODE_SETTING)) {
    colonAt = caret - 1;
    openPicker(
      el.form,
      (native) => {
        if (el.input.value[colonAt] === ':') {
          insertEmoji(native, colonAt, colonAt + 1);
        }
        colonAt = null;
      },
      { focus: false },
    );
  } else if (colonAt !== null) {
    colonAt = null;
    closePicker();
  }
}

// iPhone keyboard, as the NeAI app does it: WebKit pans the whole window up when the
// keyboard opens, so hold the window at 0 and cap the page to the visible height instead.
// iOS reports passing sizes while the keyboard slides; only one that lasts reaches the layout.
const KEYBOARD_SETTLE_MS = 90;
const KEYBOARD_MIN_PX = 40;
let keyboardTimer = 0;
let keyboardPinned = false;

function fitKeyboard() {
  const vv = window.visualViewport;
  const root = document.documentElement;
  if (!vv || !root.classList.contains('ios') || vv.scale > 1.01) {
    return;
  }
  if (vv.offsetTop > 0.5) {
    window.scrollTo(0, 0);
  }
  // Taken before the slide starts moving the chat.
  if (!keyboardTimer) {
    keyboardPinned ||= stuck;
  }
  clearTimeout(keyboardTimer);
  keyboardTimer = setTimeout(() => {
    keyboardTimer = 0;
    const full = root.clientHeight;
    const up = vv.height < full - KEYBOARD_MIN_PX;
    root.classList.toggle('keyboard', up);
    // The page's own zoom scales this length too, so it is given unzoomed.
    if (up) {
      root.style.setProperty('--app-h', `${Math.round(vv.height / pageScale)}px`);
    } else {
      root.style.removeProperty('--app-h');
    }
    if (keyboardPinned) {
      stuck = true;
      toBottom();
    }
    keyboardPinned = false;
    const field = document.activeElement;
    if (up && field?.closest('dialog')) {
      requestAnimationFrame(() => field.scrollIntoView({ block: 'nearest' }));
    }
  }, KEYBOARD_SETTLE_MS);
}

// The tap on the box comes before iOS starts moving anything.
el.input.addEventListener('focus', () => (keyboardPinned = stuck || atBottom()));
window.visualViewport?.addEventListener('resize', fitKeyboard);
window.visualViewport?.addEventListener('scroll', fitKeyboard);

let fittedLength = 0;

function fitInput() {
  // Collapsing the box to measure it lays out the whole chat twice, which made typing lag in a
  // long channel: text that only grew and still fits needs no measuring.
  const length = el.input.value.length;
  const grew = length >= fittedLength;
  fittedLength = length;
  if (!(grew && el.input.scrollHeight <= el.input.clientHeight)) {
    // Measuring collapses the box for a moment, which scrolls the chat; the bottom stays the bottom.
    const pinned = atBottom();
    const css = getComputedStyle(el.input);
    const padding = Number.parseFloat(css.paddingTop) + Number.parseFloat(css.paddingBottom);
    el.input.style.height = 'auto';
    el.input.style.height = `${boxHeight(el.input.scrollHeight, Number.parseFloat(css.lineHeight), padding)}px`;
    if (pinned) {
      toBottom();
    }
  }
  renderRoom();
}

// Text set from code (sending, replies, history) resizes the box too.
const textValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
Object.defineProperty(el.input, 'value', {
  get() {
    return textValue.get.call(this);
  },
  set(v) {
    textValue.set.call(this, v);
    fitInput();
  },
});

// A phone's Return can arrive while a predicted word is still being written (iOS shows it inline),
// so keydown lets it through as composing; the line break it then asks for sends instead.
let lineBreakAsked = false;
el.input.addEventListener('beforeinput', (e) => {
  if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') {
    return;
  }
  if (lineBreakAsked) {
    lineBreakAsked = false;
    return;
  }
  e.preventDefault();
  el.form.requestSubmit();
});

el.input.addEventListener('keydown', (e) => {
  if (slashItems.length) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      slashPick = (slashPick + step + slashItems.length) % slashItems.length;
      renderSlash();
      return;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && slashItems[slashPick].enter !== false)) {
      e.preventDefault();
      slashItems[slashPick].apply();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideSlash();
      return;
    }
  }
  if (pressed(e, 'complete')) {
    e.preventDefault();
    complete();
    return;
  }
  // Enter sends, Shift+Enter starts a new line (sent as its own IRC line).
  lineBreakAsked = e.key === 'Enter' && e.shiftKey;
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    el.form.requestSubmit();
    return;
  }
  completion = null;
  if (e.key === 'Escape' && replying) {
    e.preventDefault();
    stopReply();
    return;
  }
  if (pressed(e, 'recall') && !el.input.value && lastSent) {
    e.preventDefault();
    el.input.value = lastSent;
  }
});

// Keyboard shortcuts, each one changeable in Settings. Checked before the message box sees the key.
let IS_MAC = false;
const SHORTCUT_SETTING = 'shortcuts';
const SHORTCUT_ACTIONS = [
  ['switcher', t('Find a channel')],
  ['markRead', t('Mark this channel read and go to the newest')],
  ['jumpUnread', t('Jump to the first unread')],
  ['nextUnreadChannel', t('Next channel with unread')],
  ['prevChannel', t('Previous channel')],
  ['nextChannel', t('Next channel')],
  ['channelNumber', t('Channel 1 to 9 (with a number)')],
  ['latest', t('Back to the latest')],
  ['scrollUp', t('Scroll the chat up')],
  ['scrollDown', t('Scroll the chat down')],
  ['reply', t('Reply to the last message')],
  ['highlights', t('Highlights')],
  ['shelf', t('Chat or Shelf')],
  ['people', t('People')],
  ['settings', t('Settings')],
  ['complete', t('Complete a nick')],
  ['recall', t('Bring back the last message')],
  ['textLarger', t('Larger text')],
  ['textSmaller', t('Smaller text')],
  ['textDefault', t('Default text size')],
];
let recordingShortcut = null;

function shortcuts() {
  try {
    return { ...defaultShortcuts(PLATFORM.value), ...JSON.parse(state.settings[SHORTCUT_SETTING] || '{}') };
  } catch {
    return defaultShortcuts(PLATFORM.value);
  }
}

function shortcutLabel(action) {
  const combo = shortcuts()[action];
  return action === 'channelNumber' ? comboLabel(`${combo}+1…9`, IS_MAC) : comboLabel(combo, IS_MAC);
}

function pressed(e, action) {
  return comboOf(e, IS_MAC) === shortcuts()[action];
}

const SHORTCUT_RUN = {
  switcher: () => (el.switcher.open ? el.switcher.close() : openSwitcher()),
  markRead: () => {
    markCurrentRead();
    el.jumpLatest.click();
  },
  jumpUnread: () => jumpToUnread(),
  nextUnreadChannel: () => jumpToUnreadChannel(),
  prevChannel: () => step(-1),
  nextChannel: () => step(1),
  highlights: () => (el.inbox.hidden ? openInbox() : closeInbox()),
  shelf: () => setView(shelf.open ? 'chat' : 'shelf'),
  people: () => el.pill.click(),
  settings: () => (el.settings.open ? el.settings.close() : el.gear.click()),
  latest: () => el.jumpLatest.click(),
  scrollUp: () => scrollChat(-1),
  scrollDown: () => scrollChat(1),
  reply: () => replyToLast(),
  textLarger: () => applyTextSize(textSize() + TEXT_SIZE_STEP),
  textSmaller: () => applyTextSize(textSize() - TEXT_SIZE_STEP),
  textDefault: () => applyTextSize(TEXT_SIZE_DEFAULT),
};

document.addEventListener(
  'keydown',
  (e) => {
    if (recordingShortcut) {
      return;
    }
    const combo = comboOf(e, IS_MAC);
    if (!combo) {
      return;
    }
    const keys = shortcuts();
    const action = Object.keys(SHORTCUT_RUN).find((a) => keys[a] === combo);
    const number = /^[1-9]$/.test(combo.split('+').pop()) && comboMods(combo) === keys.channelNumber && comboMods(combo) !== '';
    if (!action && !number) {
      return;
    }
    // Cmd+arrows move the cursor while there is a message to edit; channels only when it is empty.
    const editing = e.target === el.input && el.input.value !== '' && /Arrow/.test(combo) && combo.startsWith('Mod+');
    if (editing && ['prevChannel', 'nextChannel', 'latest', 'scrollUp', 'scrollDown'].includes(action)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (action) {
      SHORTCUT_RUN[action]();
    } else {
      const b = ordered()[Number(combo.split('+').pop()) - 1];
      if (b) {
        select(b.key);
      }
    }
    refreshShortcutTips();
  },
  true,
);

/** Tooltips that name a shortcut follow the current setting. */
function refreshShortcutTips() {
  el.jumpUnread.dataset.tip = t('Jump to the first unread ({key})', { key: shortcutLabel('jumpUnread') });
  for (const m of document.querySelectorAll('.sep-mark')) {
    m.dataset.tip = t('Mark as read ({key})', { key: shortcutLabel('markRead') });
  }
}

function renderShortcuts() {
  el.shortcutList.replaceChildren(
    ...SHORTCUT_ACTIONS.map(([action, label]) => {
      const row = h('div', 'shortcut-row');
      const key = h('button', 'shortcut-key', recordingShortcut === action ? t('Press keys…') : shortcutLabel(action));
      key.type = 'button';
      key.classList.toggle('recording', recordingShortcut === action);
      key.addEventListener('click', () => {
        recordingShortcut = recordingShortcut === action ? null : action;
        renderShortcuts();
      });
      row.append(h('span', null, label), key);
      return row;
    }),
  );
}

// While a shortcut is being set, the next key press is the new shortcut. Escape cancels.
document.addEventListener(
  'keydown',
  (e) => {
    if (!recordingShortcut) {
      return;
    }
    const combo = comboOf(e, IS_MAC);
    if (!combo) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (combo !== 'Escape') {
      let saved = {};
      try {
        saved = JSON.parse(state.settings[SHORTCUT_SETTING] || '{}');
      } catch {
        /* start over */
      }
      saved[recordingShortcut] = recordingShortcut === 'channelNumber' ? comboMods(combo) || 'Alt' : combo;
      saveSetting(SHORTCUT_SETTING, JSON.stringify(saved));
    }
    recordingShortcut = null;
    renderShortcuts();
    refreshShortcutTips();
  },
  true,
);

el.shortcutReset.addEventListener('click', () => {
  saveSetting(SHORTCUT_SETTING, '{}');
  recordingShortcut = null;
  renderShortcuts();
  refreshShortcutTips();
});

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.getAttribute('href') === '#') {
    return;
  }
  e.preventDefault();
  openUrl(a.href);
});

function separatorNode() {
  const sep = h('div', 'unread-sep');
  sep.setAttribute('role', 'separator');
  const mark = h('button', 'sep-mark');
  mark.type = 'button';
  mark.dataset.tip = t('Mark as read ({key})', { key: shortcutLabel('markRead') });
  mark.setAttribute('aria-label', t('Mark as read'));
  mark.innerHTML = ICONS.check;
  mark.addEventListener('click', markCurrentRead);
  sep.append(h('span', 'sep-label', t('New')), mark);
  return sep;
}

/** Messages after the read position in this channel. */
function unreadCount(b) {
  const seen = readMap[b.key];
  if (seen === undefined) {
    return 0;
  }
  return (b.unreadGap || 0) + b.lines.filter((l) => l.id > seen && CHAT_KINDS.has(l.kind) && !l.own).length;
}

function markCurrentRead() {
  const b = state.buffers.get(state.current);
  if (!b) {
    return;
  }
  markRead(b);
  flushRead();
  dropSeparator();
  view.separatorAfter = readMap[b.key] ?? lastId(b);
  updateJumps();
}

/** One person's talk split only by the New line becomes one group again once that line goes. */
function joinGroups(before, after) {
  const group = (n) => n?.classList.contains('group') && !n.classList.contains('narration') && n.dataset.nick;
  if (!group(before) || !group(after) || before.dataset.nick !== after.dataset.nick) {
    return;
  }
  const last = Number(before.dataset.last);
  const first = Number(after.dataset.first);
  if (first - last >= GROUP_GAP_MS || !sameDay(last, first)) {
    return;
  }
  const into = before.querySelector(':scope > .gb');
  const from = after.querySelector(':scope > .gb');
  for (const r of [...from.children].filter((c) => !c.classList.contains('hd'))) {
    into.append(r);
  }
  before.dataset.last = after.dataset.last;
  after.remove();
  if (view.group?.body === from) {
    view.group.body = into;
  }
}

// Removing the New line keeps what is on screen where it was.
function dropSeparator() {
  const sep = view.separator;
  view.separator = null;
  if (!sep) {
    return;
  }
  const pinned = atBottom();
  // It folds away instead of vanishing, so the lines around it slide rather than jump.
  sep.classList.add('gone');
  sep.addEventListener(
    'transitionend',
    () => {
      const before = sep.previousElementSibling;
      const after = sep.nextElementSibling;
      sep.remove();
      joinGroups(before, after);
      if (pinned) {
        toBottom();
      }
    },
    { once: true },
  );
}

// Jumping: to the channel with unread, to the "New" line, back to the latest.

function jumpToUnreadChannel() {
  const waiting = ordered().filter((b) => b.key !== state.current && wantsAttention(b));
  const next = waiting.find((b) => b.mention) || waiting[0];
  if (next) {
    select(next.key);
  }
}

/** Messages wholly under the bottom edge, counted from the end until one is in sight. */
function messagesBelow(bottom) {
  const rows = el.col.querySelectorAll('.text');
  let n = 0;
  for (let i = rows.length - 1; i >= 0 && rows[i].getBoundingClientRect().top >= bottom; i -= 1) {
    n += 1;
  }
  return n;
}

function updateJumps() {
  const b = state.buffers.get(state.current);
  const count = b ? unreadCount(b) : 0;
  // The jump shows whenever the New line is out of sight, pointing the way to it.
  const sep = view?.separator?.getBoundingClientRect();
  const log = el.log.getBoundingClientRect();
  const above = sep && sep.bottom < log.top;
  const below = sep && sep.top > log.bottom;
  // Unread lines older than what is loaded: the way to them is up.
  const unloaded = Boolean(b?.unreadGap) && !view?.separator;
  el.jumpUnread.hidden = !(count && (above || below || unloaded));
  el.jumpUnread.classList.toggle('down', Boolean(below));
  el.jumpLatest.hidden = atBottom() || glide !== 0;
  if (!el.jumpLatest.hidden) {
    // In an earlier view, the messages not drawn yet count too.
    const more = messagesBelow(log.bottom) + (b?.window ? b.windowAfter || 0 : 0);
    el.jumpLatestLabel.textContent = more ? t('{n} more', { n: more }) : t('Latest');
  }
  el.markRead.hidden = count === 0;
  // Said in words in the middle, so a busy chat at the bottom still shows what is unread.
  el.unreadCount.hidden = count === 0;
  el.unreadCount.textContent = t('{n} unread', { n: count });
  const vars = { n: count, key: shortcutLabel('markRead') };
  el.markRead.dataset.tip = count === 1 ? t('Mark {n} message read ({key})', vars) : t('Mark {n} messages read ({key})', vars);
}

el.markRead.addEventListener('click', markCurrentRead);

// The message box's emoji button: the same picker, inserting at the cursor.
el.emojiBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const start = el.input.selectionStart ?? el.input.value.length;
  const end = el.input.selectionEnd ?? start;
  openPicker(el.emojiBtn, (emoji) => {
    el.input.setRangeText(emoji, start, end, 'end');
    fitInput();
    el.input.focus();
  });
});

/** Further than this the jump is instant: a long smooth scroll drags everything on the way past. */
const SMOOTH_JUMP_SCREENS = 2;

function jumpToUnread() {
  const b = state.buffers.get(state.current);
  const sep = view?.separator;
  if (sep) {
    const far = Math.abs(sep.getBoundingClientRect().top - el.log.getBoundingClientRect().top) > el.log.clientHeight * SMOOTH_JUMP_SCREENS;
    sep.scrollIntoView({ block: 'center', behavior: far ? 'auto' : 'smooth' });
    return;
  }
  if (b?.unreadGap) {
    openUnread(b);
  }
}

/** The first unread line is not loaded: show the lines around the read marker, with the New line. */
async function openUnread(b) {
  const seen = readMap[b.key];
  const lines = await invoke('around', { net: b.net, buffer: b.name, line: seen }).catch(() => []);
  const first = lines.find((l) => l.id > seen && CHAT_KINDS.has(l.kind) && !l.own);
  if (!first || state.current !== b.key) {
    return;
  }
  b.window = lines;
  b.windowAt = first.id;
  b.windowEnd = null;
  b.windowSeparator = seen;
  renderLog();
}

el.jumpUnread.addEventListener('click', jumpToUnread);
el.unreadCount.addEventListener('click', jumpToUnread);
el.jumpLatest.addEventListener('click', () => {
  if (state.buffers.get(state.current)?.window) {
    return leaveWindow();
  }
  // Our own glide, which a channel switch stops; a native smooth scroll would carry on into the next channel.
  glideDown();
});

let jumpFrame = 0;
// A resize of the chat or of what is in it (a photo loading) keeps the latest message in view
// when it was in view before.
let stuck = true;
// Away from the bottom, a picture or card loading above what you read must not push it away:
// WebKit has no scroll anchoring of its own, so the line at the top of the view is held in place.
let anchor = null;
let lastTop = 0;

// Found by rows, not by what is under a point: a floating pill there would hide the line.
function noteAnchor() {
  anchor = topSpot();
  if (anchor) {
    anchor.at = el.log.scrollTop;
  }
}

function holdAnchor() {
  // Moved since it was noted (a jump to a highlight, a page key) and no scroll event yet: that place is the new one.
  if (anchor?.at !== el.log.scrollTop) {
    return noteAnchor();
  }
  toSpot(anchor);
  anchor.at = el.log.scrollTop;
}

// Moving the chat by hand, so leaving a channel measures where it is again.
let movedByHand = false;
for (const kind of ['wheel', 'touchmove', 'pointerdown']) {
  el.log.addEventListener(kind, () => (movedByHand = true), { passive: true });
}
const stayDown = new ResizeObserver(() => {
  if (actionPanel || aimHeld) {
    return;
  }
  if (glide) {
    return;
  }
  if (stuck) {
    toBottom();
  } else {
    holdAnchor();
  }
});
stayDown.observe(el.log);
// Scrolling by hand takes over from a glide.
el.log.addEventListener('wheel', stopGlide, { passive: true });
el.log.addEventListener('touchstart', stopGlide, { passive: true });
stayDown.observe(el.col);

el.log.addEventListener(
  'scroll',
  () => {
    // Pictures and cards growing under a chat that follows the newest do not stop it following;
    // only moving it up does.
    stuck = atBottom() || glide !== 0 || (stuck && el.log.scrollTop >= lastTop);
    lastTop = el.log.scrollTop;
    noteAnchor();
    cancelAnimationFrame(jumpFrame);
    jumpFrame = requestAnimationFrame(() => {
      updateJumps();
    });
  },
  { passive: true },
);

// Start

function applyStatus(st) {
  // Settings can arrive later than the app starts (lobby-server connecting), so polling starts here.
  queueMicrotask(pollNowPlaying);
  // A network removed from the server takes its windows with it.
  const nets = new Set(st.networks.map((n) => n.name));
  if (nets.size) {
    for (const [k, b] of state.buffers) {
      if (!nets.has(b.net)) {
        state.buffers.delete(k);
      }
    }
    if (state.current && !state.buffers.has(state.current)) {
      state.current = null;
      pickFirst();
    }
  }
  if (st.platform !== PLATFORM.value) {
    PLATFORM.value = st.platform;
    IS_MAC = st.platform === 'macos';
    document.documentElement.classList.toggle('mac', IS_MAC);
    document.documentElement.classList.toggle('ios', st.platform === 'ios');
    applyTextSize(textSize());
    if (IS_MAC) {
      offerNotifyGuide();
    }
    // iPhone pauses Lobby in the background, so the Allow prompt cannot wait for a first notification;
    // the badge on the icon needs the same permission.
    if (st.platform === 'ios' && notifyOn() && notifier) {
      notifier
        .isPermissionGranted()
        .then((granted) => granted || notifier.requestPermission())
        .catch(() => {});
    }
  }
  state.networks = st.networks.map((n) => n.name);
  state.configPath = st.config_path;
  state.serverUploads = Boolean(st.uploads);
  for (const n of st.networks) {
    state.conn[n.name] = n.state;
    if (n.nick) {
      state.me[n.name] = n.nick;
    }
    if (n.mask) {
      state.masks[n.name] = n.mask;
    }
  }
  state.people = st.people || [];
  state.settings = st.settings || {};
  loadHighlightsSoon();
  refreshShortcutTips();
  renderAttach();
  applyReadSetting(state.settings[READ_SETTING]);
  for (const info of st.channels) {
    onBuffer(info);
  }
  syncQuit();
  state.setupError = st.error && !st.networks.length ? st.error : null;
  if (st.error && st.networks.length) {
    showToast(st.error);
  }
  renderStatus();
  // Nothing set up yet, like on a phone's first start: the welcome.
  if (st.error && !st.networks.length && !el.connection.open && !el.welcome.open) {
    openWelcome();
  }
}

// The page's own text names the app; a fork renames it there once.
if (BRAND.name !== 'Lobby') {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    node.nodeValue = node.nodeValue.replace(/\bLobby\b/g, BRAND.name);
  }
  for (const node of document.querySelectorAll('[aria-label*="Lobby"]')) {
    node.setAttribute('aria-label', node.getAttribute('aria-label').replace(/\bLobby\b/g, BRAND.name));
  }
}

// Onboarding: the welcome on a first start, then a checklist over the chat until it is done or hidden.
const START_NETWORKS = [
  ['QuakeNet', 'irc.quakenet.org'],
  ['IRCnet', 'open.ircnet.net'],
  ['Libera.Chat', 'irc.libera.chat'],
];
const OTHER_SERVER = 'Other server';
const IRC_PORT = 6667;
const NICK_RE = /^[A-Za-z[\]\\`_^{|}][\w[\]\\`^{|}-]*$/;
const JOIN_AFTER_KEY = 'lobby.joinAfterSetup';
const CHECKLIST_KEY = 'lobby.checklist';
const CHECK_OPEN =
  '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.6"/></svg>';
const CHECK_DONE =
  '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="var(--mention)"/><path d="M7.5 12.5l3 3 6-6.5" stroke="var(--bg)" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
let welcomeWay = 'irc';
let welcomeNet = BRAND.start?.network ?? START_NETWORKS[0][0];

function openWelcome() {
  // The welcome is not a chat loading: no lamp in front of it, and none on the next start either.
  splashDone = true;
  storeFlag(CHAT_SHOWN_KEY, '');
  for (const node of [el.splash, el.splashLight, el.splashLamp]) {
    node.remove();
  }
  // Finnish puts the name in its own case: Tervetuloa Lobbyyn.
  const app = currentLang() === 'fi' ? (BRAND.fiInto ?? BRAND.name) : BRAND.name;
  $('welcome-title').textContent = BRAND.welcome ? t(BRAND.welcome) : t('Welcome to {app}', { app });
  if (BRAND.startNote) {
    el.welcome.querySelector('[data-way="irc"] span').textContent = t(BRAND.startNote);
  }
  el.welcome.showModal();
  if (!SHEET) {
    showWelcomeStep('ways');
    return;
  }
  $('welcome-other-ways').hidden = ONLY;
  el.welcomeQuick.querySelector('h1').textContent = $('welcome-title').textContent;
  el.welcomeQuick.querySelector('.welcome-lead').textContent = t(BRAND.startNote ?? '');
  openQuickStart();
  showPeek();
  showAccountChoice();
}

/** The channel's latest talk, blurred behind the welcome: it is already going on. */
async function showPeek() {
  const real = await invoke('backlog_peek').catch(() => []);
  // Made-up talk only sets the mood: nobody is counted as chatting now.
  const lines = real.length ? real : (BRAND.peek ?? []).map(([nick, text]) => ({ nick, text, ts: 0 }));
  $('welcome-peek').replaceChildren(
    ...lines.map((l) => {
      const row = h('div', 'peek-line');
      const nick = h('b', null, l.nick);
      nick.style.color = nickColor(l.nick);
      row.append(nick, h('span', null, stripFormatting(l.text)));
      return row;
    }),
  );
  showTalking(real);
}

/** Who spoke in the channel lately, as the header's people pill shows them. */
function showTalking(lines) {
  const now = Date.now();
  const speakers = (within) => [
    ...new Set(
      lines
        .filter((l) => now - l.ts < within)
        .map((l) => l.nick)
        .reverse(),
    ),
  ];
  const recent = speakers(TALKING_MS);
  const shown = recent.length ? recent : speakers(Number.POSITIVE_INFINITY);
  const box = $('welcome-talking');
  box.hidden = !shown.length;
  if (!shown.length) {
    return;
  }
  const faces = h('span', 'pill-faces');
  faces.append(...shown.slice(0, PILL_FACES).map((n) => avatar(n, '')));
  const text = recent.length ? t('{count} chatting now', { count: recent.length }) : t('Talked last');
  const label = h('span');
  label.append(h('span', 'talking-dot'), text);
  box.replaceChildren(label, faces);
}

function showNickFace() {
  const nick = el.welcomeNick.value.trim();
  $('welcome-nick-face').replaceChildren(...(nick ? [avatar(nick, '')] : []));
  $('welcome-nick-go').disabled = !nick;
  if (ONLY) {
    el.welcomeNick.style.color = nick ? identity(nick, '').color : '';
  }
}

el.welcomeNick.addEventListener('input', () => {
  $('welcome-claimed').hidden = true;
  showNickFace();
});

function openQuickStart() {
  renderWelcomeNets();
  el.welcomeChans.value ||= BRAND.start?.channels ?? '';
  showWelcomeStep('quick');
  showNickFace();
  el.welcomeNick.focus();
}

// A fork's own accounts (BRAND.accounts): apply in the welcome, get an always-on connection
// once an admin approves. The app keeps only a waiting key, never the password.
const ACCOUNT_WAITING_KEY = 'lobby.accountWaiting';
const ACCOUNT_CHECK_MS = 2 * 60 * 1000;
// QuakeNet cuts the ident to 10 characters; the nick keeps the whole name.
const IDENT_MAX = 10;
const ACCOUNT_ERRORS = {
  taken: 'That account is already taken.',
  bad_name: 'An account can have letters, digits, - and _.',
  bad_email: 'Check the email address.',
  short_password: 'The password needs at least 10 characters.',
  weak_password: 'That password is too easy to guess.',
  name_in_password: "The password can't contain the account name.",
  breached_password: 'This password has turned up in a data breach. Pick another one.',
  locked: 'Too many wrong tries. Try again in 15 minutes.',
  no_shell: 'No shell account with that name is set up for the app. Ask the admins.',
  expired: 'The code ran out. Press Continue for a new one.',
  busy: 'Too many applications are waiting right now. Try again later.',
  wrong: 'Wrong account or password.',
};
// zxcvbn scores 0-4; 3 is the least the form takes. It guesses like a cracker would, against
// common passwords, names, words, dates and keyboard runs, in English and Finnish.
const PASSWORD_MIN = 10;
const PASSWORD_OK_SCORE = 3;
const PASSWORD_LEVELS = ['Weak', 'Weak', 'Weak', 'Okay', 'Strong'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let passwordCheck = null;

/** The estimator, loaded only when someone starts typing a password: its word lists are large. */
async function passwordEstimator() {
  passwordCheck ??= import('./vendor/zxcvbn.js').then((m) => m.estimator(t));
  return passwordCheck;
}

/** Score, verdict and what to fix for the password in a form: `form` is the ids' prefix. */
async function judgePassword(form) {
  const password = $(`${form}-password`).value;
  const account = $(`${form}-account`).value.trim().toLowerCase();
  if (!password) {
    return { score: -1, text: t('At least 10 characters. A longer one is better.') };
  }
  if (account && password.toLowerCase().includes(account)) {
    return { score: 0, text: t("The password can't contain the account name.") };
  }
  const est = await passwordEstimator();
  const hints = [account, $('apply-email')?.value, $('apply-known')?.value, BRAND.accounts?.host, BRAND.name].filter(Boolean);
  const r = est.check(password, hints);
  const score = password.length < PASSWORD_MIN ? Math.min(r.score, 1) : r.score;
  const level = t(PASSWORD_LEVELS[score]);
  if (password.length < PASSWORD_MIN) {
    return { score, text: `${level} · ${t('Characters still missing: {n}.', { n: PASSWORD_MIN - password.length })}` };
  }
  const time = r.crackTimes.offlineSlowHashingXPerSecond.display;
  if (score === PASSWORD_OK_SCORE) {
    return { score, text: `${level} · ${t('A longer one would be even better.')}` };
  }
  const why =
    score > PASSWORD_OK_SCORE
      ? t('Guessing it would take {time}.', { time })
      : r.feedback.warning || t('Guessing it would take only {time}.', { time });
  return { score, text: `${level} · ${why}` };
}

async function renderPasswordMeter(form) {
  const verdict = await judgePassword(form);
  const meter = $(`${form}-meter`);
  meter.dataset.level = String(verdict.score < 0 ? 0 : verdict.score < PASSWORD_OK_SCORE ? Math.max(1, verdict.score) : verdict.score);
  meter.classList.toggle('ok', verdict.score >= PASSWORD_OK_SCORE);
  $(`${form}-verdict`).textContent = verdict.text;
  return verdict;
}

/** The meter, the tip and Show/Hide for one form's password field. */
function wirePassword(form) {
  $(`${form}-password`).addEventListener('input', () => {
    $(`${form}-tip`).hidden = false;
    renderPasswordMeter(form);
  });
  $(`${form}-show`).addEventListener('click', () => {
    const field = $(`${form}-password`);
    const shown = field.type === 'text';
    field.type = shown ? 'password' : 'text';
    $(`${form}-show`).textContent = t(shown ? 'Show' : 'Hide');
  });
}

/** Refuses a password the meter calls weak, with the reason in `box`. */
async function passwordOk(form, box) {
  const verdict = await renderPasswordMeter(form);
  if (verdict.score >= PASSWORD_OK_SCORE) {
    return true;
  }
  const error = $(`${form}-password`).value.length < PASSWORD_MIN ? 'short_password' : 'weak_password';
  accountError(box, { error });
  return false;
}

function accountWaiting() {
  try {
    return JSON.parse(storedFlag(ACCOUNT_WAITING_KEY) || 'null');
  } catch {
    return null;
  }
}

function showAccountChoice() {
  const acc = BRAND.accounts;
  if (!acc) {
    return;
  }
  const host = acc.host;
  $('welcome-account-links').hidden = false;
  $('signin-shell').hidden = !acc.shell;
  $('accounts-title').textContent = acc.title;
  $('accounts-lead').textContent = acc.lead;
  $('accounts-own-title').textContent = t('Own {host} account', { host });
  $('accounts-mask-line').textContent = t('Others see you as nick!account@{host}, your own address stays hidden', { host });
  // "pulina.fi-tunnus" must not break at its hyphen: a non-breaking one keeps it whole.
  const whole = (text) => text.replaceAll(`${host}-`, `${host}\u2011`);
  $('welcome-account-link').textContent = whole(t('I want a {host} account', { host }));
  $('apply-title').textContent = whole(t('Apply for a {host} account', { host }));
  $('signin-title').textContent = whole(t('Sign in with your {host} account', { host }));
  $('shell-title').textContent = whole(t('Sign in with your {host} shell', { host }));
  $('accounts-shell').hidden = !acc.shell;
  showApplied();
}

function showApplied() {
  const waiting = accountWaiting();
  $('welcome-applied').hidden = !waiting;
  if (waiting) {
    $('welcome-applied-text').textContent = t('When the admins approve it, the app signs in with your account by itself.');
    el.welcomeQuick.querySelector('h1').textContent = t('Join directly in the meantime');
  }
}

$('welcome-account-link').addEventListener('click', () => showWelcomeStep('accounts'));
$('welcome-have-account').addEventListener('click', () => openSignin('account', ''));
$('signin-shell').addEventListener('click', () => openSignin('shell', $('signin-account').value.trim()));

/** Sign-in with an account or a shell, straight from the first view; Back returns there. */
function openSignin(kind, nick) {
  const step = kind === 'shell' ? 'shell' : 'signin';
  showWelcomeStep(step);
  $(`welcome-${step}`).querySelector('.step-back').dataset.back = 'quick';
  $(`${step}-account`).value = nick;
  (nick && kind !== 'shell' ? $('signin-password') : $(`${step}-account`)).focus();
}

/** A nick that is someone's account: offer to sign in with it instead of joining under it. */
async function claimedNick(nick) {
  if (!BRAND.accounts) {
    return null;
  }
  const who = await invoke('account_call', { action: 'who', body: { account: nick.toLowerCase() } }).catch(() => null);
  return who?.kind ?? null;
}

$('welcome-claimed-other').addEventListener('click', () => {
  $('welcome-claimed').hidden = true;
  el.welcomeNick.select();
  el.welcomeNick.focus();
});
$('accounts-direct').addEventListener('click', () => {
  showWelcomeStep('quick');
  el.welcomeNick.focus();
});
$('accounts-apply').addEventListener('click', () => {
  showWelcomeStep('apply');
  $('apply-account').focus();
});
$('accounts-shell').addEventListener('click', () => {
  showWelcomeStep('shell');
  $('welcome-shell').querySelector('.step-back').dataset.back = 'accounts';
  $('shell-account').focus();
});
$('accounts-signin').addEventListener('click', () => {
  showWelcomeStep('signin');
  $('welcome-signin').querySelector('.step-back').dataset.back = 'accounts';
  $('signin-account').focus();
});
$('apply-account').addEventListener('input', () => {
  const name = $('apply-account').value.trim().toLowerCase();
  $('apply-mask').textContent = name
    ? t('Others see you like this: {mask}', { mask: `${name}!${name.slice(0, IDENT_MAX)}@${BRAND.accounts.host}` })
    : '';
});

function accountError(box, answer) {
  box.hidden = false;
  box.textContent = t(ACCOUNT_ERRORS[answer?.error] ?? 'Sending the application failed. Try again in a moment.');
}

wirePassword('apply');

$('welcome-apply').addEventListener('submit', async (e) => {
  e.preventDefault();
  const account = $('apply-account').value.trim().toLowerCase();
  const email = $('apply-email').value.trim();
  if (!EMAIL_RE.test(email)) {
    return accountError($('apply-error'), { error: 'bad_email' });
  }
  if (!(await passwordOk('apply', $('apply-error')))) {
    return;
  }
  const body = { account, email, password: $('apply-password').value, known: $('apply-known').value.trim() };
  const answer = await invoke('account_call', { action: 'apply', body }).catch(() => null);
  if (answer?.status !== 'pending') {
    return accountError($('apply-error'), answer);
  }
  storeFlag(ACCOUNT_WAITING_KEY, JSON.stringify({ account, check: answer.check }));
  showApplied();
  showWelcomeStep('quick');
});

$('welcome-signin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const account = $('signin-account').value.trim().toLowerCase();
  const answer = await invoke('account_call', { action: 'status', body: { account, password: $('signin-password').value } }).catch(
    () => null,
  );
  if (answer?.status !== 'approved') {
    return accountError($('signin-error'), answer?.error ? answer : { error: 'wrong' });
  }
  useAccount(account, answer);
});

// A shell user needs no password: pulina-verify, run in their shell, proves who they are on
// each device. The app waits for it here.
const SHELL_POLL_MS = 2500;
let shellPoll = null;

function stopShellWait() {
  clearInterval(shellPoll);
  shellPoll = null;
  $('shell-proof').hidden = true;
  $('shell-go').hidden = false;
}

$('shell-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('shell-command').textContent);
    $('shell-copy').textContent = t('Copied');
  } catch {
    getSelection().selectAllChildren($('shell-command'));
  }
});

$('welcome-shell').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('shell-error');
  error.hidden = true;
  const account = $('shell-account').value.trim().toLowerCase();
  if (shellPoll || !account) {
    return;
  }
  const answer = await invoke('account_call', { action: 'shell', body: { account } }).catch(() => null);
  if (!answer?.code) {
    return accountError(error, answer);
  }
  $('shell-command').textContent = `pulina-verify ${answer.code}`;
  $('shell-copy').textContent = t('Copy');
  $('shell-proof').hidden = false;
  $('shell-go').hidden = true;
  shellPoll = setInterval(async () => {
    if ($('welcome-shell').hidden) {
      return stopShellWait();
    }
    const state = await invoke('account_call', { action: 'shell/check', body: { account, code: answer.code } }).catch(() => null);
    if (state?.status === 'approved') {
      stopShellWait();
      useAccount(account, state);
    } else if (state?.error) {
      stopShellWait();
      accountError(error, state);
    }
  }, SHELL_POLL_MS);
});

$('signin-forgot').addEventListener('click', async () => {
  const account = $('signin-account').value.trim().toLowerCase();
  const note = $('signin-note');
  note.hidden = false;
  if (!account) {
    note.textContent = t('Write your account name first.');
    $('signin-account').focus();
    return;
  }
  await invoke('account_call', { action: 'forgot', body: { account } }).catch(() => null);
  note.textContent = t('If the account has an email address, a link for a new password is on its way there.');
});

$('welcome-cancel-apply').addEventListener('click', async () => {
  const waiting = accountWaiting();
  if (waiting) {
    await invoke('account_call', { action: 'cancel', body: waiting }).catch(() => {});
  }
  storeFlag(ACCOUNT_WAITING_KEY, '');
  el.welcomeQuick.querySelector('h1').textContent = $('welcome-title').textContent;
  showApplied();
});

/** An approved account: from now on the app talks to that account's always-on connection. */
async function useAccount(account, answer) {
  renderStatus(t('Your account {account} is approved. Connecting to the always-on connection…', { account }));
  const connection = {
    mode: 'url',
    ssh: '',
    ssh_port: null,
    port: null,
    url: answer.url,
    token: answer.token,
    nick: account,
    networks: [],
    key_line: '',
  };
  try {
    await invoke('save_connection', { connection });
    storeFlag(ACCOUNT_WAITING_KEY, '');
    storeFlag(CHAT_SHOWN_KEY, '1');
    location.reload();
  } catch (err) {
    renderStatus(String(err));
  }
}

/** While an application waits, ask now and then; the app moves over by itself once approved. */
async function checkApplication() {
  const waiting = accountWaiting();
  if (!waiting || !BRAND.accounts) {
    return;
  }
  const answer = await invoke('account_call', { action: 'status', body: waiting }).catch(() => null);
  if (answer?.status === 'approved') {
    useAccount(waiting.account, answer);
  } else if (answer?.status === 'rejected' || answer?.error === 'wrong') {
    storeFlag(ACCOUNT_WAITING_KEY, '');
    renderStatus(t('Your application was not approved. You can still join directly.'));
  }
}

setTimeout(checkApplication, 5000);
setInterval(checkApplication, ACCOUNT_CHECK_MS);

const WELCOME_STEPS = ['ways', 'quick', 'rules', 'notify', 'photo', 'accounts', 'apply', 'signin', 'shell'];

function showWelcomeStep(step) {
  for (const name of WELCOME_STEPS) {
    $(`welcome-${name}`).hidden = name !== step;
  }
  // The channel's talk shows only behind the nick; the later steps fill the window.
  $('welcome-peek').hidden = step !== 'quick';
  el.welcome.scrollTop = 0;
}

for (const b of el.welcome.querySelectorAll('.way')) {
  b.addEventListener('click', () => {
    welcomeWay = b.dataset.way;
    for (const other of el.welcome.querySelectorAll('.way')) {
      other.setAttribute('aria-checked', String(other === b));
    }
  });
}

el.welcomeNext.addEventListener('click', async () => {
  storeFlag(CHECKLIST_KEY, 'show');
  if (welcomeWay === 'irc') {
    // Chosen from the other ways: the full form, with every network and channels.
    if (!ONLY) {
      document.documentElement.removeAttribute('data-sheet');
    }
    openQuickStart();
    return;
  }
  el.welcome.close();
  await openConnection();
  setConnectionMode(welcomeWay);
});
el.welcomeBack.addEventListener('click', () => showWelcomeStep('ways'));

function renderWelcomeNets() {
  const names = [...START_NETWORKS.map(([name]) => name), OTHER_SERVER];
  el.welcomeNets.replaceChildren(
    ...names.map((name) => {
      const b = h('button', null, name === OTHER_SERVER ? t(OTHER_SERVER) : name);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(name === welcomeNet));
      b.addEventListener('click', () => {
        welcomeNet = name;
        renderWelcomeNets();
      });
      return b;
    }),
  );
  el.welcomeHost.hidden = welcomeNet !== OTHER_SERVER;
}

el.welcomeQuick.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nick = el.welcomeNick.value.trim();
  // A fork may name its network after itself: BRAND.start.host says where it really is.
  const own = BRAND.start?.host && [BRAND.start.network, BRAND.start.host];
  const preset = START_NETWORKS.find(([name]) => name === welcomeNet) ?? (welcomeNet === own?.[0] ? own : null);
  // Another server may name its port: irc.example.org:6697.
  const [host, port] = preset ? [preset[1]] : el.welcomeHost.value.trim().split(':');
  const problem = !NICK_RE.test(nick)
    ? t('Pick a nick that starts with a letter: letters, digits and - _ after it.')
    : host
      ? null
      : t('Write the server address.');
  el.welcomeError.hidden = !problem;
  el.welcomeError.textContent = problem || '';
  if (problem) {
    return;
  }
  const claimed = await claimedNick(nick);
  $('welcome-claimed').hidden = !claimed;
  if (claimed) {
    const host = BRAND.accounts.host;
    // Never which kind: naming shell users would hand out server login names.
    $('welcome-claimed-title').textContent = t('{nick} is a {host} account.', { nick, host });
    const signin = $('welcome-claimed-signin');
    signin.textContent = t('Sign in as {nick} →', { nick });
    signin.onclick = () => openSignin('account', nick);
    return;
  }
  const name = preset ? preset[0] : host;
  const connection = {
    mode: 'irc',
    ssh: '',
    ssh_port: null,
    port: null,
    url: '',
    token: '',
    nick,
    networks: [{ name, host, port: Number(port) || IRC_PORT, password: null, password_file: null }],
    key_line: '',
  };
  const channels = el.welcomeChans.value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((c) => (isChannel(c) ? c : `#${c}`));
  onboarding = { connection, plan: { net: name, channels, nick } };
  // A one-channel fork walks through its rules, notifications and a picture first.
  if (ONLY) {
    showRules();
    return;
  }
  finishWelcome();
});

let onboarding = null;

async function finishWelcome() {
  try {
    await invoke('save_connection', { connection: onboarding.connection });
    if (onboarding.plan.photo) {
      shareOwnPhoto(onboarding.plan.photo);
    }
    storeFlag(JOIN_AFTER_KEY, JSON.stringify(onboarding.plan));
    storeFlag(CHAT_SHOWN_KEY, '1');
    location.reload();
  } catch (err) {
    showWelcomeStep('quick');
    el.welcomeError.hidden = false;
    el.welcomeError.textContent = String(err);
  }
}

function showRules() {
  const rules = BRAND.rules;
  if (!rules) {
    showNotifyStep();
    return;
  }
  $('rules-title').textContent = rules.title;
  $('rules-intro').textContent = rules.intro;
  $('rules-link').href = rules.link;
  $('rules-list').replaceChildren(
    ...rules.items.map(({ title, body }) => {
      const item = h('li');
      item.append(h('b', null, title));
      if (body) {
        item.append(h('span', null, body));
      }
      return item;
    }),
  );
  showWelcomeStep('rules');
  const box = $('rules-scroll');
  box.scrollTop = 0;
  rulesRead();
}

/** Like terms of service: accepting waits until the list has been scrolled to its end. */
function rulesRead() {
  const box = $('rules-scroll');
  const end = box.scrollTop + box.clientHeight >= box.scrollHeight - RULES_END_SLACK_PX;
  $('rules-more').hidden = end;
  if (end) {
    $('rules-accept').disabled = false;
  }
}

const RULES_END_SLACK_PX = 8;
$('rules-scroll').addEventListener('scroll', rulesRead, { passive: true });

function showNotifyStep() {
  showWelcomeStep('notify');
}

function showPhotoStep() {
  const nick = onboarding.connection.nick;
  $('welcome-photo-nick').textContent = nick;
  $('welcome-photo-lead').textContent = t(
    'People using {app} or Lobby see it next to your messages. Other IRC programs show just your nick. Without a picture you get an animal.',
    { app: BRAND.name },
  );
  const face = $('welcome-photo-face');
  face.replaceChildren(onboarding.plan.photo ? image(onboarding.plan.photo) : avatar(nick, ''), h('span', 'photo-badge'));
  face.lastChild.append(svg(onboarding.plan.photo ? CAMERA_ICON : DICE_ICON));
  face.setAttribute('aria-label', onboarding.plan.photo ? t('Use an animal instead') : t('Another animal'));
  $('welcome-photo-hint').textContent = onboarding.plan.photo
    ? t('Tap the picture to go back to an animal')
    : t('Tap the animal for another one');
  showWelcomeStep('photo');
}

$('rules-accept').addEventListener('click', showNotifyStep);
// Back a step; the rules once read stay accepted.
for (const b of el.welcome.querySelectorAll('.step-back')) {
  b.addEventListener('click', () => {
    if (b.dataset.back === 'rules') {
      showWelcomeStep('rules');
      return;
    }
    showWelcomeStep(b.dataset.back);
    if (b.dataset.back === 'quick') {
      el.welcomeNick.focus();
    }
  });
}
$('welcome-notify').addEventListener('submit', (e) => {
  e.preventDefault();
  onboarding.plan.words = $('welcome-words').value.trim();
  askToNotify();
  showPhotoStep();
});
$('notify-later').addEventListener('click', () => {
  onboarding.plan.words = $('welcome-words').value.trim();
  showPhotoStep();
});
$('welcome-photo-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (file) {
    onboarding.plan.photo = await photoFrom(file).catch(() => '');
    showPhotoStep();
  }
});
$('welcome-photo-face').addEventListener('click', async () => {
  if (onboarding.plan.photo) {
    delete onboarding.plan.photo;
    showPhotoStep();
    return;
  }
  const face = $('welcome-photo-face').firstChild;
  onboarding.plan.animal = await rollAnimal(face);
});
$('welcome-photo').addEventListener('submit', (e) => {
  e.preventDefault();
  finishWelcome();
});
$('photo-skip').addEventListener('click', () => {
  delete onboarding.plan.photo;
  finishWelcome();
});

const NICK_WAIT_MS = 5000;
let nickTakenNet = null;

function openNickTaken(net, wanted, now) {
  nickTakenNet = net;
  $('nick-taken-title').textContent = t('{nick} is taken', { nick: wanted });
  $('nick-taken-text').textContent = t('Someone already uses {nick}, so for now you are {now}. Pick a nick of your own.', {
    nick: wanted,
    now,
  });
  $('nick-taken-keep').textContent = t('Keep {now}', { now });
  $('nick-taken-error').hidden = true;
  $('nick-taken-field').value = '';
  $('nick-taken').showModal();
  $('nick-taken-field').focus();
}

/** Resolves true once the network confirms the new nick, false if it did not take it in time. */
function nickTaken(net, nick) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (state.me[net]?.toLowerCase() === nick.toLowerCase()) {
        return resolve(true);
      }
      if (Date.now() - start > NICK_WAIT_MS) {
        return resolve(false);
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}

$('nick-taken-keep').addEventListener('click', () => {
  invoke('remember_nick', { nick: state.me[nickTakenNet] }).catch(() => {});
  $('nick-taken').close();
});
$('nick-taken-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nick = $('nick-taken-field').value.trim();
  const error = $('nick-taken-error');
  const say = (text) => {
    error.textContent = text;
    error.hidden = !text;
  };
  if (!NICK_RE.test(nick)) {
    return say(t('Pick a nick that starts with a letter: letters, digits and - _ after it.'));
  }
  const net = nickTakenNet;
  $('nick-taken-go').disabled = true;
  await invoke('send', { net, buffer: '', text: `/nick ${nick}` }).catch((err) => say(String(err)));
  const ok = await nickTaken(net, nick);
  $('nick-taken-go').disabled = false;
  if (!ok) {
    return say(t('{nick} is taken too. Try another one.', { nick }));
  }
  invoke('remember_nick', { nick }).catch(() => {});
  $('nick-taken').close();
});

/** The channels picked in the welcome, joined once the network first answers. */
function joinAfterSetup(net) {
  let plan = null;
  try {
    plan = JSON.parse(storedFlag(JOIN_AFTER_KEY));
  } catch {
    /* nothing planned */
  }
  if (plan?.net !== net) {
    return;
  }
  try {
    localStorage.removeItem(JOIN_AFTER_KEY);
  } catch {
    /* joined once anyway */
  }
  askToNotify();
  // Someone had the nick: the server gave a stand-in, so ask for one of the person's own.
  const now = state.me[net];
  if (plan.nick && now && now.toLowerCase() !== plan.nick.toLowerCase()) {
    openNickTaken(net, plan.nick, now);
  }
  // What the welcome asked for, kept until there was somewhere to save it.
  if (plan.words) {
    saveSetting(NOTIFY_WORDS_SETTING, plan.words);
  }
  if (plan.animal) {
    saveSetting(ANIMAL_SETTING, plan.animal);
  }
  const me = state.me[net];
  if (plan.photo && me) {
    invoke('save_person', { person: { id: 0, name: me, color: '', photo: plan.photo, nicks: [me] } }).catch((err) =>
      renderStatus(String(err)),
    );
  }
  if (plan.channels.length) {
    openWhenJoined = key(net, plan.channels[0]);
    invoke('send', { net, buffer: '', text: `/join ${plan.channels.join(',')}` }).catch((err) => renderStatus(String(err)));
  }
}

function openSettingsTab(tab) {
  el.switcher.close();
  renderSettings();
  showSettingsTab(tab);
  el.settings.showModal();
}

function checklistItems() {
  const net = state.networks[0];
  const me = state.me[net];
  return [
    { label: net ? t('Connect to {network}', { network: net }) : t('Connect'), done: Object.values(state.conn).includes('connected') },
    { label: t('Join a channel'), done: [...state.buffers.values()].some((b) => isChannel(b.name)), go: openSwitcher },
    { label: t('Add your photo'), done: Boolean(me && identity(me).photo), go: () => me && openPerson(me) },
    { label: t('Turn on notifications'), done: notifyOn() && notifyAllowed === true, go: () => openSettingsTab('notifications') },
    { label: t('Pick your highlight words'), done: highlightWords().length > 0, go: () => openSettingsTab('notifications') },
  ];
}

let checklistShown = '';

function renderChecklist() {
  const items = storedFlag(CHECKLIST_KEY) === 'show' ? checklistItems() : [];
  const done = items.filter((item) => item.done).length;
  const shown = items.map((item) => item.label + item.done).join();
  el.checklist.hidden = !items.length || done === items.length;
  if (el.checklist.hidden || shown === checklistShown) {
    return;
  }
  checklistShown = shown;
  el.checklistCount.textContent = t('{done} of {total}', { done, total: items.length });
  el.checklistFill.style.width = `${(done / items.length) * 100}%`;
  el.checklistItems.replaceChildren(
    ...items.map((item) => {
      const b = h('button', 'check-item');
      b.type = 'button';
      b.disabled = item.done || !item.go;
      b.append(svg(item.done ? CHECK_DONE : CHECK_OPEN), h('span', null, item.label));
      if (item.go) {
        b.addEventListener('click', item.go);
      }
      return b;
    }),
  );
}

el.checklistHide.addEventListener('click', () => {
  storeFlag(CHECKLIST_KEY, 'hidden');
  renderChecklist();
});

// Connection setup: the same choices on every device, saved to the config file.

const PROJECT_LINKS = {
  [BRAND.name]: BRAND.site,
  'lobby-server': 'https://github.com/rollecode/lobby#lobby-server',
};

/** The text with the first mention of the app and of lobby-server linked to the project. */
function linkNames(text) {
  const linked = new Set();
  return text.split(new RegExp(`(lobby-server|${BRAND.name})`)).map((part) => {
    if (!PROJECT_LINKS[part] || linked.has(part)) {
      return part;
    }
    linked.add(part);
    const a = h('a', null, part);
    a.href = PROJECT_LINKS[part];
    return a;
  });
}

const CONNECTION_ABOUT = {
  ssh: t(
    '{app} signs in to the machine where lobby-server runs and reaches it from there. Your whole history, and nothing on the server is opened to the internet.',
    { app: BRAND.name },
  ),
  url: t('lobby-server behind a web server with TLS, at an address of its own. Your whole history.'),
  irc: t('{app} connects to IRC servers or irssiproxy itself. History only covers the time {app} is open.', { app: BRAND.name }),
};
let connectionMode = 'ssh';
/** The way Lobby is connected now, as saved; the dialog's tabs may show another. */
let activeMode = null;

/** Connected or not, for the tab on show: only the mode in use can be connected. */
function connectionStatus(mode) {
  if (state.setupError || mode !== activeMode) {
    return { ok: false, text: t('Not connected') };
  }
  if (mode !== 'irc') {
    const unreachable = state.serverDown || (state.networks.length && state.networks.every((n) => state.conn[n] === UNREACHABLE));
    if (unreachable) {
      return { ok: false, text: state.serverDown ? t('Not connected: {reason}', { reason: state.serverDown }) : t('Not connected') };
    }
    return { ok: true, text: t('Connected to lobby-server') };
  }
  const up = state.networks.filter((n) => state.conn[n] === 'connected');
  if (!up.length) {
    return { ok: false, text: t('Not connected') };
  }
  if (up.length === state.networks.length) {
    return { ok: true, text: t('Connected') };
  }
  const down = state.networks.filter((n) => !up.includes(n)).join(', ');
  return { ok: true, text: t('Connected to {up}, not to {down}', { up: up.join(', '), down }) };
}

function renderConnectionStatus() {
  const c = connectionStatus(connectionMode);
  el.connectionState.dataset.ok = String(c.ok);
  el.connectionStateText.textContent = c.text;
}

async function openConnection() {
  splashReady();
  const c = await invoke('get_connection');
  el.connSsh.value = c.ssh;
  el.connSshPort.value = c.ssh_port ?? '';
  el.connPort.value = c.port ?? '';
  el.connKey.textContent = c.key_line;
  el.connUrl.value = c.url;
  el.connToken.value = c.token;
  el.connNick.value = c.nick;
  el.connNetworks.replaceChildren(...(c.networks.length ? c.networks : [{}]).map(networkRow));
  el.connectionError.hidden = true;
  activeMode = c.mode;
  setConnectionMode(c.mode);
  el.serverNetNew.hidden = true;
  el.serverNetAdd.hidden = false;
  renderServerNetworks();
  if (el.settings.open) {
    el.settings.close();
  }
  el.connection.showModal();
}

// lobby-server's own networks: one per irssiproxy port. Changes apply on the server at once.
async function renderServerNetworks() {
  let nets;
  try {
    nets = await invoke('server_networks');
  } catch {
    el.serverNets.replaceChildren();
    el.serverNetsHint.textContent = t('Connect to lobby-server first, then its networks can be changed here.');
    el.serverNetAdd.hidden = true;
    return;
  }
  el.serverNetsHint.textContent = t('Removing a network disconnects it on the server. Its history stays.');
  el.serverNets.replaceChildren(
    ...nets.map((n) => {
      const row = h('div', 'server-net');
      row.append(h('span', 'server-net-name', n.name), h('span', 'server-net-where', `${n.host}:${n.port}`));
      const remove = h('button', 'link-btn danger', t('Remove'));
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        if (!remove.dataset.sure) {
          remove.dataset.sure = '1';
          remove.textContent = t('Remove {name}?', { name: n.name });
          return;
        }
        try {
          await invoke('delete_server_network', { name: n.name });
          renderServerNetworks();
        } catch (e) {
          el.serverNetsHint.textContent = String(e);
        }
      });
      row.append(remove);
      return row;
    }),
  );
}

el.serverNetAdd.addEventListener('click', () => {
  const row = networkRow({ port: 45000 });
  row.querySelector('.icon-btn').remove();
  const add = h('button', 'primary-btn', t('Add'));
  add.type = 'button';
  add.addEventListener('click', async () => {
    const network = {
      name: row.querySelector('.name').value.trim(),
      host: row.querySelector('.host').value.trim(),
      port: Number(row.querySelector('.port').value) || 6667,
      password: row.querySelector('.pass').value || null,
    };
    try {
      await invoke('save_server_network', { network });
      el.serverNetNew.hidden = true;
      el.serverNetAdd.hidden = false;
      renderServerNetworks();
    } catch (e) {
      el.serverNetsHint.textContent = String(e);
    }
  });
  row.append(add);
  el.serverNetNew.replaceChildren(...row.children);
  el.serverNetNew.hidden = false;
  el.serverNetAdd.hidden = true;
});

function setConnectionMode(mode) {
  connectionMode = mode;
  for (const b of el.connectionForm.querySelectorAll('.segments button')) {
    b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  }
  for (const part of el.connectionForm.querySelectorAll('[data-modes]')) {
    part.hidden = !part.dataset.modes.split(' ').includes(mode);
  }
  el.connectionAbout.replaceChildren(...linkNames(CONNECTION_ABOUT[mode]));
  renderConnectionStatus();
}

function networkRow(n = {}) {
  const row = h('div', 'net-row');
  const field = (cls, placeholder, value, type = 'text') => {
    const f = h('input', `field ${cls}`);
    Object.assign(f, { placeholder, value: value ?? '', type, autocomplete: 'off', spellcheck: false });
    f.setAttribute('aria-label', placeholder);
    return f;
  };
  const remove = h('button', 'icon-btn');
  remove.type = 'button';
  remove.setAttribute('aria-label', t('Remove network'));
  remove.dataset.tip = t('Remove');
  remove.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  remove.addEventListener('click', () => row.remove());
  row.append(
    field('name', t('Name'), n.name),
    field('host', t('Host'), n.host),
    field('port', t('Port'), n.port),
    remove,
    field('pass', t('Password, if any'), n.password, 'password'),
  );
  if (n.password_file) {
    row.dataset.passwordFile = n.password_file;
  }
  return row;
}

function readConnection() {
  const num = (v) => (v.trim() ? Number(v) : null);
  const networks = [...el.connNetworks.querySelectorAll('.net-row')]
    .map((r) => ({
      name: r.querySelector('.name').value.trim(),
      host: r.querySelector('.host').value.trim(),
      port: Number(r.querySelector('.port').value) || 6667,
      password: r.querySelector('.pass').value || null,
      password_file: r.querySelector('.pass').value ? null : r.dataset.passwordFile || null,
    }))
    .filter((n) => n.name && n.host);
  return {
    mode: connectionMode,
    ssh: el.connSsh.value,
    ssh_port: num(el.connSshPort.value),
    port: num(el.connPort.value),
    url: el.connUrl.value,
    token: el.connToken.value,
    nick: el.connNick.value,
    networks,
    key_line: '',
  };
}

function connectionProblem(c) {
  if (c.mode === 'ssh' && !/^[^@\s]+@[^@\s]+$/.test(c.ssh.trim())) {
    return t('Write the SSH login as you@host.');
  }
  if (c.mode === 'url' && !/^wss?:\/\//.test(c.url.trim())) {
    return t('The server address starts with wss:// or ws://.');
  }
  if (c.mode !== 'irc' && !c.token.trim()) {
    return t('Paste the lobby-server token.');
  }
  if (c.mode === 'irc' && !c.nick.trim()) {
    return t('Pick a nick.');
  }
  if (c.mode === 'irc' && !c.networks.length) {
    return t('Add at least one network with a name and a host.');
  }
  return null;
}

for (const b of el.connectionForm.querySelectorAll('.segments button')) {
  b.addEventListener('click', () => setConnectionMode(b.dataset.mode));
}
el.openConnection.addEventListener('click', openConnection);
el.statusAction.addEventListener('click', openConnection);
el.connectionClose.addEventListener('click', () => el.connection.close());
el.connAddNet.addEventListener('click', () => el.connNetworks.append(networkRow()));
el.connCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(el.connKey.textContent);
    el.connCopy.textContent = t('Copied');
  } catch {
    getSelection().selectAllChildren(el.connKey);
  }
});
el.connectionForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const c = readConnection();
  const problem = connectionProblem(c);
  el.connectionError.hidden = !problem;
  el.connectionError.textContent = problem || '';
  if (problem) {
    return;
  }
  try {
    await invoke('save_connection', { connection: c });
    location.reload();
  } catch (err) {
    el.connectionError.hidden = false;
    el.connectionError.textContent = String(err);
  }
});

async function start() {
  await listen('line', (e) => onLine(e.payload));
  await listen('buffer', (e) => onBuffer(e.payload));
  await listen('me', (e) => {
    state.me[e.payload.net] = e.payload.nick;
    state.masks[e.payload.net] = e.payload.mask || state.masks[e.payload.net];
    // The server takes JOIN only once it has welcomed the nick.
    joinAfterSetup(e.payload.net);
    loadHighlightsSoon();
  });
  await listen('conn', (e) => {
    state.conn[e.payload.net] = e.payload.state;
    renderStatus();
    renderChecklist();
  });
  await listen('people', (e) => {
    state.people = e.payload;
    renderHeader();
    renderLog();
    if (peopleListShown()) {
      renderPeople();
    }
  });
  await listen('whois', (e) => onWhois(e.payload));
  await listen('notification-click', (e) => openNotified(e.payload));
  await listen('show-about', showAbout);
  await listen('show-settings', () => el.settings.open || el.gear.click());
  await listen('check-updates', checkUpdateNow);
  // iPhone: the volume buttons step the text size.
  await listen('volume-key', (e) => applyTextSize(textSize() + e.payload * TEXT_SIZE_STEP));
  showVersion();
  await listen('setting', (e) => {
    state.settings[e.payload.key] = e.payload.value;
    if (e.payload.key === QUIT_SETTING) {
      syncQuit();
    }
    if (e.payload.key === ANIMAL_SETTING) {
      renderHeader();
      renderLog();
    }
    if (e.payload.key === READ_SETTING) {
      applyReadSetting(e.payload.value);
    }
    if (e.payload.key === SHORTCUT_SETTING) {
      refreshShortcutTips();
    }
    if ([MUTED_SETTING, CHANNELS_SETTING, HIDDEN_SETTING].includes(e.payload.key)) {
      renderHeader();
    }
    if (e.payload.key === HIDDEN_SETTING) {
      renderInbox();
    }
    if (e.payload.key === NOTIFY_NICKS_SETTING) {
      el.notifyNicksField.value = commaList(e.payload.value);
    }
    if (e.payload.key === NOTIFY_WORDS_SETTING) {
      el.notifyWordsField.value = commaList(e.payload.value);
    }
    if ([BADGE_ALL_SETTING, NOTIFY_ALL_SETTING, NOTIFY_NICKS_SETTING, NOTIFY_WORDS_SETTING].includes(e.payload.key)) {
      renderHeader();
      if (el.settings.open) {
        renderChannelAlerts();
      }
    }
    if ([LASTFM_USER_SETTING, LASTFM_KEY_SETTING].includes(e.payload.key)) {
      pollNowPlaying();
    }
    if ([UPLOAD_SETTING, UPLOAD_VIA_SETTING, UPLOAD_S3_SETTING, UPLOAD_SFTP_SETTING].includes(e.payload.key)) {
      renderAttach();
    }
    if (e.payload.key === HIGHLIGHTS_SETTING) {
      renderInbox();
    }
    if (e.payload.key === REPLY_STYLE_SETTING) {
      renderLog();
    }
    if ([BLOCKED_SETTING, FILTER_WORDS_SETTING, MASK_SETTING].includes(e.payload.key)) {
      el.filterField.value = commaList(state.settings[FILTER_WORDS_SETTING]);
      el.maskToggle.checked = state.settings[MASK_SETTING] === 'on';
      refilter();
    }
    if (e.payload.key === HIGHLIGHT_WORDS_SETTING) {
      el.highlightField.value = commaList(e.payload.value);
      renderLog();
      loadHighlightsSoon();
    }
  });
  // A lobby-server connection came back: fetch what was missed.
  await listen('server', (e) => {
    state.serverDown = e.payload.down
      ?.replace(/\s*\(os error \d+\)/, '')
      .replace(/^IO error:\s*/i, '')
      .toLowerCase();
    renderConnection();
  });
  await listen('resync', async () => {
    applyStatus(await invoke('status'));
    for (const r of await invoke('recent_buffers').catch(() => [])) {
      buffer(r.net, r.buffer);
    }
    for (const b of state.buffers.values()) {
      loadHistory(b);
    }
  });

  applyStatus(await invoke('status'));

  for (const r of await invoke('recent_buffers').catch(() => [])) {
    buffer(r.net, r.buffer);
  }
  state.started = true;
  pickFirst();
}

function pickFirst() {
  if (state.current) {
    return;
  }
  let saved = null;
  try {
    saved = localStorage.getItem(LAST_BUFFER_KEY);
  } catch {
    /* storage may be unavailable */
  }
  // Before any channel, the server's own window rather than an empty one.
  const first = ordered().find((b) => isChannel(b.name)) ?? ordered()[0];
  if (saved && state.buffers.has(saved)) {
    select(saved);
  } else if (first) {
    select(first.key);
  }
}

// Channels arrive in a burst after connecting: wait for it to settle before picking one.
let firstPickTimer = null;
function scheduleFirstPick() {
  clearTimeout(firstPickTimer);
  firstPickTimer = setTimeout(pickFirst, FIRST_PICK_DELAY_MS);
}

start();

// Tooltips: one small black label, shown at once, for anything with data-tip.

const tip = h('div', 'tip');
tip.setAttribute('role', 'tooltip');
tip.hidden = true;
document.body.append(tip);
const TIP_GAP_PX = 8;

let tipFor = null;
let tipX = 0;

// People's cards wait for the pointer to rest, so sweeping across the list shows nothing.
const CARD_REST_MS = 400;
let cardTimer = 0;
let cardPinned = false;

function showTip(target, x, { fresh = false, ask = true } = {}) {
  tipX = x;
  if (target !== tipFor || fresh) {
    if (target.dataset.person) {
      if (ask) {
        askWhois(target);
      }
      const card = personCard(target.dataset.net, target.dataset.nick, { spoke: !target.dataset.noSpoke });
      tip.style.setProperty('--tint', card.style.getPropertyValue('--tint'));
      tip.replaceChildren(card);
    } else if (target.tipNode) {
      tip.replaceChildren(target.tipNode.cloneNode(true));
    } else if (target.dataset.tip) {
      tip.textContent = target.dataset.tip;
    } else {
      return hideTip();
    }
    tip.classList.toggle('person', Boolean(target.dataset.person));
    tipFor = target;
  }
  tip.hidden = false;
  const box = target.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const left = Math.min(Math.max(x - w / 2, 4), window.innerWidth - w - 4);
  const above = box.top - h - TIP_GAP_PX;
  tip.style.left = `${left}px`;
  tip.style.top = `${above >= 4 ? above : box.bottom + TIP_GAP_PX}px`;
}

function hideTip() {
  clearTimeout(cardTimer);
  tip.hidden = true;
  tipFor = null;
  cardPinned = false;
}

/** The card for a person picked from a menu: stays until the next click. */
function showProfile(node, net, nick) {
  personTip(node, net, nick);
  const box = node.getBoundingClientRect();
  hideTip();
  showTip(node, box.left + box.width / 2);
  cardPinned = true;
}

document.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || cardPinned) {
    return;
  }
  const target = e.target.closest?.('[data-tip], [data-person]');
  // Still on the same thing: its card and a WHOIS on the way are left as they are.
  if (target && target === tipFor) {
    showTip(target, e.clientX);
    return;
  }
  clearTimeout(cardTimer);
  if (!target) {
    if (!tip.hidden) {
      hideTip();
    }
    return;
  }
  if (!target.dataset.person) {
    showTip(target, e.clientX);
    return;
  }
  if (!tip.hidden) {
    hideTip();
  }
  if (!settingOn(HOVER_CARD_SETTING)) {
    return;
  }
  if (settingOn(HOVER_CARD_WAIT_SETTING)) {
    cardTimer = setTimeout(() => showTip(target, e.clientX), CARD_REST_MS);
    return;
  }
  // Right away: the card shows at once, the WHOIS still waits for the pointer to rest.
  showTip(target, e.clientX, { ask: false });
  cardTimer = setTimeout(() => askWhois(target), CARD_REST_MS);
});
document.addEventListener('pointerdown', hideTip);

// Touch screens have no hover: a tap on a name, a nick or a message shows its tooltip for a while.
const TOUCH_TIP_MS = 4000;
let lastPointer = 'mouse';
let touchTipTimer = 0;
document.addEventListener(
  'pointerdown',
  (e) => {
    lastPointer = e.pointerType;
  },
  true,
);
document.addEventListener(
  'click',
  (e) => {
    if (lastPointer === 'mouse') {
      return;
    }
    const target = e.target.closest?.('[data-person], [data-tip]');
    if (!target) {
      return;
    }
    // Buttons and links do their own thing; their tooltips only name them.
    if (!target.dataset.person && e.target.closest('a, button, input, textarea')) {
      return;
    }
    // A name shows its card instead of opening the editor; the photo still opens it.
    if (target.dataset.person) {
      e.stopPropagation();
    }
    showTip(target, e.clientX);
    clearTimeout(touchTipTimer);
    touchTipTimer = setTimeout(hideTip, TOUCH_TIP_MS);
  },
  true,
);
el.log.addEventListener('scroll', hideTip, { passive: true });
document.addEventListener('pointerleave', hideTip);

// People: photos, colours and nicks, edited here and stored on lobby-server.

let editing = null;
let editingFromChat = false;

function personSubtitle(p) {
  return p.nicks.length ? p.nicks.join(', ') : t('No nicks yet');
}

function renderPeople() {
  const rows = state.people.map((p) => {
    const row = h('button', 'person-row');
    row.type = 'button';
    const who = h('span', 'who');
    who.append(h('span', '', p.name), h('span', '', personSubtitle(p)));
    row.append(personAvatar(p, 'av'), who);
    row.addEventListener('click', () => editPerson(p));
    return row;
  });
  el.peopleItems.replaceChildren(...(rows.length ? rows : [h('p', 'people-empty', t('Nobody yet. Click a name in the chat, or use +.'))]));
}

function personAvatar(p, cls) {
  const av = h('div', cls);
  const color = personColor(p, p.nicks[0] || p.name || '?');
  if (p.photo) {
    av.classList.add('photo');
    const img = h('img');
    img.src = shownPhoto(p.photo);
    img.alt = '';
    av.append(img);
  } else {
    animalInto(av, p.nicks[0] || p.name || '?', color);
  }
  return av;
}

function peopleListShown() {
  return el.settings.open && settingsTab === 'people' && !el.peopleList.hidden;
}

function showList() {
  editing = null;
  editingFromChat = false;
  el.peopleTitle.textContent = t('People');
  el.peopleBack.hidden = true;
  el.personNew.hidden = false;
  el.personEdit.hidden = true;
  el.peopleList.hidden = false;
  renderPeople();
}

function editChannel(b) {
  const look = channelLook(b);
  openSettingsTab('people');
  editPerson({ id: 0, channel: b.key, name: label(b), color: look.color || '', photo: look.photo || '', nicks: [] });
  editingFromChat = true;
}

function editPerson(p) {
  editing = structuredClone(p);
  el.personEdit.classList.toggle('channel-mode', Boolean(p.channel));
  el.peopleTitle.textContent = p.channel ? p.name : p.id ? p.name : t('New person');
  el.peopleBack.hidden = Boolean(p.channel);
  el.personNew.hidden = true;
  el.peopleList.hidden = true;
  el.personEdit.hidden = false;
  el.personDelete.hidden = !p.id;
  el.personName.value = editing.name;
  renderEditor();
  if (!p.channel) {
    el.personName.focus();
  }
  if (editing.photo) {
    colorOfPhoto(editing.photo).then((c) => {
      if (!editing || editing.id !== p.id) {
        return;
      }
      editing.photoColor = c;
      renderEditor();
    });
  }
}

function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup;
  return t.content.firstChild;
}

function swatch(color, label, selected, content = '') {
  const b = h('button', 'swatch');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(selected));
  b.setAttribute('aria-label', label);
  b.dataset.tip = label;
  b.style.background = color;
  if (content) {
    b.append(content);
  }
  return b;
}

function renderEditor() {
  const p = editing;
  const name = p.channel ? '#' : el.personName.value || p.nicks[0] || '';
  const auto = p.photoColor || (p.channel ? '#3a3a42' : nickColor(p.nicks[0] || p.name || '?'));
  const color = p.color || auto;

  el.personPhoto.replaceChildren();
  el.personPhoto.classList.remove('animal');
  el.personPhoto.style.background = '';
  el.personPhoto.classList.toggle('empty', !p.photo && !name);
  if (p.photo) {
    const img = h('img');
    img.src = shownPhoto(p.photo);
    img.alt = '';
    el.personPhoto.append(img);
  } else if (name) {
    if (p.channel) {
      el.personPhoto.textContent = '#';
      el.personPhoto.style.background = color;
    } else {
      animalInto(el.personPhoto, p.nicks[0] || name, color);
    }
  } else {
    el.personPhoto.append(svg(PERSON_ICON));
  }
  el.personPhoto.append(h('span', 'photo-badge'));
  el.personPhoto.lastChild.append(svg(CAMERA_ICON));
  el.personPhotoRemove.hidden = !p.photo;
  $('person-animal').hidden = Boolean(p.photo || p.channel || !p.nicks.some(isMyNick));

  const swatches = [swatch(auto, t('Automatic'), !p.color, h('span', 'swatch-mark', 'A'))];
  for (const c of SWATCHES) {
    swatches.push(swatch(c, c, p.color === c));
  }
  const custom = !swatches.some((b) => b.getAttribute('aria-checked') === 'true');
  swatches.push(swatch(custom ? color : 'var(--raised)', t('Pick any colour'), custom, h('span', 'swatch-mark', '+')));
  const values = ['', ...SWATCHES];
  for (const [i, b] of swatches.entries()) {
    b.addEventListener('click', () => {
      if (i === swatches.length - 1) {
        el.personColor.value = toHex(color);
        el.personColor.click();
        return;
      }
      p.color = values[i];
      renderEditor();
    });
  }
  el.personColors.replaceChildren(...swatches);

  el.personNicks.replaceChildren(
    ...p.nicks.map((n, i) => {
      const chip = h('span', 'chip', n);
      const x = h('button', '', '×');
      x.type = 'button';
      x.setAttribute('aria-label', t('Remove {name}', { name: n }));
      x.addEventListener('click', () => {
        p.nicks.splice(i, 1);
        renderEditor();
      });
      chip.append(x);
      return chip;
    }),
  );
}

/** Any CSS colour as #rrggbb, for the colour input. */
function toHex(color) {
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = color;
  return c.fillStyle.startsWith('#') ? c.fillStyle : '#7aa2f7';
}

function openPerson(nick, mask) {
  const found = personFor(state.people, nick, mask);
  openSettingsTab('people');
  editPerson(found || { id: 0, name: nick, color: '', photo: '', nicks: [nick] });
  editingFromChat = true;
}

// Read as a data URL: the page's content policy allows data: images but not blob: ones.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t('Could not read the file')));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(t('Not an image')));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** Square-crop and shrink a picture so it travels and stores cheaply. */
async function photoFrom(file) {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  let crop = side;
  if (isRound(img, side)) {
    crop = side * ROUND_INNER;
  }
  const canvas = document.createElement('canvas');
  canvas.width = PHOTO_PX;
  canvas.height = PHOTO_PX;
  canvas
    .getContext('2d')
    .drawImage(img, (img.naturalWidth - crop) / 2, (img.naturalHeight - crop) / 2, crop, crop, 0, 0, PHOTO_PX, PHOTO_PX);
  return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
}

/**
 * Is this picture a round avatar on an empty square? Corners that are see-through, or solid
 * black from an earlier JPEG save, while the middle is not.
 */
function isRound(img, side) {
  const c = document.createElement('canvas');
  c.width = ROUND_SAMPLE_PX;
  c.height = ROUND_SAMPLE_PX;
  const ctx = c.getContext('2d');
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, ROUND_SAMPLE_PX, ROUND_SAMPLE_PX);
  const px = (x, y) => ctx.getImageData(x, y, 1, 1).data;
  const empty = ([r, g, b, a]) => a < 16 || (a > 240 && r + g + b < 30);
  const last = ROUND_SAMPLE_PX - 2;
  const corners = [px(1, 1), px(last, 1), px(1, last), px(last, last)];
  return corners.every(empty) && !empty(px(ROUND_SAMPLE_PX / 2, ROUND_SAMPLE_PX / 2));
}

/** Square up a saved photo that turns out to be a round avatar. */
async function squarePhoto(src) {
  const img = await new Promise((resolve) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = src;
  });
  if (!img) {
    return src;
  }
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  if (!isRound(img, side)) {
    return src;
  }
  const crop = side * ROUND_INNER;
  const canvas = document.createElement('canvas');
  canvas.width = PHOTO_PX;
  canvas.height = PHOTO_PX;
  canvas
    .getContext('2d')
    .drawImage(img, (img.naturalWidth - crop) / 2, (img.naturalHeight - crop) / 2, crop, crop, 0, 0, PHOTO_PX, PHOTO_PX);
  return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
}

/** The photo's average colour, made readable on the dark background. */
function colorOfPhoto(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = COLOR_SAMPLE_PX;
      canvas.height = COLOR_SAMPLE_PX;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, COLOR_SAMPLE_PX, COLOR_SAMPLE_PX);
      const data = ctx.getImageData(0, 0, COLOR_SAMPLE_PX, COLOR_SAMPLE_PX).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let weight = 0;
      for (let i = 0; i < data.length; i += 4) {
        const max = Math.max(data[i], data[i + 1], data[i + 2]);
        const min = Math.min(data[i], data[i + 1], data[i + 2]);
        const w = 1 + (max - min);
        r += data[i] * w;
        g += data[i + 1] * w;
        b += data[i + 2] * w;
        weight += w;
      }
      resolve(colorFromRgb(r / weight, g / weight, b / weight));
    };
    img.onerror = () => resolve('');
    img.src = src;
  });
}

async function setPhoto(file) {
  if (!editing || !file?.type.startsWith('image/')) {
    return;
  }
  try {
    editing.photo = await photoFrom(file);
    editing.photoColor = await colorOfPhoto(editing.photo);
    editing.color = '';
    renderEditor();
  } catch (e) {
    renderStatus(String(e));
  }
}

el.peopleBack.addEventListener('click', showList);
el.personNew.addEventListener('click', () => editPerson({ id: 0, name: '', color: '', photo: '', nicks: [] }));
el.personPhoto.addEventListener('click', () => el.personFile.click());
el.personFile.addEventListener('change', () => {
  setPhoto(el.personFile.files[0]);
  el.personFile.value = '';
});
/** An image on the clipboard: as a file, or as a clipboard item (copied from a browser or viewer). */
function clipboardImage(e) {
  const data = e.clipboardData;
  if (!data) {
    return null;
  }
  const file = [...(data.files || [])].find((f) => f.type.startsWith('image/'));
  if (file) {
    return file;
  }
  const item = [...(data.items || [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  return item ? item.getAsFile() : null;
}

el.people.addEventListener('paste', (e) => {
  const file = editing && clipboardImage(e);
  if (!file) {
    return;
  }
  e.preventDefault();
  setPhoto(file);
});
$('person-animal').addEventListener('click', () => {
  let pick = shownAnimal(editing.nicks.find(isMyNick));
  while (pick === shownAnimal(editing.nicks.find(isMyNick))) {
    pick = randomAnimal();
  }
  saveSetting(ANIMAL_SETTING, pick);
  renderEditor();
  el.personPhoto.classList.remove('rolled');
  el.personPhoto.offsetWidth;
  el.personPhoto.classList.add('rolled');
  renderHeader();
  renderLog();
});
el.personPhotoRemove.addEventListener('click', () => {
  editing.photo = '';
  editing.photoColor = '';
  renderEditor();
});
el.personColor.addEventListener('input', () => {
  editing.color = el.personColor.value;
  renderEditor();
});
el.personName.addEventListener('input', () => {
  if (!editing.photo) {
    renderEditor();
  }
});
el.personNick.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') {
    return;
  }
  e.preventDefault();
  const nick = el.personNick.value.trim();
  if (nick && !editing.nicks.includes(nick)) {
    editing.nicks.push(nick);
  }
  el.personNick.value = '';
  renderEditor();
});
el.personEdit.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pending = el.personNick.value.trim();
  if (pending && !editing.nicks.includes(pending)) {
    editing.nicks.push(pending);
  }
  el.personNick.value = '';
  editing.name = el.personName.value.trim() || editing.nicks[0] || t('Someone');
  if (editing.channel) {
    let all = {};
    try {
      all = JSON.parse(state.settings[CHANNELS_SETTING] || '{}');
    } catch {
      /* start fresh */
    }
    all[editing.channel] = { photo: editing.photo, color: editing.color };
    saveSetting(CHANNELS_SETTING, JSON.stringify(all));
    el.settings.close();
    renderHeader();
    return;
  }
  try {
    const { photoColor: _, ...person } = editing;
    await invoke('save_person', { person });
    if (person.nicks.some(isMyNick)) {
      shareOwnPhoto(person.photo);
    }
    if (editingFromChat) {
      el.settings.close();
    } else {
      showList();
    }
  } catch (err) {
    renderStatus(String(err));
  }
});
el.personDelete.addEventListener('click', async () => {
  if (!editing?.id) {
    return;
  }
  try {
    await invoke('delete_person', { id: editing.id });
    showList();
  } catch (err) {
    renderStatus(String(err));
  }
});

// Emoji picker: search, frequently used, every category, and a bar to jump between them.

const PICKER_GAP = 8;
const PICKER_PREBUILD_MS = 3000;
const PICKER_COLUMNS = 9;
const PICKER_CHUNK = PICKER_COLUMNS * 6;
const PICKER_AHEAD_PX = 300;
const FREQUENT_COUNT = 18;
const SEARCH_LIMIT = 120;
const CATEGORY_ICONS = {
  frequent: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  people: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>',
  nature: '<path d="M11 20a7 7 0 0 1-7-7c0-5 5-9 15-9 0 10-4 16-8 16z"/><path d="M4 20c4-4 7-7 11-11"/>',
  foods: '<path d="M4 11h16a8 8 0 0 1-16 0z"/><path d="M8 8c0-2 1-3 2-4M12 8c0-2 1-3 2-4M16 8c0-2 1-3 2-4"/>',
  activity: '<circle cx="12" cy="12" r="9"/><path d="M3.5 9.5c5 2 12 2 17 0M5 18c3-4 11-4 14 0"/>',
  places: '<path d="M5 16V11l2-5h10l2 5v5z"/><circle cx="8" cy="16" r="2"/><circle cx="16" cy="16" r="2"/>',
  objects: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>',
  symbols: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  flags: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
};

const pickerState = { el: null, data: null, onPick: null, sections: [], tabs: [], opening: 0, open: false };

async function emojiData() {
  pickerState.data ??= await fetch('vendor/emoji.json').then((r) => r.json());
  return pickerState.data;
}

function categoryIcon(id) {
  return svg(
    `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CATEGORY_ICONS[id]}</svg>`,
  );
}

// One click handler on the picker serves every emoji button.
function emojiButton(native, label) {
  const b = h('button', 'pick', native);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  return b;
}

function choose(native) {
  const onPick = pickerState.onPick;
  closePicker();
  onPick?.(native);
}

function section(id, title, grids) {
  const wrap = h('section', 'picker-section');
  wrap.dataset.cat = id;
  wrap.append(h('h4', '', title), ...grids);
  return wrap;
}

function grid(buttons) {
  const g = h('div', 'picker-grid');
  g.append(...buttons);
  return g;
}

// Laying out every emoji at once froze the Mac for seconds, so a category starts as empty
// blocks of the right height and each fills in as it scrolls into view.
const unfilled = new WeakMap();

function emptyGrids(emojis, observer) {
  const grids = [];
  for (let i = 0; i < emojis.length; i += PICKER_CHUNK) {
    const part = emojis.slice(i, i + PICKER_CHUNK);
    const g = h('div', 'picker-grid');
    g.style.aspectRatio = `${PICKER_COLUMNS} / ${Math.ceil(part.length / PICKER_COLUMNS)}`;
    unfilled.set(g, part);
    observer.observe(g);
    grids.push(g);
  }
  return grids;
}

function fillGrid(g, observer) {
  observer.unobserve(g);
  const part = unfilled.get(g);
  unfilled.delete(g);
  g.style.aspectRatio = '';
  g.append(...part.map(([native, words]) => emojiButton(native, words.split(' ')[0])));
}

function frequentButtons() {
  const counts = reactionCounts();
  const used = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([e]) => e);
  return [...new Set([...used, ...QUICK_REACTIONS])].slice(0, FREQUENT_COUNT).map((e) => emojiButton(e, e));
}

async function buildPicker() {
  const data = await emojiData();
  const root = h('div', 'glass picker');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', t('Emoji'));

  const search = h('label', 'picker-search');
  const input = h('input');
  input.placeholder = t('Search');
  input.setAttribute('aria-label', t('Search emoji'));
  search.append(
    svg(
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    ),
    input,
  );

  const scroll = h('div', 'picker-scroll');
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          fillGrid(e.target, observer);
        }
      }
    },
    { root: scroll, rootMargin: `${PICKER_AHEAD_PX}px 0px` },
  );
  const results = section('results', t('Search results'), [grid([])]);
  results.hidden = true;
  const frequent = section('frequent', t('Frequently used'), [grid(frequentButtons())]);
  const cats = data.map((c) => section(c.id, t(c.name), emptyGrids(c.emojis, observer)));
  scroll.append(results, frequent, ...cats);

  const tabs = h('nav', 'picker-tabs');
  const ids = ['frequent', ...data.map((c) => c.id)];
  pickerState.tabs = ids.map((id) => {
    const tab = h('button', 'picker-tab');
    tab.type = 'button';
    tab.dataset.cat = id;
    tab.setAttribute('aria-label', t(id === 'frequent' ? 'Frequently used' : data.find((c) => c.id === id).name));
    tab.append(categoryIcon(id));
    tab.addEventListener('click', () => {
      input.value = '';
      showSearch('');
      const target = scroll.querySelector(`section[data-cat="${id}"]`);
      scroll.scrollTop = target.offsetTop - scroll.offsetTop;
    });
    return tab;
  });
  tabs.append(...pickerState.tabs);

  function showSearch(q) {
    const query = q.trim().toLowerCase();
    results.hidden = !query;
    for (const sec of scroll.querySelectorAll('section:not([data-cat="results"])')) {
      sec.hidden = Boolean(query);
    }
    if (!query) {
      return;
    }
    // Best first: a whole word matches, then the name starts with it, then a word does, then any part.
    const scored = [];
    for (const c of data) {
      for (const [native, words] of c.emojis) {
        if (!words.includes(query)) {
          continue;
        }
        const list = words.split(' ');
        const score = list.includes(query) ? 0 : words.startsWith(query) ? 1 : list.some((w) => w.startsWith(query)) ? 2 : 3;
        scored.push([score, native, words]);
      }
    }
    scored.sort((a, b) => a[0] - b[0]);
    const found = scored.slice(0, SEARCH_LIMIT).map(([, native, words]) => emojiButton(native, words.split(' ')[0]));
    results.querySelector('.picker-grid').replaceChildren(...found);
    scroll.scrollTop = 0;
  }

  input.addEventListener('input', () => showSearch(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = results.querySelector('.pick');
      if (first) {
        choose(first.textContent);
      }
    }
  });
  scroll.addEventListener(
    'scroll',
    () => {
      const top = scroll.scrollTop + scroll.offsetTop + PICKER_GAP;
      let current = 'frequent';
      for (const sec of scroll.querySelectorAll('section:not([hidden])')) {
        if (sec.offsetTop <= top) {
          current = sec.dataset.cat;
        }
      }
      for (const t of pickerState.tabs) {
        t.classList.toggle('active', t.dataset.cat === current);
      }
    },
    { passive: true },
  );

  root.append(search, scroll, tabs);
  root.addEventListener('pointerdown', (e) => e.stopPropagation());
  root.addEventListener('click', (e) => {
    const pick = e.target.closest('.pick');
    if (pick) {
      choose(pick.textContent);
    }
  });
  // Kept laid out while closed, so opening it only has to show it.
  root.classList.add('closed');
  document.body.append(root);
  pickerState.el = root;
  pickerState.input = input;
  pickerState.frequent = frequent;
  pickerState.scroll = scroll;
  pickerState.showSearch = showSearch;
}

// Built ahead, so the first colon or emoji button opens it at once.
function pickerReady() {
  pickerState.building ??= buildPicker();
  return pickerState.building;
}

setTimeout(pickerReady, PICKER_PREBUILD_MS);

/** Open the picker next to `anchor`; `onPick` gets the chosen emoji. */
async function openPicker(anchor, onPick, { focus = true } = {}) {
  pickerState.opening += 1;
  const opening = pickerState.opening;
  await pickerReady();
  // Closed again while the emoji were still loading.
  if (opening !== pickerState.opening) {
    return;
  }
  const p = pickerState;
  p.onPick = onPick;
  p.frequent.querySelector('.picker-grid').replaceChildren(...frequentButtons());
  p.input.value = '';
  p.showSearch('');
  p.scroll.scrollTop = 0;
  for (const [i, t] of p.tabs.entries()) {
    t.classList.toggle('active', i === 0);
  }

  p.el.classList.remove('closed');
  p.open = true;
  // Measured once placed, against the page rather than the window: the iPhone zooms the page
  // and shortens it for the keyboard. `k` turns measured pixels back into style pixels.
  const k = p.el.getBoundingClientRect().width / p.el.offsetWidth || 1;
  const page = document.body.getBoundingClientRect();
  // Narrower and shorter on a phone, and above its keyboard.
  p.el.style.maxWidth = `${page.width / k - 2 * PICKER_GAP}px`;
  p.el.style.maxHeight = `${page.height / k - 2 * PICKER_GAP}px`;
  const spot = popupSpot(anchor.getBoundingClientRect(), page, p.el.offsetWidth * k, p.el.offsetHeight * k, PICKER_GAP * k);
  p.el.style.left = `${spot.left / k}px`;
  p.el.style.top = `${spot.top / k}px`;
  closePanel();
  if (focus) {
    p.input.focus();
  }
}

function closePicker() {
  pickerState.opening += 1;
  pickerState.el?.classList.add('closed');
  pickerState.open = false;
  pickerState.onPick = null;
}

document.addEventListener('pointerdown', () => {
  if (pickerState.open) {
    closePicker();
  }
});
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && pickerState.open) {
      e.stopPropagation();
      closePicker();
    }
  },
  true,
);

// Desktop notifications for mentions and private messages, on unless turned off in Settings.

const NOTIFY_SETTING = 'notify';
const NOTIFY_TEXT_CHARS = 160;
const notifier = window.__TAURI__.notification;
let notifyAllowed = null;

function settingOn(key) {
  return state.settings[key] !== 'off';
}

// Text size, per device: the whole window zooms, so everything keeps its proportions.
const TEXT_SIZE_KEY = 'lobby.textSize';
const TEXT_SIZE_DEFAULT = 100;
const TEXT_SIZE_MIN = 70;
const TEXT_SIZE_MAX = 200;
/** One press of Cmd/Ctrl + or -: one percent. */
const TEXT_SIZE_STEP = 1;
/** On iPhone 100 % is a fifth larger than the page's own pixel sizes. */
const IOS_TEXT_BASE = 1.2;

function textSize() {
  try {
    return Number(localStorage.getItem(TEXT_SIZE_KEY)) || TEXT_SIZE_DEFAULT;
  } catch {
    return TEXT_SIZE_DEFAULT;
  }
}

let pageScale = 1;

function applyTextSize(percent) {
  const p = Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, Math.round(Number(percent) || TEXT_SIZE_DEFAULT)));
  try {
    localStorage.setItem(TEXT_SIZE_KEY, String(p));
  } catch {
    /* lasts this run */
  }
  el.textSize.value = p;
  el.textSizeNumber.value = p;
  const root = document.documentElement;
  // iPhone ignores the webview's zoom, so there the page zooms itself.
  if (root.classList.contains('ios')) {
    pageScale = (p / 100) * IOS_TEXT_BASE;
    root.style.zoom = String(pageScale);
    viewSize();
    return;
  }
  // The macOS header keeps its size so it stays level with the window buttons.
  root.style.setProperty('--chrome-zoom', String(100 / p));
  window.__TAURI__.webview
    .getCurrentWebview()
    .setZoom(p / 100)
    .catch(() => {});
}

// Conversation width, per device like the text size: a narrow column unless asked for.
const WIDE_CHAT_KEY = 'lobby.wideChat';

function wideChat() {
  try {
    return localStorage.getItem(WIDE_CHAT_KEY) === 'on';
  } catch {
    return false;
  }
}

function applyWideChat(on) {
  try {
    localStorage.setItem(WIDE_CHAT_KEY, on ? 'on' : 'off');
  } catch {
    /* lasts this run */
  }
  document.documentElement.classList.toggle('wide-chat', on);
  $('wide-chat-toggle').checked = on;
}

applyWideChat(wideChat());
$('wide-chat-toggle').addEventListener('change', (e) => applyWideChat(e.target.checked));

/** The window in the zoomed page's pixels: 100vw and 100vh ignore the zoom and overflow on iPhone. */
function viewSize() {
  const root = document.documentElement;
  root.style.setProperty('--view-w', `${window.innerWidth / pageScale}px`);
  root.style.setProperty('--view-h', `${window.innerHeight / pageScale}px`);
}
window.addEventListener('resize', () => {
  if (pageScale !== 1) {
    viewSize();
  }
});

el.textSize.addEventListener('input', () => applyTextSize(el.textSize.value));
el.textSizeNumber.addEventListener('change', () => applyTextSize(el.textSizeNumber.value));
el.textSizeReset.addEventListener('click', () => applyTextSize(TEXT_SIZE_DEFAULT));
applyTextSize(textSize());

// The app icon, chosen per device: Dock on macOS, window icon elsewhere.
const ICONS_KEY = 'lobby.icon';
const DEFAULT_ICON = BRAND.icons[0][0];

function chosenIcon() {
  // An icon that has since been removed falls back to the default.
  let saved = null;
  try {
    saved = localStorage.getItem(ICONS_KEY);
  } catch {
    /* storage may be unavailable */
  }
  return BRAND.icons.some(([name]) => name === saved) ? saved : DEFAULT_ICON;
}

function useIcon(name) {
  invoke('set_app_icon', { name }).catch((e) => renderStatus(t('App icon: {error}', { error: e })));
}

function renderIconChoices() {
  const current = chosenIcon();
  el.iconChoices.replaceChildren(
    ...BRAND.icons.map(([name, label]) => {
      const b = h('button', 'icon-choice');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(name === current));
      b.setAttribute('aria-label', t(label));
      b.dataset.tip = t(label);
      const img = h('img');
      img.src = `icons/${name}.png`;
      img.alt = '';
      b.append(img);
      b.addEventListener('click', () => {
        try {
          localStorage.setItem(ICONS_KEY, name);
        } catch {
          /* the choice lasts this run */
        }
        useIcon(name);
        renderIconChoices();
      });
      return b;
    }),
  );
}

if (chosenIcon() !== DEFAULT_ICON) {
  useIcon(chosenIcon());
}

function notifyOn() {
  return state.settings[NOTIFY_SETTING] !== 'off';
}

async function notify(b, l) {
  if (!notifyOn() || !notifier) {
    return;
  }
  notifyAllowed ??= (await notifier.isPermissionGranted()) || (await notifier.requestPermission()) === 'granted';
  if (!notifyAllowed) {
    return;
  }
  const who = identity(l.nick, l.mask);
  const title = isPrivate(b) ? l.nick : t('{name} in {channel}', { name: who.name, channel: label(b) });
  const icon = await notifyIcon(who.photo);
  showNotification(title, shownText(stripFormatting(l.text)).slice(0, NOTIFY_TEXT_CHARS), icon, { key: b.key, line: l.id }).catch((e) =>
    renderStatus(t('Notification: {error}', { error: e })),
  );
}

/** Notification id to the message it was about, so a click can open it. */
const notified = new Map();
const NOTIFIED_KEEP = 50;
const FLASH_MS = 2400;

// Opening an older line: the channel shows the conversation around it until "Back to latest".

const WINDOW_FLASH_DELAY_MS = 60;

function centerLine(id) {
  stopGlide();
  requestAnimationFrame(() => {
    const row = [...el.col.querySelectorAll('.text')].find((r) => r.line?.id === id);
    if (!row) {
      return;
    }
    stuck = false;
    row.scrollIntoView({ block: 'center' });
    noteAnchor();
    setTimeout(() => {
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), FLASH_MS);
    }, WINDOW_FLASH_DELAY_MS);
  });
}

async function openLine(l) {
  const b = buffer(l.net, l.buffer);
  closeShelf();
  if (b.lines.some((x) => x.id === l.id)) {
    b.window = null;
    select(b.key);
    centerLine(l.id);
    return;
  }
  const lines = await invoke('around', { net: l.net, buffer: l.buffer, line: l.id }).catch(() => []);
  b.window = lines.length ? lines : null;
  b.windowAt = l.id;
  b.windowEnd = null;
  b.windowSeparator = null;
  if (state.current === b.key) {
    renderLog();
  } else {
    select(b.key);
  }
}

function leaveWindow() {
  const b = state.buffers.get(state.current);
  if (!b) {
    return;
  }
  b.window = null;
  b.windowSeparator = null;
  renderLog();
}

el.windowBack.addEventListener('click', leaveWindow);

// The earlier view grows as you scroll past either end, and becomes the live chat once it reaches it.
const WINDOW_EDGE_PX = 400;
let windowLoading = false;

el.log.addEventListener(
  'scroll',
  () => {
    const b = state.buffers.get(state.current);
    if (!b || windowLoading) {
      return;
    }
    if (!b.window) {
      if (el.log.scrollTop < WINDOW_EDGE_PX) {
        growBack(b);
      }
      return;
    }
    if (el.log.scrollTop < WINDOW_EDGE_PX) {
      growWindow(b, 'up');
    } else if (el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < WINDOW_EDGE_PX) {
      growWindow(b, 'down');
    }
  },
  { passive: true },
);

/**
 * The live chat reaches back as far as the history goes, a page at a time as you near the top.
 * Older pages are drawn only, not held: what is not held is counted as unread by the server.
 */
async function growBack(b) {
  const first = view.oldest ?? b.lines.find((l) => l.id)?.id;
  if (view.atStart || !first) {
    return;
  }
  windowLoading = true;
  const lines = await invoke('history', { net: b.net, buffer: b.name, before: first }).catch(() => null);
  windowLoading = false;
  if (!lines || state.current !== b.key || b.window) {
    return;
  }
  if (!lines.length) {
    view.atStart = true;
    return;
  }
  view.oldest = lines[0].id;
  // The first unread was not held, so its New line comes with the page that has it.
  const seen = readMap[b.key];
  const marker = b.unreadGap && !view.separator && seen !== undefined && lines[0].id <= seen ? seen : null;
  prependLines(lines, marker);
  updateJumps();
}

/** Messages newer than the earlier view holds, so its "N more" counts all the way to the newest. */
async function countAfterWindow(b) {
  const last = b.window?.[b.window.length - 1]?.id;
  if (!last) {
    return;
  }
  const n = await invoke('count_unread', { net: b.net, buffer: b.name, after: last, before: Number.MAX_SAFE_INTEGER }).catch(() => 0);
  if (b.window?.[b.window.length - 1]?.id === last) {
    b.windowAfter = n;
    updateJumps();
  }
}

async function growWindow(b, side) {
  b.windowEnd ??= {};
  if (b.windowEnd[side]) {
    return;
  }
  windowLoading = true;
  const first = b.window[0].id;
  const last = b.window[b.window.length - 1].id;
  const lines =
    side === 'up'
      ? await invoke('history', { net: b.net, buffer: b.name, before: first }).catch(() => [])
      : (await invoke('around', { net: b.net, buffer: b.name, line: last }).catch(() => [])).filter((l) => l.id > last);
  windowLoading = false;
  if (state.current !== b.key || !b.window) {
    return;
  }
  if (side === 'up') {
    if (!lines.length) {
      b.windowEnd.up = true;
      return;
    }
    b.window = [...lines, ...b.window];
    prependLines(lines);
    return;
  }
  // New lines go under what is shown, so nothing on screen moves.
  b.window = [...b.window, ...lines];
  for (const l of lines) {
    appendLine(l);
  }
  countAfterWindow(b);
  const newest = b.window[b.window.length - 1].id;
  if (!lines.length || (b.lines.length && newest >= b.lines[0].id)) {
    joinLatest(b, newest);
  }
}

/** Older lines above the view: drawn on their own, put in front, and the scroll moved by their height. */
function prependLines(lines, separatorAfter = null) {
  const col = el.col;
  const kept = view;
  const firstDay = col.firstElementChild?.classList.contains('day') ? col.firstElementChild : null;
  el.col = h('div');
  view = {
    lastLine: null,
    group: null,
    events: null,
    command: null,
    lastByNick: new Map(),
    lastToward: new Map(),
    byId: new Map(),
    separator: null,
    separatorAfter,
  };
  for (const l of lines) {
    appendLine(l);
  }
  const fresh = el.col;
  const lastTs = view.lastLine?.ts;
  kept.separator ||= view.separator;
  el.col = col;
  view = kept;
  if (firstDay && lastTs && firstDay.textContent === dayLabel(lastTs)) {
    firstDay.remove();
  }
  const before = el.log.scrollHeight;
  col.prepend(...fresh.childNodes);
  el.log.scrollTop += el.log.scrollHeight - before;
}

/** The earlier view met the live chat: from here on it is the live chat, nothing redrawn. */
function joinLatest(b, newest) {
  const shown = new Set(b.window.map((l) => l.id));
  for (const l of b.lines) {
    if (l.id > newest && !shown.has(l.id)) {
      appendLine(l);
    }
  }
  for (const l of b.window) {
    b.ids.add(l.id);
  }
  const known = new Set(b.lines.map((l) => l.id));
  b.lines = [...b.window.filter((l) => !known.has(l.id)), ...b.lines].sort((x, y) => x.id - y.id);
  b.window = null;
  b.windowEnd = null;
  b.windowSeparator = null;
  // Everything from the read marker on is loaded now.
  if (b.lines[0]?.id <= (readMap[b.key] ?? 0)) {
    b.unreadGap = 0;
  }
  el.windowBar.hidden = true;
  document.body.classList.remove('windowed');
  updateJumps();
}

// Highlights inbox: every line that names you, until you mark it done. The rest is the archive.

const HIGHLIGHTS_SETTING = 'highlights';
const DONE_KEEP = 500;
const FOUND_PAGE = 200;
const SWIPE_DONE_PX = 80;
const inbox = { lines: new Map(), archive: false, older: true, timer: 0 };

/** Today as 14:02, earlier days as their date. */
function shortWhen(ts) {
  return sameDay(ts, Date.now()) ? clock(ts).slice(0, 5) : dayLabel(ts);
}

/** A private message from someone, which counts as a highlight unless that is turned off. */
function pmToMe(l) {
  return settingOn(PM_HIGHLIGHT_SETTING) && Boolean(l.buffer) && !isChannel(l.buffer) && !l.own && CHAT_KINDS.has(l.kind);
}

/** Names me, or is a private message to me. */
function forMe(l) {
  return mentions(l.text, myWords(l.net)) || pmToMe(l);
}

/** A line that names you; a reaction ("rolle: 🎉") shows as a reaction, not a highlight. */
function isHighlight(l) {
  return (
    !parseReaction(l.text) &&
    !hiddenKeys().has(key(l.net, l.buffer)) &&
    Boolean(l.id) &&
    !l.own &&
    CHAT_KINDS.has(l.kind) &&
    (isChannel(l.buffer) ? mentions(l.text, myWords(l.net)) : pmToMe(l))
  );
}

function highlightMarks() {
  try {
    const v = JSON.parse(state.settings[HIGHLIGHTS_SETTING] || '{}');
    return { upTo: v.upTo || 0, done: new Set(v.done || []) };
  } catch {
    return { upTo: 0, done: new Set() };
  }
}

function saveMarks(upTo, done) {
  const kept = [...done].filter((id) => id > upTo).slice(-DONE_KEEP);
  saveSetting(HIGHLIGHTS_SETTING, JSON.stringify({ upTo, done: kept }));
  renderInbox();
}

function markDone(id) {
  const m = highlightMarks();
  m.done.add(id);
  saveMarks(m.upTo, m.done);
}

function markAllDone() {
  const newest = Math.max(0, ...inbox.lines.keys());
  saveMarks(Math.max(newest, highlightMarks().upTo), new Set());
}

function loadHighlightsSoon() {
  clearTimeout(inbox.timer);
  inbox.timer = setTimeout(() => loadHighlights(null), 400);
}

async function loadHighlights(before) {
  const words = [...new Set([...Object.values(state.me), ...highlightWords()].filter(Boolean))];
  if (!words.length) {
    return;
  }
  const lines = await invoke('mentions', { words, before }).catch(() => []);
  for (const l of lines) {
    if (isHighlight(l)) {
      inbox.lines.set(l.id, l);
    }
  }
  // Private messages have no word to search for: the ones already loaded go in as they are.
  if (before === null) {
    for (const b of state.buffers.values()) {
      for (const l of isPrivate(b) ? b.lines : []) {
        if (isHighlight(l)) {
          inbox.lines.set(l.id, l);
        }
      }
    }
  }
  // The first page decides too: a short one is all there is.
  if (before !== null || !inbox.paged) {
    inbox.older = lines.length >= FOUND_PAGE;
  }
  inbox.paged ||= before !== null;
  renderInbox();
}

function inboxParts() {
  const m = highlightMarks();
  const hidden = hiddenKeys();
  const shown = [...inbox.lines.values()].filter((l) => !hidden.has(key(l.net, l.buffer)) && !isMuffled(l));
  return inboxSplit(shown, m.upTo, m.done);
}

function renderInbox() {
  updateBadge();
  const { fresh, archived } = inboxParts();
  el.inboxPill.hidden = fresh.length === 0;
  el.inboxPill.textContent = `@${fresh.length}`;
  el.inboxPill.dataset.tip = fresh.length === 1 ? t('{n} highlight for you', { n: 1 }) : t('{n} highlights for you', { n: fresh.length });
  if (el.inbox.hidden) {
    return;
  }
  const query = el.inboxFilter.value;
  const list = (inbox.archive ? archived : fresh).filter((l) => looseMatch(l, query));
  el.inboxFreshTab.textContent = fresh.length ? t('For you · {n}', { n: fresh.length }) : t('For you');
  el.inboxFreshTab.setAttribute('aria-selected', String(!inbox.archive));
  el.inboxArchiveTab.setAttribute('aria-selected', String(inbox.archive));
  el.inboxAll.hidden = inbox.archive || fresh.length === 0;
  // Drawing again keeps the keyboard on the row it was on.
  const focused = el.inboxList.contains(document.activeElement) ? document.activeElement.line?.id : null;
  el.inboxList.replaceChildren(...list.map((l) => inboxRow(l, !inbox.archive)));
  if (focused) {
    [...el.inboxList.children].find((r) => r.line?.id === focused)?.focus();
  }
  if (!list.length) {
    const empty = query.trim() ? t('Nothing matches.') : inbox.archive ? t('Nothing here yet.') : t('All caught up.');
    el.inboxList.append(h('div', 'inbox-empty', empty));
  }
  el.inboxFoot.hidden = !inbox.archive || !inbox.older;
  el.inboxFoot.textContent = t('Load older');
}

function inboxText(l) {
  const box = h('div', 'inbox-text');
  for (const t of tokenize(l.text, myWords(l.net))) {
    box.append(...(t.type === 'mention' ? [h('span', 'mention', t.value)] : t.type === 'url' ? [shortUrl(t.value)] : shownNodes(t.value)));
  }
  return box;
}

function inboxRow(l, fresh) {
  const row = h('div', 'inbox-row');
  row.tabIndex = 0;
  row.line = l;
  row.fresh = fresh;
  const head = h('div', 'inbox-meta');
  head.append(h('span', 'inbox-nick', l.nick), h('span', 'inbox-where', `${l.buffer} · ${shortWhen(l.ts)}`));
  const body = h('div', 'inbox-body');
  body.append(head, inboxText(l));
  row.append(avatar(l.nick, l.mask), body);
  if (fresh) {
    const done = h('button', 'inbox-done');
    done.type = 'button';
    done.dataset.tip = t('Done');
    done.setAttribute('aria-label', t('Done'));
    done.innerHTML =
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    done.addEventListener('click', (e) => {
      e.stopPropagation();
      markDone(l.id);
    });
    row.append(done);
    swipeToDone(row, l.id);
  }
  const open = () => {
    closeInbox();
    openLine(l);
  };
  row.addEventListener('click', open);
  row.addEventListener('keydown', (e) => {
    // Kept from the message box, which takes the focus as the chat opens.
    if (e.key === 'Enter') {
      e.preventDefault();
      open();
    }
  });
  return row;
}

/** On a phone a highlight slides right to be done, as in a mail app. */
function swipeToDone(row, id) {
  let start = null;
  row.addEventListener(
    'touchstart',
    (e) => {
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0 };
    },
    { passive: true },
  );
  row.addEventListener(
    'touchmove',
    (e) => {
      if (!start) {
        return;
      }
      const dx = e.touches[0].clientX - start.x;
      if (Math.abs(e.touches[0].clientY - start.y) > Math.abs(dx)) {
        start = null;
        row.style.transform = '';
        return;
      }
      start.dx = Math.max(0, dx);
      row.style.transform = `translateX(${start.dx}px)`;
      row.classList.toggle('swiped', start.dx > SWIPE_DONE_PX);
    },
    { passive: true },
  );
  row.addEventListener('touchend', () => {
    const swiped = start && start.dx > SWIPE_DONE_PX;
    start = null;
    if (!swiped) {
      row.style.transform = '';
      row.classList.remove('swiped');
      return;
    }
    row.addEventListener('click', (e) => e.stopImmediatePropagation(), { capture: true, once: true });
    row.classList.add('leaving');
    row.style.transform = 'translateX(100%)';
    setTimeout(() => markDone(id), 180);
  });
}

function openInbox() {
  inbox.archive = false;
  el.inbox.hidden = false;
  document.body.classList.add('inbox-open');
  renderInbox();
  document.activeElement?.blur();
}

function closeInbox() {
  el.inbox.hidden = true;
  el.inboxFilter.value = '';
  document.body.classList.remove('inbox-open');
}

el.inboxFilter.addEventListener('input', renderInbox);

el.inboxPill.addEventListener('click', (e) => {
  e.stopPropagation();
  el.inbox.hidden ? openInbox() : closeInbox();
});
el.openInbox.addEventListener('click', () => {
  el.switcher.close();
  openInbox();
});
el.inboxAll.addEventListener('click', markAllDone);
for (const [tab, archive] of [
  [el.inboxFreshTab, false],
  [el.inboxArchiveTab, true],
]) {
  tab.addEventListener('click', () => {
    inbox.archive = archive;
    renderInbox();
  });
}
el.inboxFoot.addEventListener('click', () => loadHighlights(Math.min(...inbox.lines.keys())));
el.inbox.querySelector('.inbox-dim').addEventListener('click', closeInbox);
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Escape' || el.inbox.hidden) {
      return;
    }
    e.stopPropagation();
    // Escape clears a filter first, then closes.
    if (el.inboxFilter.value) {
      el.inboxFilter.value = '';
      renderInbox();
      return;
    }
    closeInbox();
  },
  true,
);

// Shelf: the channel's links, pictures and videos on its own timeline, newest first.

const SHELF_BOTTOM_PX = 40;
const shelf = { tab: 'pictures', open: false, key: null, lines: [], older: true, loading: false };
const linkTitles = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      linkTitles.unobserve(e.target);
      e.target.fill?.();
    }
  }
});

function setView(name) {
  for (const b of el.views.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.view === name));
  }
  shelf.open = name === 'shelf';
  el.shelf.hidden = !shelf.open;
  el.shelfLatest.hidden = true;
  document.body.classList.toggle('shelf-open', shelf.open);
  if (shelf.open) {
    loadShelf();
  }
}

function closeShelf() {
  if (shelf.open) {
    setView('chat');
  }
}

function shelfAtBottom() {
  return el.shelf.scrollHeight - el.shelf.scrollTop - el.shelf.clientHeight < SHELF_BOTTOM_PX;
}

el.shelf.addEventListener('scroll', () => (el.shelfLatest.hidden = shelfAtBottom()), { passive: true });
el.shelfLatest.addEventListener('click', () => el.shelf.scrollTo({ top: el.shelf.scrollHeight, behavior: 'smooth' }));

el.views.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) {
    setView(b.dataset.view);
  }
});

async function loadShelf(more = false) {
  const b = state.buffers.get(state.current);
  if (!b || shelf.loading) {
    return;
  }
  if (!more || shelf.key !== b.key) {
    shelf.key = b.key;
    shelf.lines = [];
    shelf.older = true;
    el.shelf.replaceChildren(h('div', 'shelf-empty', t('Looking…')));
  }
  shelf.loading = true;
  const fromBottom = el.shelf.scrollHeight - el.shelf.scrollTop;
  const before = more && shelf.lines.length ? shelf.lines[shelf.lines.length - 1].id : null;
  const lines = await invoke('links', { net: b.net, buffer: b.name, before }).catch(() => []);
  shelf.loading = false;
  if (shelf.key !== b.key) {
    return;
  }
  shelf.lines.push(...lines);
  shelf.older = lines.length >= FOUND_PAGE;
  renderShelf(more ? fromBottom : null);
}

/** Every link, picture and video in the shelf's lines, oldest first. */
function shelfItems() {
  const items = [];
  for (const l of [...shelf.lines].reverse()) {
    if (isMuffled(l)) {
      continue;
    }
    for (const t of tokenize(l.text, '')) {
      if (t.type === 'url') {
        items.push({ l, url: t.value, kind: mediaKind(t.value) });
      }
    }
  }
  return items;
}

// The newest pictures are at the bottom, so a short row goes on top and the last row is always full.
const tilesFromBottom = new ResizeObserver((entries) => {
  for (const e of entries) {
    alignTiles(e.target);
  }
});

function alignTiles(grid) {
  const first = grid.firstElementChild;
  if (!first) {
    return;
  }
  first.style.gridColumnStart = '';
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const rest = grid.children.length % columns;
  if (rest) {
    first.style.gridColumnStart = String(columns - rest + 1);
  }
}

function shelfTabs(links, pictures) {
  const bar = h('div', 'shelf-tabs');
  for (const [name, label, count] of [
    ['pictures', t('Pictures'), pictures],
    ['links', t('Links'), links],
  ]) {
    const tab = h('button', 'shelf-tab', `${label} ${count}`);
    tab.type = 'button';
    tab.setAttribute('aria-selected', String(shelf.tab === name));
    tab.addEventListener('click', () => {
      shelf.tab = name;
      renderShelf();
    });
    bar.append(tab);
  }
  return bar;
}

/** Oldest first like the chat, so the newest sits at the bottom where the shelf opens. */
function renderShelf(keepFromBottom = null) {
  const items = shelfItems();
  const links = items.filter((i) => i.kind === 'link');
  const pictures = items.filter((i) => i.kind !== 'link');
  const nodes = [shelfTabs(links.length, pictures.length)];
  if (shelf.older && shelf.lines.length) {
    const more = h('button', 'shelf-more', t('Older'));
    more.type = 'button';
    more.addEventListener('click', () => loadShelf(true));
    nodes.push(more);
  }
  const shown = shelf.tab === 'pictures' ? pictures : links;
  if (shelf.tab === 'pictures') {
    const grid = h('div', 'shelf-tiles');
    grid.append(...shown.map((i) => shelfTile(i.l, i.url, i.kind)));
    tilesFromBottom.observe(grid);
    nodes.push(grid);
  } else {
    let day = null;
    for (const i of shown) {
      if (!day || !sameDay(day, i.l.ts)) {
        day = i.l.ts;
        nodes.push(h('div', 'shelf-day', dayLabel(i.l.ts)));
      }
      nodes.push(shelfLink(i.l, i.url));
    }
  }
  if (!shown.length) {
    nodes.push(h('div', 'shelf-empty', shelf.tab === 'pictures' ? t('No pictures or videos here yet.') : t('No links here yet.')));
  }
  el.shelf.replaceChildren(...nodes);
  el.shelf.scrollTop = keepFromBottom === null ? el.shelf.scrollHeight : el.shelf.scrollHeight - keepFromBottom;
  el.shelfLatest.hidden = shelfAtBottom();
}

function shelfTip(l) {
  return `${l.nick} · ${dayLabel(l.ts)} ${clock(l.ts)}`;
}

function shelfTile(l, url, kind) {
  const tile = h('button', `shelf-tile ${kind}`);
  tile.type = 'button';
  tile.dataset.tip = shelfTip(l);
  const yt = kind === 'youtube' ? youtube(url) : null;
  if (yt) {
    tile.append(image(`https://i.ytimg.com/vi/${yt.id}/mqdefault.jpg`));
  } else if (kind === 'image') {
    tile.append(image(directLink(url)));
  } else {
    const v = h('video');
    v.muted = true;
    v.preload = 'metadata';
    v.src = `${directLink(url)}#t=0.5`;
    tile.append(v);
  }
  if (kind !== 'image') {
    tile.append(h('span', 'shelf-play', '▶'));
  }
  tile.addEventListener('click', () => openLine(l));
  return tile;
}

/** A link in the shelf looks like its card in the chat; who posted it and when opens that message. */
function shelfLink(l, url) {
  const row = h('div', 'shelf-link');
  const who = h('button', 'shelf-who');
  who.type = 'button';
  who.dataset.tip = t('Show in the chat');
  who.append(avatar(l.nick, l.mask), h('span', 'shelf-nick', l.nick), h('span', 'shelf-time', shortWhen(l.ts)));
  who.addEventListener('click', () => openLine(l));
  // Every card keeps three lines, so cards filling in as they scroll into view never move the list.
  const blank = '\u00a0';
  let site = url;
  try {
    site = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    /* shown as typed */
  }
  let card = pageCard({ url, site, title: shortUrl(url), description: blank });
  row.append(who, card);
  row.fill = async () => {
    const p = await getPreview(url);
    if (p) {
      const next = pageCard({ ...p, url, site: p.site || site, title: p.title || shortUrl(url), description: p.description || blank });
      card.replaceWith(next);
      card = next;
    }
  };
  linkTitles.observe(row);
  return row;
}

function openNotified(id) {
  const target = notified.get(id);
  if (!target) {
    return;
  }
  select(target.key);
  // After the channel's own scroll to its New line has run.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const row = [...el.col.querySelectorAll('.text')].find((r) => r.line?.id === target.line);
      if (!row) {
        return;
      }
      stuck = false;
      row.scrollIntoView({ block: 'center' });
      noteAnchor();
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), FLASH_MS);
    }),
  );
}

// macOS gets its notifications from the system notification centre, the rest through the plugin.
// Resolves once the system has the notification; rejects with the reason it refused.
async function showNotification(title, body, icon, target = null) {
  const id = `${Date.now()}`;
  if (!IS_MAC) {
    notifier.sendNotification({ title, body, icon });
    return;
  }
  if (target) {
    notified.set(id, target);
    if (notified.size > NOTIFIED_KEEP) {
      notified.delete(notified.keys().next().value);
    }
  }
  await invoke('notify_mac', { id, title, body, image: icon || null });
}

// Green when the system took it, red with its reason when it refused. A Focus mode can still
// hide a notification the system took, so the green line says where to look.
el.notifyTest.addEventListener('click', async () => {
  let ok = true;
  let text = IS_MAC ? t('Sent. Not seeing it? A Focus mode may be hiding {app}.', { app: BRAND.name }) : t('Sent');
  try {
    await showNotification(BRAND.name, t('Notifications work.'), null);
  } catch (e) {
    ok = false;
    text = t('Not sent: {error}', { error: e });
  }
  el.notifyResult.textContent = text;
  el.notifyResult.classList.toggle('ok', ok);
  el.notifyResult.classList.toggle('fail', !ok);
  el.notifyResult.hidden = false;
});

// What macOS lets Lobby do, and the one step that fixes it: its Allow prompt the first time,
// System Settings after a no.
const GUIDE_SEEN_KEY = 'lobby.notifyGuide';

/** Text written about Lobby, with the app's own name in a fork. */
function appNamed(text) {
  return text.replace(/\bLobby\b/g, BRAND.name);
}

async function notifyPermission() {
  return IS_MAC ? invoke('notify_permission').catch(() => null) : null;
}

/** Right after the welcome: the system's Allow prompt, while someone is there to answer it. */
async function askToNotify() {
  if (!notifyOn()) {
    return;
  }
  if (IS_MAC) {
    if ((await notifyPermission())?.state === 'ask') {
      await invoke('allow_notifications').catch(() => {});
    }
    return;
  }
  notifier
    ?.isPermissionGranted()
    .then((granted) => granted || notifier.requestPermission())
    .catch(() => {});
}

async function fixNotifications() {
  const p = await notifyPermission();
  if (p?.state === 'ask') {
    await invoke('allow_notifications').catch((e) => renderStatus(t('Notifications: {error}', { error: e })));
  } else {
    await invoke('open_notify_settings').catch((e) => renderStatus(t('System Settings: {error}', { error: e })));
  }
  renderNotifyState();
}

async function renderNotifyState() {
  const fix = notifyAdvice(await notifyPermission());
  el.notifyState.hidden = !fix;
  el.notifyFix.hidden = !fix;
  if (!fix) {
    return;
  }
  el.notifyState.textContent = appNamed(fix.text);
  el.notifyFix.textContent = fix.action;
}

/** Once per Mac, the first time notifications are not working: say why and offer the fix. */
async function offerNotifyGuide() {
  if (!notifyOn()) {
    return;
  }
  try {
    if (localStorage.getItem(GUIDE_SEEN_KEY)) {
      return;
    }
  } catch {
    /* ask again next time */
  }
  const fix = notifyAdvice(await notifyPermission());
  // A first start asks once the welcome is done, with the system's own prompt.
  if (!fix || el.welcome.open) {
    return;
  }
  el.notifyGuideText.textContent = appNamed(fix.text);
  el.notifyGuideGo.textContent = fix.action;
  el.notifyGuide.showModal();
}

el.notifyFix.addEventListener('click', fixNotifications);
el.notifyGuideGo.addEventListener('click', async () => {
  el.notifyGuide.close();
  await fixNotifications();
});
el.notifyGuideLater.addEventListener('click', () => el.notifyGuide.close());
el.notifyGuide.addEventListener('close', () => {
  try {
    localStorage.setItem(GUIDE_SEEN_KEY, '1');
  } catch {
    /* asks again next start */
  }
  el.input.focus();
});
// Back from System Settings, the settings sheet shows what changed there.
window.addEventListener('focus', () => {
  if (el.settings.open) {
    renderNotifyState();
  }
});

// A photo as a file the notification can show, written once per photo.
const notifyIcons = new Map();
const PHOTO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function notifyIcon(photo) {
  const m = photo?.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m || !PHOTO_EXT[m[1]]) {
    return Promise.resolve(undefined);
  }
  if (!notifyIcons.has(photo)) {
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    const key = hashHex(photo);
    notifyIcons.set(
      photo,
      invoke('notify_icon', bytes, { headers: { 'x-key': key, 'x-ext': PHOTO_EXT[m[1]] } }).catch(() => undefined),
    );
  }
  return notifyIcons.get(photo);
}

// FNV-1a, enough to name a cache file.
function hashHex(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  }
  return (h >>> 0).toString(16);
}

el.notifyToggle.addEventListener('change', () => {
  saveSetting(NOTIFY_SETTING, el.notifyToggle.checked ? 'on' : 'off');
});

el.emoticonToggle.addEventListener('change', () => saveSetting(EMOTICON_SETTING, el.emoticonToggle.checked ? 'on' : 'off'));
for (const [id, key] of [
  ['nick-at-toggle', NICK_MENU_SETTINGS.at],
  ['nick-word-toggle', NICK_MENU_SETTINGS.word],
  ['hover-card-toggle', HOVER_CARD_SETTING],
  ['hover-wait-toggle', HOVER_CARD_WAIT_SETTING],
  ['pm-highlight-toggle', PM_HIGHLIGHT_SETTING],
]) {
  $(id).addEventListener('change', (e) => saveSetting(key, e.target.checked ? 'on' : 'off'));
}
$('pm-highlight-toggle').addEventListener('change', () => {
  inbox.lines.clear();
  renderInbox();
  loadHighlightsSoon();
});
$('hover-card-toggle').addEventListener('change', (e) => {
  $('hover-wait-toggle').disabled = !e.target.checked;
});
el.replyStyle.addEventListener('change', (e) => {
  saveSetting(REPLY_STYLE_SETTING, e.target.value);
  renderLog();
});
el.shortcodeToggle.addEventListener('change', () => saveSetting(SHORTCODE_SETTING, el.shortcodeToggle.checked ? 'on' : 'off'));

// Attachments: files go to the file host set in Settings, and their address into the message.

const UPLOAD_SETTING = 'upload';
const UPLOAD_VIA_SETTING = 'uploadVia';
const UPLOAD_S3_SETTING = 'uploadS3';
const UPLOAD_SFTP_SETTING = 'uploadSftp';

function uploadHost() {
  return state.settings[UPLOAD_SETTING] || '';
}

function uploadVia() {
  return state.settings[UPLOAD_VIA_SETTING] || 'auto';
}

function jsonSetting(key) {
  try {
    return JSON.parse(state.settings[key] || '{}');
  } catch {
    return {};
  }
}

/** The free host anyone can use: the fork's own, else catbox.moe. */
const SHARED_HOST = BRAND.upload ? { kind: 'filehost', url: BRAND.upload.url } : { kind: 'catbox' };

/** Where to try sending a file, in order. Automatic: lobby-server, your own file host, the shared host. */
async function uploadTargets() {
  const host = uploadHost();
  switch (uploadVia()) {
    case 'server':
      return [{ kind: 'server' }];
    case 'filehost':
      return [{ kind: 'filehost', url: host }];
    case 's3':
      return [{ kind: 's3', ...jsonSetting(UPLOAD_S3_SETTING) }];
    case 'sftp':
      return [{ kind: 'sftp', ...jsonSetting(UPLOAD_SFTP_SETTING) }];
    case 'catbox':
      return [SHARED_HOST];
  }
  const targets = [];
  // Only a lobby-server that says it has a place for files: an older one would never answer.
  if (state.serverUploads) {
    targets.push({ kind: 'server' });
  }
  if (host) {
    targets.push({ kind: 'filehost', url: host });
  }
  targets.push(SHARED_HOST);
  return targets;
}

function renderAttach() {
  el.attachBtn.hidden = uploadVia() === 'filehost' && !uploadHost();
}

function renderUploadSettings() {
  const via = uploadVia();
  for (const r of el.uploadVia.querySelectorAll('input')) {
    r.checked = r.value === via;
  }
  for (const part of el.settings.querySelectorAll('[data-via]')) {
    part.hidden = !part.dataset.via.split(' ').includes(via);
  }
  el.uploadUrl.value = uploadHost();
  const s3 = jsonSetting(UPLOAD_S3_SETTING);
  for (const f of el.settings.querySelectorAll('[data-s3]')) {
    f.value = s3[f.dataset.s3] || '';
  }
  const sftp = jsonSetting(UPLOAD_SFTP_SETTING);
  for (const f of el.settings.querySelectorAll('[data-sftp]')) {
    f.value = sftp[f.dataset.sftp] || '';
  }
  if (via === 'sftp' && !el.sftpKey.textContent) {
    // Lobby's own public key, without the tunnel-only options in front of it.
    invoke('get_connection')
      .then((c) => {
        el.sftpKey.textContent = `restrict ${c.key_line.split(' ').slice(-3).join(' ')}`;
      })
      .catch(() => {});
  }
}

function saveFields(key, attr) {
  const value = {};
  for (const f of el.settings.querySelectorAll(`[data-${attr}]`)) {
    value[f.dataset[attr]] = f.value.trim();
  }
  saveSetting(key, JSON.stringify(value));
}

el.uploadVia.addEventListener('change', (e) => {
  saveSetting(UPLOAD_VIA_SETTING, e.target.value);
  renderUploadSettings();
  renderAttach();
});
el.settings.addEventListener('change', (e) => {
  if (e.target.dataset.s3 !== undefined) {
    saveFields(UPLOAD_S3_SETTING, 's3');
  }
  if (e.target.dataset.sftp !== undefined) {
    saveFields(UPLOAD_SFTP_SETTING, 'sftp');
  }
});
el.sftpCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(el.sftpKey.textContent);
    el.sftpCopy.textContent = t('Copied');
  } catch {
    getSelection().selectAllChildren(el.sftpKey);
  }
});

function insertAtCursor(text) {
  const start = el.input.selectionStart ?? el.input.value.length;
  const end = el.input.selectionEnd ?? start;
  const before = el.input.value.slice(0, start);
  const spaced = `${before && !before.endsWith(' ') ? ' ' : ''}${text} `;
  el.input.setRangeText(spaced, start, end, 'end');
  fitInput();
  el.input.focus();
}

/** A sent file's link, with the cursor left in front of it for a few words about the file. */
function insertLink(url) {
  const start = el.input.selectionStart ?? el.input.value.length;
  const before = el.input.value.slice(0, start);
  const gap = before && !before.endsWith(' ') ? ' ' : '';
  el.input.setRangeText(`${gap} ${url}`, start, el.input.selectionEnd ?? start, 'start');
  el.input.setSelectionRange(start + gap.length, start + gap.length);
  fitInput();
  el.input.focus();
}

async function uploadFiles(files) {
  const targets = await uploadTargets();
  for (const file of files) {
    const name = file.name || `pasted.${file.type.split('/')[1] || 'png'}`;
    renderStatus(t('Uploading {name}…', { name }));
    const bytes = new Uint8Array(await file.arrayBuffer());
    let failure = '';
    for (const target of targets) {
      try {
        const url = await invoke('upload', bytes, {
          headers: {
            'x-target': JSON.stringify(target),
            'x-name': encodeURIComponent(name),
            'x-type': file.type || 'application/octet-stream',
          },
        });
        insertLink(url);
        failure = '';
        break;
      } catch (e) {
        failure = String(e);
      }
    }
    renderStatus(failure || undefined);
  }
}

el.attachBtn.addEventListener('click', () => el.attachFile.click());
el.attachFile.addEventListener('change', () => {
  uploadFiles([...el.attachFile.files]);
  el.attachFile.value = '';
});
el.input.addEventListener('paste', (e) => {
  const file = clipboardImage(e);
  if (!file) {
    return;
  }
  e.preventDefault();
  uploadFiles([file]);
});
document.addEventListener('dragover', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) {
    return;
  }
  e.preventDefault();
  document.body.classList.add('dropping');
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) {
    document.body.classList.remove('dropping');
  }
});
document.addEventListener('drop', (e) => {
  document.body.classList.remove('dropping');
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) {
    return;
  }
  e.preventDefault();
  uploadFiles(files);
});
el.highlightField.addEventListener('change', () => {
  el.highlightField.value = commaList(el.highlightField.value);
  saveSetting(HIGHLIGHT_WORDS_SETTING, el.highlightField.value);
  renderLog();
  loadHighlightsSoon();
});

for (const [field, setting] of [
  [el.notifyNicksField, NOTIFY_NICKS_SETTING],
  [el.notifyWordsField, NOTIFY_WORDS_SETTING],
]) {
  field.addEventListener('change', () => {
    field.value = commaList(field.value);
    saveSetting(setting, field.value);
    renderHeader();
  });
}

el.maskToggle.addEventListener('change', () => {
  saveSetting(MASK_SETTING, el.maskToggle.checked ? 'on' : 'off');
  refilter();
});
el.filterField.addEventListener('change', () => {
  el.filterField.value = commaList(el.filterField.value);
  saveSetting(FILTER_WORDS_SETTING, el.filterField.value);
  refilter();
});

el.botsField.addEventListener('change', () => {
  el.botsField.value = commaList(el.botsField.value);
  saveSetting(BOTS_SETTING, el.botsField.value);
  renderLog();
});
el.uploadUrl.addEventListener('change', () => {
  saveSetting(UPLOAD_SETTING, el.uploadUrl.value.trim());
  renderAttach();
});

// Now playing from Last.fm: bars by the emoji button while something plays. They open a card with
// the line to send, which goes to the channel or into the message box to add to.

const LASTFM_USER_SETTING = 'lastfmUser';
const LASTFM_KEY_SETTING = 'lastfmKey';
const NP_FORMAT_SETTING = 'npFormat';
const NP_POLL_MS = 30_000;
let nowPlaying = null;
let npTimer = 0;

async function pollNowPlaying() {
  clearTimeout(npTimer);
  const user = state.settings[LASTFM_USER_SETTING];
  const key = state.settings[LASTFM_KEY_SETTING];
  if (!user || !key) {
    setNowPlaying(null);
    return;
  }
  // Only asked while the window is in use; coming back asks at once.
  if (!document.hidden) {
    // A failed request keeps what was showing; the next one corrects it.
    const track = await invoke('now_playing', { user, key }).catch(() => undefined);
    if (track !== undefined) {
      setNowPlaying(track);
    }
  }
  npTimer = setTimeout(pollNowPlaying, NP_POLL_MS);
}

function setNowPlaying(track) {
  nowPlaying = track;
  el.npBtn.hidden = !track;
  el.npBtn.dataset.tip = track ? `${track.artist} – ${track.title}` : '';
  if (!track) {
    closeNp();
  } else if (!el.npCard.hidden) {
    fillNp();
  }
}

function npText() {
  return npLine(state.settings[NP_FORMAT_SETTING], nowPlaying);
}

function fillNp() {
  const b = state.buffers.get(state.current);
  el.npTitle.textContent = nowPlaying.title;
  el.npArtist.textContent = [nowPlaying.artist, nowPlaying.album].filter(Boolean).join(' · ');
  el.npCover.hidden = !nowPlaying.image;
  el.npCover.style.backgroundImage = nowPlaying.image ? `url("${CSS.escape(nowPlaying.image)}")` : '';
  el.npLine.textContent = npText();
  el.npSend.textContent = b ? t('Send to {name}', { name: label(b) }) : t('Send');
  el.npSend.disabled = !b;
}

function openNp() {
  fillNp();
  el.npCard.hidden = false;
  el.npBtn.setAttribute('aria-expanded', 'true');
}

function closeNp() {
  el.npCard.hidden = true;
  el.npBtn.setAttribute('aria-expanded', 'false');
}

el.npBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  el.npCard.hidden ? openNp() : closeNp();
});
el.npCard.addEventListener('pointerdown', (e) => e.stopPropagation());
document.addEventListener('pointerdown', (e) => {
  if (!el.npCard.hidden && e.target !== el.npBtn && !el.npBtn.contains(e.target)) {
    closeNp();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el.npCard.hidden) {
    closeNp();
  }
});
el.npSend.addEventListener('click', async () => {
  const b = state.buffers.get(state.current);
  if (!b || !nowPlaying) {
    return;
  }
  closeNp();
  try {
    await invoke('send', { net: b.net, buffer: b.name, text: npText() });
  } catch (err) {
    renderStatus(String(err));
  }
});
el.npEdit.addEventListener('click', () => {
  closeNp();
  insertAtCursor(npText());
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    pollNowPlaying();
  }
});
for (const [field, key] of [
  [el.lastfmUser, LASTFM_USER_SETTING],
  [el.lastfmKey, LASTFM_KEY_SETTING],
  [el.npFormat, NP_FORMAT_SETTING],
]) {
  field.addEventListener('change', () => {
    saveSetting(key, field.value.trim());
    pollNowPlaying();
  });
}

// Most active, like toptod: words said per person in a channel. Where today starts in the chat,
// a card shows yesterday's top three; the people list ranks today so far.

const PODIUM_STEP_PX = [64, 46, 32];
const CROWN =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 7.5l4.5 4 4.5-6.5 4.5 6.5 4.5-4-2 11.5H5z"/></svg>';

/** The most active one's crown. */
function crown() {
  const c = h('span', 'crown');
  c.innerHTML = CROWN;
  c.setAttribute('aria-label', t('Most active'));
  return c;
}
const recaps = new Map();

/** Midnight of the day `daysBack` days ago, in local time. */
function dayStart(daysBack = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d.getTime();
}

/** Words per person between two times, without the bots from Settings. */
/** Words per person between two times, without the bots from Settings; null if not counted. */
async function talkers(b, since, until) {
  const bots = botNicks(state.settings[BOTS_SETTING]);
  const list = await invoke('talkers', { net: b.net, buffer: b.name, since, until }).catch(() => null);
  return list?.filter((t) => !bots.has(t.nick.toLowerCase()) && !isIgnored(t.nick) && !isMutedNick(t.nick)) ?? null;
}

async function addRecap(b) {
  if (!isChannel(b.name)) {
    return;
  }
  const today = dayStart();
  const line = [...el.col.querySelectorAll(':scope > .day')].find((d) => d.textContent === dayLabel(today));
  if (!line) {
    return;
  }
  const cached = `${b.key}|${today}`;
  if (!recaps.has(cached)) {
    recaps.set(cached, await talkers(b, dayStart(1), today));
  }
  const list = recaps.get(cached);
  if (!list?.length || state.current !== b.key || !line.isConnected || line.nextElementSibling?.classList.contains('recap')) {
    return;
  }
  // The card goes in above what is being read; WebKit does not hold the view in place on its own.
  const bottom = atBottom();
  const spot = bottom ? null : topSpot();
  line.after(recapCard(b, list));
  if (bottom) {
    toBottom();
  } else {
    toSpot(spot);
  }
}

function recapCard(b, list) {
  const card = h('div', 'recap');
  const words = list.reduce((n, t) => n + t.words, 0);
  const vars = { n: list.length, words: words.toLocaleString('fi-FI') };
  card.append(
    h('div', 'recap-title', t('Yesterday in {name}', { name: label(b) })),
    h('div', 'recap-sub', list.length === 1 ? t('{n} person said {words} words', vars) : t('{n} people said {words} words', vars)),
  );
  const podium = h('div', 'podium');
  // Second, first, third, as on a podium.
  for (const place of [1, 0, 2]) {
    const who = list[place];
    if (!who) {
      continue;
    }
    const spot = h('div', 'podium-spot');
    const name = h('span', 'podium-name', identity(who.nick).name);
    name.classList.toggle('me', who.nick.toLowerCase() === (state.me[b.net] || '').toLowerCase());
    const step = h('div', 'podium-step', String(place + 1));
    step.style.height = `${PODIUM_STEP_PX[place]}px`;
    step.dataset.place = String(place + 1);
    spot.append(
      ...(place === 0 ? [crown()] : []),
      avatar(who.nick, ''),
      name,
      h('span', 'podium-count', who.words.toLocaleString('fi-FI')),
      step,
    );
    personTip(name, b.net, who.nick);
    podium.append(spot);
  }
  card.append(podium);
  return card;
}

// The people list's Today ranking: words said in the channel since midnight, fetched again when
// older than TODAY_FRESH_MS, so a busy channel does not ask on every line.

const TODAY_FRESH_MS = 30_000;

function peopleTabs() {
  const tabs = h('div', 'nl-tabs');
  for (const [id, name] of [
    ['people', t('People')],
    ['today', t('Today')],
  ]) {
    const tab = h('button', null, name);
    tab.type = 'button';
    tab.setAttribute('aria-pressed', String(nicklist.tab === id));
    tab.addEventListener('click', () => {
      nicklist.tab = id;
      renderNicklist();
    });
    tabs.append(tab);
  }
  return tabs;
}

function todayRanking(b) {
  const today = nicklist.today;
  if (!today || today.key !== b.key || Date.now() - today.at > TODAY_FRESH_MS) {
    refreshToday(b);
  }
  if (today?.key !== b.key) {
    return [h('div', 'nl-empty', t('Counting…'))];
  }
  const list = today.list;
  // An older lobby-server does not count words; it never answers the request.
  if (!list) {
    return [h('div', 'nl-empty', t('Your lobby-server needs an update to count this.'))];
  }
  if (!list.length) {
    return [h('div', 'nl-empty', t('Nobody has said anything here today.'))];
  }
  const me = (state.me[b.net] || '').toLowerCase();
  const place = list.findIndex((x) => x.nick.toLowerCase() === me);
  const usual = nicklist.today.usual;
  const usualText = usual === undefined ? '' : keepLastTwo(usualLine(place === -1 ? 0 : list[place].words, usual));
  const out = [];
  // Your own place shows when you point at your row; without one it stays on top.
  const line = standing(list, place);
  if (usualText) {
    line.append(h('div', 'nl-usual', usualText));
  }
  if (place === -1) {
    out.push(line);
  }
  const most = list[0].words;
  list.forEach((x, i) => {
    const row = h('div', 'nl-rank');
    row.classList.toggle('me', i === place);
    const bar = h('span', 'nl-meter');
    const fill = h('i');
    fill.style.width = `${(x.words / most) * 100}%`;
    bar.append(fill);
    const name = h('span', 'nl-name', identity(x.nick).name);
    if (i === place) {
      row.dataset.tip = line.textContent;
      row.tipNode = line;
    } else {
      personTip(name, b.net, x.nick);
    }
    // The place shows over the photo on hover.
    const face = h('span', 'nl-face');
    face.append(avatar(x.nick, ''), h('span', 'nl-place', String(i + 1)));
    row.append(face, name, h('span', 'nl-words', x.words.toLocaleString('fi-FI')), bar);
    out.push(row);
  });
  return out;
}

async function refreshToday(b) {
  if (nicklist.today?.loading === b.key) {
    return;
  }
  nicklist.today = { ...nicklist.today, loading: b.key };
  const [list, usual] = await Promise.all([talkers(b, dayStart(), Date.now() + 1), usualWords(b)]);
  nicklist.today = { key: b.key, at: Date.now(), list, usual, loading: null };
  if (nicklist.el && nicklist.tab === 'today' && channelShown()?.key === b.key) {
    renderNicklist();
  }
}

/** "You are **3rd** with 272 words." */
function standing(list, place) {
  const line = h('div', 'nl-standing');
  if (place === -1) {
    line.textContent = t('You have not said anything here today.');
    return line;
  }
  // The place is bold, so the sentence is split around it. The count and "words." stay together,
  // so "words." never wraps onto a line of its own.
  const text = t('You are {place} with {words} words.', { words: list[place].words.toLocaleString('fi-FI') });
  const [before, after] = text.split('{place}');
  line.append(before, h('b', null, ordinal(place + 1)), keepLastTwo(after));
  return line;
}

// "Usual" is your average by this time of day over the earlier days the channel was talked on,
// once there are USUAL_MIN_DAYS of them; it is worked out again after USUAL_FRESH_MS.
const USUAL_DAYS = 14;
const USUAL_MIN_DAYS = 3;
const USUAL_FRESH_MS = 600_000;
const ABOUT_SAME_PERCENT = 5;
const usuals = new Map();

async function usualWords(b) {
  const known = usuals.get(b.key);
  if (known && Date.now() - known.at < USUAL_FRESH_MS) {
    return known.value;
  }
  const me = (state.me[b.net] || '').toLowerCase();
  const sinceMidnight = Date.now() - dayStart();
  const back = Array.from({ length: USUAL_DAYS }, (_, i) => i + 1);
  const days = await Promise.all(back.map((d) => talkers(b, dayStart(d), dayStart(d) + sinceMidnight)));
  const talked = days.filter((list) => list?.length);
  const mine = talked.map((list) => list.find((t) => t.nick.toLowerCase() === me)?.words || 0);
  const value = talked.length >= USUAL_MIN_DAYS ? mine.reduce((n, w) => n + w, 0) / talked.length : undefined;
  usuals.set(b.key, { at: Date.now(), value });
  return value;
}

/** "23% more than usual by this time." */
function usualLine(words, usual) {
  if (!usual) {
    return words ? t('More than usual by this time.') : t('Quiet as usual by this time.');
  }
  const percent = Math.round((words / usual - 1) * 100);
  if (Math.abs(percent) < ABOUT_SAME_PERCENT) {
    return t('About as much as usual by this time.');
  }
  const n = Math.abs(percent);
  return percent > 0 ? t('{n}% more than usual by this time.', { n }) : t('{n}% less than usual by this time.', { n });
}

/** Joins the last two words, so the last one never ends up alone on a line. */
function keepLastTwo(text) {
  const at = text.lastIndexOf(' ');
  return at === -1 ? text : `${text.slice(0, at)}\u00a0${text.slice(at + 1)}`;
}

/** 3rd in English, 3. in Finnish. */
function ordinal(n) {
  if (currentLang() === 'fi') {
    return `${n}.`;
  }
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const end = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  return `${n}${end}`;
}

// Keys for the rest: reply to the last message, page through the chat, move through the
// highlights and the Settings tabs with the arrows.

/** Reply to the newest message from someone else in this channel. */
function replyToLast() {
  const b = state.buffers.get(state.current);
  const last = b?.lines.findLast((l) => CHAT_KINDS.has(l.kind) && !l.own && l.nick !== state.me[b.net]);
  if (last) {
    startReply(last);
  }
}

const PAGE_PART = 0.9;
const SCROLL_STEP_PX = 80;

/** A step up or down, like a turn of the wheel; holding the key keeps it going. */
function scrollChat(direction) {
  stopGlide();
  movedByHand = true;
  el.log.scrollBy({ top: direction * SCROLL_STEP_PX });
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'PageUp' && e.key !== 'PageDown') {
    return;
  }
  // From the message box or nowhere in particular, the keys page through the chat.
  const at = document.activeElement;
  if (at !== el.input && at !== document.body && !el.log.contains(at)) {
    return;
  }
  e.preventDefault();
  stopGlide();
  movedByHand = true;
  el.log.scrollBy({ top: (e.key === 'PageUp' ? -1 : 1) * el.log.clientHeight * PAGE_PART });
});

el.inboxList.addEventListener('keydown', (e) => {
  const row = e.target.closest('.inbox-row');
  if (!row) {
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    (e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling)?.focus();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && row.fresh) {
    e.preventDefault();
    const next = row.nextElementSibling || row.previousElementSibling;
    markDone(row.line.id);
    // The list is drawn again; the row that took this one's place gets the focus.
    renderInbox();
    [...el.inboxList.children].find((r) => r.line?.id === next?.line?.id)?.focus();
  }
});

// With the highlights open, the down arrow goes into the list from the filter or from anywhere else.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' || el.inbox.hidden || el.inboxList.contains(document.activeElement)) {
    return;
  }
  e.preventDefault();
  el.inboxList.querySelector('.inbox-row')?.focus();
});

el.settingsTabs.addEventListener('keydown', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (!tab || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) {
    return;
  }
  e.preventDefault();
  const next = e.key === 'ArrowDown' ? tab.nextElementSibling : tab.previousElementSibling;
  if (next) {
    next.focus();
    next.click();
  }
});

// Sign out and Reset ask twice: the first press only arms the button for a moment.
const CONFIRM_MS = 4000;

function armed(button, label, action) {
  let timer = null;
  button.addEventListener('click', () => {
    if (!timer) {
      button.textContent = t('Press again to confirm');
      timer = setTimeout(() => {
        timer = null;
        button.textContent = t(label);
      }, CONFIRM_MS);
      return;
    }
    clearTimeout(timer);
    timer = null;
    action().catch((e) => renderStatus(String(e)));
  });
}

armed($('sign-out'), 'Sign out', async () => {
  const nick = (await invoke('get_connection').catch(() => null))?.nick ?? '';
  const connection = { mode: '', ssh: '', ssh_port: null, port: null, url: '', token: '', nick, networks: [], key_line: '' };
  await invoke('save_connection', { connection });
  for (const key of [CHAT_SHOWN_KEY, ACCOUNT_WAITING_KEY, FRESH_DEVICE_KEY]) {
    storeFlag(key, '');
  }
  location.reload();
});

armed($('reset-app'), 'Reset the app', async () => {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* storage may be unavailable */
  }
  await invoke('reset_app');
});

$('welcome-other-ways').addEventListener('click', () => showWelcomeStep('ways'));
