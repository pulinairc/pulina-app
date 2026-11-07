// Pure helpers for the chat view, kept apart so they can be tested in Node.

export const GROUP_GAP_MS = 5 * 60 * 1000;
export const EVENT_KINDS = new Set(['join', 'part', 'quit', 'nick', 'kick']);
export const CHAT_KINDS = new Set(['msg', 'action', 'notice']);

const NAMES_SHOWN = 3;
// Tokyo Night colours, purple left out.
const PALETTE = ['#7aa2f7', '#7dcfff', '#2ac3de', '#73daca', '#9ece6a', '#e0af68', '#ff9e64', '#f7768e', '#b4f9f8', '#c3e88d'];
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

export function nickColor(nick) {
  let h = 0;
  for (const ch of nick.toLowerCase().replace(/[_\-`|^]+$/, '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
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
