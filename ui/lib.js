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
  const two = (n) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
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

/** Commands offered in the / menu. `local` ones are handled by the app itself. */
export const COMMANDS = [
  { name: 'me', args: 'action', desc: 'Say what you are doing' },
  { name: 'msg', args: 'nick text', desc: 'Send a private message' },
  { name: 'query', args: 'nick', desc: 'Open a private chat', local: true },
  { name: 'join', args: '#channel', desc: 'Join a channel' },
  { name: 'part', args: 'reason', desc: 'Leave this channel' },
  { name: 'wc', args: '', desc: 'Close this window, leaving the channel', local: true },
  { name: 'topic', args: 'text', desc: 'Show or change the topic' },
  { name: 'names', args: '', desc: 'List people here', local: true },
  { name: 'whois', args: 'nick', desc: 'Who is this' },
  { name: 'nick', args: 'newnick', desc: 'Change your nick' },
  { name: 'away', args: 'message', desc: 'Set away, or come back without a message' },
  { name: 'notice', args: 'target text', desc: 'Send a notice' },
  { name: 'invite', args: 'nick', desc: 'Invite someone here' },
  { name: 'kick', args: 'nick reason', desc: 'Kick someone out' },
  { name: 'op', args: 'nick', desc: 'Give operator status' },
  { name: 'deop', args: 'nick', desc: 'Take operator status' },
  { name: 'voice', args: 'nick', desc: 'Give voice' },
  { name: 'devoice', args: 'nick', desc: 'Take voice' },
  { name: 'mute', args: '', desc: 'Mute this channel', local: true },
  { name: 'unmute', args: '', desc: 'Unmute this channel', local: true },
  { name: 'say', args: 'text', desc: 'Send text as is, even starting with /' },
];

/** Commands matching what is typed after "/", or null when the menu should be closed. */
export function commandMatches(input) {
  const m = input.match(/^\/(\w*)$/);
  if (!m) return null;
  const q = m[1].toLowerCase();
  return COMMANDS.filter((c) => c.name.startsWith(q));
}

const NICK_TAIL = /[_\-`|^]+$/;

function normNick(nick) {
  return nick.toLowerCase().replace(NICK_TAIL, '');
}

/** Shell-style pattern: * is anything, ? is one character. Case-insensitive. */
export function glob(pattern, text) {
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${re}$`, 'i').test(text);
}

/**
 * The person a nick belongs to. Patterns are nicks ("Setsu"), nick globs ("Setsu*")
 * or ident@host globs ("*!setsu@*.example.net" or "setsu@*"). Trailing _ - ` | ^ on a
 * nick are ignored, so "Setsu" also covers "Setsu_".
 */
export function personFor(people, nick, mask = '') {
  const plain = normNick(nick);
  for (const person of people) {
    for (const pattern of person.nicks) {
      if (pattern.includes('@')) {
        if (mask && glob(pattern.split('!').pop(), mask)) return person;
      } else if (glob(pattern, nick) || glob(normNick(pattern), plain)) {
        return person;
      }
    }
  }
  return null;
}

/** A readable name colour from an average photo colour: keep the hue, fix the lightness. */
export function colorFromRgb(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const d = max - min;
  let hue = 0;
  if (d) {
    const [R, G, B] = [r / 255, g / 255, b / 255];
    if (max === R) hue = ((G - B) / d) % 6;
    else if (max === G) hue = (B - R) / d + 2;
    else hue = (R - G) / d + 4;
    hue = Math.round(hue * 60 + 360) % 360;
  }
  const sat = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const s = Math.round(Math.min(Math.max(sat * 100, 45), 80));
  return `hsl(${hue} ${s}% ${NICK_LIGHTNESS}%)`;
}

const YOUTUBE_HOSTS = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'];

/** The video in a YouTube link, or null. Shorts are portrait. */
export function youtube(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  let id = null;
  if (host === 'youtu.be') {
    id = u.pathname.slice(1);
  } else if (YOUTUBE_HOSTS.includes(host)) {
    id = u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
  }
  if (!/^[\w-]{11}$/.test(id ?? '')) return null;
  return { id, portrait: u.pathname.startsWith('/shorts/') };
}

/** 83 seconds as 1:23. */
export function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
