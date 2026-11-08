import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continues, summarize, tokenize, nickColor, completeNick, dayLabel, mentions, shortUrl, nickHue, parseReaction, parseAddress, commandMatches, personFor, glob, colorFromRgb, clock, youtube, duration, animalFor, convertEmoticons, colonQuery, emojiSearch } from '../ui/lib.js';

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
  assert.deepEqual(t.map((x) => x.type), ['mention', 'text', 'url', 'text']);
  assert.equal(t[2].value, 'https://example.org/a');
  assert.equal(mentions('trolleybus', 'rolle'), false);
  assert.equal(tokenize('\x02bold\x02 \x0304red', '')[0].value, 'bold red');
});

test('nick colours ignore trailing underscores and avoid purple', () => {
  assert.equal(nickColor('Kaisla_'), nickColor('kaisla'));
  assert.notEqual(nickColor('rolle'), nickColor('snowfake'));
  const nicks = ['rolle', 'snowfake', 'mustikkasoppa', 'kummitus', 'milla', 'jaska', 'tiina', 'mikko', 'anna', 'pekka'];
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
  assert.deepEqual(parseReaction('mustikkasoppa: 😂'), { nick: 'mustikkasoppa', emoji: '😂' });
  assert.deepEqual(parseReaction('rolle, 👍🏽'), { nick: 'rolle', emoji: '👍🏽' });
  assert.equal(parseReaction('rolle: haha 😂'), null);
  assert.equal(parseReaction('rolle: 123'), null);
  assert.deepEqual(parseAddress('snowfake: no niin'), { nick: 'snowfake', rest: 'no niin' });
  assert.equal(parseAddress('https://example.org'), null);
  assert.equal(parseAddress('no niin'), null);
});

test('slash menu matches typed commands', () => {
  assert.ok(commandMatches('/').length > 10);
  assert.deepEqual(commandMatches('/wh').map((c) => c.name), ['whois']);
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
  assert.equal(convertEmoticons('nice :D see you :)'), 'nice 😀 see you 🙂');
  assert.equal(convertEmoticons('https://example.org:D'), 'https://example.org:D');
  assert.equal(convertEmoticons('<3 xD'), '❤️ 😆');
});

test('finds the colon word before the caret', () => {
  assert.equal(colonQuery('hello :joy'), 'joy');
  assert.equal(colonQuery('hello :j'), null);
  assert.equal(colonQuery('10:30'), null);
});

test('ranks exact shortcodes first, then usage', () => {
  const data = [{ emojis: [['😂', 'face with tears of joy nauru', 'joy'], ['😹', 'cat face with tears of joy', 'joy_cat'], ['🙂', 'slightly smiling face hymy', 'slightly_smiling_face']] }];
  assert.deepEqual(emojiSearch('joy', data).map((h) => h.id), ['joy', 'joy_cat']);
  assert.deepEqual(emojiSearch('joy', data, { '😹': 3 }).map((h) => h.id), ['joy', 'joy_cat']);
  assert.deepEqual(emojiSearch('jo', data, { '😹': 3 }).map((h) => h.id), ['joy_cat', 'joy']);
  assert.deepEqual(emojiSearch('nauru', data).map((h) => h.id), ['joy']);
});
