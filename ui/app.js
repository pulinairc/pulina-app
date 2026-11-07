import {
  CHAT_KINDS, EVENT_KINDS, clock, completeNick, continues, dayLabel, initial,
  isChannel, mentions, nickColor, sameDay, summarize, tokenize,
} from './lib.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { openUrl } = window.__TAURI__.opener;

const MAX_LINES = 2000;
const BOTTOM_SLACK_PX = 48;
const LAST_BUFFER_KEY = 'lobby.current';
const FIRST_PICK_DELAY_MS = 400;

const $ = (id) => document.getElementById(id);
const el = {
  title: $('title'), chanIcon: $('chan-icon'), chanName: $('chan-name'), chanMeta: $('chan-meta'),
  unread: $('unread'), gear: $('gear'), status: $('status'), log: $('log'), col: $('col'),
  form: $('composer'), input: $('input'),
  switcher: $('switcher'), filter: $('filter'), list: $('list'),
  settings: $('settings'), settingsClose: $('settings-close'), connections: $('connections'), configPath: $('config-path'),
};

const state = { networks: [], buffers: new Map(), current: null, me: {}, conn: {}, configPath: '' };
const previews = new Map();
let view = null;
let completion = null;
let lastSent = '';
let picked = 0;

const key = (net, name) => `${net}\u0000${name.toLowerCase()}`;
const label = (b) => b.name || b.net;
const isPrivate = (b) => b.name !== '' && !isChannel(b.name);

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
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
  const fresh = lines.filter((l) => !b.ids.has(l.id));
  if (!fresh.length) return;
  for (const l of fresh) b.ids.add(l.id);
  b.lines = [...b.lines, ...fresh].sort((x, y) => (x.id || Infinity) - (y.id || Infinity)).slice(-MAX_LINES);
  if (state.current === b.key) renderLog();
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
  const b = buffer(l.net, l.buffer);
  if (l.id && b.ids.has(l.id)) return;
  if (l.id) b.ids.add(l.id);
  b.lines.push(l);
  if (b.lines.length > MAX_LINES) b.lines.shift();
  trackMembers(b, l);

  const visible = state.current === b.key;
  if (visible) appendLine(l, true);
  if (!CHAT_KINDS.has(l.kind) || l.own || (visible && document.hasFocus())) return;

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

function icon(b, node) {
  node.style.background = '';
  node.style.color = '';
  if (isPrivate(b)) {
    node.textContent = initial(b.name);
    node.style.background = nickColor(b.name);
    node.style.color = 'var(--bg)';
  } else {
    node.textContent = b.name === '' ? '~' : '#';
  }
  return node;
}

function renderHeader() {
  const b = state.buffers.get(state.current);
  if (b) {
    icon(b, el.chanIcon);
    el.chanName.textContent = label(b);
    const who = isPrivate(b) ? 'private' : b.name === '' ? 'server messages' : `${b.members.size} people`;
    el.chanMeta.textContent = `${b.net} · ${who}`;
    el.title.title = b.topic || '';
  }

  const others = [...state.buffers.values()].filter((x) => x.key !== state.current && x.unread);
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
  b.unread = 0;
  b.mention = false;
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
    item.append(icon(b, h('span', 'chan-icon')), h('span', 'name', label(b)));
    if (b.unread) item.append(h('span', 'count', String(b.unread)));
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
el.unread.addEventListener('click', openSwitcher);
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
  view = { lastLine: null, group: null, events: null };
  const b = state.buffers.get(state.current);
  if (!b) return;
  for (const l of b.lines) appendLine(l, false);
  toBottom();
}

function appendLine(l, live) {
  const pinned = atBottom();
  const prev = view.lastLine;

  if (!prev || !sameDay(prev.ts, l.ts)) {
    el.col.append(h('div', 'day', dayLabel(l.ts)));
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
  const color = nickColor(l.nick);
  const av = h('div', 'av', initial(l.nick));
  av.style.background = color;
  av.setAttribute('aria-hidden', 'true');

  const body = h('div', 'gb');
  const head = h('div', 'hd');
  const name = h('span', 'nm', l.nick);
  name.style.color = color;
  head.append(name, h('span', 'tm', clock(l.ts)));
  body.append(head);
  group.append(av, body);
  el.col.append(group);
  return { body, last: l };
}

function row(l) {
  const r = h('div', `text ${l.kind}`);
  r.title = clock(l.ts);

  let firstUrl = null;
  for (const t of tokenize(l.text, state.me[l.net])) {
    if (t.type === 'url') {
      const a = h('a', 'link', t.value);
      a.href = t.value;
      r.append(a);
      firstUrl ??= t.value;
    } else if (t.type === 'mention') {
      r.append(h('span', 'mention', t.value));
    } else {
      r.append(t.value);
    }
  }
  if (firstUrl) attachPreview(firstUrl, r);
  return r;
}

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
  const pinned = atBottom();
  const card = p.kind === 'image' ? imageCard(p) : pageCard(p);
  const bareImage = p.kind === 'image' && rowNode.textContent.trim() === url;
  if (bareImage) rowNode.replaceWith(card);
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
  const text = h('div', 'card-text');
  if (p.site) text.append(h('span', 'card-site', p.site));
  if (p.title) text.append(h('span', 'card-title', p.title));
  if (p.description) text.append(h('span', 'card-desc', p.description));
  a.append(text);
  if (p.image) a.append(image(p.image, 'card-img'));
  return a;
}

// Composer

async function send() {
  const text = el.input.value;
  const b = state.buffers.get(state.current);
  if (!text.trim() || !b) return;
  try {
    await invoke('send', { net: b.net, buffer: b.name, text });
    lastSent = text;
    el.input.value = '';
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

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  send();
});

el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    complete();
    return;
  }
  completion = null;
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
  if ((e.altKey && e.key === 'ArrowRight') || (e.ctrlKey && e.key === 'PageDown')) step(1);
  if ((e.altKey && e.key === 'ArrowLeft') || (e.ctrlKey && e.key === 'PageUp')) step(-1);
});

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.getAttribute('href') === '#') return;
  e.preventDefault();
  openUrl(a.href);
});

window.addEventListener('focus', () => {
  const b = state.buffers.get(state.current);
  if (!b || (!b.unread && !b.mention)) return;
  b.unread = 0;
  b.mention = false;
  renderHeader();
});

// Start

function applyStatus(st) {
  state.networks = st.networks.map((n) => n.name);
  state.configPath = st.config_path;
  for (const n of st.networks) {
    state.conn[n.name] = n.state;
    if (n.nick) state.me[n.name] = n.nick;
  }
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
