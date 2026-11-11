// Pure helpers for the chat view, kept apart so they can be tested in Node.
import { t, tv } from './i18n.js';

export const GROUP_GAP_MS = 5 * 60 * 1000;
export const EVENT_KINDS = new Set(['join', 'part', 'quit', 'nick', 'kick', 'mode']);
export const CHAT_KINDS = new Set(['msg', 'action', 'notice']);

const NAMES_SHOWN = 3;
// Nick colours are spread over the whole hue circle, minus purple (kept free for nothing
// to clash with), at one lightness that reads well on the dark background.
const PURPLE_FROM = 235;
const PURPLE_SPAN = 85;
const NICK_SATURATION = 70;
const NICK_LIGHTNESS = 68;
// biome-ignore lint/suspicious/noControlCharactersInRegex: IRC formatting codes are control characters.
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
  if (sameDay(ts, now)) {
    return t('Today');
  }
  if (sameDay(ts, now - 86_400_000)) {
    return t('Yesterday');
  }
  const d = new Date(ts);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

/** Does `line` belong in the same group as `prev`? */
export function continues(prev, line) {
  if (!prev || !CHAT_KINDS.has(prev.kind) || !CHAT_KINDS.has(line.kind)) {
    return false;
  }
  if (prev.nick.toLowerCase() !== line.nick.toLowerCase()) {
    return false;
  }
  return line.ts - prev.ts < GROUP_GAP_MS && sameDay(prev.ts, line.ts);
}

/** "kaisla and otso" from a list of nicks. */
function andList(list) {
  return list.length > 1 ? t('{list} and {last}', { list: list.slice(0, -1).join(', '), last: list.at(-1) }) : list[0];
}

/** `verb` is a template like "{who} joined"; Finnish has a plural form of each. */
function names(list, verb, all) {
  const unique = [...new Set(list)];
  if (unique.length > NAMES_SHOWN && !all) {
    return tv(verb, 'many', { who: unique.length });
  }
  return tv(verb, unique.length > 1 ? 'plural' : '', { who: andList(unique) });
}

const QUIT_REASON_CHARS = 120;

/** What someone said on quitting, without the "Quit:" servers put in front. */
export function quitReason(text = '') {
  return text
    .replace(/^Quit:\s*/i, '')
    .trim()
    .slice(0, QUIT_REASON_CHARS);
}

/** One readable line for a run of joins, parts, quits and nick changes; `all` names every one of them. */
export function summarize(events, all = false) {
  const by = { join: [], part: [], quit: [] };
  const extra = [];
  for (const e of events) {
    // Someone who left a quit message gets a line of their own with it.
    const reason = e.kind === 'quit' ? quitReason(e.text) : '';
    if (reason) {
      extra.push(t('{nick} quit ({reason})', { nick: e.nick, reason }));
    } else if (by[e.kind]) {
      by[e.kind].push(e.nick);
    }
    if (e.kind === 'nick') {
      extra.push(t('{nick} is now {name}', { nick: e.nick, name: e.text }));
    }
    if (e.kind === 'kick') {
      extra.push(t('{nick} was kicked by {by}', { nick: e.nick, by: e.text.split(':')[0] }));
    }
    if (e.kind === 'mode') {
      extra.push(describeMode(e.nick, e.text));
    }
  }
  const parts = [];
  if (by.join.length) {
    parts.push(names(by.join, '{who} joined', all));
  }
  if (by.part.length) {
    parts.push(names(by.part, '{who} left', all));
  }
  if (by.quit.length) {
    parts.push(names(by.quit, '{who} quit', all));
  }
  if (extra.length > NAMES_SHOWN && !all) {
    parts.push(t('{n} changes', { n: extra.length }));
  } else {
    parts.push(...extra);
  }
  return parts.join(', ');
}

/** Name prefix modes in words; any other mode is shown as set. */
const MODE_WORDS = { q: 'owner', a: 'admin', o: 'op', h: 'half-op', v: 'voice' };
/** Modes that take a parameter always, and those that take one only when set. */
const MODE_PARAMS = 'qaohvbeIk';
const MODE_SET_PARAMS = 'l';

