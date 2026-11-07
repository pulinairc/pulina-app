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

const $ = (id) => document.getElementById(id);
const el = { tabs: $('tabs'), status: $('status'), log: $('log'), col: $('col'), form: $('composer'), input: $('input') };

const state = { networks: [], buffers: new Map(), current: null, me: {}, conn: {} };
const previews = new Map();
let view = null;
let completion = null;
let lastSent = '';

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
  renderTabs();
  if (!state.current && isChannel(name)) select(k);
  return b;
}

async function loadHistory(b) {
  const lines = await invoke('history', { net: b.net, buffer: b.name });
  const fresh = lines.filter((l) => !b.ids.has(l.id));
  b.lines = [...fresh, ...b.lines].slice(-MAX_LINES);
  for (const l of fresh) b.ids.add(l.id);
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

  if (state.current === b.key) {
    appendLine(l, true);
    if (document.hasFocus()) return;
  }
  if (!CHAT_KINDS.has(l.kind) || l.own) return;
  if (state.current !== b.key || !document.hasFocus()) {
    b.unread += 1;
    if (isPrivate(b) || mentions(l.text, state.me[l.net])) b.mention = true;
    renderTabs();
  }
}

function onBuffer(info) {
  const b = buffer(info.net, info.name);
  b.topic = info.topic;
  b.joined = info.joined;
  b.members = new Set(info.members);
  renderTabs();
}

// Tabs

function ordered() {
  const kind = (b) => (b.name === '' ? 2 : isPrivate(b) ? 1 : 0);
  const netIndex = (b) => {
    const i = state.networks.indexOf(b.net);
    return i === -1 ? 99 : i;
  };
  return [...state.buffers.values()].sort((a, b) => netIndex(a) - netIndex(b) || kind(a) - kind(b));
}

function renderTabs() {
  const tabs = ordered().map((b) => {
    const tab = h('button', 'tab', label(b));
    tab.type = 'button';
    tab.title = [b.net, b.topic].filter(Boolean).join(' · ');
    tab.classList.toggle('active', b.key === state.current);
    tab.classList.toggle('mention', b.mention);
    tab.classList.toggle('private', isPrivate(b));
    tab.classList.toggle('server', b.name === '');
    if (b.unread) tab.append(h('span', 'count', String(b.unread)));
    tab.addEventListener('click', () => select(b.key));
    return tab;
  });
  el.tabs.replaceChildren(...tabs);
  el.tabs.querySelector('.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function renderStatus(message) {
  const down = state.networks.filter((n) => state.conn[n] && state.conn[n] !== 'connected');
  const text = message || down.map((n) => `${n}: ${state.conn[n]}`).join(' · ');
  el.status.textContent = text;
  el.status.hidden = !text;
}

function select(k) {
  const b = state.buffers.get(k);
  if (!b) return;
  state.current = k;
  b.unread = 0;
  b.mention = false;
  try { localStorage.setItem(LAST_BUFFER_KEY, k); } catch { /* storage may be unavailable */ }
  el.input.placeholder = `Message ${label(b)}`;
  renderTabs();
  renderLog();
  el.input.focus();
}

function step(offset) {
  const list = ordered();
  const i = list.findIndex((b) => b.key === state.current);
  const next = list[(i + offset + list.length) % list.length];
  if (next) select(next.key);
}

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
  if (!a) return;
  e.preventDefault();
  openUrl(a.href);
});

window.addEventListener('focus', () => {
  const b = state.buffers.get(state.current);
  if (!b || (!b.unread && !b.mention)) return;
  b.unread = 0;
  b.mention = false;
  renderTabs();
});

// Start

async function start() {
  await listen('line', (e) => onLine(e.payload));
  await listen('buffer', (e) => onBuffer(e.payload));
  await listen('me', (e) => { state.me[e.payload.net] = e.payload.nick; });
  await listen('conn', (e) => {
    state.conn[e.payload.net] = e.payload.state;
    renderStatus();
  });

  const st = await invoke('status');
  state.networks = st.networks.map((n) => n.name);
  for (const n of st.networks) {
    state.conn[n.name] = n.state;
    if (n.nick) state.me[n.name] = n.nick;
  }
  for (const info of st.channels) onBuffer(info);
  if (st.error) renderStatus(st.error);
  else renderStatus();

  let saved = null;
  try { saved = localStorage.getItem(LAST_BUFFER_KEY); } catch { /* storage may be unavailable */ }
  for (const r of await invoke('recent_buffers')) buffer(r.net, r.buffer);
  if (saved && state.buffers.has(saved)) select(saved);
}

start();
