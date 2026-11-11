#!/usr/bin/env python3
"""Pulina accounts: apply in the app, approve with one tap, get an always-on IRC connection.

POST /accounts/apply    {account, email, password, known} -> {status: "pending", check} or {error}
POST /accounts/status   {account, password or check} -> {status} and, once approved, {url, token}
POST /accounts/cancel   {account, password}         -> {status: "cancelled"}
POST /accounts/forgot   {account}                   -> {status: "sent"}, mails a reset link if it can
GET  /accounts/reset/<token>                            -> the page for a new password
POST /accounts/reset/<token>  password
GET  /accounts/pending  (X-Key: Kummitus' key)     -> applications Rolle has not been told about
POST /accounts/notified (X-Key) {account}           -> marks one told
GET  /accounts/review/<token>                           -> the approval page for one application
POST /accounts/review/<token>  decision=approve|reject
GET  /accounts/admin?key=<admin key>               -> every account, with Poista
POST /accounts/admin/remove  key, account

Approving runs pulina-account-create, which makes the system user (so identd answers with
the account name), its own lobby-server and the nginx route. Mail goes out through Mailgun's
API; passwords are checked against Have I Been Pwned's range API, which only ever sees the first
five characters of the password's SHA-1. Stdlib only.
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
import sys
import time
import urllib.request
from base64 import b64encode
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

DB = os.environ.get('ACCOUNTS_DB', '/var/lib/pulina-accounts/accounts.db')
HOST = '127.0.0.1'
PORT = int(os.environ.get('ACCOUNTS_PORT', '8733'))
PUBLIC = 'https://chat.pulina.fi'
KUMMITUS_KEY = os.environ.get('KUMMITUS_KEY', '')
ADMIN_KEY = os.environ.get('ADMIN_KEY', '')
MAX_ACCOUNTS = int(os.environ.get('MAX_ACCOUNTS', '30'))
CREATE = os.environ.get('ACCOUNT_CREATE', '/usr/local/sbin/pulina-account-create')
REMOVE = os.environ.get('ACCOUNT_REMOVE', '/usr/local/sbin/pulina-account-remove')
FIRST_PORT = 9201
# The account name is the nick (15 on QuakeNet); the ident shows its first 10.
NAME_RE = re.compile(r'^[a-z][a-z0-9_-]{1,14}$')
MIN_PASSWORD = 10
MAX_PASSWORD = 256
MAX_EMAIL = 254
EMAIL_RE = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
MAILGUN_KEY = os.environ.get('MAILGUN_KEY', '')
MAILGUN_DOMAIN = os.environ.get('MAILGUN_DOMAIN', 'mg.chat.pulina.fi')
MAILGUN_API = os.environ.get('MAILGUN_API', 'https://api.eu.mailgun.net')
MAIL_FROM = os.environ.get('MAIL_FROM', f'Pulina <tunnukset@{MAILGUN_DOMAIN}>')
PWNED_API = 'https://api.pwnedpasswords.com/range/'
CLIENT = 'pulina-accounts/1.0 (+https://github.com/pulinairc/pulina-app)'
RESET_SECONDS = 3600
RESET_GAP = 600
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
    have = {r[1] for r in conn.execute('PRAGMA table_info(accounts)')}
    for column in ('email TEXT', 'reset TEXT', 'reset_until INTEGER', 'reset_sent INTEGER'):
        if column.split()[0] not in have:
            conn.execute(f'ALTER TABLE accounts ADD COLUMN {column}')
    return conn


def hashed(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, **SCRYPT)


def pwned(password):
    """True when the password is in a known breach. Unknown when the API is down: then it passes."""
    digest = hashlib.sha1(password.encode()).hexdigest().upper()
    request = urllib.request.Request(PWNED_API + digest[:5], headers={'User-Agent': CLIENT, 'Add-Padding': 'true'})
    try:
        with urllib.request.urlopen(request, timeout=5) as answer:
            lines = answer.read().decode().splitlines()
    except OSError as e:
        print(f'pwned check failed: {e}', file=sys.stderr)
        return False
    return any(line.split(':')[0] == digest[5:] and int(line.split(':')[1]) > 0 for line in lines)


def password_problem(name, password):
    if len(password) < MIN_PASSWORD:
        return 'short_password'
    if len(password) > MAX_PASSWORD:
        return 'weak_password'
    if name in password.lower():
        return 'name_in_password'
    if pwned(password):
        return 'breached_password'
    return None


def send_mail(to, subject, text):
    """Mailgun's messages API. A failed mail is logged, never fatal."""
    if not (MAILGUN_KEY and to):
        return
    data = urlencode({'from': MAIL_FROM, 'to': to, 'subject': subject, 'text': text}).encode()
    auth = b64encode(f'api:{MAILGUN_KEY}'.encode()).decode()
    request = urllib.request.Request(f'{MAILGUN_API}/v3/{MAILGUN_DOMAIN}/messages', data=data,
                                     headers={'Authorization': f'Basic {auth}', 'User-Agent': CLIENT})
    try:
        urllib.request.urlopen(request, timeout=15).close()
    except OSError as e:
        print(f'mail to {to} failed: {e}', file=sys.stderr)


