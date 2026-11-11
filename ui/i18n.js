// UI language. English is the source: every string is written in English and looked up here.
import { FI } from './i18n-fi.js';

const LANG_KEY = 'lobby.lang';
const DICTS = { fi: FI };

export const LANGS = [
  ['en', 'English'],
  ['fi', 'Suomi'],
];

let lang = 'en';

/** Picks the stored language, else `fallback`. Call once before anything is drawn. */
export function startLang(fallback) {
  let stored = null;
  try {
    stored = localStorage.getItem(LANG_KEY);
  } catch {
    /* storage may be unavailable */
  }
  const code = stored ?? fallback;
  lang = LANGS.some(([c]) => c === code) ? code : 'en';
  document.documentElement.lang = lang;
  return lang;
}

export function chooseLang(code) {
  try {
    localStorage.setItem(LANG_KEY, code);
  } catch {
    /* the default stays */
  }
}

export function currentLang() {
  return lang;
}

/** `text` in the current language, with {name} filled in from `vars`; unknown {x} stay as they are. */
export function t(text, vars) {
  const out = DICTS[lang]?.[text] ?? text;
  if (!vars) {
    return out;
  }
  return out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/**
 * `text` in a form only some languages tell apart, such as a plural verb English does not inflect:
 * the dictionary's "text (variant)" when it has one, else plain `text`.
 */
export function tv(text, variant, vars) {
  const tagged = `${text} (${variant})`;
  return t(variant && DICTS[lang] && tagged in DICTS[lang] ? tagged : text, vars);
}
