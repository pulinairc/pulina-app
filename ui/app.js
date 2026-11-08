import {
  CHAT_KINDS, EVENT_KINDS, clock, commandMatches, completeNick, continues, dayLabel,
  DEFAULT_SHORTCUTS, animalFor, colonQuery, comboLabel, comboMods, comboOf, colorFromRgb, convertEmoticons, emojiSearch, formatWhois, splitNicks, duration, isChannel, mentions, nickColor, parseAddress, personFor, parseReaction, sameDay, shortUrl, stripFormatting, summarize, tokenize, youtube,
} from './lib.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { openUrl } = window.__TAURI__.opener;

const MAX_LINES = 2000;
const BOTTOM_SLACK_PX = 48;
const LAST_BUFFER_KEY = 'lobby.current';
const FIRST_PICK_DELAY_MS = 400;
const QUICK_REACTIONS = ['👍', '😂', '❤️', '🔥', '😮'];
const REACTION_SETTING = 'reactions';
// Emoji helpers in the message box, on unless turned off.
const EMOTICON_SETTING = 'emoticons';
const SHORTCODE_SETTING = 'shortcodes';
const PHOTO_PX = 160;
const PHOTO_QUALITY = 0.85;
const COLOR_SAMPLE_PX = 24;
const ROUND_SAMPLE_PX = 32;
// The largest square inside a circle is 1/√2 of its width; a little less avoids the rim.
const ROUND_INNER = 0.7;
// Colours offered for people, purple left out.
const SWATCHES = ['#f7768e', '#ff9e64', '#e0af68', '#9ece6a', '#73daca', '#7dcfff', '#d6d6da'];
const PERSON_ICON = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
const CAMERA_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
// A "nick: text" line shows the nick's previous message as a quote when it is this recent.
const REPLY_WINDOW_MS = 30 * 60 * 1000;
const QUOTE_CHARS = 120;
const READ_SETTING = 'read';
const READ_SAVE_DELAY_MS = 1500;
// Leave this much of the earlier chat visible above the "New" line when opening at it.
const SEPARATOR_MARGIN_PX = 48;
// Server answers (WHOIS, errors) show in the open window when a command was sent this recently.
const COMMAND_ANSWER_MS = 15000;

const $ = (id) => document.getElementById(id);
const el = {
  title: $('title'), chanIcon: $('chan-icon'), chanName: $('chan-name'), chanMeta: $('chan-meta'),
  unread: $('unread'), gear: $('gear'), bell: $('bell'), status: $('status'), statusText: $('status-text'), statusAction: $('status-action'), toast: $('toast'), log: $('log'), col: $('col'),
  form: $('composer'), input: $('input'), jumpUnread: $('jump-unread'), jumpUnreadLabel: $('jump-unread-label'), jumpLatest: $('jump-latest'),
  markRead: $('mark-read'), markReadLabel: $('mark-read-label'), notifyToggle: $('notify-toggle'), notifyTest: $('notify-test'), emoticonToggle: $('emoticon-toggle'), shortcodeToggle: $('shortcode-toggle'), iconChoices: $('icon-choices'), shortcutList: $('shortcut-list'), shortcutReset: $('shortcut-reset'), emojiBtn: $('emoji-btn'), attachBtn: $('attach-btn'), attachFile: $('attach-file'), uploadUrl: $('upload-url'),
  slash: $('slash'), replying: $('replying'),
  openPeople: $('open-people'), people: $('people'), peopleTitle: $('people-title'), peopleBack: $('people-back'),
  peopleClose: $('people-close'), peopleList: $('people-list-view'), peopleItems: $('people-list'), personNew: $('person-new'),
  personEdit: $('person-edit'), personPhoto: $('person-photo'),
  personPhotoRemove: $('person-photo-remove'), personFile: $('person-file'), personName: $('person-name'),
  personColor: $('person-color'), personColors: $('person-colors'),
  personNicks: $('person-nicks'), personNick: $('person-nick'), personDelete: $('person-delete'), replyNick: $('reply-nick'), replyText: $('reply-text'), replyClose: $('reply-close'),
  switcher: $('switcher'), filter: $('filter'), list: $('list'),
  settings: $('settings'), settingsClose: $('settings-close'), connections: $('connections'), configPath: $('config-path'), openConnection: $('open-connection'),
  connection: $('connection'), connectionForm: $('connection-form'), connectionClose: $('connection-close'), connectionAbout: $('connection-about'), connectionError: $('connection-error'),
  connSsh: $('conn-ssh'), connSshPort: $('conn-ssh-port'), connPort: $('conn-port'), connKey: $('conn-key'), connCopy: $('conn-copy'), connUrl: $('conn-url'),
  connToken: $('conn-token'), connNick: $('conn-nick'), connNetworks: $('conn-networks'), connAddNet: $('conn-add-net'),
};

const state = { networks: [], buffers: new Map(), current: null, me: {}, conn: {}, configPath: '', people: [], settings: {} };
const previews = new Map();
let view = null;
let completion = null;
let lastSent = '';
let picked = 0;

// The system comes from the app itself: an iPhone's web view also calls itself Mac OS X.
const PLATFORM = { value: 'linux' };

const key = (net, name) => `${net}\u0000${name.toLowerCase()}`;
const label = (b) => b.name || b.net;
const isPrivate = (b) => b.name !== '' && !isChannel(b.name);

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Who a nick is: their person's name, colour and photo when one matches.

// Colours read from photos, worked out once per photo and kept for the session.
// Photos as shown, and their colours: worked out once per photo and kept for the session.
const photoInfos = new Map();

function photoInfo(photo) {
  if (photoInfos.has(photo)) return photoInfos.get(photo);
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
    if (el.people.open && !el.peopleList.hidden) renderPeople();
  }, PHOTO_REFRESH_DELAY_MS);
}