/**
 * "kaisla gave voice to lumi and aapo, took op from otso" from a MODE line's
 * setter and its text, "+vv-o lumi aapo otso". Other modes read "set +m" or "set +b mask".
 */
export function describeMode(setter, text) {
  const [changes = '', ...args] = text.split(' ');
  const given = new Map();
  const plain = [];
  let sign = '+';
  for (const mode of changes) {
    if (mode === '+' || mode === '-') {
      sign = mode;
      continue;
    }
    const takes = MODE_PARAMS.includes(mode) || (sign === '+' && MODE_SET_PARAMS.includes(mode));
    const arg = takes ? args.shift() : undefined;
    if (MODE_WORDS[mode] && arg) {
      const k = `${sign}${mode}`;
      given.set(k, [...(given.get(k) || []), arg]);
    } else {
      plain.push(arg ? `${sign}${mode} ${arg}` : `${sign}${mode}`);
    }
  }
  const parts = [...given].map(([k, nicks]) => {
    const vars = { mode: tv(MODE_WORDS[k[1]], 'mode'), who: andList(nicks) };
    const many = nicks.length > 1 ? 'plural' : '';
    return k[0] === '+' ? tv('gave {mode} to {who}', many, vars) : tv('took {mode} from {who}', many, vars);
  });
  if (plain.length) {
    parts.push(t('set {modes}', { modes: plain.join(' ') }));
  }
  return `${setter} ${parts.join(', ')}`;
}

export function stripFormatting(text) {
  return text.replace(FORMATTING, '');
}

/**
 * Matches any of the words (a nick, or highlight words) as a whole word, in any letters,
 * so "rolle" is found in "rolle: hi" but not in "Anterolle" or "kontrolleri".
 */
const patterns = new Map();

function wordPattern(words) {
  const list = [words].flat().filter(Boolean);
  if (!list.length) {
    return null;
  }
  const key = list.join('\n');
  if (!patterns.has(key)) {
    const any = list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    patterns.set(key, new RegExp(`(?<![\\p{L}\\p{N}_])(?:${any})(?![\\p{L}\\p{N}_])`, 'giu'));
  }
  const re = patterns.get(key);
  re.lastIndex = 0;
  return re;
}

export function mentions(text, words) {
  const re = wordPattern(words);
  return Boolean(re) && re.test(text);
}

// Masked by Settings > Chat > Hide offensive words. Whole words only, so Finnish needs its common forms listed.
export const OFFENSIVE_WORDS = [
  'asshole',
  'assholes',
  'bastard',
  'bitch',
  'bitches',
  'bullshit',
  'chink',
  'cunt',
  'cunts',
  'dickhead',
  'fag',
  'faggot',
  'faggots',
  'fuck',
  'fucked',
  'fucker',
  'fuckers',
  'fucking',
  'kike',
  'motherfucker',
  'nigga',
  'nigger',
  'niggers',
  'retard',
  'retarded',
  'shit',
  'shitty',
  'slut',
  'spic',
  'tranny',
  'twat',
  'wanker',
  'whore',
  'helvetin',
  'helvetti',
  'hintti',
  'hintit',
  'huora',
  'huoran',
  'huorat',
  'kusipää',
  'kusipäät',
  'kyrpä',
  'kyrvän',
  'lutka',
  'lutkat',
  'mulkku',
  'mulkut',
  'neekeri',
  'neekerin',
  'neekerit',
  'paska',
  'paskaa',
  'paskan',
  'paskat',
  'perkele',
  'pillu',
  'pillun',
  'runkkari',
  'ryssä',
  'ryssät',
  'saatana',
  'saatanan',
  'vitun',
  'vittu',
  'vittua',
  'vittuun',
];

const MASK = '•••';

/** `text` with each whole-word match of `words` shown as •••. */
export function maskWords(text, words) {
  const re = wordPattern(words);
  return re ? text.replace(re, MASK) : text;
}

/** Split text into plain, link and mention pieces. */
export function tokenize(text, me) {
  const clean = stripFormatting(text);
  const out = [];
  let at = 0;
  for (const m of clean.matchAll(URL_RE)) {
    const url = m[0].replace(TRAILING_PUNCT, '');
    if (m.index > at) {
      out.push(...splitMentions(clean.slice(at, m.index), me));
    }
    out.push({ type: 'url', value: url });
    at = m.index + url.length;
  }
  if (at < clean.length) {
    out.push(...splitMentions(clean.slice(at), me));
  }
  return out;
}

