import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import {
  APP_ICONS,
  byActivity,
  fadeFor,
  modeAction,
  peopleGroups,
  quietFor,
  roleOf,
  DEFAULT_ICON,
  colonOpensPicker,
  notifyAdvice,
  popupSpot,
  continues,
  summarize,
  tokenize,
  nickColor,
  completeNick,
  dayLabel,
  mentions,
  shortUrl,
  nickHue,
  parseReaction,
  parseAddress,
  commandMatches,
  personFor,
  glob,
  colorFromRgb,
  clock,
  youtube,
  duration,
  animalFor,
  convertEmoticons,
  colonQuery,
  emojiSearch,
  splitNicks,
  formatWhois,
  comboOf,
  comboMods,
  comboLabel,
  ago,
} from '../ui/lib.js';

const at = (min) => Date.UTC(2026, 10, 7, 10, min);

test('groups lines from one nick within five minutes', () => {
  const a = { kind: 'msg', nick: 'Rolle', ts: at(0) };
  assert.equal(continues(a, { kind: 'msg', nick: 'rolle', ts: at(4) }), true);
  assert.equal(continues(a, { kind: 'msg', nick: 'rolle', ts: at(6) }), false);
  assert.equal(continues(a, { kind: 'msg', nick: 'jaska', ts: at(1) }), false);
  assert.equal(continues(a, { kind: 'join', nick: 'rolle', ts: at(1) }), false);
});

test('summarizes joins and quits', () => {
  const ev = (kind, nick, text = '') => ({ kind, nick, text });
  assert.equal(summarize([ev('join', 'pekka'), ev('quit', 'a'), ev('quit', 'b')]), 'pekka joined, a and b quit');
  assert.equal(summarize(['a', 'b', 'c', 'd'].map((n) => ev('quit', n))), '4 quit');
  assert.equal(summarize([ev('nick', 'kaisla', 'Kaisla_')]), 'kaisla is now Kaisla_');
});

test('splits links and mentions', () => {
  const t = tokenize('rolle: see https://example.org/a). ok', 'rolle');
  assert.deepEqual(
    t.map((x) => x.type),
    ['mention', 'text', 'url', 'text'],
  );
  assert.equal(t[2].value, 'https://example.org/a');
  assert.equal(mentions('trolleybus', 'rolle'), false);
  assert.equal(tokenize('\x02bold\x02 \x0304red', '')[0].value, 'bold red');
});

test('nick colours ignore trailing underscores and avoid purple', () => {
  assert.equal(nickColor('Kaisla_'), nickColor('kaisla'));
  assert.notEqual(nickColor('rolle'), nickColor('frostbyte'));
  const nicks = ['rolle', 'frostbyte', 'puolukkapuuro', 'haamu', 'milla', 'jaska', 'tiina', 'mikko', 'anna', 'pekka'];
  for (const n of nicks) {
    const h = nickHue(n);
    assert.ok(h < 235 || h >= 320, `${n} got purple hue ${h}`);
  }
  assert.ok(new Set(nicks.map(nickColor)).size >= 9);
});

test('completes nicks in order', () => {
  const m = ['kaisla', 'Kaisla_', 'jaska'];
  assert.equal(completeNick('ka', m), 'kaisla');
  assert.equal(completeNick('ka', m, 'kaisla'), 'Kaisla_');
  assert.equal(completeNick('x', m), null);
});

test('day labels use Finnish date format', () => {
  const now = at(0);
  assert.equal(dayLabel(now, now), 'Today');
  assert.equal(dayLabel(Date.UTC(2026, 0, 5, 12), now), '5.1.2026');
});

test('shortens links for reading', () => {
  assert.equal(shortUrl('https://www.example.org/'), 'example.org');
  assert.equal(shortUrl('https://example.org/a/b'), 'example.org/a/b');
  assert.equal(shortUrl('https://example.org/a-very-long-article-name-that-goes-on'), 'example.org/a-very-long-article-name-th…');
  assert.equal(shortUrl('not a url'), 'not a url');
});

test('reads reactions and replies sent as plain IRC text', () => {
  assert.deepEqual(parseReaction('puolukkapuuro: 😂'), { nick: 'puolukkapuuro', emoji: '😂' });
  assert.deepEqual(parseReaction('rolle, 👍🏽'), { nick: 'rolle', emoji: '👍🏽' });
  assert.equal(parseReaction('rolle: haha 😂'), null);
  assert.equal(parseReaction('rolle: 123'), null);
  assert.deepEqual(parseAddress('frostbyte: no niin'), { nick: 'frostbyte', rest: 'no niin' });
  assert.equal(parseAddress('https://example.org'), null);
  assert.equal(parseAddress('no niin'), null);
});