def reset_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


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
ul{{list-style:none;padding:0}}label{{display:block;margin:20px 0 8px;color:#fff;font-weight:600}}
input{{box-sizing:border-box;width:100%;max-width:320px;height:44px;padding:0 12px;border:1px solid #17233f;border-radius:12px;background:#0b1530;color:#fff;font:16px system-ui}}
.hint{{font-size:14px}}.error{{color:#ff7a7a}}</style></head><body><main>{body}</main></body></html>"""


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
        if url.path.startswith('/accounts/reset/'):
            return self.reset_page(url.path.rsplit('/', 1)[1])
        self.json(404, {'error': 'not found'})

    def do_POST(self):
        url = urlparse(self.path)
        data = self.body()
        if data is None:
            return self.json(400, {'error': 'bad request'})
        routes = {'/accounts/apply': self.apply, '/accounts/status': self.status, '/accounts/cancel': self.cancel,
                  '/accounts/forgot': self.forgot, '/accounts/notified': self.notified, '/accounts/admin/remove': self.remove}
        if url.path in routes:
            return routes[url.path](data)
        if url.path.startswith('/accounts/review/'):
            return self.decide(url.path.rsplit('/', 1)[1], data.get('decision', ''))
        if url.path.startswith('/accounts/reset/'):
            return self.reset(url.path.rsplit('/', 1)[1], str(data.get('password', '')))
        self.json(404, {'error': 'not found'})

    def apply(self, data):
        name = str(data.get('account', '')).strip().lower()
        password = str(data.get('password', ''))
        known = str(data.get('known', '')).strip()[:MAX_KNOWN]
        email = str(data.get('email', '')).strip()
        if not NAME_RE.fullmatch(name):
            return self.json(400, {'error': 'bad_name'})
        if len(email) > MAX_EMAIL or not EMAIL_RE.fullmatch(email):
            return self.json(400, {'error': 'bad_email'})
        problem = password_problem(name, password)
        if problem:
            return self.json(400, {'error': problem})
        with db() as conn:
            if system_user(name) or conn.execute('SELECT 1 FROM accounts WHERE name = ?', (name,)).fetchone():
                return self.json(409, {'error': 'taken'})
            salt = secrets.token_bytes(16)
            # The app keeps this to ask about the application without storing the password.
            waiting = secrets.token_urlsafe(24)
            conn.execute('INSERT INTO accounts (name, salt, hash, known, status, decision, created, "check", email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                         (name, salt, hashed(password, salt), known, 'pending', secrets.token_urlsafe(24), int(time.time()), waiting, email))
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
        send_mail(row['email'], 'Pulina-tunnuksesi on valmis',
                  f"Hei!\n\nTunnuksesi {row['name']} on hyväksytty. Avaa Pulina, niin sovellus kirjautuu sillä itse.\n\n"
                  'Jos vaihdat laitetta, kirjaudu tunnuksellasi ja salasanallasi.\n\n– Pulina')
        self.decision_page(token)

    def forgot(self, data):
        """Always the same answer, so nobody can find out which accounts exist."""
        name = str(data.get('account', '')).strip().lower()
        now = int(time.time())
        with db() as conn:
            row = conn.execute("SELECT * FROM accounts WHERE name = ? AND status IN ('pending', 'approved')", (name,)).fetchone()
            if row and row['email'] and now - (row['reset_sent'] or 0) > RESET_GAP:
                token = secrets.token_urlsafe(32)
                conn.execute('UPDATE accounts SET reset = ?, reset_until = ?, reset_sent = ? WHERE name = ?',
                             (reset_hash(token), now + RESET_SECONDS, now, name))
                send_mail(row['email'], 'Uusi salasana Pulina-tunnukselle',
                          f'Hei!\n\nTunnukselle {name} pyydettiin uutta salasanaa. Jos pyysit sitä itse, aseta uusi salasana '
                          f'tunnin kuluessa tästä:\n\n{PUBLIC}/accounts/reset/{token}\n\n'
                          'Jos et pyytänyt sitä, voit jättää viestin huomiotta. Salasanasi pysyy ennallaan.\n\n– Pulina')
        self.json(200, {'status': 'sent'})

    def reset_row(self, conn, token):
        return conn.execute('SELECT * FROM accounts WHERE reset = ? AND reset_until > ?', (reset_hash(token), int(time.time()))).fetchone()

    def reset_page(self, token, error=''):
        with db() as conn:
            row = self.reset_row(conn, token)
        if not row:
            return self.html(404, 'Vanhentunut linkki', '<h1>Linkki on vanhentunut</h1><p>Pyydä uusi linkki sovelluksesta.</p>')
        name = html.escape(row['name'])
        note = f'<p class="hint error">{html.escape(error)}</p>' if error else ''
        body = (f'<h1>Uusi salasana tunnukselle {name}</h1><form method="post" style="display:block">'
                f'<input type="text" name="username" value="{name}" autocomplete="username" hidden>'
                '<label for="password">Uusi salasana</label>'
                f'<input id="password" name="password" type="password" minlength="{MIN_PASSWORD}" maxlength="{MAX_PASSWORD}" autocomplete="new-password" required autofocus>'
                '<p class="hint">Vähintään 10 merkkiä. Mitä pidempi, sen parempi.<br>'
                'Salasanamanageri, kuten Bitwarden, keksii vahvan salasanan ja muistaa sen puolestasi.</p>'
                f'{note}<button class="go">Vaihda salasana</button></form>')
        self.html(200, 'Uusi salasana', body)

    def reset(self, token, password):
        errors = {'short_password': 'Salasanassa pitää olla vähintään 10 merkkiä.', 'weak_password': 'Salasana on liian pitkä.',
                  'name_in_password': 'Salasanassa ei saa olla tunnusta.',
                  'breached_password': 'Tämä salasana on paljastunut tietovuodossa. Valitse toinen.'}
        with db() as conn:
            row = self.reset_row(conn, token)
            if not row:
                return self.reset_page(token)
            problem = password_problem(row['name'], password)
            if problem:
                return self.reset_page(token, errors[problem])
            salt = secrets.token_bytes(16)
            conn.execute('UPDATE accounts SET salt = ?, hash = ?, reset = NULL, reset_until = NULL WHERE name = ?',
                         (salt, hashed(password, salt), row['name']))
        self.html(200, 'Salasana vaihdettu', '<h1>Salasana vaihdettu</h1><p>Voit nyt kirjautua sovelluksessa uudella salasanalla.</p>')

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
