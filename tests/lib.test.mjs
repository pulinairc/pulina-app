import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continues, summarize, tokenize, nickColor, completeNick, dayLabel, mentions, shortUrl } from '../ui/lib.js';

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

test('nick color ignores trailing underscores', () => {
  assert.equal(nickColor('Kaisla_'), nickColor('kaisla'));
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
