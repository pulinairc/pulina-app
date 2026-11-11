"""One-off patch for up.pulina.fi/fh.php: accept per-account keys from /etc/up-pulina-keys
besides its own secret. Usage: python3 -I up-pulina-fh-keys.py /var/www/up.pulina.fi/public/fh.php"""
import sys

p = sys.argv[1]
s = open(p).read()
old = """// Constant-time secret check; 404 (not 401/403) to not advertise it.
if (!hash_equals(SECRET, (string) ($_GET['k'] ?? ''))) {
    fail(404);
}"""
new = """// Pulina accounts each have their own key, one "account:key" per line, so one can be revoked alone.
const KEYS_FILE = '/etc/up-pulina-keys';
function key_ok(string $k): bool {
    if (hash_equals(SECRET, $k)) {
        return true;
    }
    foreach (@file(KEYS_FILE, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $parts = explode(':', $line, 2);
        if (count($parts) === 2 && strlen($parts[1]) >= 32 && hash_equals($parts[1], $k)) {
            return true;
        }
    }
    return false;
}
// Constant-time secret check; 404 (not 401/403) to not advertise it.
if (!key_ok((string) ($_GET['k'] ?? ''))) {
    fail(404);
}"""
assert old in s, 'fh.php is not the expected version'
open(p, 'w').write(s.replace(old, new, 1))