test('slash menu matches typed commands', () => {
  assert.ok(commandMatches('/').length > 10);
  assert.deepEqual(
    commandMatches('/wh').map((c) => c.name),
    ['whois'],
  );
  assert.equal(commandMatches('/me waves'), null);
  assert.equal(commandMatches('hello'), null);
  assert.deepEqual(commandMatches('/zzz'), []);
});

test('finds the person behind a nick', () => {
  const kaisla = { id: 1, nicks: ['Kaisla'] };
  const jaska = { id: 2, nicks: ['jaska*'] };
  const anna = { id: 3, nicks: ['*!anna@*.example.net'] };
  const people = [kaisla, jaska, anna];
  assert.equal(personFor(people, 'Kaisla_'), kaisla);
  assert.equal(personFor(people, 'kaisla-'), kaisla);
  assert.equal(personFor(people, 'jaska|away'), jaska);
  assert.equal(personFor(people, 'annukka', 'anna@home.example.net'), anna);
  assert.equal(personFor(people, 'annukka', 'anna@elsewhere.org'), null);
  assert.equal(personFor(people, 'mikko'), null);
  assert.ok(glob('Setsu*', 'setsu|away'));
});

test('photo colours keep their hue', () => {
  assert.equal(colorFromRgb(200, 40, 40), 'hsl(0 67% 68%)');
  assert.equal(colorFromRgb(40, 90, 200), 'hsl(221 67% 68%)');
  assert.equal(colorFromRgb(128, 128, 128), 'hsl(0 45% 68%)');
});

test('clock shows seconds', () => {
  assert.equal(clock(new Date(2026, 10, 7, 9, 5, 3).getTime()), '09:05:03');
});