/** Redraw the chat without moving what the reader is looking at. */
function redrawKeepingScroll() {
  const fromBottom = el.log.scrollHeight - el.log.scrollTop;
  const pinned = atBottom();
  renderLog();
  if (pinned) toBottom();
  else el.log.scrollTop = el.log.scrollHeight - fromBottom;
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

function identity(nick, mask = '') {
  const person = personFor(state.people, nick, mask);
  return {
    person,
    name: person?.name || nick,
    color: personColor(person, nick),
    photo: shownPhoto(person?.photo),
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
  node.textContent = animalFor(nick);
  node.style.background = `linear-gradient(color-mix(in srgb, ${color} 45%, white), ${color})`;
  return node;
}

// Read markers: the last line id seen per channel, stored as a setting so every device agrees.

let readMap = {};
let readSaveTimer = null;

function lastId(b) {
  for (let i = b.lines.length - 1; i >= 0; i -= 1) if (b.lines[i].id) return b.lines[i].id;
  return 0;
}

function saveReadSoon() {
  clearTimeout(readSaveTimer);
  readSaveTimer = setTimeout(() => saveSetting(READ_SETTING, JSON.stringify(readMap)), READ_SAVE_DELAY_MS);
}

function markRead(b) {
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
    readMap[b.key] = lastId(b);
    return;
  }
  const seen = readMap[b.key];
  const fresh = b.lines.filter((l) => l.id > seen && CHAT_KINDS.has(l.kind) && !l.own);
  b.unread = fresh.length;
  b.mention = fresh.length > 0 && (isPrivate(b) || fresh.some((l) => mentions(l.text, state.me[l.net])));
}

function applyReadSetting(value) {
  let incoming = {};
  try { incoming = JSON.parse(value || '{}'); } catch { /* keep what we have */ }
  for (const [k, id] of Object.entries(incoming)) readMap[k] = Math.max(readMap[k] || 0, id);
  for (const b of state.buffers.values()) if (b.key !== state.current) recountUnread(b);
  renderHeader();
}

// Buffers

function buffer(net, name) {
  const k = key(net, name);
  const existing = state.buffers.get(k);
  if (existing) return existing;

  const b = { key: k, net, name, lines: [], ids: new Set(), unread: 0, mention: false, topic: '', members: new Set(), joined: false };
  state.buffers.set(k, b);
  loadHistory(b);
  renderHeader();
  if (!state.current && state.started) scheduleFirstPick();
  return b;
}

async function loadHistory(b) {
  const lines = await invoke('history', { net: b.net, buffer: b.name }).catch(() => []);
  // First time this channel is seen anywhere: its old history counts as read.
  if (readMap[b.key] === undefined) {
    readMap[b.key] = lines.reduce((max, l) => Math.max(max, l.id || 0), 0);
    saveReadSoon();
  }
  const fresh = lines.filter((l) => !b.ids.has(l.id));
  if (!fresh.length) return;
  for (const l of fresh) b.ids.add(l.id);
  b.lines = [...b.lines, ...fresh].sort((x, y) => (x.id || Infinity) - (y.id || Infinity)).slice(-MAX_LINES);
  if (state.current === b.key) {
    renderLog();
    return;
  }
  recountUnread(b);
  renderHeader();
}

function trackMembers(b, l) {
  if (l.kind === 'join') b.members.add(l.nick);
  if (l.kind === 'part' || l.kind === 'quit' || l.kind === 'kick') b.members.delete(l.nick);
  if (l.kind === 'nick') {
    b.members.delete(l.nick);
    b.members.add(l.text);
  }
}

function onLine(l) {
  if (l.kind === 'info' && Date.now() - lastCommandAt < COMMAND_ANSWER_MS && view) {
    const pinned = atBottom();
    el.col.append(h('div', 'events info', l.text));
    if (pinned) toBottom();
  }
  const b = buffer(l.net, l.buffer);
  if (l.id && b.ids.has(l.id)) return;
  if (l.id) b.ids.add(l.id);
  b.lines.push(l);
  if (b.lines.length > MAX_LINES) b.lines.shift();
  trackMembers(b, l);

  const visible = state.current === b.key;
  if (visible) {
    appendLine(l, true);
    updateJumps();
  }
  // Nothing is marked read on its own: only the Mark as read button does that.
  if (!CHAT_KINDS.has(l.kind) || l.own) return;

  b.unread += 1;
  const mentioned = isPrivate(b) || mentions(l.text, state.me[l.net]);
  if (mentioned) b.mention = true;
  if (mentioned && !(visible && document.hasFocus())) notify(b, l);
  renderHeader();
}

function onBuffer(info) {
  const b = buffer(info.net, info.name);
  b.topic = info.topic;
  b.joined = info.joined;
  b.members = new Set(info.members);
  renderHeader();
}

function ordered() {
  const kind = (b) => (b.name === '' ? 2 : isPrivate(b) ? 1 : 0);
  const netIndex = (b) => {
    const i = state.networks.indexOf(b.net);
    return i === -1 ? 99 : i;
  };
  return [...state.buffers.values()].sort((a, b) =>
    netIndex(a) - netIndex(b) || kind(a) - kind(b) || label(a).localeCompare(label(b)));
}

// Header

const CHANNELS_SETTING = 'channels';
const MUTED_SETTING = 'muted';

/** Muted channels add nothing to unread counts or jumps, except mentions. */
function mutedKeys() {
  try { return new Set(JSON.parse(state.settings[MUTED_SETTING] || '[]')); } catch { return new Set(); }
}

function isMuted(b) {
  return mutedKeys().has(b.key);
}

/** Does this channel's unread deserve attention? */
function wantsAttention(b) {
  return b.unread > 0 && (b.mention || !isMuted(b));
}

const BELL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>';
const BELL_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.7 3.6A6 6 0 0 1 18 8c0 3 .6 5 1.4 6.4M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>';

function renderBell(b) {
  el.bell.hidden = b.name === '';
  const muted = isMuted(b);
  el.bell.replaceChildren(svg(muted ? BELL_OFF : BELL));
  el.bell.setAttribute('aria-pressed', String(muted));
  el.bell.setAttribute('aria-label', muted ? 'Unmute channel' : 'Mute channel');
  el.bell.dataset.tip = muted ? 'Unmute' : 'Mute';
}

function setMuted(b, muted) {
  const keys = mutedKeys();
  if (muted) keys.add(b.key);
  else keys.delete(b.key);
  saveSetting(MUTED_SETTING, JSON.stringify([...keys]));
  renderHeader();
}

/** A channel's own picture and colour, set from its header icon. */
function channelLook(b) {
  try { return JSON.parse(state.settings[CHANNELS_SETTING] || '{}')[b.key] || {}; } catch { return {}; }
}

function icon(b, node) {
  node.style.background = '';
  node.style.color = '';
  node.classList.remove('animal');
  node.replaceChildren();
  if (isPrivate(b)) {
    const who = identity(b.name);
    if (who.photo) return photoInto(node, who.photo);
    return animalInto(node, b.name, who.color);
  }
  const look = channelLook(b);
  if (look.photo) return photoInto(node, shownPhoto(look.photo));
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

// The Dock badge counts unread highlights: messages that name you, and private messages.
let shownBadge = -1;

function highlightCount() {
  let n = 0;
  for (const b of state.buffers.values()) {
    if (!b.mention) continue;
    const seen = readMap[b.key] ?? Infinity;
    const fresh = b.lines.filter((l) => l.id > seen && CHAT_KINDS.has(l.kind) && !l.own);
    n += isPrivate(b) ? fresh.length : fresh.filter((l) => mentions(l.text, state.me[l.net])).length;
  }
  return n;
}

function updateBadge() {
  const n = highlightCount();
  if (n === shownBadge) return;
  shownBadge = n;
  invoke('set_badge', { count: n }).catch(() => {});
}

function renderHeader() {
  updateBadge();
  const b = state.buffers.get(state.current);
  if (b) {
    icon(b, el.chanIcon);
    el.chanName.textContent = label(b);
    const who = isPrivate(b) ? 'private' : b.name === '' ? 'server messages' : `${b.members.size} people`;
    el.chanMeta.textContent = `${b.net} · ${who}${isMuted(b) ? ' · muted' : ''}`;
    renderBell(b);
    el.title.dataset.tip = b.topic || '';
  }

  const others = [...state.buffers.values()].filter((x) => x.key !== state.current && wantsAttention(x));
  const total = others.reduce((n, x) => n + x.unread, 0);
  el.unread.hidden = total === 0;
  el.unread.textContent = `${total} unread`;
  el.unread.classList.toggle('mention', others.some((x) => x.mention));
  document.title = total ? `Lobby (${total})` : 'Lobby';

  if (el.switcher.open) renderList();
}

// Connection trouble shows as one clear line under the header; other messages as a toast that goes away.
const TOAST_MS = 6000;
const UNREACHABLE = 'lobby-server unreachable';
let toastTimer = null;

function renderStatus(message) {
  if (message !== undefined) showToast(message);
  else if (el.toast.dataset.sticky) hideToast();
  renderConnection();
  if (el.settings.open) renderSettings();
}

function showToast(text) {
  clearTimeout(toastTimer);
  el.toast.textContent = text;
  el.toast.hidden = false;
  // A message ending in … is work in progress: it stays until the next one.
  const sticky = text.endsWith('…');
  el.toast.dataset.sticky = sticky ? '1' : '';
  if (!sticky) toastTimer = setTimeout(hideToast, TOAST_MS);
}

function hideToast() {
  el.toast.hidden = true;
  el.toast.dataset.sticky = '';
}

function connectionText() {
  if (state.setupError) return { level: 'error', text: 'Lobby is not connected to anything yet.' };
  const down = state.networks.filter((n) => state.conn[n] && state.conn[n] !== 'connected');
  if (!down.length) return null;
  if (down.every((n) => state.conn[n] === UNREACHABLE)) {
    return { level: 'warn', text: "Can't reach lobby-server. Trying again every few seconds." };
  }
  const connecting = down.filter((n) => state.conn[n] === 'connecting');
  const parts = [];
  if (connecting.length) parts.push(`Connecting to ${connecting.join(', ')}…`);
  for (const n of down.filter((x) => !connecting.includes(x))) {
    const reason = state.conn[n].replace(/^disconnected:?\s*/, '').replace(/\s*\(os error \d+\)/, '');
    const why = reason && reason !== UNREACHABLE ? `: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : '';
    parts.push(`${n} is disconnected${why}. Trying again.`);
  }
  return { level: connecting.length === down.length ? 'info' : 'warn', text: parts.join(' ') };
}

function renderConnection() {
  const c = connectionText();
  el.status.hidden = !c;
  if (!c) return;
  el.status.dataset.level = c.level;
  el.statusText.textContent = c.text;
  el.statusAction.textContent = c.level === 'error' ? 'Set up' : 'Connection';
}

function select(k) {
  const b = state.buffers.get(k);
  if (!b) return;
  state.current = k;
  try { localStorage.setItem(LAST_BUFFER_KEY, k); } catch { /* storage may be unavailable */ }
  el.input.placeholder = `Message ${label(b)}`;
  renderHeader();
  renderLog();
  el.input.focus();
}

function step(offset) {
  const list = ordered();
  const i = list.findIndex((b) => b.key === state.current);
  const next = list[(i + offset + list.length) % list.length];
  if (next) select(next.key);
}

// Switcher

function matches() {
  const q = el.filter.value.trim().toLowerCase();
  return ordered().filter((b) => !q || label(b).toLowerCase().includes(q) || b.net.toLowerCase().includes(q));
}

function renderList() {
  const list = matches();
  picked = Math.min(picked, Math.max(list.length - 1, 0));
  const nodes = [];
  let net = null;
  list.forEach((b, i) => {
    if (b.net !== net) {
      net = b.net;
      nodes.push(h('div', 'list-net', net));
    }
    const item = h('button', 'item');
    item.type = 'button';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(i === picked));
    item.classList.toggle('current', b.key === state.current);
    item.classList.toggle('mention', b.mention);
    item.classList.toggle('muted', isMuted(b));
    item.append(icon(b, h('span', 'chan-icon')), h('span', 'name', label(b)));
    if (isMuted(b)) item.append(svg(ICONS.bellOff));
    if (wantsAttention(b)) item.append(h('span', 'count', String(b.unread)));
    item.addEventListener('click', () => pick(b.key));
    nodes.push(item);
  });
  el.list.replaceChildren(...nodes);
  el.list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

function openSwitcher() {
  el.filter.value = '';
  picked = 0;
  renderList();
  el.switcher.showModal();
  el.filter.focus();
}

function pick(k) {
  el.switcher.close();
  select(k);
}

el.title.addEventListener('click', openSwitcher);
el.bell.addEventListener('click', () => {
  const b = state.buffers.get(state.current);
  if (b) setMuted(b, !isMuted(b));
});
el.chanIcon.addEventListener('click', (e) => {
  e.stopPropagation();
  const b = state.buffers.get(state.current);
  if (!b || b.name === '') return;
  if (isPrivate(b)) openPerson(b.name, '');
  else editChannel(b);
});
el.unread.addEventListener('click', jumpToUnreadChannel);
el.filter.addEventListener('input', () => {
  picked = 0;
  renderList();
});
el.filter.addEventListener('keydown', (e) => {
  const list = matches();
  if (e.key === 'ArrowDown') picked = Math.min(picked + 1, list.length - 1);
  else if (e.key === 'ArrowUp') picked = Math.max(picked - 1, 0);
  else if (e.key === 'Enter' && list[picked]) {
    // The same Enter would otherwise land in the message box as a new line.
    e.preventDefault();
    return pick(list[picked].key);
  }
  else return;
  e.preventDefault();
  renderList();
});
el.switcher.addEventListener('click', (e) => {
  if (e.target === el.switcher) el.switcher.close();
});

// Settings

function renderSettings() {
  el.notifyToggle.checked = notifyOn();
  el.emoticonToggle.checked = settingOn(EMOTICON_SETTING);
  el.shortcodeToggle.checked = settingOn(SHORTCODE_SETTING);
  renderIconChoices();
  renderShortcuts();
  el.uploadUrl.value = uploadHost();
  const rows = state.networks.map((n) => {
    const row = h('div', 'conn');
    const name = h('span', '', state.me[n] ? `${n} · ${state.me[n]}` : n);
    const st = state.conn[n] || 'waiting';
    row.append(name, h('span', `state${st === 'connected' ? ' ok' : ''}`, st));
    return row;
  });
  el.connections.replaceChildren(...(rows.length ? rows : [h('p', 'hint', 'No networks configured.')]));
  el.configPath.textContent = state.configPath;
}

el.gear.addEventListener('click', () => {
  renderSettings();
  el.settings.showModal();
  el.settings.focus();
});
el.settingsClose.addEventListener('click', () => el.settings.close());
el.settings.addEventListener('click', (e) => {
  if (e.target === el.settings) el.settings.close();
});
el.settings.addEventListener('close', () => el.input.focus());
el.switcher.addEventListener('close', () => el.input.focus());

// Log

function atBottom() {
  return el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < BOTTOM_SLACK_PX;
}

function toBottom() {
  el.log.scrollTop = el.log.scrollHeight;
}

function renderLog() {
  el.col.replaceChildren();
  view = { lastLine: null, group: null, events: null, lastByNick: new Map(), separator: null, separatorAfter: null };
  const b = state.buffers.get(state.current);
  if (!b) return updateJumps();
  view.separatorAfter = readMap[b.key] ?? lastId(b);
  for (const l of b.lines) appendLine(l, false);
  if (view.separator) toSeparator();
  else toBottom();
  updateJumps();
}

function toSeparator() {
  const top = view.separator.getBoundingClientRect().top - el.col.getBoundingClientRect().top;
  el.log.scrollTop = Math.max(0, top - SEPARATOR_MARGIN_PX);
}

function appendLine(l, live) {
  const pinned = atBottom();
  const prev = view.lastLine;

  // "nick: 😂" becomes a reaction under that nick's last message.
  const reaction = l.kind === 'msg' ? parseReaction(l.text) : null;
  const reacted = reaction && view.lastByNick.get(reaction.nick.toLowerCase());
  if (reacted) {
    addReaction(reacted, reaction.emoji, l.nick, l.own);
    if (live && pinned) toBottom();
    return;
  }

  if (!prev || !sameDay(prev.ts, l.ts)) {
    el.col.append(h('div', 'day', dayLabel(l.ts)));
    view.group = null;
    view.events = null;
  }

  const firstUnread = view.separatorAfter !== null && !view.separator
    && l.id > view.separatorAfter && CHAT_KINDS.has(l.kind) && !l.own;
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
    }
    view.events.list.push(l);
    view.events.node.textContent = summarize(view.events.list);
    view.events.node.dataset.tip = clock(l.ts);
    view.group = null;
  } else if (CHAT_KINDS.has(l.kind)) {
    view.events = null;
    if (!view.group || !continues(view.group.last, l)) view.group = newGroup(l);
    view.group.body.append(row(l));
    view.group.last = l;
  } else {
    view.events = null;
    view.group = null;
    el.col.append(note(l));
  }

  view.lastLine = l;
  if (live && pinned) toBottom();
}

function newGroup(l) {
  const group = h('div', 'group');
  const who = identity(l.nick, l.mask);
  const av = avatar(l.nick, l.mask);
  av.dataset.tip = 'Edit person';
  av.addEventListener('click', () => openPerson(l.nick, l.mask));

  const body = h('div', 'gb');
  const head = h('div', 'hd');
  const name = h('span', 'nm', who.name);
  name.style.color = who.color;
  name.dataset.tip = who.name === l.nick ? l.nick : `${l.nick} · ${l.mask || 'IRC'}`;
  name.addEventListener('click', () => openPerson(l.nick, l.mask));
  head.append(name);
  body.append(head);
  group.append(av, body);
  el.col.append(group);
  return { body, last: l };
}

function row(l) {
  const r = h('div', `text ${l.kind}`);
  r.classList.toggle('own', l.own || l.nick === state.me[l.net]);
  r.dataset.tip = clock(l.ts);
  r.line = l;

  // "nick: text" right after that nick spoke reads as a reply: show what it answers.
  let text = l.text;
  const addr = l.kind === 'msg' ? parseAddress(l.text) : null;
  const quoted = (l.own && replyHints.get(l.text)) || (addr && view.lastByNick.get(addr.nick.toLowerCase()));
  if (addr && quoted && quoted.line !== l && l.ts - quoted.line.ts < REPLY_WINDOW_MS) {
    r.append(quoteNode(quoted));
    text = addr.rest;
  }
  replyHints.delete(l.text);

  let firstUrl = null;
  const members = nicksOf(l);
  const tokens = tokenize(text, state.me[l.net]).flatMap((t) => (t.type === 'text' ? splitNicks(t.value, members) : [t]));
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
      r.append(t.value);
    }
  }
  // A message that is only a link gets replaced by its card.
  r.dataset.onlyLink = String(tokens.length === 1 && tokens[0].type === 'url');
  if (firstUrl) attachPreview(firstUrl, r);
  view.lastByNick.set(l.nick.toLowerCase(), { line: l, row: r });
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
  for (const n of b?.members || []) if (n.toLowerCase() !== me) out.set(n.toLowerCase(), n);
  return out;
}

function nickRef(net, t) {
  const n = h('span', 'nick-ref', t.value);
  n.style.color = identity(t.nick).color;
  n.dataset.net = net;
  n.dataset.nick = t.nick;
  n.dataset.tip = whois.get(key(net, t.nick))?.text || t.nick;
  return n;
}

el.log.addEventListener('pointerover', (e) => {
  const n = e.target.closest?.('.nick-ref');
  if (!n) return;
  const k = key(n.dataset.net, n.dataset.nick);
  const known = whois.get(k);
  if (known) n.dataset.tip = known.text;
  if (known && Date.now() - known.at < (known.pending ? WHOIS_WAIT_MS : WHOIS_FRESH_MS)) return;
  whois.set(k, { text: known?.text || `${n.dataset.nick}\nLooking up…`, pending: true, at: Date.now() });
  n.dataset.tip = whois.get(k).text;
  const b = state.buffers.get(state.current);
  invoke('send', { net: n.dataset.net, buffer: b?.name || '', text: `/whois ${n.dataset.nick}` }).catch(() => whois.delete(k));
});

function onWhois(w) {
  const text = formatWhois(w);
  whois.set(key(w.net, w.nick), { text, at: Date.now() });
  for (const n of el.log.querySelectorAll('.nick-ref')) {
    if (n.dataset.net === w.net && n.dataset.nick.toLowerCase() === w.nick.toLowerCase()) n.dataset.tip = text;
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
  q.append(name, h('span', 'quote-text', stripFormatting(target.line.text).slice(0, QUOTE_CHARS)));
  q.addEventListener('click', () => {
    if (!target.row?.isConnected) return;
    target.row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.row.classList.add('flash');
    setTimeout(() => target.row.classList.remove('flash'), 1200);
  });
  return q;
}

// Reactions and replies

const replyHints = new Map();
let replying = null;

function addReaction(target, emoji, nick, own) {
  target.reactions ??= new Map();
  const who = target.reactions.get(emoji) ?? new Set();
  who.add(nick);
  target.reactions.set(emoji, who);
  if (own) (target.mine ??= new Set()).add(emoji);

  let box = target.row.querySelector(':scope > .reacts');
  if (!box) {
    box = h('div', 'reacts');
    target.row.append(box);
  }
  box.replaceChildren(...[...target.reactions].map(([e, nicks]) => {
    const chip = h('button', 'react', nicks.size > 1 ? `${e} ${nicks.size}` : e);
    chip.type = 'button';
    chip.dataset.tip = [...nicks].join(', ');
    chip.classList.toggle('mine', Boolean(target.mine?.has(e)));
    chip.addEventListener('click', () => react(target.line, e));
    return chip;
  }));
}

function reactionCounts() {
  try { return JSON.parse(state.settings[REACTION_SETTING] || '{}'); } catch { return {}; }
}

function topReactions() {
  const counts = reactionCounts();
  const used = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([e]) => e);
  return [...new Set([...used, ...QUICK_REACTIONS])].slice(0, QUICK_REACTIONS.length);
}

// Settings live on lobby-server (or locally in direct mode), so every device shares them.
function saveSetting(key, value) {
  state.settings[key] = value;
  invoke('set_setting', { key, value }).catch((e) => renderStatus(String(e)));
}

function countReaction(emoji) {
  const counts = reactionCounts();
  counts[emoji] = (counts[emoji] || 0) + 1;
  saveSetting(REACTION_SETTING, JSON.stringify(counts));
}

async function react(line, emoji) {
  const b = state.buffers.get(state.current);
  if (!b) return;
  countReaction(emoji);
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
  el.replyText.textContent = stripFormatting(line.text);
  el.replying.hidden = false;
  el.input.focus();
  el.input.setSelectionRange(el.input.value.length, el.input.value.length);
}

function stopReply() {
  replying = null;
  el.replying.hidden = true;
}

// Hover menu: quick reactions on top, actions under them. One instance, moved to the hovered line.

const ICONS = {
  addReaction: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.56"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/><path d="M19 2v6M16 5h6"/></svg>',
  reply: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  moreV: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
  bellOff: '<svg class="muted-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-label="Muted"><path d="M8.7 3.6A6 6 0 0 1 18 8c0 3 .6 5 1.4 6.4M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>',
  moreH: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  external: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>',
  play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"/></svg>',
  pause: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
  sound: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
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
  if (content.startsWith('<')) b.append(svg(content));
  else b.textContent = content;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const line = hoveredLine();
    if (line) onClick(line, b);
  });
  return b;
}

function closePanel() {
  actionPanel?.remove();
  actionPanel = null;
}

function togglePanel(build) {
  const open = actionPanel?.dataset.kind === build.name;
  closePanel();
  if (open) return;
  actionPanel = build();
  actionPanel.dataset.kind = build.name;
  actions.append(actionPanel);
}

function quickRow() {
  const row = h('div', 'glass emoji-row quick-row');
  row.append(
    ...topReactions().map((e) => menuButton(`React ${e}`, e, (line) => {
      closePanel();
      react(line, e);
    }, 'act emoji')),
    menuButton('More emojis', ICONS.moreH, (line, button) => {
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
      if (line) run(line);
    });
    return b;
  };
  menu.append(
    item('Reply', startReply),
    item('Copy text', (line) => navigator.clipboard?.writeText(stripFormatting(line.text))),
    item('Edit person', (line) => openPerson(line.nick, line.mask)),
  );
  return menu;
}

function fillActions() {
  closePanel();
  const tools = h('div', 'glass action-row');
  tools.append(
    menuButton('Add reaction', ICONS.addReaction, () => togglePanel(quickRow)),
    menuButton('Reply', ICONS.reply, startReply),
    menuButton('More', ICONS.moreV, () => togglePanel(moreMenu)),
  );
  actions.replaceChildren(tools);
}

el.col.addEventListener('pointerover', (e) => {
  const r = e.target.closest('.text');
  if (!r || !r.line || actions.parentElement === r) return;
  fillActions();
  r.append(actions);
});
function hideActions() {
  closePanel();
  actions.remove();
}

// Leaving the chat, the window or its focus takes the hover menu away.
el.log.addEventListener('pointerleave', hideActions);
document.documentElement.addEventListener('mouseleave', hideActions);
window.addEventListener('blur', () => {
  hideActions();
  hideTip();
});

function note(l) {
  const text = l.kind === 'topic' ? `${l.nick} changed the topic to “${l.text}”` : l.text;
  const n = h('div', 'events', text);
  n.dataset.tip = clock(l.ts);
  return n;
}

// Link previews

function getPreview(url) {
  if (!previews.has(url)) previews.set(url, invoke('preview', { url }).catch(() => null));
  return previews.get(url);
}

async function attachPreview(url, rowNode) {
  const yt = youtube(url);
  if (yt) {
    await null; // the row is appended right after it is built
    return place(youtubeCard(url, yt), rowNode);
  }
  const p = await getPreview(url);
  if (!p || !rowNode.isConnected) return;
  // A page with only a title says nothing the link does not: no card.
  if (p.kind === 'page' && !p.image && !p.description) return;
  const cards = { image: imageCard, video: videoCard, audio: audioCard, page: pageCard };
  place((cards[p.kind] ?? pageCard)(p), rowNode);
}

function place(card, rowNode) {
  if (!rowNode.isConnected) return;
  const pinned = atBottom();
  if (rowNode.dataset.onlyLink === 'true') rowNode.replaceWith(card);
  else rowNode.after(card);
  const keep = () => pinned && toBottom();
  card.querySelector('img')?.addEventListener('load', keep);
  card.querySelector('video')?.addEventListener('loadedmetadata', keep);
  keep();
}

// Videos only play while they are on screen.
const onScreen = new IntersectionObserver((entries) => {
  for (const e of entries) e.target.visible?.(e.isIntersecting);
}, { threshold: 0.25 });

function openButton(url) {
  const b = h('button', 'glass media-open');
  b.type = 'button';
  b.dataset.tip = 'Open in browser';
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

function youtubeCard(url, { id, portrait }) {
  const box = h('div', `vid${portrait ? ' portrait' : ''}`);
  const poster = image(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, 'vid-poster');
  box.append(poster, openButton(url));
  let preview = null;
  let failed = false;

  // The muted loop runs behind the still, which fades out once the loop really plays.
  box.visible = (on) => {
    if (failed || box.classList.contains('playing')) return;
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
    if (state === 'playing') box.classList.add('live');
    if (state !== 'error') return;
    failed = true;
    frame.remove();
    preview = null;
    box.classList.remove('live', 'playing');
    if (!poster.isConnected) box.prepend(poster);
    box.dataset.tip = 'Open on YouTube';
  };

  box.dataset.tip = 'Play with sound';
  box.addEventListener('click', () => {
    if (failed) return openUrl(url);
    if (box.classList.contains('playing')) return;
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
    if (title) box.append(h('span', 'vid-title', title));
  });
  return box;
}

window.addEventListener('message', (e) => {
  const state = e.data?.lobbyPlayer;
  if (!state) return;
  const frame = [...document.querySelectorAll('.vid iframe')].find((f) => f.contentWindow === e.source);
  frame?.closest('.vid')?.playerState?.(state, frame);
});

function videoCard(p) {
  const box = h('div', 'vid native');
  const v = h('video');
  Object.assign(v, { src: p.url, muted: true, loop: true, playsInline: true, preload: 'metadata' });
  v.addEventListener('error', () => box.replaceWith(pageLink(p)));
  box.append(v, openButton(p.url));
  box.visible = (on) => {
    if (on) v.play().catch(() => {});
    else v.pause();
  };
  onScreen.observe(box);

  box.dataset.tip = 'Play with sound';
  box.addEventListener('click', () => {
    if (box.classList.contains('playing')) return;
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
  Object.assign(audio, { src: p.url, preload: 'metadata' });
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
    if (!audio.duration) return;
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
  if (p.title) text.append(h('span', 'card-title', p.title));
  if (p.description) text.append(h('span', 'card-desc', p.description));
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
    if (next) select(next.key);
    else renderLog();
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
      if (isChannel(b.name) && b.joined) await invoke('send', { net: b.net, buffer: b.name, text: '/part' });
      closeBuffer(b);
      return true;
    case 'mute':
    case 'unmute':
      setMuted(b, cmd.toLowerCase() === 'mute');
      localNote(cmd.toLowerCase() === 'mute' ? `${label(b)} muted` : `${label(b)} unmuted`);
      return true;
    case 'clear':
      b.lines = [];
      renderLog();
      return true;
    case 'query':
      if (!rest) return true;
      select(buffer(b.net, rest.split(' ')[0]).key);
      return true;
    case 'names':
      localNote(`${b.members.size} people: ${[...b.members].sort((x, y) => x.localeCompare(y)).join(', ')}`);
      return true;
    default:
      return false;
  }
}

async function send() {
  const text = settingOn(EMOTICON_SETTING) ? convertEmoticons(el.input.value) : el.input.value;
  const b = state.buffers.get(state.current);
  if (!text.trim() || !b) return;
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
      if (!out.startsWith(prefix)) out = prefix + out;
      replyHints.set(out, { line: replying, row: findRow(replying) });
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

function complete() {
  const b = state.buffers.get(state.current);
  if (!b) return;
  const value = el.input.value;
  if (!completion) {
    const start = value.lastIndexOf(' ') + 1;
    completion = { start, prefix: value.slice(start), last: '' };
  }
  const nick = completeNick(completion.prefix, b.members, completion.last);
  if (!nick) return;
  completion.last = nick;
  const suffix = completion.start === 0 ? ': ' : ' ';
  el.input.value = value.slice(0, completion.start) + nick + suffix;
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
  if (!items.length) return hideSlash();
  slashItems = items;
  slashPick = Math.min(slashPick, items.length - 1);
  el.slash.replaceChildren(...items.map((entry, i) => {
    const item = h('button', 'slash-item');
    item.type = 'button';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(i === slashPick));
    item.append(...entry.parts);
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      entry.apply();
    });
    return item;
  }));
  el.slash.hidden = false;
  el.slash.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

/** The / commands, or emoji for a ":word" before the caret. */
function menuEntries() {
  const commands = commandMatches(el.input.value);
  if (commands?.length) {
    return commands.map((c) => ({
      parts: [h('span', 'slash-name', `/${c.name}`), h('span', 'slash-args', c.args), h('span', 'slash-desc', c.desc)],
      apply: () => applySlash(c),
    }));
  }
  if (!settingOn(SHORTCODE_SETTING)) return [];
  const caret = el.input.selectionStart ?? el.input.value.length;
  const q = colonQuery(el.input.value.slice(0, caret));
  if (!q) return [];
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
  if (!c.args) send();
}

el.input.addEventListener('input', () => {
  emoticonsAsTyped();
  colonPicker();
  slashPick = 0;
  renderSlash();
  fitInput();
});

// ":D " becomes 😀 the moment a space lands after it; sending converts a last one too.
function emoticonsAsTyped() {
  if (!settingOn(EMOTICON_SETTING)) return;
  const caret = el.input.selectionStart ?? 0;
  if (caret === 0 || !/\s/.test(el.input.value[caret - 1])) return;
  const next = convertEmoticons(el.input.value);
  if (next === el.input.value) return;
  const moved = caret + next.length - el.input.value.length;
  el.input.value = next;
  el.input.setSelectionRange(moved, moved);
}

// A colon at the start of a word opens the emoji picker; typing on closes it again.
let colonAt = null;

function colonPicker() {
  const caret = el.input.selectionStart ?? 0;
  const value = el.input.value;
  const fresh = caret > 0 && value[caret - 1] === ':' && (caret === 1 || /\s/.test(value[caret - 2]));
  if (fresh && settingOn(SHORTCODE_SETTING)) {
    colonAt = caret - 1;
    openPicker(el.form, (native) => {
      if (el.input.value[colonAt] === ':') insertEmoji(native, colonAt, colonAt + 1);
      colonAt = null;
    }, { focus: false });
  } else if (colonAt !== null) {
    colonAt = null;
    closePicker();
  }
}

function fitInput() {
  el.input.style.height = 'auto';
  el.input.style.height = `${el.input.scrollHeight}px`;
}

// Text set from code (sending, replies, history) resizes the box too.
const textValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
Object.defineProperty(el.input, 'value', {
  get() { return textValue.get.call(this); },
  set(v) { textValue.set.call(this, v); fitInput(); },
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
    if (e.key === 'Tab' || e.key === 'Enter') {
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
  ['switcher', 'Find a channel'],
  ['markRead', 'Mark this channel read'],
  ['jumpUnread', 'Jump to the first unread'],
  ['nextUnreadChannel', 'Next channel with unread'],
  ['prevChannel', 'Previous channel'],
  ['nextChannel', 'Next channel'],
  ['channelNumber', 'Channel 1 to 9 (with a number)'],
  ['complete', 'Complete a nick'],
  ['recall', 'Bring back the last message'],
];
let recordingShortcut = null;

function shortcuts() {
  try { return { ...DEFAULT_SHORTCUTS, ...JSON.parse(state.settings[SHORTCUT_SETTING] || '{}') }; } catch { return { ...DEFAULT_SHORTCUTS }; }
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
  markRead: () => markCurrentRead(),
  jumpUnread: () => jumpToUnread(),
  nextUnreadChannel: () => jumpToUnreadChannel(),
  prevChannel: () => step(-1),
  nextChannel: () => step(1),
};

document.addEventListener('keydown', (e) => {
  if (recordingShortcut) return;
  const combo = comboOf(e, IS_MAC);
  if (!combo) return;
  const keys = shortcuts();
  const action = Object.keys(SHORTCUT_RUN).find((a) => keys[a] === combo);
  const number = /^[1-9]$/.test(combo.split('+').pop()) && comboMods(combo) === keys.channelNumber && comboMods(combo) !== '';
  if (!action && !number) return;
  e.preventDefault();
  e.stopPropagation();
  if (action) SHORTCUT_RUN[action]();
  else {
    const b = ordered()[Number(combo.split('+').pop()) - 1];
    if (b) select(b.key);
  }
  refreshShortcutTips();
}, true);

/** Tooltips that name a shortcut follow the current setting. */
function refreshShortcutTips() {
  el.markRead.dataset.tip = shortcutLabel('markRead');
  el.jumpUnread.dataset.tip = `Jump to the first unread (${shortcutLabel('jumpUnread')})`;
  for (const m of document.querySelectorAll('.sep-mark')) m.dataset.tip = `Mark as read (${shortcutLabel('markRead')})`;
}

function renderShortcuts() {
  el.shortcutList.replaceChildren(...SHORTCUT_ACTIONS.map(([action, label]) => {
    const row = h('div', 'shortcut-row');
    const key = h('button', 'shortcut-key', recordingShortcut === action ? 'Press keys…' : shortcutLabel(action));
    key.type = 'button';
    key.classList.toggle('recording', recordingShortcut === action);
    key.addEventListener('click', () => {
      recordingShortcut = recordingShortcut === action ? null : action;
      renderShortcuts();
    });
    row.append(h('span', null, label), key);
    return row;
  }));
}

// While a shortcut is being set, the next key press is the new shortcut. Escape cancels.
document.addEventListener('keydown', (e) => {
  if (!recordingShortcut) return;
  const combo = comboOf(e, IS_MAC);
  if (!combo) return;
  e.preventDefault();
  e.stopPropagation();
  if (combo !== 'Escape') {
    let saved = {};
    try { saved = JSON.parse(state.settings[SHORTCUT_SETTING] || '{}'); } catch { /* start over */ }
    saved[recordingShortcut] = recordingShortcut === 'channelNumber' ? comboMods(combo) || 'Alt' : combo;
    saveSetting(SHORTCUT_SETTING, JSON.stringify(saved));
  }
  recordingShortcut = null;
  renderShortcuts();
  refreshShortcutTips();
}, true);

el.shortcutReset.addEventListener('click', () => {
  saveSetting(SHORTCUT_SETTING, '{}');
  recordingShortcut = null;
  renderShortcuts();
  refreshShortcutTips();
});

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.getAttribute('href') === '#') return;
  e.preventDefault();
  openUrl(a.href);
});

function separatorNode() {
  const sep = h('div', 'unread-sep');
  sep.setAttribute('role', 'separator');
  const mark = h('button', 'sep-mark');
  mark.type = 'button';
  mark.dataset.tip = `Mark as read (${shortcutLabel('markRead')})`;
  mark.setAttribute('aria-label', 'Mark as read');
  mark.innerHTML = ICONS.check;
  mark.addEventListener('click', markCurrentRead);
  sep.append(h('span', 'sep-label', 'New'), mark);
  return sep;
}

/** Messages after the read position in this channel. */
function unreadCount(b) {
  const seen = readMap[b.key];
  if (seen === undefined) return 0;
  return b.lines.filter((l) => l.id > seen && CHAT_KINDS.has(l.kind) && !l.own).length;
}

function markCurrentRead() {
  const b = state.buffers.get(state.current);
  if (!b) return;
  markRead(b);
  dropSeparator();
  view.separatorAfter = readMap[b.key] ?? lastId(b);
  updateJumps();
}

// Removing the New line keeps what is on screen where it was.
function dropSeparator() {
  const sep = view.separator;
  view.separator = null;
  if (!sep) return;
  const pinned = atBottom();
  // It folds away instead of vanishing, so the lines around it slide rather than jump.
  sep.classList.add('gone');
  sep.addEventListener('transitionend', () => {
    sep.remove();
    if (pinned) toBottom();
  }, { once: true });
}

// Jumping: to the channel with unread, to the "New" line, back to the latest.

function jumpToUnreadChannel() {
  const waiting = ordered().filter((b) => b.key !== state.current && wantsAttention(b));
  const next = waiting.find((b) => b.mention) || waiting[0];
  if (next) select(next.key);
}

function updateJumps() {
  const b = state.buffers.get(state.current);
  const count = b ? unreadCount(b) : 0;
  // The jump shows whenever the New line is out of sight, pointing the way to it.
  const sep = view?.separator?.getBoundingClientRect();
  const log = el.log.getBoundingClientRect();
  const above = sep && sep.bottom < log.top;
  const below = sep && sep.top > log.bottom;
  el.jumpUnread.hidden = !(count && (above || below));
  el.jumpUnread.classList.toggle('down', Boolean(below));
  el.jumpUnreadLabel.textContent = `${count} unread`;
  el.jumpLatest.hidden = atBottom();
  el.markRead.hidden = count === 0;
  el.markReadLabel.textContent = `Mark ${count} ${count === 1 ? 'message' : 'messages'} read`;
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

function jumpToUnread() {
  view?.separator?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

el.jumpUnread.addEventListener('click', jumpToUnread);
el.jumpLatest.addEventListener('click', () => {
  el.log.scrollTo({ top: el.log.scrollHeight, behavior: 'smooth' });
});

let jumpFrame = 0;
// A resize keeps the latest message in view when it was in view before.
let stuck = true;
new ResizeObserver(() => stuck && toBottom()).observe(el.log);

el.log.addEventListener('scroll', () => {
  stuck = atBottom();
  cancelAnimationFrame(jumpFrame);
  jumpFrame = requestAnimationFrame(() => {
    updateJumps();
  });
}, { passive: true });

// Start

function applyStatus(st) {
  if (st.platform !== PLATFORM.value) {
    PLATFORM.value = st.platform;
    IS_MAC = st.platform === 'macos';
    document.documentElement.classList.toggle('mac', IS_MAC);
    document.documentElement.classList.toggle('ios', st.platform === 'ios');
    if (IS_MAC) invoke('allow_notifications').catch(() => {});
  }
  state.networks = st.networks.map((n) => n.name);
  state.configPath = st.config_path;
  for (const n of st.networks) {
    state.conn[n.name] = n.state;
    if (n.nick) state.me[n.name] = n.nick;
  }
  state.people = st.people || [];
  state.settings = st.settings || {};
  refreshShortcutTips();
  renderAttach();
  applyReadSetting(state.settings[READ_SETTING]);
  for (const info of st.channels) onBuffer(info);
  state.setupError = st.error && !st.networks.length ? st.error : null;
  if (st.error && st.networks.length) showToast(st.error);
  renderStatus();
  // Nothing set up yet, like on a phone's first start: go straight to the setup.
  if (st.error && !st.networks.length && !el.connection.open) openConnection();
}

// Connection setup: the same choices on every device, saved to the config file.

const CONNECTION_ABOUT = {
  ssh: 'Lobby signs in to the machine where lobby-server runs and reaches it from there. Your whole history, and nothing on the server is opened to the internet.',
  url: 'lobby-server behind a web server with TLS, at an address of its own. Your whole history.',
  irc: 'Lobby connects to IRC servers or irssiproxy itself. History only covers the time Lobby is open.',
};
let connectionMode = 'ssh';

async function openConnection() {
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
  setConnectionMode(c.mode);
  if (el.settings.open) el.settings.close();
  el.connection.showModal();
}

function setConnectionMode(mode) {
  connectionMode = mode;
  for (const b of el.connectionForm.querySelectorAll('.segments button')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  for (const part of el.connectionForm.querySelectorAll('[data-modes]')) part.hidden = !part.dataset.modes.split(' ').includes(mode);
  el.connectionAbout.textContent = CONNECTION_ABOUT[mode];
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
  remove.setAttribute('aria-label', 'Remove network');
  remove.dataset.tip = 'Remove';
  remove.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  remove.addEventListener('click', () => row.remove());
  row.append(field('name', 'Name', n.name), field('host', 'Host', n.host), field('port', 'Port', n.port), remove, field('pass', 'Password, if any', n.password, 'password'));
  if (n.password_file) row.dataset.passwordFile = n.password_file;
  return row;
}

function readConnection() {
  const num = (v) => (v.trim() ? Number(v) : null);
  const networks = [...el.connNetworks.querySelectorAll('.net-row')].map((r) => ({
    name: r.querySelector('.name').value.trim(),
    host: r.querySelector('.host').value.trim(),
    port: Number(r.querySelector('.port').value) || 6667,
    password: r.querySelector('.pass').value || null,
    password_file: r.querySelector('.pass').value ? null : r.dataset.passwordFile || null,
  })).filter((n) => n.name && n.host);
  return {
    mode: connectionMode, ssh: el.connSsh.value, ssh_port: num(el.connSshPort.value), port: num(el.connPort.value),
    url: el.connUrl.value, token: el.connToken.value, nick: el.connNick.value, networks, key_line: '',
  };
}

function connectionProblem(c) {
  if (c.mode === 'ssh' && !/^[^@\s]+@[^@\s]+$/.test(c.ssh.trim())) return 'Write the SSH login as you@host.';
  if (c.mode === 'url' && !/^wss?:\/\//.test(c.url.trim())) return 'The server address starts with wss:// or ws://.';
  if (c.mode !== 'irc' && !c.token.trim()) return 'Paste the lobby-server token.';
  if (c.mode === 'irc' && !c.nick.trim()) return 'Pick a nick.';
  if (c.mode === 'irc' && !c.networks.length) return 'Add at least one network with a name and a host.';
  return null;
}

for (const b of el.connectionForm.querySelectorAll('.segments button')) b.addEventListener('click', () => setConnectionMode(b.dataset.mode));
el.openConnection.addEventListener('click', openConnection);
el.statusAction.addEventListener('click', openConnection);
el.connectionClose.addEventListener('click', () => el.connection.close());
el.connAddNet.addEventListener('click', () => el.connNetworks.append(networkRow()));
el.connCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(el.connKey.textContent);
    el.connCopy.textContent = 'Copied';
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
  if (problem) return;
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
  await listen('me', (e) => { state.me[e.payload.net] = e.payload.nick; });
  await listen('conn', (e) => {
    state.conn[e.payload.net] = e.payload.state;
    renderStatus();
  });
  await listen('people', (e) => {
    state.people = e.payload;
    renderHeader();
    renderLog();
    if (el.people.open && !el.peopleList.hidden) renderPeople();
  });
  await listen('whois', (e) => onWhois(e.payload));
  await listen('setting', (e) => {
    state.settings[e.payload.key] = e.payload.value;
    if (e.payload.key === READ_SETTING) applyReadSetting(e.payload.value);
    if (e.payload.key === SHORTCUT_SETTING) refreshShortcutTips();
    if (e.payload.key === MUTED_SETTING || e.payload.key === CHANNELS_SETTING) renderHeader();
    if (e.payload.key === UPLOAD_SETTING) renderAttach();
  });
  // A lobby-server connection came back: fetch what was missed.
  await listen('resync', async () => {
    applyStatus(await invoke('status'));
    for (const r of await invoke('recent_buffers').catch(() => [])) buffer(r.net, r.buffer);
    for (const b of state.buffers.values()) loadHistory(b);
  });

  applyStatus(await invoke('status'));

  for (const r of await invoke('recent_buffers').catch(() => [])) buffer(r.net, r.buffer);
  state.started = true;
  pickFirst();
}

function pickFirst() {
  if (state.current) return;
  let saved = null;
  try { saved = localStorage.getItem(LAST_BUFFER_KEY); } catch { /* storage may be unavailable */ }
  const first = ordered().find((b) => isChannel(b.name));
  if (saved && state.buffers.has(saved)) select(saved);
  else if (first) select(first.key);
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

function showTip(target, x) {
  const text = target.dataset.tip;
  if (!text) return hideTip();
  tip.textContent = text;
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
  tip.hidden = true;
}

document.addEventListener('pointermove', (e) => {
  const target = e.target.closest?.('[data-tip]');
  if (target) showTip(target, e.clientX);
  else if (!tip.hidden) hideTip();
});
document.addEventListener('pointerdown', hideTip);
el.log.addEventListener('scroll', hideTip, { passive: true });
document.addEventListener('pointerleave', hideTip);


// People: photos, colours and nicks, edited here and stored on lobby-server.

let editing = null;
let editingFromChat = false;

function personSubtitle(p) {
  return p.nicks.length ? p.nicks.join(', ') : 'No nicks yet';
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
  el.peopleItems.replaceChildren(...(rows.length ? rows : [h('p', 'people-empty', 'Nobody yet. Click a name in the chat, or use +.')]));
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

function showList() {
  editing = null;
  editingFromChat = false;
  el.peopleTitle.textContent = 'People';
  el.peopleBack.hidden = true;
  el.personNew.hidden = false;
  el.personEdit.hidden = true;
  el.peopleList.hidden = false;
  renderPeople();
}

function editChannel(b) {
  const look = channelLook(b);
  el.people.showModal();
  editPerson({ id: 0, channel: b.key, name: label(b), color: look.color || '', photo: look.photo || '', nicks: [] });
  editingFromChat = true;
}

function editPerson(p) {
  editing = structuredClone(p);
  el.personEdit.classList.toggle('channel-mode', Boolean(p.channel));
  el.peopleTitle.textContent = p.channel ? p.name : p.id ? p.name : 'New person';
  el.peopleBack.hidden = Boolean(p.channel);
  el.personNew.hidden = true;
  el.peopleList.hidden = true;
  el.personEdit.hidden = false;
  el.personDelete.hidden = !p.id;
  el.personName.value = editing.name;
  renderEditor();
  if (!p.channel) el.personName.focus();
  if (editing.photo) {
    colorOfPhoto(editing.photo).then((c) => {
      if (!editing || editing.id !== p.id) return;
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
  if (content) b.append(content);
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

  const swatches = [swatch(auto, 'Automatic', !p.color, h('span', 'swatch-mark', 'A'))];
  for (const c of SWATCHES) swatches.push(swatch(c, c, p.color === c));
  const custom = !swatches.some((b) => b.getAttribute('aria-checked') === 'true');
  swatches.push(swatch(custom ? color : 'var(--raised)', 'Pick any colour', custom, h('span', 'swatch-mark', '+')));
  const values = ['', ...SWATCHES];
  swatches.forEach((b, i) => b.addEventListener('click', () => {
    if (i === swatches.length - 1) {
      el.personColor.value = toHex(color);
      el.personColor.click();
      return;
    }
    p.color = values[i];
    renderEditor();
  }));
  el.personColors.replaceChildren(...swatches);

  el.personNicks.replaceChildren(...p.nicks.map((n, i) => {
    const chip = h('span', 'chip', n);
    const x = h('button', '', '×');
    x.type = 'button';
    x.setAttribute('aria-label', `Remove ${n}`);
    x.addEventListener('click', () => {
      p.nicks.splice(i, 1);
      renderEditor();
    });
    chip.append(x);
    return chip;
  }));
}

/** Any CSS colour as #rrggbb, for the colour input. */
function toHex(color) {
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = color;
  return c.fillStyle.startsWith('#') ? c.fillStyle : '#7aa2f7';
}

function openPerson(nick, mask) {
  const found = personFor(state.people, nick, mask);
  el.people.showModal();
  editPerson(found || { id: 0, name: nick, color: '', photo: '', nicks: [nick] });
  editingFromChat = true;
}

// Read as a data URL: the page's content policy allows data: images but not blob: ones.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Not an image'));
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
  if (isRound(img, side)) crop = side * ROUND_INNER;
  const canvas = document.createElement('canvas');
  canvas.width = PHOTO_PX;
  canvas.height = PHOTO_PX;
  canvas.getContext('2d').drawImage(img, (img.naturalWidth - crop) / 2, (img.naturalHeight - crop) / 2, crop, crop, 0, 0, PHOTO_PX, PHOTO_PX);
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
  if (!img) return src;
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  if (!isRound(img, side)) return src;
  const crop = side * ROUND_INNER;
  const canvas = document.createElement('canvas');
  canvas.width = PHOTO_PX;
  canvas.height = PHOTO_PX;
  canvas.getContext('2d').drawImage(img, (img.naturalWidth - crop) / 2, (img.naturalHeight - crop) / 2, crop, crop, 0, 0, PHOTO_PX, PHOTO_PX);
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
  if (!editing || !file?.type.startsWith('image/')) return;
  try {
    editing.photo = await photoFrom(file);
    editing.photoColor = await colorOfPhoto(editing.photo);
    editing.color = '';
    renderEditor();
  } catch (e) {
    renderStatus(String(e));
  }
}

el.openPeople.addEventListener('click', () => {
  el.settings.close();
  el.people.showModal();
  el.people.focus();
  showList();
});
el.peopleClose.addEventListener('click', () => el.people.close());
el.peopleBack.addEventListener('click', showList);
el.people.addEventListener('click', (e) => {
  if (e.target === el.people) el.people.close();
});
el.personNew.addEventListener('click', () => editPerson({ id: 0, name: '', color: '', photo: '', nicks: [] }));
el.personPhoto.addEventListener('click', () => el.personFile.click());
el.personFile.addEventListener('change', () => {
  setPhoto(el.personFile.files[0]);
  el.personFile.value = '';
});
/** An image on the clipboard: as a file, or as a clipboard item (copied from a browser or viewer). */
function clipboardImage(e) {
  const data = e.clipboardData;
  if (!data) return null;
  const file = [...(data.files || [])].find((f) => f.type.startsWith('image/'));
  if (file) return file;
  const item = [...(data.items || [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  return item ? item.getAsFile() : null;
}

el.people.addEventListener('paste', (e) => {
  const file = editing && clipboardImage(e);
  if (!file) return;
  e.preventDefault();
  setPhoto(file);
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
  if (!editing.photo) renderEditor();
});
el.personNick.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const nick = el.personNick.value.trim();
  if (nick && !editing.nicks.includes(nick)) editing.nicks.push(nick);
  el.personNick.value = '';
  renderEditor();
});
el.personEdit.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pending = el.personNick.value.trim();
  if (pending && !editing.nicks.includes(pending)) editing.nicks.push(pending);
  el.personNick.value = '';
  editing.name = el.personName.value.trim() || editing.nicks[0] || 'Someone';
  if (editing.channel) {
    let all = {};
    try { all = JSON.parse(state.settings[CHANNELS_SETTING] || '{}'); } catch { /* start fresh */ }
    all[editing.channel] = { photo: editing.photo, color: editing.color };
    saveSetting(CHANNELS_SETTING, JSON.stringify(all));
    el.people.close();
    renderHeader();
    return;
  }
  try {
    const { photoColor: _, ...person } = editing;
    await invoke('save_person', { person });
    if (editingFromChat) el.people.close();
    else showList();
  } catch (err) {
    renderStatus(String(err));
  }
});
el.personDelete.addEventListener('click', async () => {
  if (!editing?.id) return;
  try {
    await invoke('delete_person', { id: editing.id });
    showList();
  } catch (err) {
    renderStatus(String(err));
  }
});
el.people.addEventListener('close', () => el.input.focus());


// Emoji picker: search, frequently used, every category, and a bar to jump between them.

const PICKER_WIDTH = 340;
const PICKER_HEIGHT = 400;
const PICKER_GAP = 8;
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

const pickerState = { el: null, data: null, onPick: null, sections: [], tabs: [] };

async function emojiData() {
  pickerState.data ??= await fetch('vendor/emoji.json').then((r) => r.json());
  return pickerState.data;
}

function categoryIcon(id) {
  return svg(`<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CATEGORY_ICONS[id]}</svg>`);
}

function emojiButton(native, label) {
  const b = h('button', 'pick', native);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.addEventListener('click', () => choose(native));
  return b;
}

function choose(native) {
  const onPick = pickerState.onPick;
  closePicker();
  onPick?.(native);
}

function section(id, title, buttons) {
  const wrap = h('section', 'picker-section');
  wrap.dataset.cat = id;
  const grid = h('div', 'picker-grid');
  grid.append(...buttons);
  wrap.append(h('h4', '', title), grid);
  return wrap;
}

function frequentButtons() {
  const counts = reactionCounts();
  const used = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([e]) => e);
  return [...new Set([...used, ...QUICK_REACTIONS])].slice(0, FREQUENT_COUNT).map((e) => emojiButton(e, e));
}

async function buildPicker() {
  const data = await emojiData();
  const root = h('div', 'glass picker');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Emoji');

  const search = h('label', 'picker-search');
  const input = h('input');
  input.placeholder = 'Search';
  input.setAttribute('aria-label', 'Search emoji');
  search.append(svg('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>'), input);

  const scroll = h('div', 'picker-scroll');
  const results = section('results', 'Search results', []);
  results.hidden = true;
  const frequent = section('frequent', 'Frequently used', frequentButtons());
  const cats = data.map((c) => section(c.id, c.name, c.emojis.map(([native, words]) => emojiButton(native, words.split(' ')[0]))));
  scroll.append(results, frequent, ...cats);

  const tabs = h('nav', 'picker-tabs');
  const ids = ['frequent', ...data.map((c) => c.id)];
  pickerState.tabs = ids.map((id) => {
    const t = h('button', 'picker-tab');
    t.type = 'button';
    t.dataset.cat = id;
    t.setAttribute('aria-label', id === 'frequent' ? 'Frequently used' : data.find((c) => c.id === id).name);
    t.append(categoryIcon(id));
    t.addEventListener('click', () => {
      input.value = '';
      showSearch('');
      const target = scroll.querySelector(`section[data-cat="${id}"]`);
      scroll.scrollTop = target.offsetTop - scroll.offsetTop;
    });
    return t;
  });
  tabs.append(...pickerState.tabs);

  function showSearch(q) {
    const query = q.trim().toLowerCase();
    results.hidden = !query;
    for (const sec of scroll.querySelectorAll('section:not([data-cat="results"])')) sec.hidden = Boolean(query);
    if (!query) return;
    // Best first: a whole word matches, then the name starts with it, then a word does, then any part.
    const scored = [];
    for (const c of data) {
      for (const [native, words] of c.emojis) {
        if (!words.includes(query)) continue;
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
      if (first) choose(first.textContent);
    }
  });
  scroll.addEventListener('scroll', () => {
    const top = scroll.scrollTop + scroll.offsetTop + PICKER_GAP;
    let current = 'frequent';
    for (const sec of scroll.querySelectorAll('section:not([hidden])')) if (sec.offsetTop <= top) current = sec.dataset.cat;
    for (const t of pickerState.tabs) t.classList.toggle('active', t.dataset.cat === current);
  }, { passive: true });

  root.append(search, scroll, tabs);
  root.addEventListener('pointerdown', (e) => e.stopPropagation());
  pickerState.el = root;
  pickerState.input = input;
  pickerState.frequent = frequent;
  pickerState.scroll = scroll;
  pickerState.showSearch = showSearch;
}

/** Open the picker next to `anchor`; `onPick` gets the chosen emoji. */
async function openPicker(anchor, onPick, { focus = true } = {}) {
  if (!pickerState.el) await buildPicker();
  const p = pickerState;
  p.onPick = onPick;
  p.frequent.querySelector('.picker-grid').replaceChildren(...frequentButtons());
  p.input.value = '';
  p.showSearch('');
  p.scroll.scrollTop = 0;
  p.tabs.forEach((t, i) => t.classList.toggle('active', i === 0));

  const box = anchor.getBoundingClientRect();
  const left = Math.min(Math.max(box.right - PICKER_WIDTH, PICKER_GAP), window.innerWidth - PICKER_WIDTH - PICKER_GAP);
  const above = box.top - PICKER_HEIGHT - PICKER_GAP;
  const top = above >= PICKER_GAP ? above : Math.min(box.bottom + PICKER_GAP, window.innerHeight - PICKER_HEIGHT - PICKER_GAP);
  p.el.style.left = `${Math.max(left, PICKER_GAP)}px`;
  p.el.style.top = `${Math.max(top, PICKER_GAP)}px`;
  document.body.append(p.el);
  closePanel();
  if (focus) p.input.focus();
}

function closePicker() {
  pickerState.el?.remove();
  pickerState.onPick = null;
}

document.addEventListener('pointerdown', () => {
  if (pickerState.el?.isConnected) closePicker();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pickerState.el?.isConnected) {
    e.stopPropagation();
    closePicker();
  }
}, true);


// Desktop notifications for mentions and private messages, on unless turned off in Settings.

const NOTIFY_SETTING = 'notify';
const NOTIFY_TEXT_CHARS = 160;
const notifier = window.__TAURI__.notification;
let notifyAllowed = null;

function settingOn(key) {
  return state.settings[key] !== 'off';
}

// The app icon, chosen per device: Dock on macOS, window icon elsewhere.
const ICONS_KEY = 'lobby.icon';
const APP_ICONS = [
  ['teal-night', 'Teal night'], ['neon-night', 'Neon night'], ['sunset', 'Sunset'], ['mint-glass', 'Mint glass'],
  ['porcelain', 'Porcelain'], ['neon-glow', 'Neon glow'], ['neon-sign', 'Neon sign'],
];
const DEFAULT_ICON = APP_ICONS[0][0];

function chosenIcon() {
  try { return localStorage.getItem(ICONS_KEY) || DEFAULT_ICON; } catch { return DEFAULT_ICON; }
}

function useIcon(name) {
  invoke('set_app_icon', { name }).catch((e) => renderStatus(`App icon: ${e}`));
}

function renderIconChoices() {
  const current = chosenIcon();
  el.iconChoices.replaceChildren(...APP_ICONS.map(([name, label]) => {
    const b = h('button', 'icon-choice');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(name === current));
    b.setAttribute('aria-label', label);
    b.dataset.tip = label;
    const img = h('img');
    img.src = `icons/${name}.png`;
    img.alt = '';
    b.append(img);
    b.addEventListener('click', () => {
      try { localStorage.setItem(ICONS_KEY, name); } catch { /* the choice lasts this run */ }
      useIcon(name);
      renderIconChoices();
    });
    return b;
  }));
}

if (chosenIcon() !== DEFAULT_ICON) useIcon(chosenIcon());

function notifyOn() {
  return state.settings[NOTIFY_SETTING] !== 'off';
}

async function notify(b, l) {
  if (!notifyOn() || !notifier) return;
  notifyAllowed ??= (await notifier.isPermissionGranted()) || (await notifier.requestPermission()) === 'granted';
  if (!notifyAllowed) return;
  const who = identity(l.nick, l.mask);
  const title = isPrivate(b) ? l.nick : `${who.name} in ${label(b)}`;
  const icon = await notifyIcon(who.photo);
  showNotification(title, stripFormatting(l.text).slice(0, NOTIFY_TEXT_CHARS), icon);
}

// macOS gets its notifications from the system notification centre, the rest through the plugin.
function showNotification(title, body, icon) {
  if (IS_MAC) {
    invoke('notify_mac', { id: `${Date.now()}`, title, body, image: icon || null }).catch((e) => renderStatus(`Notification: ${e}`));
  } else {
    notifier.sendNotification({ title, body, icon });
  }
}


el.notifyTest.addEventListener('click', () => showNotification('Lobby', 'Notifications work.', null));

// A photo as a file the notification can show, written once per photo.
const notifyIcons = new Map();
const PHOTO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function notifyIcon(photo) {
  const m = photo?.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m || !PHOTO_EXT[m[1]]) return Promise.resolve(undefined);
  if (!notifyIcons.has(photo)) {
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    const key = hashHex(photo);
    notifyIcons.set(photo, invoke('notify_icon', bytes, { headers: { 'x-key': key, 'x-ext': PHOTO_EXT[m[1]] } }).catch(() => undefined));
  }
  return notifyIcons.get(photo);
}

// FNV-1a, enough to name a cache file.
function hashHex(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

el.notifyToggle.addEventListener('change', () => {
  saveSetting(NOTIFY_SETTING, el.notifyToggle.checked ? 'on' : 'off');
});

el.emoticonToggle.addEventListener('change', () => saveSetting(EMOTICON_SETTING, el.emoticonToggle.checked ? 'on' : 'off'));
el.shortcodeToggle.addEventListener('change', () => saveSetting(SHORTCODE_SETTING, el.shortcodeToggle.checked ? 'on' : 'off'));


// Attachments: files go to the file host set in Settings, and their address into the message.

const UPLOAD_SETTING = 'upload';

function uploadHost() {
  return state.settings[UPLOAD_SETTING] || '';
}

function renderAttach() {
  el.attachBtn.hidden = !uploadHost();
}

function insertAtCursor(text) {
  const start = el.input.selectionStart ?? el.input.value.length;
  const end = el.input.selectionEnd ?? start;
  const before = el.input.value.slice(0, start);
  const spaced = (before && !before.endsWith(' ') ? ' ' : '') + text + ' ';
  el.input.setRangeText(spaced, start, end, 'end');
  fitInput();
  el.input.focus();
}

async function uploadFiles(files) {
  if (!uploadHost()) {
    renderStatus('Set a file host in Settings to send files');
    return;
  }
  for (const file of files) {
    const name = file.name || `pasted.${(file.type.split('/')[1] || 'png')}`;
    renderStatus(`Uploading ${name}…`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const url = await invoke('upload', bytes, {
        headers: { 'x-host': uploadHost(), 'x-name': encodeURIComponent(name), 'x-type': file.type || 'application/octet-stream' },
      });
      insertAtCursor(url);
      renderStatus();
    } catch (e) {
      renderStatus(String(e));
    }
  }
}

el.attachBtn.addEventListener('click', () => el.attachFile.click());
el.attachFile.addEventListener('change', () => {
  uploadFiles([...el.attachFile.files]);
  el.attachFile.value = '';
});
el.input.addEventListener('paste', (e) => {
  const file = clipboardImage(e);
  if (!file) return;
  e.preventDefault();
  uploadFiles([file]);
});
document.addEventListener('dragover', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  e.preventDefault();
  document.body.classList.add('dropping');
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dropping');
});
document.addEventListener('drop', (e) => {
  document.body.classList.remove('dropping');
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  uploadFiles(files);
});
el.uploadUrl.addEventListener('change', () => {
  saveSetting(UPLOAD_SETTING, el.uploadUrl.value.trim());
  renderAttach();
});
