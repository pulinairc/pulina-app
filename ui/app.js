import {
  CHAT_KINDS, EVENT_KINDS, clock, commandMatches, completeNick, continues, dayLabel, initial,
  colorFromRgb, isChannel, mentions, nickColor, parseAddress, personFor, parseReaction, sameDay, shortUrl, stripFormatting, summarize, tokenize,
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
  unread: $('unread'), gear: $('gear'), bell: $('bell'), status: $('status'), log: $('log'), col: $('col'),
  form: $('composer'), input: $('input'), jumpUnread: $('jump-unread'), jumpLatest: $('jump-latest'),
  markRead: $('mark-read'), markReadLabel: $('mark-read-label'), emojiBtn: $('emoji-btn'),
  slash: $('slash'), replying: $('replying'),
  openPeople: $('open-people'), people: $('people'), peopleTitle: $('people-title'), peopleBack: $('people-back'),
  peopleClose: $('people-close'), peopleList: $('people-list-view'), peopleItems: $('people-list'), personNew: $('person-new'),
  personEdit: $('person-edit'), personPhoto: $('person-photo'),
  personPhotoRemove: $('person-photo-remove'), personFile: $('person-file'), personName: $('person-name'),
  personColor: $('person-color'), personColors: $('person-colors'),
  channelMute: $('channel-mute'), personNicks: $('person-nicks'), personNick: $('person-nick'), personDelete: $('person-delete'), replyNick: $('reply-nick'), replyText: $('reply-text'), replyClose: $('reply-close'),
  switcher: $('switcher'), filter: $('filter'), list: $('list'),
  settings: $('settings'), settingsClose: $('settings-close'), connections: $('connections'), configPath: $('config-path'),
};

const state = { networks: [], buffers: new Map(), current: null, me: {}, conn: {}, configPath: '', people: [], settings: {} };
const previews = new Map();
let view = null;
let completion = null;
let lastSent = '';
let picked = 0;

if (navigator.userAgent.includes('Mac')) document.documentElement.classList.add('mac');

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
    av.textContent = initial(who.name);
    av.style.background = who.color;
  }
  return av;
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
  if (isPrivate(b) || mentions(l.text, state.me[l.net])) b.mention = true;
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
  node.replaceChildren();
  if (isPrivate(b)) {
    const who = identity(b.name);
    if (who.photo) return photoInto(node, who.photo);
    node.textContent = initial(who.name);
    node.style.background = who.color;
    node.style.color = 'var(--bg)';
    return node;
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

function renderHeader() {
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

function renderStatus(message) {
  const down = state.networks.filter((n) => state.conn[n] && state.conn[n] !== 'connected');
  const text = message || down.map((n) => `${n}: ${state.conn[n]}`).join(' · ');
  el.status.textContent = text;
  el.status.hidden = !text;
  if (el.settings.open) renderSettings();
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
  else if (e.key === 'Enter' && list[picked]) return pick(list[picked].key);
  else return;
  e.preventDefault();
  renderList();
});
el.switcher.addEventListener('click', (e) => {
  if (e.target === el.switcher) el.switcher.close();
});

// Settings

function renderSettings() {
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
  head.append(name, h('span', 'tm', clock(l.ts)));
  body.append(head);
  group.append(av, body);
  el.col.append(group);
  return { body, last: l };
}

function row(l) {
  const r = h('div', `text ${l.kind}`);
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
  const tokens = tokenize(text, state.me[l.net]);
  for (const t of tokens) {
    if (t.type === 'url') {
      const a = h('a', 'link', shortUrl(t.value));
      a.href = t.value;
      a.dataset.tip = t.value;
      r.append(a);
      firstUrl ??= t.value;
    } else if (t.type === 'mention') {
      r.append(h('span', 'mention', t.value));
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
  const prefix = `${line.nick}: `;
  if (!el.input.value.startsWith(prefix)) el.input.value = prefix + el.input.value;
  el.input.focus();
  el.input.setSelectionRange(el.input.value.length, el.input.value.length);
}

function stopReply() {
  if (replying && el.input.value === `${replying.nick}: `) el.input.value = '';
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
el.log.addEventListener('pointerleave', () => {
  closePanel();
  actions.remove();
});

function note(l) {
  if (l.kind === 'topic') return h('div', 'events', `${l.nick} changed the topic to “${l.text}”`);
  return h('div', 'events', l.text);
}

// Link previews

function getPreview(url) {
  if (!previews.has(url)) previews.set(url, invoke('preview', { url }).catch(() => null));
  return previews.get(url);
}

async function attachPreview(url, rowNode) {
  const p = await getPreview(url);
  if (!p || !rowNode.isConnected) return;
  // A page with only a title says nothing the link does not: no card.
  if (p.kind === 'page' && !p.image && !p.description) return;
  const pinned = atBottom();
  const card = p.kind === 'image' ? imageCard(p) : pageCard(p);
  if (rowNode.dataset.onlyLink === 'true') rowNode.replaceWith(card);
  else rowNode.after(card);
  const keep = () => pinned && toBottom();
  card.querySelector('img')?.addEventListener('load', keep);
  keep();
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
  const text = el.input.value;
  const b = state.buffers.get(state.current);
  if (!text.trim() || !b) return;
  hideSlash();
  try {
    if (text.startsWith('/') && !text.startsWith('//')) {
      lastCommandAt = Date.now();
      if (await runLocal(b, text)) {
        lastSent = text;
        el.input.value = '';
        return;
      }
    }
    if (replying && text.startsWith(`${replying.nick}: `)) {
      replyHints.set(text, { line: replying, row: findRow(replying) });
    }
    await invoke('send', { net: b.net, buffer: b.name, text });
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
  const items = commandMatches(el.input.value);
  if (!items || !items.length) return hideSlash();
  slashItems = items;
  slashPick = Math.min(slashPick, items.length - 1);
  el.slash.replaceChildren(...items.map((c, i) => {
    const item = h('button', 'slash-item');
    item.type = 'button';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(i === slashPick));
    item.append(h('span', 'slash-name', `/${c.name}`), h('span', 'slash-args', c.args), h('span', 'slash-desc', c.desc));
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      applySlash(c);
    });
    return item;
  }));
  el.slash.hidden = false;
  el.slash.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

function applySlash(c) {
  el.input.value = `/${c.name} `;
  hideSlash();
  el.input.focus();
  if (!c.args) send();
}

el.input.addEventListener('input', () => {
  slashPick = 0;
  renderSlash();
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
      applySlash(slashItems[slashPick]);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideSlash();
      return;
    }
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    complete();
    return;
  }
  completion = null;
  if (e.key === 'Escape' && replying) {
    e.preventDefault();
    stopReply();
    return;
  }
  if (e.key === 'ArrowUp' && !el.input.value && lastSent) {
    e.preventDefault();
    el.input.value = lastSent;
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (el.switcher.open) el.switcher.close();
    else openSwitcher();
    return;
  }
  if (e.altKey && /^[1-9]$/.test(e.key)) {
    const b = ordered()[Number(e.key) - 1];
    if (b) select(b.key);
    e.preventDefault();
  }
  if (e.shiftKey && e.key === 'Escape') {
    e.preventDefault();
    markCurrentRead();
    return;
  }
  if (e.altKey && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    jumpToUnreadChannel();
  }
  if ((e.altKey && e.key === 'ArrowRight') || (e.ctrlKey && e.key === 'PageDown')) step(1);
  if ((e.altKey && e.key === 'ArrowLeft') || (e.ctrlKey && e.key === 'PageUp')) step(-1);
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
  sep.append(h('span', 'sep-label', 'New'));
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
  view.separator?.remove();
  view.separator = null;
  view.separatorAfter = readMap[b.key] ?? lastId(b);
  updateJumps();
}

// Jumping: to the channel with unread, to the "New" line, back to the latest.

function jumpToUnreadChannel() {
  const waiting = ordered().filter((b) => b.key !== state.current && wantsAttention(b));
  const next = waiting.find((b) => b.mention) || waiting[0];
  if (next) select(next.key);
}

function updateJumps() {
  const sep = view?.separator;
  const sepAbove = sep && sep.getBoundingClientRect().bottom < el.log.getBoundingClientRect().top;
  el.jumpUnread.hidden = !sepAbove;
  el.jumpLatest.hidden = atBottom();
  const b = state.buffers.get(state.current);
  const count = b ? unreadCount(b) : 0;
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
    el.input.focus();
  });
});