test('finds YouTube videos in links', () => {
  assert.deepEqual(youtube('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), { id: 'dQw4w9WgXcQ', portrait: false });
  assert.deepEqual(youtube('https://youtu.be/dQw4w9WgXcQ?si=x'), { id: 'dQw4w9WgXcQ', portrait: false });
  assert.deepEqual(youtube('https://youtube.com/shorts/dQw4w9WgXcQ'), { id: 'dQw4w9WgXcQ', portrait: true });
  assert.equal(youtube('https://www.youtube.com/@channel'), null);
  assert.equal(youtube('https://example.org/watch?v=dQw4w9WgXcQ'), null);
});

test('formats durations', () => {
  assert.equal(duration(83), '1:23');
  assert.equal(duration(NaN), '0:00');
});

test('gives a nick the same animal every time', () => {
  assert.equal(animalFor('Kaisla'), animalFor('kaisla_'));
  assert.ok(animalFor('mikko').length > 0);
});

test('turns standalone emoticons into emoji', () => {
  assert.equal(convertEmoticons('nice :D see you :)'), 'nice 😁 see you 🙂');
  assert.equal(convertEmoticons('https://example.org:D'), 'https://example.org:D');
  assert.equal(convertEmoticons('<3 xD'), '❤️ 😆');
});

test('finds the colon word before the caret', () => {
  assert.equal(colonQuery('hello :joy'), 'joy');
  assert.equal(colonQuery('hello :j'), null);
  assert.equal(colonQuery('10:30'), null);
});

test('ranks exact shortcodes first, then usage', () => {
  const data = [
    {
      emojis: [
        ['😂', 'face with tears of joy nauru', 'joy'],
        ['😹', 'cat face with tears of joy', 'joy_cat'],
        ['🙂', 'slightly smiling face hymy', 'slightly_smiling_face'],
      ],
    },
  ];
  assert.deepEqual(
    emojiSearch('joy', data).map((h) => h.id),
    ['joy', 'joy_cat'],
  );
  assert.deepEqual(
    emojiSearch('joy', data, { '😹': 3 }).map((h) => h.id),
    ['joy', 'joy_cat'],
  );
  assert.deepEqual(
    emojiSearch('jo', data, { '😹': 3 }).map((h) => h.id),
    ['joy_cat', 'joy'],
  );
  assert.deepEqual(
    emojiSearch('nauru', data).map((h) => h.id),
    ['joy'],
  );
});

test('picks channel nicks out of text', () => {
  const members = new Map([
    ['kaisla', 'Kaisla'],
    ['mikko', 'mikko'],
  ]);
  assert.deepEqual(splitNicks('ask kaisla, or Mikko', members), [
    { type: 'text', value: 'ask ' },
    { type: 'nick', value: 'kaisla', nick: 'Kaisla' },
    { type: 'text', value: ', or ' },
    { type: 'nick', value: 'Mikko', nick: 'mikko' },
  ]);
  assert.deepEqual(splitNicks('kaislat', members), [{ type: 'text', value: 'kaislat' }]);
});

test('formats whois for a tooltip', () => {
  const w = {
    nick: 'kaisla',
    found: true,
    user: 'ka',
    host: 'example.net',
    realname: 'Kaisla Example',
    channels: '#rust',
    idle_secs: 300,
    server: 'irc.example.net',
    server_info: '',
    account: '',
    away: '',
    secure: false,
    oper: false,
  };
  assert.equal(formatWhois(w), 'kaisla (Kaisla Example)\nka@example.net\nOn #rust\nVia irc.example.net\nIdle 5 min');
  assert.equal(formatWhois({ nick: 'x', found: false }), 'x is not online');
});

test('reads key presses as shortcut combos', () => {
  const key = (k, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
  assert.equal(comboOf(key('Enter', { ctrlKey: true }), false), 'Mod+Enter');
  assert.equal(comboOf(key('Enter', { metaKey: true }), true), 'Mod+Enter');
  assert.equal(comboOf(key('Enter', { ctrlKey: true }), true), 'Ctrl+Enter');
  assert.equal(comboOf(key('a', { altKey: true }), false), 'Alt+A');
  assert.equal(comboOf(key('å', { altKey: true, code: 'KeyA' }), true), 'Alt+A');
  assert.equal(comboOf(key('Shift', { shiftKey: true }), false), null);
  assert.equal(comboMods('Alt+3'), 'Alt');
  assert.equal(comboLabel('Mod+Enter', true), 'Cmd+Enter');
  assert.equal(comboLabel('Alt+ArrowLeft', false), 'Alt+←');
  // + is named so it never reads as the separator, with or without Shift, as = or as +.
  assert.equal(comboOf(key('+', { metaKey: true }), true), 'Mod+Plus');
  assert.equal(comboOf(key('=', { metaKey: true }), true), 'Mod+Plus');
  assert.equal(comboOf(key('+', { ctrlKey: true, shiftKey: true }), false), 'Mod+Plus');
  assert.equal(comboOf(key('-', { ctrlKey: true }), false), 'Mod+-');
  assert.equal(comboOf(key('0', { metaKey: true, code: 'Digit0' }), true), 'Mod+0');
  assert.equal(comboLabel('Mod+Plus', true), 'Cmd++');
  assert.equal(comboLabel('Mod+-', false), 'Ctrl+-');
});

test('ago says how long since', () => {
  const now = at(30);
  assert.equal(ago(now - 20_000, now), 'just now');
  assert.equal(ago(at(25), now), '5 min ago');
  assert.equal(ago(now - 90 * 60_000, now), '1 h 30 min ago');
  assert.equal(ago(now - 3 * 86_400_000, now), '3 d ago');
});

test('a colon opens the picker only at the start of a word', () => {
  assert.equal(colonOpensPicker(':', 1), true);
  assert.equal(colonOpensPicker('hi :', 4), true);
  assert.equal(colonOpensPicker('hi\n:', 4), true);
  assert.equal(colonOpensPicker('hi:', 3), false);
  assert.equal(colonOpensPicker(':D', 2), false);
  assert.equal(colonOpensPicker('', 0), false);
  // The caret, not the end of the text, decides.
  assert.equal(colonOpensPicker('a : b', 3), true);
});

test('popups sit above their anchor, inside the page', () => {
  const page = { left: 0, top: 0, right: 400, bottom: 800 };
  // Room above: right edges line up.
  assert.deepEqual(popupSpot({ left: 300, right: 380, top: 700, bottom: 740 }, page, 340, 400, 8), { left: 40, top: 292 });
  // No room above: below instead.
  assert.deepEqual(popupSpot({ left: 300, right: 380, top: 60, bottom: 100 }, page, 340, 400, 8), { left: 40, top: 108 });
  // Near the left edge: pushed in by the gap.
  assert.deepEqual(popupSpot({ left: 0, right: 40, top: 700, bottom: 740 }, page, 340, 400, 8), { left: 8, top: 292 });
  // Neither above nor below fits: kept inside the bottom, never above the top.
  assert.deepEqual(popupSpot({ left: 300, right: 380, top: 200, bottom: 240 }, { ...page, bottom: 500 }, 340, 400, 8), {
    left: 40,
    top: 92,
  });
  assert.deepEqual(popupSpot({ left: 300, right: 380, top: 100, bottom: 140 }, { ...page, bottom: 300 }, 340, 400, 8), {
    left: 40,
    top: 8,
  });
  // Wider than the page: starts at the gap.
  assert.deepEqual(popupSpot({ left: 0, right: 300, top: 700, bottom: 740 }, { ...page, right: 300 }, 340, 400, 8), { left: 8, top: 292 });
});

test('notification advice follows what macOS reports', () => {
  assert.equal(notifyAdvice(null), null);
  assert.equal(notifyAdvice({ state: 'allowed', banners: true, badge: true }), null);
  assert.equal(notifyAdvice({ state: 'ask', banners: false, badge: false }).action, 'Allow notifications');
  assert.equal(notifyAdvice({ state: 'denied', banners: false, badge: false }).action, 'Open System Settings');
  assert.match(notifyAdvice({ state: 'allowed', banners: false, badge: true }).text, /but banners is off/);
  assert.match(notifyAdvice({ state: 'allowed', banners: true, badge: false }).text, /but the Dock badge is off/);
  assert.match(notifyAdvice({ state: 'allowed', banners: false, badge: false }).text, /banners and the Dock badge are off/);
});

// Each icon is drawn three times: the window and Settings, the macOS Dock, the iPhone home screen.
test('every app icon exists for each platform', () => {
  const pngs = (dir) =>
    readdirSync(new URL(`../${dir}`, import.meta.url))
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.slice(0, -4))
      .sort();
  const names = APP_ICONS.map(([name]) => name).sort();
  assert.equal(DEFAULT_ICON, 'pendant-lamp');
  assert.deepEqual(pngs('ui/icons'), names);
  assert.deepEqual(pngs('ui/icons/mac'), names);
  assert.deepEqual(pngs('src-tauri/icons/ios'), names);
});

test('people sort by when they last spoke, ops first', () => {
  const now = Date.UTC(2026, 10, 9, 18);
  const dayStart = Date.UTC(2026, 10, 9);
  const spoke = { veera: now - 2 * 60e3, otso: now - 3600e3, lumi: now - 30 * 60e3, iida: now - 4 * 86400e3 };
  const modes = new Map([
    ['otso', '@'],
    ['kaisla', '@+'],
    ['jaska', '+'],
  ]);
  const groups = peopleGroups(['iida', 'jaska', 'kaisla', 'lumi', 'otso', 'pekka', 'veera'], modes, (n) => spoke[n], now, dayStart);
  assert.deepEqual(
    groups.map((g) => [g.id, g.people.map((p) => p.nick)]),
    [
      ['ops', ['otso', 'kaisla']],
      ['now', ['veera']],
      ['today', ['lumi']],
      ['away', ['iida', 'jaska', 'pekka']],
    ],
  );
  assert.deepEqual(
    byActivity(['b', 'A', 'c'], () => 0),
    ['A', 'b', 'c'],
  );
});

test('quiet people fade and say for how long', () => {
  const now = 1_000_000_000_000;
  assert.equal(quietFor(0, now), '');
  assert.equal(quietFor(now - 20e3, now), 'now');
  assert.equal(quietFor(now - 14 * 60e3, now), '14 min');
  assert.equal(quietFor(now - 3 * 3600e3, now), '3 h');
  assert.equal(quietFor(now - 4 * 86400e3, now), '4 d');
  assert.equal(fadeFor(now - 60e3, now), 1);
  assert.ok(fadeFor(now - 5 * 3600e3, now) < fadeFor(now - 2 * 3600e3, now));
  assert.equal(fadeFor(0, now), fadeFor(now - 30 * 86400e3, now));
});

test('op and voice give to whoever lacks it, else take from all', () => {
  assert.equal(roleOf('@+'), 'op');
  assert.equal(roleOf('%'), 'voice');
  assert.equal(roleOf(''), '');
  const modes = new Map([
    ['a', '+'],
    ['b', '@'],
  ]);
  assert.deepEqual(modeAction(['a', 'b', 'c'], modes, '+'), { give: true, nicks: ['b', 'c'] });
  assert.deepEqual(modeAction(['a'], modes, '+'), { give: false, nicks: ['a'] });
});
