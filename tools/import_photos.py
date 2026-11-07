"""Import IRC contact photos from a folder into lobby-server as people.

Usage: python3 tools/import_photos.py <photo folder> <ws url> <token file> [--dry-run] [--skip file ...]
Needs Pillow and websocket-client. Reach lobby-server first, for example with
ssh -N -L 17667:127.0.0.1:7667 you@your-shell-host, then use ws://127.0.0.1:17667.
File names are nicks. Nicks that differ only by trailing _ - ` and files with the same
picture become one person. People whose nick is already covered are left alone.
"""
import base64
import hashlib
import io
import json
import re
import sys
from pathlib import Path

from PIL import Image
from websocket import create_connection

PHOTO_PX = 160
ROUND_INNER = 0.7
EXTS = {".png", ".jpg", ".jpeg", ".webp"}
BACKDROP = (31, 31, 35)


def norm(nick):
    return re.sub(r"[_\-`|^]+$", "", nick.lower())


def is_round(img):
    small = img.resize((32, 32))
    def empty(p):
        r, g, b, a = p
        return a < 16 or (a > 240 and r + g + b < 30)
    corners = [small.getpixel(xy) for xy in ((1, 1), (30, 1), (1, 30), (30, 30))]
    return all(empty(c) for c in corners) and not empty(small.getpixel((16, 16)))


def photo(path):
    img = Image.open(path).convert("RGBA")
    side = min(img.size)
    left, top = (img.width - side) // 2, (img.height - side) // 2
    img = img.crop((left, top, left + side, top + side))
    if is_round(img):
        inner = int(side * ROUND_INNER)
        off = (side - inner) // 2
        img = img.crop((off, off, off + inner, off + inner))
    flat = Image.new("RGB", img.size, BACKDROP)
    flat.paste(img, mask=img.split()[3])
    flat = flat.resize((PHOTO_PX, PHOTO_PX), Image.LANCZOS)
    buf = io.BytesIO()
    flat.save(buf, "JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def groups(folder, skip):
    files = [p for p in sorted(Path(folder).iterdir()) if p.suffix.lower() in EXTS and p.name not in skip]
    by_key = {}
    for p in files:
        digest = hashlib.sha1(p.read_bytes()).hexdigest()
        key = next((k for k, g in by_key.items() if norm(p.stem) in g["norms"] or digest in g["hashes"]), None)
        if key is None:
            key = p.stem
            by_key[key] = {"files": [], "norms": set(), "hashes": set()}
        g = by_key[key]
        g["files"].append(p)
        g["norms"].add(norm(p.stem))
        g["hashes"].add(digest)
    return by_key.values()


def main():
    folder, url, token_file = sys.argv[1:4]
    dry = "--dry-run" in sys.argv
    skip = set(sys.argv[sys.argv.index("--skip") + 1:]) if "--skip" in sys.argv else set()
    token = Path(token_file).expanduser().read_text().strip()
    ws = create_connection(url)
    ws.send(json.dumps({"type": "hello", "token": token}))
    welcome = json.loads(ws.recv())
    existing = welcome["snapshot"].get("people", [])
    covered = {norm(n.rstrip("*")) for p in existing for n in p["nicks"]}

    next_id = 1
    for g in groups(folder, skip):
        nicks = sorted({f.stem for f in g["files"]}, key=lambda n: (len(n), n))
        bases = []
        for n in nicks:
            if norm(n) not in {norm(b) for b in bases}:
                bases.append(n)
        if any(norm(n) in covered for n in bases):
            print(f"skip  {', '.join(bases)} (already set up)")
            continue
        best = min(g["files"], key=lambda f: (norm(f.stem) != f.stem.lower(), len(f.stem)))
        person = {"id": 0, "name": bases[0], "color": "", "photo": photo(best), "nicks": bases}
        print(f"add   {person['name']:<20} nicks: {', '.join(bases)}  ({best.name})")
        if dry:
            continue
        ws.send(json.dumps({"type": "save_person", "id": next_id, "person": person}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("type") == "reply" and msg.get("id") == next_id:
                if msg.get("error"):
                    print("  error:", msg["error"])
                break
        next_id += 1
    ws.close()


if __name__ == "__main__":
    main()
