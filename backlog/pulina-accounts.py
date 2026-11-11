#!/usr/bin/env python3
"""Pulina accounts: apply in the app, approve with one tap, get an always-on IRC connection.

POST /accounts/apply    {account, password, known}  -> {status: "pending", check} or {error}
POST /accounts/status   {account, password or check} -> {status} and, once approved, {url, token}
POST /accounts/cancel   {account, password}         -> {status: "cancelled"}
GET  /accounts/pending  (X-Key: Kummitus' key)     -> applications Rolle has not been told about
POST /accounts/notified (X-Key) {account}           -> marks one told
GET  /accounts/review/<token>                           -> the approval page for one application
POST /accounts/review/<token>  decision=approve|reject
GET  /accounts/admin?key=<admin key>               -> every account, with Poista
POST /accounts/admin/remove  key, account

Approving runs pulina-account-create, which makes the system user (so identd answers with
the account name), its own lobby-server and the nginx route. Stdlib only.
"""

import hashlib
import hmac
import html
import json
import os
import re
import secrets
import sqlite3
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DB = os.environ.get('ACCOUNTS_DB', '/var/lib/pulina-accounts/accounts.db')
HOST = '127.0.0.1'
PORT = int(os.environ.get('ACCOUNTS_PORT', '8733'))
PUBLIC = 'https://chat.pulina.fi'
KUMMITUS_KEY = os.environ.get('KUMMITUS_KEY', '')
ADMIN_KEY = os.environ.get('ADMIN_KEY', '')
MAX_ACCOUNTS = int(os.environ.get('MAX_ACCOUNTS', '10'))
CREATE = os.environ.get('ACCOUNT_CREATE', '/usr/local/sbin/pulina-account-create')
REMOVE = os.environ.get('ACCOUNT_REMOVE', '/usr/local/sbin/pulina-account-remove')
FIRST_PORT = 9201
# Ident is at most 10 characters on QuakeNet, and the account name is the ident.
NAME_RE = re.compile(r'^[a-z][a-z0-9_-]{1,9}$')
MIN_PASSWORD = 10
MAX_KNOWN = 200
MAX_BODY = 4096
SCRYPT = dict(n=2 ** 14, r=8, p=1, dklen=32)


def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("""CREATE TABLE IF NOT EXISTS accounts (
        name TEXT PRIMARY KEY, salt BLOB NOT NULL, hash BLOB NOT NULL, known TEXT NOT NULL,
        status TEXT NOT NULL, decision TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0,
        port INTEGER, token TEXT, created INTEGER NOT NULL, "check" TEXT)""")
    return conn


def hashed(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, **SCRYPT)


def system_user(name):
    try:
        import pwd
        pwd.getpwnam(name)
        return True
    except KeyError:
        return False


def check(conn, name, password, check_token=''):
    """The account if the password, or the app's own waiting key, is right."""
    row = conn.execute('SELECT * FROM accounts WHERE name = ?', (name,)).fetchone()
    if not row:
        return None
    if check_token and row['check'] and hmac.compare_digest(row['check'], check_token):
        return row
    if password and hmac.compare_digest(row['hash'], hashed(password, row['salt'])):
        return row
    return None