function splitMentions(text, words) {
  const re = wordPattern(words);
  if (!re) {
    return [{ type: 'text', value: text }];
  }
  const out = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) {
      out.push({ type: 'text', value: text.slice(at, m.index) });
    }
    out.push({ type: 'mention', value: m[0] });
    at = m.index + m[0].length;
  }
  if (at < text.length) {
    out.push({ type: 'text', value: text.slice(at) });
  }
  return out;
}

const SHORT_PATH_CHARS = 28;

/** A link as people read it: host and the start of the path, no scheme or www. */
export function shortUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const rest = (u.pathname + u.search).replace(/\/$/, '');
    if (!rest) {
      return host;
    }
    return rest.length > SHORT_PATH_CHARS ? `${host}${rest.slice(0, SHORT_PATH_CHARS)}…` : host + rest;
  } catch {
    return url;
  }
}

/** Hue for a nick, ignoring trailing _ - ` | ^ so Setsu and Setsu_ match. */
function nickHash(nick) {
  let h = 0x811c9dc5;
  for (const ch of nick.toLowerCase().replace(/[_\-`|^]+$/, '')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function nickHue(nick) {
  const h = nickHash(nick);
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

/**
 * The word being typed at the caret when it could be a nick: "@mi" or "mi" at the end of `before`.
 * Gives where it starts, whether it began with @, and the part to match. A bare word needs two letters.
 */
export function nickQuery(before) {
  const m = /(^|\s)(@?)([^\s@:,]*)$/u.exec(before);
  if (!m) {
    return null;
  }
  const at = m[2] === '@';
  if (!at && m[3].length < 2) {
    return null;
  }
  return { start: m.index + m[1].length, at, word: m[3] };
}

/** Members whose nick starts with `word`, by `rank` (lower first), at most `limit`. */
export function nickMatches(word, members, rank, limit = 6) {
  const w = word.toLowerCase();
  return [...members]
    .filter((m) => m.toLowerCase().startsWith(w))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .slice(0, limit);
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
  if (!m) {
    return null;
  }
  const q = m[1].toLowerCase();
  return COMMANDS.filter((c) => c.name.startsWith(q));
}

const NICK_TAIL = /[_\-`|^]+$/;

function normNick(nick) {
  return nick.toLowerCase().replace(NICK_TAIL, '');
}

/** Shell-style pattern: * is anything, ? is one character. Case-insensitive. */
export function glob(pattern, text) {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
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
        if (mask && glob(pattern.split('!').pop(), mask)) {
          return person;
        }
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
    if (max === R) {
      hue = ((G - B) / d) % 6;
    } else if (max === G) {
      hue = (B - R) / d + 2;
    } else {
      hue = (R - G) / d + 4;
    }
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
  if (!/^[\w-]{11}$/.test(id ?? '')) {
    return null;
  }
  return { id, portrait: u.pathname.startsWith('/shorts/') };
}

/** 83 seconds as 1:23. */
export function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const ANIMALS = [
  ...'🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🐤🦆🦉🦇🐺🐗🐴🦄🐝🐛🦋🐌🐞🐢🐍🦎🐙🦑🦀🐡🐠🐟🐬🐳🦈🐊🐅🐆🦓🦍🦧🐘🦛🦏🐪🦒🦘🦬🐃🐂🐄🐎🐖🐏🐑🦙🐐🦌🐕🐩🦮🐈🐓🦃🦤🦚🦜🦢🦩🐇🦝🦨🦡🦫🦦🦥🐁🐀🦔🐉🦕🦖🐋🦭🪼🐹🐰🐭🐶🐱',
];

/** The animal a nick gets when it has no photo, the same one every time. */
export function animalFor(nick) {
  return ANIMALS[nickHash(nick) % ANIMALS.length];
}

// Emoticons and emoji shortcodes, the same rules as the NeAI web app.

/** Only standalone tokens convert, so "https://" and mid-word colons never match. Longer tokens first. */
const EMOTICONS = [
  [":'(", '😢'],
  [':D', '😁'],
  [';)', '😉'],
  [':)', '🙂'],
  [':(', '🙁'],
  [':P', '😛'],
  [':p', '😛'],
  [':S', '😖'],
  [':s', '😖'],
  ['xD', '😆'],
  ['XD', '😆'],
  [':O', '😮'],
  [':o', '😮'],
  ['<3', '❤️'],
  [':*', '😘'],
  [':/', '😕'],
  [':|', '😐'],
  [':-)', '🙂'],
  [':-D', '😁'],
  [':-(', '🙁'],
  [';-)', '😉'],
  [':-P', '😛'],
  [':-p', '😛'],
  [':-/', '😕'],
  [':-|', '😐'],
  ['=)', '🙂'],
  ['=D', '😁'],
  ['=(', '🙁'],
  [':]', '🙂'],
  [':>', '😊'],
  ['^^', '😊'],
  ['^_^', '😊'],
  ['-_-', '😑'],
  ['o_O', '🤨'],
  ['O_o', '🤨'],
  ['>:(', '😠'],
  [':@', '😠'],
  [':$', '😳'],
  [':x', '🤐'],
  [':X', '🤐'],
  [':3', '😺'],
  ['D:', '😧'],
  ['xd', '😆'],
  ['</3', '💔'],
];
const EMOTICON_RE = new RegExp(`(^|\\s)(${EMOTICONS.map(([t]) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=\\s|$)`, 'g');
const EMOTICON_MAP = Object.fromEntries(EMOTICONS);

export function convertEmoticons(text) {
  return text.replace(EMOTICON_RE, (_m, pre, tok) => pre + (EMOTICON_MAP[tok] ?? tok));
}

/** The ":word" right before the caret, two characters or more, or null. */
export function colonQuery(beforeCaret) {
  return /(?:^|\s):([a-z0-9_+-]{2,})$/i.exec(beforeCaret)?.[1].toLowerCase() ?? null;
}

/** Shortest shared opening that counts as the same Finnish word. */
const STEM = 5;
/** Shorter fragments reach too many keywords to mean any of them. */
const KEYWORD_MIN = 3;
const SHORTCODE_HITS = 8;
const Tier = { Exact: 0, Shortcode: 1, Keyword: 2 };

/** A prefix, or a shared five-letter stem, since Finnish inflects the end of a word. */
function matchesWord(q, word) {
  if (word.startsWith(q)) {
    return true;
  }
  if (q.length < STEM) {
    return false;
  }
  let i = 0;
  while (i < q.length && i < word.length && q[i] === word[i]) {
    i++;
  }
  return i >= STEM;
}

/**
 * Emoji for a typed shortcode: exact shortcode, then shortcodes containing it, then keywords.
 * Inside a tier the most used wins, then where the match sits, then the shorter name.
 * `data` is the picker's categories of [emoji, words, shortcode]; `freq` counts use per emoji.
 */
export function emojiSearch(query, data, freq = {}) {
  const q = query.toLowerCase();
  const out = [];
  for (const cat of data) {
    for (const [native, words, id] of cat.emojis) {
      const at = id.indexOf(q);
      if (at !== -1) {
        out.push({ id, native, start: at, end: at + q.length, tier: id === q ? Tier.Exact : Tier.Shortcode });
        continue;
      }
      if (q.length < KEYWORD_MIN) {
        continue;
      }
      if (!words.split(' ').some((w) => matchesWord(q, w))) {
        continue;
      }
      out.push({ id, native, start: id.length, end: id.length + q.length, tier: Tier.Keyword });
    }
  }
  const strip = (e) => e.replace(/️/g, '');
  const counts = new Map(Object.entries(freq).map(([e, n]) => [strip(e), n]));
  const used = (h) => counts.get(strip(h.native)) ?? 0;
  return out
    .sort((a, b) => a.tier - b.tier || used(b) - used(a) || a.start - b.start || a.id.length - b.id.length)
    .slice(0, SHORTCODE_HITS);
}

const NICK_WORD = /[A-Za-z_[\]\\`^{}|][A-Za-z0-9_\-[\]\\`^{}|]+/g;

/** Text with the channel's nicks picked out. `members` maps lower-case nicks to their spelling. */
export function splitNicks(text, members) {
  const out = [];
  let at = 0;
  for (const m of text.matchAll(NICK_WORD)) {
    const nick = members.get(m[0].toLowerCase());
    if (!nick) {
      continue;
    }
    if (m.index > at) {
      out.push({ type: 'text', value: text.slice(at, m.index) });
    }
    out.push({ type: 'nick', value: m[0], nick });
    at = m.index + m[0].length;
  }
  if (at < text.length) {
    out.push({ type: 'text', value: text.slice(at) });
  }
  return out;
}

const MINUTE_S = 60;
const HOUR_S = 3600;
const DAY_S = 86400;

/** A length of time in its largest sensible units: 45 s, 12 min, 3 h 5 min, 4 d. */
export function span(secs) {
  if (secs < MINUTE_S) {
    return `${secs} s`;
  }
  if (secs < HOUR_S) {
    return `${Math.floor(secs / MINUTE_S)} min`;
  }
  if (secs < DAY_S) {
    return `${Math.floor(secs / HOUR_S)} h ${Math.floor((secs % HOUR_S) / MINUTE_S)} min`;
  }
  return t('{n} d', { n: Math.floor(secs / DAY_S) });
}

/** How long ago a time was, in words. */
export function ago(ts, now = Date.now()) {
  const secs = Math.floor((now - ts) / 1000);
  return secs < MINUTE_S ? t('just now') : t('{time} ago', { time: span(secs) });
}

/** WHOIS as tooltip lines. */
export function formatWhois(w) {
  if (!w.found) {
    return t('{nick} is not online', { nick: w.nick });
  }
  const lines = [w.realname && w.realname !== w.nick ? `${w.nick} (${w.realname})` : w.nick, `${w.user}@${w.host}`];
  if (w.account) {
    lines.push(t('Logged in as {account}', { account: w.account }));
  }
  if (w.channels) {
    lines.push(t('On {channels}', { channels: w.channels }));
  }
  if (w.server) {
    lines.push(t('Via {server}', { server: `${w.server}${w.server_info ? `, ${w.server_info}` : ''}` }));
  }
  if (w.idle_secs != null) {
    const vars = { time: span(w.idle_secs), date: w.signon && new Date(w.signon * 1000).toLocaleDateString('fi-FI') };
    lines.push(w.signon ? t('Idle {time}, online since {date}', vars) : t('Idle {time}', vars));
  }
  if (w.away) {
    lines.push(t('Away: {message}', { message: w.away }));
  }
  const extra = [w.secure && t('secure connection'), w.oper && t('IRC operator')].filter(Boolean);
  if (extra.length) {
    lines.push(extra.join(', '));
  }
  return lines.join('\n');
}

// Keyboard shortcuts. "Mod" is Cmd on macOS and Ctrl elsewhere, so one setting works on both.

export const DEFAULT_SHORTCUTS = {
  switcher: 'Mod+K',
  markRead: 'Mod+Enter',
  nextUnreadChannel: 'Alt+A',
  jumpUnread: 'Alt+U',
  prevChannel: 'Alt+ArrowLeft',
  nextChannel: 'Alt+ArrowRight',
  channelNumber: 'Alt',
  complete: 'Tab',
  recall: 'ArrowUp',
  highlights: 'Mod+Shift+H',
  shelf: 'Mod+Shift+S',
  people: 'Mod+Shift+P',
  settings: 'Mod+,',
  latest: 'Mod+End',
  scrollUp: 'Mod+ArrowUp',
  scrollDown: 'Mod+ArrowDown',
  reply: 'Mod+Shift+R',
  textLarger: 'Mod+Plus',
  textSmaller: 'Mod+-',
  textDefault: 'Mod+0',
};

/** On a Mac, Option types characters such as @ (Option+2 on a Nordic layout), so channels move with Cmd. */
const MAC_SHORTCUTS = {
  prevChannel: 'Mod+ArrowLeft',
  nextChannel: 'Mod+ArrowRight',
  channelNumber: 'Mod',
};

export function defaultShortcuts(mac) {
  return mac ? { ...DEFAULT_SHORTCUTS, ...MAC_SHORTCUTS } : { ...DEFAULT_SHORTCUTS };
}

const MODIFIER_KEYS = ['Control', 'Meta', 'Alt', 'Shift'];

/** A key press as a combo like "Mod+Enter", or null for a lone modifier. */
export function comboOf(e, mac) {
  if (MODIFIER_KEYS.includes(e.key)) {
    return null;
  }
  // Letters and digits by position, so Option+A on a Mac still reads as A, not å.
  const byCode = /^Key([A-Z])$/.exec(e.code || '')?.[1] ?? /^Digit(\d)$/.exec(e.code || '')?.[1];
  // + is the separator, so it is named; = is the same key without Shift on many layouts.
  const plus = e.key === '+' || e.key === '=';
  const key = byCode ?? (plus ? 'Plus' : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  const mods = [];
  if (mac ? e.metaKey : e.ctrlKey) {
    mods.push('Mod');
  }
  if (mac && e.ctrlKey) {
    mods.push('Ctrl');
  }
  if (e.altKey) {
    mods.push('Alt');
  }
  // Some layouts need Shift for +; Cmd++ is the same press either way.
  if (e.shiftKey && !plus) {
    mods.push('Shift');
  }
  return [...mods, key].join('+');
}

/** The modifier part of a combo: "Alt+3" gives "Alt". */
export function comboMods(combo) {
  return combo.split('+').slice(0, -1).join('+');
}

const KEY_NAMES = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', ' ': 'Space', Plus: '+' };

/** How a combo reads to a person on this system. */
export function comboLabel(combo, mac) {
  return combo
    .split('+')
    .map((part) => {
      if (part === 'Mod') {
        return mac ? 'Cmd' : 'Ctrl';
      }
      if (part === 'Alt' && mac) {
        return 'Option';
      }
      return KEY_NAMES[part] ?? part;
    })
    .join('+');
}

/** Whether the character just typed is a colon that starts a word, which opens the emoji picker. */
export function colonOpensPicker(value, caret) {
  return caret > 0 && value[caret - 1] === ':' && (caret === 1 || /\s/.test(value[caret - 2]));
}

/**
 * Where a popup of `width` x `height` goes for an anchor `box`: above it when it fits, else below,
 * right edges lined up, always `gap` inside `page`. All in the same pixels as the rectangles.
 */
export function popupSpot(box, page, width, height, gap) {
  const left = Math.min(Math.max(box.right - width, page.left + gap), page.right - width - gap);
  const above = box.top - height - gap;
  const top = above >= page.top + gap ? above : Math.min(box.bottom + gap, page.bottom - height - gap);
  return { left: Math.max(left, page.left + gap), top: Math.max(top, page.top + gap) };
}

/**
 * What to tell the user about macOS notifications, from what macOS reports
 * ({ state: 'allowed' | 'denied' | 'ask', banners, badge }), or null when all is well.
 */
export function notifyAdvice(permission) {
  if (!permission) {
    return null;
  }
  if (permission.state === 'ask') {
    return {
      text: t('macOS asks once whether Lobby may show notifications. Lobby uses them for mentions and private messages.'),
      action: t('Allow notifications'),
    };
  }
  if (permission.state === 'denied') {
    return {
      text: t('Notifications are off for Lobby in System Settings, so mentions and private messages make no sound or banner.'),
      action: t('Open System Settings'),
    };
  }
  const off = [!permission.banners && t('banners'), !permission.badge && t('the Dock badge')].filter(Boolean);
  if (off.length) {
    const vars = { what: andList(off) };
    return {
      text:
        off.length > 1
          ? t('Lobby may notify, but {what} are off in System Settings.', vars)
          : t('Lobby may notify, but {what} is off in System Settings.', vars),
      action: t('Open System Settings'),
    };
  }
  return null;
}

// The people list: ops first, then everyone by when they last spoke.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Spoke this recently: talking now. */
export const TALKING_MS = HOUR_MS;
/** How faint someone gets the longer they stay quiet; anyone quieter than the last step is at the floor. */
const FADE_STEPS = [
  [10 * MINUTE_MS, 1],
  [HOUR_MS, 0.9],
  [3 * HOUR_MS, 0.8],
  [DAY_MS, 0.68],
  [3 * DAY_MS, 0.55],
  [7 * DAY_MS, 0.45],
];
const FADE_FLOOR = 0.35;
const OP_PREFIXES = /[~&@]/;

/** "op", "voice" or "" from name prefixes like "@+"; half-ops count as voiced. */
export function roleOf(held = '') {
  if (OP_PREFIXES.test(held)) {
    return 'op';
  }
  return /[%+]/.test(held) ? 'voice' : '';
}

/** Short time since someone spoke: now, 12 min, 3h, 4d; nothing when never. */
export function quietFor(ts, now = Date.now()) {
  if (!ts) {
    return '';
  }
  const ms = now - ts;
  if (ms < MINUTE_MS) {
    return t('now');
  }
  if (ms < HOUR_MS) {
    return `${Math.floor(ms / MINUTE_MS)} min`;
  }
  if (ms < DAY_MS) {
    return t('{n}h', { n: Math.floor(ms / HOUR_MS) });
  }
  return t('{n}d', { n: Math.floor(ms / DAY_MS) });
}

/** Opacity for someone who last spoke at `ts`. */
export function fadeFor(ts, now = Date.now()) {
  if (!ts) {
    return FADE_FLOOR;
  }
  return FADE_STEPS.find(([limit]) => now - ts < limit)?.[1] ?? FADE_FLOOR;
}

/** Nicks by when they last spoke, latest first; those who never did in name order. */
export function byActivity(nicks, spokeAt) {
  return [...nicks].sort((a, b) => (spokeAt(b) || 0) - (spokeAt(a) || 0) || a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * The list's groups: Ops, Talking now, Earlier today, Away. Empty groups are left out.
 * `modes` maps nick to name prefixes, `spokeAt` gives a nick's last message time, `dayStart` is local midnight.
 */
export function peopleGroups(nicks, modes, spokeAt, now, dayStart) {
  const people = byActivity(nicks, spokeAt).map((nick) => {
    const held = modes.get(nick) || '';
    return { nick, held, role: roleOf(held), ts: spokeAt(nick) || 0 };
  });
  const rest = people.filter((p) => p.role !== 'op');
  return [
    { id: 'ops', title: t('Ops'), people: people.filter((p) => p.role === 'op') },
    { id: 'now', title: t('Talking now'), people: rest.filter((p) => p.ts && now - p.ts < TALKING_MS) },
    { id: 'today', title: t('Earlier today'), people: rest.filter((p) => p.ts >= dayStart && now - p.ts >= TALKING_MS) },
    { id: 'away', title: t('Away'), people: rest.filter((p) => p.ts < dayStart) },
  ].filter((g) => g.people.length);
}

/**
 * What one press of Op or Voice does to the picked people: give it when anyone lacks it,
 * otherwise take it from all. `nicks` is only those it changes.
 */
export function modeAction(picked, modes, symbol) {
  const lacking = picked.filter((n) => !(modes.get(n) || '').includes(symbol));
  return lacking.length ? { give: true, nicks: lacking } : { give: false, nicks: [...picked] };
}

/** "!seen milla" or ".w helsinki": a line that asks a bot for something. */
export function isCommand(text) {
  return /^[!.][\p{L}\p{N}_-]+(\s|$)/u.test(text);
}

/** Bot nicks from the setting, any mix of spaces and commas, lower-case. */
/** "a, b c" as ["a", "b", "c"], lowercased. */
export function wordList(value = '') {
  return value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

export function botNicks(value = '') {
  return new Set(wordList(value));
}

const IMAGE_EXT = /\.(?:jpe?g|png|gif|webp|avif|heic)$/i;

/** A Dropbox share link opens a web page; with raw=1 it serves the file itself. */
export function directLink(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (!/^(www\.)?dropbox\.com$/.test(u.hostname) || !/^\/(scl\/fi|s)\//.test(u.pathname)) {
    return url;
  }
  u.searchParams.delete('dl');
  u.searchParams.set('raw', '1');
  return u.toString();
}
const VIDEO_EXT = /\.(?:mp4|webm|mov|m4v)$/i;

/** What a link shows as on the shelf: a YouTube still, a picture, a video or a plain link row. */
export function mediaKind(url) {
  if (youtube(url)) {
    return 'youtube';
  }
  let path = '';
  try {
    path = new URL(url).pathname;
  } catch {
    return 'link';
  }
  if (IMAGE_EXT.test(path)) {
    return 'image';
  }
  return VIDEO_EXT.test(path) ? 'video' : 'link';
}

/** Highlights split into the inbox and the archive, newest first: done ones and those up to `upTo` are archived. */
export function inboxSplit(lines, upTo, done) {
  const sorted = [...lines].sort((a, b) => b.id - a.id);
  const fresh = sorted.filter((l) => l.id > upTo && !done.has(l.id));
  const archived = sorted.filter((l) => l.id <= upTo || done.has(l.id));
  return { fresh, archived };
}

/** Lowercase, with ä and ö read as a and o, so a quick filter needs no special letters. */
function plain(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '');
}

/** Whether `needle`'s letters appear in `hay` in order, like "mstk" in "mustikkasoppa". */
function inOrder(needle, hay) {
  let at = 0;
  for (const c of needle) {
    at = hay.indexOf(c, at) + 1;
    if (!at) {
      return false;
    }
  }
  return true;
}

/**
 * A loose filter over a line: every word of the query must be in the nick, channel, network or
 * text, or spell out the nick or channel with letters left out. Text needs whole pieces, as
 * letters scattered over a long message would match nearly anything.
 */
export function looseMatch(line, query) {
  const words = plain(query).split(/\s+/).filter(Boolean);
  const nick = plain(line.nick || '');
  const buffer = plain(line.buffer || '');
  const all = `${nick} ${buffer} ${plain(line.net || '')} ${plain(line.text || '')}`;
  return words.every((w) => all.includes(w) || inOrder(w, nick) || inOrder(w.replace(/^#/, ''), buffer));
}

export const NP_FORMAT = 'np. {artist} - {title}';

/** "np. {artist} - {title}" with the playing track filled in. */
export function npLine(format, track) {
  return (format || NP_FORMAT).replace(/\{(artist|title|album)\}/g, (_, k) => track[k] || '').trim();
}

// An IRC line is at most 512 bytes with its CR-LF. When the server passes a message on, it puts
// ":nick!ident@host" in front, so that counts too. Until a join shows our ident and host the
// longest ones are assumed. Same sums as text_room in core/src/irc.rs, which splits longer lines.
const LINE_BYTES = 510;
const UNKNOWN_MASK_BYTES = 1 + 10 + 1 + 63;
const SPARE_BYTES = 16;
const MIN_TEXT_BYTES = 100;
const ACTION_BYTES = '\u0001ACTION \u0001'.length;
const bytes = (text) => new TextEncoder().encode(text).length;

/** Bytes left in the longest line of a message, below zero when too long; null for a command. */
export function messageRoom(text, nick, target, mask = '') {
  let body = text;
  let extra = 0;
  if (text.startsWith('/') && !text.startsWith('//')) {
    const me = /^\/me(?:\s|$)/i.exec(text);
    if (!me) {
      return null;
    }
    body = text.slice(me[0].length);
    extra = ACTION_BYTES;
  }
  const prefix = mask ? `${nick}!${mask}` : nick;
  const around = bytes(`:${prefix} PRIVMSG ${target} :`) + (mask ? 0 : UNKNOWN_MASK_BYTES);
  const room = Math.max(MIN_TEXT_BYTES, LINE_BYTES - around - SPARE_BYTES) - extra;
  const longest = Math.max(0, ...body.split('\n').map(bytes));
  return room - longest;
}

/** A mailto: link reporting `line` to `to`, with the user's note. */
export function reportMail(to, line, note = '') {
  const d = new Date(line.ts);
  const two = (n) => String(n).padStart(2, '0');
  const when = `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
  const body = [
    t('Network: {net}', { net: line.net }),
    t('Channel: {channel}', { channel: line.buffer }),
    t('Nick: {nick}', { nick: line.nick }),
    t('Sent: {when}', { when }),
    t('Message: {text}', { text: stripFormatting(line.text) }),
  ];
  if (note.trim()) {
    body.push(t('Note: {note}', { note: note.trim() }));
  }
  const subject = t('Report: {channel} {nick}', { channel: line.buffer, nick: line.nick });
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.join('\n'))}`;
}
