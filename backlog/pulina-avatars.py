#!/usr/bin/env python3
"""Profile pictures for Lobby and Pulina, shared through the IRC real name.

POST /avatar          the picture's bytes (PNG, JPEG, WebP or GIF, at most MAX_BYTES)
                      -> {"url": "https://chat.pulina.fi/a/<id>"}
GET  /a/<id>          the picture

The id is the start of the picture's SHA-256, so the same picture gets the same address.
Runs behind nginx, which limits how often one address may upload. All pictures together stay
under MAX_TOTAL; to take one down, delete its file from the state directory. Stdlib only.
"""

import hashlib
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STORE = os.environ.get('AVATAR_DIR', '/var/lib/pulina-avatars')
HOST = '127.0.0.1'
PORT = int(os.environ.get('AVATAR_PORT', '8732'))
PUBLIC = 'https://chat.pulina.fi/a/'
MAX_BYTES = 300 * 1024
MAX_TOTAL = int(os.environ.get('AVATAR_MAX_TOTAL', str(500 * 1024 * 1024)))
ID_LEN = 16
ID_RE = re.compile(r'^/a/([0-9a-f]{%d})$' % ID_LEN)
CACHE_SECONDS = 365 * 24 * 3600


def kind_of(data):
    """The picture's media type from its first bytes, or None when it is not a picture."""
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if data.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return 'image/gif'
    return None


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body, kind='application/json', extra=()):
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        for name, value in extra:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def fail(self, status, text):
        self.reply(status, json.dumps({'error': text}).encode())

    def do_POST(self):
        if self.path != '/avatar':
            return self.fail(404, 'not found')
        size = int(self.headers.get('Content-Length') or 0)
        if not 0 < size <= MAX_BYTES:
            return self.fail(413, 'picture too large')
        data = self.rfile.read(size)
        kind = kind_of(data)
        if not kind:
            return self.fail(415, 'not a picture')
        pic = hashlib.sha256(data).hexdigest()[:ID_LEN]
        path = os.path.join(STORE, pic)
        if not os.path.exists(path):
            if sum(e.stat().st_size for e in os.scandir(STORE)) + size > MAX_TOTAL:
                return self.fail(507, 'no room for pictures')
            with open(path + '.tmp', 'wb') as f:
                f.write(data)
            os.replace(path + '.tmp', path)
        self.reply(200, json.dumps({'url': PUBLIC + pic}).encode())

    def do_GET(self):
        m = ID_RE.match(self.path)
        if not m:
            return self.fail(404, 'not found')
        try:
            with open(os.path.join(STORE, m.group(1)), 'rb') as f:
                data = f.read()
        except FileNotFoundError:
            return self.fail(404, 'not found')
        self.reply(200, data, kind_of(data) or 'application/octet-stream',
                   [('Cache-Control', 'public, max-age=%d, immutable' % CACHE_SECONDS), ('X-Content-Type-Options', 'nosniff')])

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    os.makedirs(STORE, exist_ok=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
