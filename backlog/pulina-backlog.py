#!/usr/bin/env python3
"""Serves #pulina's public log to the Pulina app as JSON, read-only.

GET /backlog                  the newest lines
GET /backlog?after=<ms>       lines after that moment, the newest ones when there are many
GET /backlog?before=<ms>      lines before that moment, for scrolling back
     &limit=<n>               at most MAX_LIMIT
GET /backlog?seen=a,b,c       when each of these nicks last spoke, over the whole log

Only messages and /me lines: no joins, quits or addresses. Runs behind nginx, which
limits how often one address may ask. Stdlib only.
"""

import json
import os
import re
import threading
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

LOG_DIR = os.environ.get('BACKLOG_DIR', '/var/www/pulina.fi/public_html/pulina-days')
HOST = '127.0.0.1'
PORT = int(os.environ.get('BACKLOG_PORT', '8731'))
TZ = ZoneInfo('Europe/Helsinki')
DEFAULT_LIMIT = 300
MAX_LIMIT = 5000
# The logs go back to 2008; a year is plenty to scroll and keeps every answer quick.
MAX_DAYS = 365
FILE_RE = re.compile(r'^pul-(\d{4})-(\d{2})-(\d{2})\.log$')
MSG_RE = re.compile(r'^(\d\d):(\d\d) <[ @+%~&]?([^>]+)> (.*)$')
ACTION_RE = re.compile(r'^(\d\d):(\d\d)  \* (\S+) ?(.*)$')

cache = {}
MAX_SEEN_NICKS = 500

# Last message per lower-case nick over every day since 2008, built once and then kept up to date
# by reading only the files that changed.
seen = {}
seen_files = {}
seen_scan = threading.Lock()


def day_lines(path, day):
    """One day's messages, oldest first, parsed once per change of the file."""
    mtime = os.stat(path).st_mtime
    hit = cache.get(path)
    if hit and hit[0] == mtime:
        return hit[1]
    lines = []
    with open(path, encoding='utf-8', errors='replace') as f:
        for raw in f:
            raw = raw.rstrip('\n')
            m = MSG_RE.match(raw)
            kind = 'msg'
            if not m:
                m = ACTION_RE.match(raw)
                kind = 'action'
            if not m:
                continue
            hour, minute, nick, text = m.groups()
            at = datetime(day.year, day.month, day.day, int(hour), int(minute), tzinfo=TZ)
            # Minutes only in the log: the line's place keeps the order inside one.
            ts = int(at.timestamp() * 1000) + len(lines) % 60000
            lines.append({'ts': ts, 'nick': nick, 'kind': kind, 'text': text})
    cache[path] = (mtime, lines)
    return lines


def days_newest_first():
    oldest = datetime.now(TZ).date() - timedelta(days=MAX_DAYS)
    found = []
    for name in os.listdir(LOG_DIR):
        m = FILE_RE.match(name)
        if not m:
            continue
        day = datetime(int(m[1]), int(m[2]), int(m[3])).date()
        if day >= oldest:
            found.append((day, os.path.join(LOG_DIR, name)))
    return sorted(found, reverse=True)


def backlog(after, before, limit):
    """The newest `limit` lines with after < ts < before, oldest first."""
    picked = []
    for day, path in days_newest_first():
        day_end = int(datetime(day.year, day.month, day.day, tzinfo=TZ).timestamp() * 1000) + 86_400_000
        if after is not None and day_end <= after:
            break
        for line in reversed(day_lines(path, day)):
            if before is not None and line['ts'] >= before:
                continue
            if after is not None and line['ts'] <= after:
                break
            picked.append(line)
            if len(picked) >= limit:
                return picked[::-1]
    return picked[::-1]


def read_seen():
    if not seen_scan.acquire(blocking=False):
        return
    try:
        days = []
        for name in os.listdir(LOG_DIR):
            m = FILE_RE.match(name)
            if m:
                days.append((datetime(int(m[1]), int(m[2]), int(m[3])), os.path.join(LOG_DIR, name)))
        for day, path in sorted(days):
            mtime = os.stat(path).st_mtime
            if seen_files.get(path) == mtime:
                continue
            last = {}
            with open(path, encoding='utf-8', errors='replace') as f:
                for raw in f:
                    m = MSG_RE.match(raw) or ACTION_RE.match(raw)
                    if m:
                        last[m[3].lower()] = (int(m[1]), int(m[2]))
            for nick, (hour, minute) in last.items():
                ts = int(day.replace(hour=hour, minute=minute, tzinfo=TZ).timestamp() * 1000)
                seen[nick] = max(seen.get(nick, 0), ts)
            seen_files[path] = mtime
    finally:
        seen_scan.release()


def last_seen(nicks):
    read_seen()
    found = {}
    for nick in nicks[:MAX_SEEN_NICKS]:
        ts = seen.get(nick.lower())
        if ts:
            found[nick] = ts
    return found


def number(query, key):
    try:
        return int(query[key][0])
    except (KeyError, ValueError):
        return None


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path != '/backlog':
            self.send_error(404)
            return
        query = parse_qs(url.query)
        if 'seen' in query:
            nicks = [n for n in query['seen'][0].split(',') if n]
            body = json.dumps({'seen': last_seen(nicks)}, ensure_ascii=False).encode()
        else:
            limit = min(max(number(query, 'limit') or DEFAULT_LIMIT, 1), MAX_LIMIT)
            body = json.dumps({'lines': backlog(number(query, 'after'), number(query, 'before'), limit)}, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'public, max-age=15')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    threading.Thread(target=read_seen, daemon=True).start()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
