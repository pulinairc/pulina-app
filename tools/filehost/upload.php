<?php
// A small file host for Lobby attachments, also usable from Halloy and other clients
// that upload the same way: the file is the raw POST body, with Content-Type and
// Content-Disposition headers. The answer is 201 with the file's address in Location.
//
// Set the three values below, serve this file with PHP, and make STORE reachable at
// BASE_URL. In Lobby, put https://your.host/upload.php?k=YOUR_KEY in Settings.

declare(strict_types=1);

// A long random string. Generate one with: head -c 24 /dev/urandom | base64
const KEY      = 'change-me';
const BASE_URL = 'https://files.example.org/u';
const STORE    = __DIR__ . '/u';
const MAX      = 20 * 1024 * 1024; // keep in step with the web server's body size limit

// Content types that are kept, with the extension they are saved under. Anything else is
// refused, so nothing that a browser would run (html, svg, php) is ever stored.
const TYPES = [
    'image/png'       => 'png',
    'image/jpeg'      => 'jpg',
    'image/gif'       => 'gif',
    'image/webp'      => 'webp',
    'image/avif'      => 'avif',
    'application/pdf' => 'pdf',
    'text/plain'      => 'txt',
];

function fail(int $code): never {
    http_response_code($code);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    fail(405);
}
if (KEY === 'change-me' || !hash_equals(KEY, (string) ($_GET['k'] ?? ''))) {
    fail(404);
}

$type = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
if (!isset(TYPES[$type])) {
    fail(415);
}

$length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($length <= 0 || $length > MAX) {
    fail(413);
}

// A readable name from Content-Disposition; the extension always comes from the type.
$stem = 'file';
$disposition = $_SERVER['HTTP_CONTENT_DISPOSITION'] ?? '';
if (preg_match("/filename\*=UTF-8''([^;]+)/i", $disposition, $m)) {
    $stem = rawurldecode($m[1]);
} elseif (preg_match('/filename="?([^";]+)"?/i', $disposition, $m)) {
    $stem = $m[1];
}
$stem = pathinfo($stem, PATHINFO_FILENAME);
$stem = preg_replace('/[^A-Za-z0-9._-]+/', '-', $stem) ?: 'file';
$stem = trim(substr($stem, 0, 64), '-.') ?: 'file';

$folder = bin2hex(random_bytes(8));
$dir = STORE . '/' . $folder;
if (!mkdir($dir, 0755, true) && !is_dir($dir)) {
    fail(500);
}
$name = $stem . '.' . TYPES[$type];
$path = $dir . '/' . $name;

$in = fopen('php://input', 'rb');
$out = fopen($path, 'wb');
if (!$in || !$out) {
    fail(500);
}

$written = 0;
while (!feof($in)) {
    $chunk = fread($in, 65536);
    if ($chunk === false) {
        break;
    }
    $written += strlen($chunk);
    if ($written > MAX) {
        fclose($in);
        fclose($out);
        unlink($path);
        rmdir($dir);
        fail(413);
    }
    fwrite($out, $chunk);
}
fclose($in);
fclose($out);

if ($written === 0) {
    unlink($path);
    rmdir($dir);
    fail(400);
}

$url = BASE_URL . '/' . $folder . '/' . rawurlencode($name);
http_response_code(201);
header('Location: ' . $url);
header('Content-Type: text/plain');
echo $url;