def page(title, body):
    return f"""<!doctype html><html lang="fi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{html.escape(title)}</title>
<style>body{{margin:0;background:#060d21;color:#d3dcef;font:16px/1.5 -apple-system,system-ui,sans-serif}}
main{{max-width:520px;margin:0 auto;padding:48px 24px}}h1{{color:#fff;font-size:24px;margin:0 0 8px}}
p{{color:#94a7cc}}form{{display:inline}}button{{height:44px;padding:0 20px;border:0;border-radius:12px;font:600 15px system-ui;cursor:pointer;margin:8px 8px 0 0}}
.go{{background:#20ffa7;color:#04140d}}.no{{background:#17233f;color:#fff}}li{{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #17233f}}
ul{{list-style:none;padding:0}}</style></head><body><main>{body}</main></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def send(self, status, body, kind='application/json'):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def json(self, status, value):
        self.send(status, json.dumps(value))

    def html(self, status, title, body):
        self.send(status, page(title, body), 'text/html; charset=utf-8')

    def body(self):
        size = int(self.headers.get('Content-Length') or 0)
        if not 0 < size <= MAX_BODY:
            return None
        raw = self.rfile.read(size)
        if 'json' in (self.headers.get('Content-Type') or ''):
            try:
                return json.loads(raw)
            except ValueError:
                return None
        return {k: v[0] for k, v in parse_qs(raw.decode(errors='replace')).items()}

    def keyed(self):
        return bool(KUMMITUS_KEY) and hmac.compare_digest(self.headers.get('X-Key', ''), KUMMITUS_KEY)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/accounts/pending':
            if not self.keyed():
                return self.json(403, {'error': 'forbidden'})
            with db() as conn:
                rows = conn.execute("SELECT name, known, decision FROM accounts WHERE status = 'pending' AND notified = 0").fetchall()
            return self.json(200, [{'account': r['name'], 'known': r['known'], 'link': f"{PUBLIC}/accounts/review/{r['decision']}"} for r in rows])
        if url.path.startswith('/accounts/review/'):
            return self.decision_page(url.path.rsplit('/', 1)[1])
        if url.path == '/accounts/admin':
            key = parse_qs(url.query).get('key', [''])[0]
            return self.admin_page(key)
        self.json(404, {'error': 'not found'})

    def do_POST(self):
        url = urlparse(self.path)
        data = self.body()
        if data is None:
            return self.json(400, {'error': 'bad request'})
        routes = {'/accounts/apply': self.apply, '/accounts/status': self.status, '/accounts/cancel': self.cancel,
                  '/accounts/notified': self.notified, '/accounts/admin/remove': self.remove}
        if url.path in routes:
            return routes[url.path](data)
        if url.path.startswith('/accounts/review/'):
            return self.decide(url.path.rsplit('/', 1)[1], data.get('decision', ''))
        self.json(404, {'error': 'not found'})

    def apply(self, data):
        name = str(data.get('account', '')).strip().lower()
        password = str(data.get('password', ''))
        known = str(data.get('known', '')).strip()[:MAX_KNOWN]
        if not NAME_RE.fullmatch(name):
            return self.json(400, {'error': 'bad_name'})
        if len(password) < MIN_PASSWORD:
            return self.json(400, {'error': 'short_password'})
        with db() as conn:
            if system_user(name) or conn.execute('SELECT 1 FROM accounts WHERE name = ?', (name,)).fetchone():
                return self.json(409, {'error': 'taken'})
            salt = secrets.token_bytes(16)
            # The app keeps this to ask about the application without storing the password.
            waiting = secrets.token_urlsafe(24)
            conn.execute('INSERT INTO accounts (name, salt, hash, known, status, decision, created, "check") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                         (name, salt, hashed(password, salt), known, 'pending', secrets.token_urlsafe(24), int(time.time()), waiting))
        self.json(200, {'status': 'pending', 'check': waiting})

    def status(self, data):
        with db() as conn:
            row = check(conn, str(data.get('account', '')).strip().lower(), str(data.get('password', '')), str(data.get('check', '')))
        if not row:
            return self.json(401, {'error': 'wrong'})
        answer = {'status': row['status']}
        if row['status'] == 'approved':
            answer.update(url=f"wss://chat.pulina.fi/u/{row['name']}/", token=row['token'])
        self.json(200, answer)

    def cancel(self, data):
        with db() as conn:
            row = check(conn, str(data.get('account', '')).strip().lower(), str(data.get('password', '')), str(data.get('check', '')))
            if not row or row['status'] != 'pending':
                return self.json(401, {'error': 'wrong'})
            conn.execute('DELETE FROM accounts WHERE name = ?', (row['name'],))
        self.json(200, {'status': 'cancelled'})

    def notified(self, data):
        if not self.keyed():
            return self.json(403, {'error': 'forbidden'})
        with db() as conn:
            conn.execute('UPDATE accounts SET notified = 1 WHERE name = ?', (str(data.get('account', '')),))
        self.json(200, {'ok': True})

    def decision_page(self, token, note=''):
        with db() as conn:
            row = conn.execute('SELECT * FROM accounts WHERE decision = ?', (token,)).fetchone()
        if not row:
            return self.html(404, 'Ei löytynyt', '<h1>Hakemusta ei löytynyt</h1>')
        name = html.escape(row['name'])
        if row['status'] == 'approved':
            return self.html(200, name, f'<h1>Tunnus {name} on käytössä.</h1>{note}')
        if row['status'] == 'rejected':
            return self.html(200, name, f'<h1>Hakemus hylätty.</h1>{note}')
        body = (f'<h1>{name} hakee pulina.fi-tunnusta</h1><p>Kanavalla tunnetaan nimellä: {html.escape(row["known"]) or "–"}</p>'
                f'<form method="post"><input type="hidden" name="decision" value="approve"><button class="go">Hyväksy</button></form>'
                f'<form method="post"><input type="hidden" name="decision" value="reject"><button class="no">Hylkää</button></form>{note}')
        self.html(200, name, body)

    def decide(self, token, decision):
        with db() as conn:
            row = conn.execute("SELECT * FROM accounts WHERE decision = ? AND status = 'pending'", (token,)).fetchone()
            if not row:
                return self.decision_page(token)
            if decision == 'reject':
                conn.execute("UPDATE accounts SET status = 'rejected' WHERE name = ?", (row['name'],))
                return self.decision_page(token)
            if decision != 'approve':
                return self.decision_page(token)
            used = [r[0] for r in conn.execute("SELECT port FROM accounts WHERE status = 'approved'")]
            if len(used) >= MAX_ACCOUNTS:
                return self.decision_page(token, f'<p>Tunnuksia on jo {MAX_ACCOUNTS}, enempää ei voi nyt hyväksyä.</p>')
            port = next(p for p in range(FIRST_PORT, FIRST_PORT + 1000) if p not in used)
            token_ws = secrets.token_urlsafe(32)
            done = subprocess.run(['sudo', '-n', CREATE, row['name'], str(port), token_ws], capture_output=True, text=True, timeout=120)
            if done.returncode != 0:
                return self.decision_page(token, f'<p>Luominen epäonnistui: {html.escape(done.stderr[-300:])}</p>')
            conn.execute("UPDATE accounts SET status = 'approved', port = ?, token = ? WHERE name = ?", (port, token_ws, row['name']))
        self.decision_page(token)

    def admin_page(self, key):
        if not ADMIN_KEY or not hmac.compare_digest(key, ADMIN_KEY):
            return self.html(403, 'Ei pääsyä', '<h1>Ei pääsyä</h1>')
        with db() as conn:
            rows = conn.execute("SELECT name FROM accounts WHERE status = 'approved' ORDER BY name").fetchall()
        items = ''.join(
            f'<li>{html.escape(r["name"])}<form method="post" action="/accounts/admin/remove" '
            f'onsubmit="return confirm(\'Poistetaanko tunnus {html.escape(r["name"])}? Yhteys katkeaa ja tunnus vapautuu.\')">'
            f'<input type="hidden" name="key" value="{html.escape(key)}"><input type="hidden" name="account" value="{html.escape(r["name"])}">'
            f'<button class="no">Poista</button></form></li>' for r in rows)
        self.html(200, 'Tunnukset', f'<h1>Tunnukset</h1><ul>{items}</ul>')

    def remove(self, data):
        key = str(data.get('key', ''))
        if not ADMIN_KEY or not hmac.compare_digest(key, ADMIN_KEY):
            return self.html(403, 'Ei pääsyä', '<h1>Ei pääsyä</h1>')
        name = str(data.get('account', ''))
        with db() as conn:
            row = conn.execute("SELECT name FROM accounts WHERE name = ? AND status = 'approved'", (name,)).fetchone()
            if row:
                subprocess.run(['sudo', '-n', REMOVE, name], capture_output=True, text=True, timeout=120)
                conn.execute('DELETE FROM accounts WHERE name = ?', (name,))
        self.admin_page(key)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    db().close()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