el.jumpUnread.addEventListener('click', () => {
  if (view?.separator) view.separator.scrollIntoView({ block: 'start', behavior: 'smooth' });
});
el.jumpLatest.addEventListener('click', () => {
  el.log.scrollTo({ top: el.log.scrollHeight, behavior: 'smooth' });
});

let jumpFrame = 0;
el.log.addEventListener('scroll', () => {
  cancelAnimationFrame(jumpFrame);
  jumpFrame = requestAnimationFrame(() => {
    updateJumps();
  });
}, { passive: true });

// Start

function applyStatus(st) {
  state.networks = st.networks.map((n) => n.name);
  state.configPath = st.config_path;
  for (const n of st.networks) {
    state.conn[n.name] = n.state;
    if (n.nick) state.me[n.name] = n.nick;
  }
  state.people = st.people || [];
  state.settings = st.settings || {};
  applyReadSetting(state.settings[READ_SETTING]);
  for (const info of st.channels) onBuffer(info);
  renderStatus(st.error || undefined);
}

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
  await listen('setting', (e) => {
    state.settings[e.payload.key] = e.payload.value;
    if (e.payload.key === READ_SETTING) applyReadSetting(e.payload.value);
    if (e.payload.key === MUTED_SETTING || e.payload.key === CHANNELS_SETTING) renderHeader();
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
    av.textContent = initial(p.name || p.nicks[0] || '?');
    av.style.background = color;
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
  el.channelMute.checked = isMuted(b);
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
  el.personPhoto.style.background = '';
  el.personPhoto.classList.toggle('empty', !p.photo && !name);
  if (p.photo) {
    const img = h('img');
    img.src = shownPhoto(p.photo);
    img.alt = '';
    el.personPhoto.append(img);
  } else if (name) {
    el.personPhoto.textContent = p.channel ? '#' : initial(name);
    el.personPhoto.style.background = color;
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
    const b = state.buffers.get(editing.channel);
    if (b && el.channelMute.checked !== isMuted(b)) setMuted(b, el.channelMute.checked);
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
async function openPicker(anchor, onPick) {
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
  p.input.focus();
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
