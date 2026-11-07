// Pure helpers for the chat view, kept apart so they can be tested in Node.

export const GROUP_GAP_MS = 5 * 60 * 1000;
export const EVENT_KINDS = new Set(['join', 'part', 'quit', 'nick', 'kick']);
export const CHAT_KINDS = new Set(['msg', 'action', 'notice']);

const NAMES_SHOWN = 3;
// Nick colours are spread over the whole hue circle, minus purple (kept free for nothing
// to clash with), at one lightness that reads well on the dark background.
const PURPLE_FROM = 235;
const PURPLE_SPAN = 85;
const NICK_SATURATION = 70;
const NICK_LIGHTNESS = 68;
const FORMATTING = /[\x02\x0f\x11\x16\x1d\x1e\x1f]|\x03(\d{1,2}(,\d{1,2})?)?/g;
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCT = /[.,;:!?'"»)\]]+$/;

export function isChannel(name) {
  return /^[#&!+]/.test(name);
}

export function sameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function clock(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function dayLabel(ts, now = Date.now()) {
  if (sameDay(ts, now)) return 'Today';
  if (sameDay(ts, now - 86_400_000)) return 'Yesterday';
  const d = new Date(ts);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

/** Does `line` belong in the same group as `prev`? */
export function continues(prev, line) {
  if (!prev || !CHAT_KINDS.has(prev.kind) || !CHAT_KINDS.has(line.kind)) return false;
  if (prev.nick.toLowerCase() !== line.nick.toLowerCase()) return false;
  return line.ts - prev.ts < GROUP_GAP_MS && sameDay(prev.ts, line.ts);
}

function names(list, verb) {
  const unique = [...new Set(list)];
  if (unique.length > NAMES_SHOWN) return `${unique.length} ${verb}`;
  const last = unique.pop();
  return unique.length ? `${unique.join(', ')} and ${last} ${verb}` : `${last} ${verb}`;
}

/** One readable line for a run of joins, parts, quits and nick changes. */
export function summarize(events) {
  const by = { join: [], part: [], quit: [] };
  const extra = [];
  for (const e of events) {
    if (by[e.kind]) by[e.kind].push(e.nick);
    if (e.kind === 'nick') extra.push(`${e.nick} is now ${e.text}`);
    if (e.kind === 'kick') extra.push(`${e.nick} was kicked by ${e.text.split(':')[0]}`);
  }
  const parts = [];
  if (by.join.length) parts.push(names(by.join, 'joined'));
  if (by.part.length) parts.push(names(by.part, 'left'));
  if (by.quit.length) parts.push(names(by.quit, 'quit'));
  if (extra.length > NAMES_SHOWN) parts.push(`${extra.length} changes`);
  else parts.push(...extra);
  return parts.join(', ');
}

export function stripFormatting(text) {
  return text.replace(FORMATTING, '');
}

export function mentions(text, me) {
  if (!me) return false;
  const escaped = me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w])${escaped}(?![\\w])`, 'i').test(text);
}

/** Split text into plain, link and mention pieces. */
export function tokenize(text, me) {
  const clean = stripFormatting(text);
  const out = [];
  let at = 0;
  for (const m of clean.matchAll(URL_RE)) {
    const url = m[0].replace(TRAILING_PUNCT, '');
    if (m.index > at) out.push(...splitMentions(clean.slice(at, m.index), me));
    out.push({ type: 'url', value: url });
    at = m.index + url.length;
  }
  if (at < clean.length) out.push(...splitMentions(clean.slice(at), me));
  return out;
}

function splitMentions(text, me) {
  if (!me || !mentions(text, me)) return [{ type: 'text', value: text }];
  const escaped = me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = [];
  let at = 0;
  for (const m of text.matchAll(new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'gi'))) {
    if (m.index > at) out.push({ type: 'text', value: text.slice(at, m.index) });
    out.push({ type: 'mention', value: m[0] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ type: 'text', value: text.slice(at) });
  return out;
}

const SHORT_PATH_CHARS = 28;

/** A link as people read it: host and the start of the path, no scheme or www. */
export function shortUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const rest = (u.pathname + u.search).replace(/\/$/, '');
    if (!rest) return host;
    return rest.length > SHORT_PATH_CHARS ? `${host}${rest.slice(0, SHORT_PATH_CHARS)}…` : host + rest;
  } catch {
    return url;
  }
}

/** Hue for a nick, ignoring trailing _ - ` | ^ so Setsu and Setsu_ match. */
export function nickHue(nick) {
  let h = 0x811c9dc5;
  for (const ch of nick.toLowerCase().replace(/[_\-`|^]+$/, '')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hue = h % (360 - PURPLE_SPAN);
  return hue >= PURPLE_FROM ? hue + PURPLE_SPAN : hue;
}

export function nickColor(nick) {
  return `hsl(${nickHue(nick)} ${NICK_SATURATION}% ${NICK_LIGHTNESS}%)`;
}

export function initial(nick) {
  const m = nick.match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : '?';
}

/** Next nick matching `prefix`, cycling past `previous`. */
export function completeNick(prefix, members, previous = '') {
  const p = prefix.toLowerCase();
  const matches = [...members].filter((m) => m.toLowerCase().startsWith(p)).sort((a, b) => a.localeCompare(b));
  if (!matches.length) return null;
  const i = matches.indexOf(previous);
  return matches[(i + 1) % matches.length];
}

const REACTION_RE = /^([^\s:,]+)[:,]\s*((?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|️|‍)+)\s*$/u;
const ADDRESS_RE = /^([^\s:,]+)[:,]\s+([\s\S]+)$/u;

/** "nick: 😂" is how a reaction travels over IRC. */
export function parseReaction(text) {
  const m = stripFormatting(text).match(REACTION_RE);
  return m ? { nick: m[1], emoji: m[2] } : null;
}

/** "nick: text" is how a reply travels over IRC. */
export function parseAddress(text) {
  const m = text.match(ADDRESS_RE);
  return m ? { nick: m[1], rest: m[2] } : null;
}
