#!/usr/bin/env python3
"""Uploads to up.pulina.fi pass through here on their way to R2 (uploads-worker/).

iPhones record HEVC, often in HDR, which Chrome, Firefox and Windows cannot play. Such videos
become H.264 first; everything else goes through untouched. nginx adds the upload key and keeps
the size and rate limits, and this listens on localhost only.
"""
import http.server
import json
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

HOST, PORT = '127.0.0.1', 8734
WORKER = 'https://pulina-uploads.digitoimisto-dude.workers.dev/upload'
MAX_BYTES = 20 * 1024 * 1024
VIDEO_TYPES = ('video/mp4', 'video/quicktime')
CONVERT_CODECS = ('hevc',)
HDR_TRANSFERS = ('arib-std-b67', 'smpte2084')
FORWARD = ('content-type', 'content-disposition', 'x-upload-key')
# HDR to SDR: linear light, BT.709 primaries, Hable tone mapping, back to 8-bit video range.
TO_SDR = ('zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,'
          'tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p')
FFMPEG_TIMEOUT_S = 150
WORKER_TIMEOUT_S = 120
# Cloudflare refuses urllib's default User-Agent (error 1010).
USER_AGENT = 'pulina-video/1.0 (+https://www.pulina.fi)'

# Two cores on the server; one video at a time leaves the chat services room.
one_at_a_time = threading.Semaphore(1)


def video_stream(path):
    """Codec and transfer of the first video stream, or None."""
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
         'stream=codec_name,color_transfer', '-of', 'json', str(path)],
        capture_output=True, text=True, timeout=30, check=False)
    streams = json.loads(out.stdout or '{}').get('streams') or []
    return streams[0] if streams else None


def to_h264(src, dst, transfer):
    video = TO_SDR if transfer in HDR_TRANSFERS else 'format=yuv420p'
    subprocess.run(
        ['nice', '-n', '10', 'ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', str(src),
         '-map', '0:v:0', '-map', '0:a:0?', '-vf', video, '-c:v', 'libx264', '-preset', 'veryfast',
         '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(dst)],
        check=True, timeout=FFMPEG_TIMEOUT_S, capture_output=True)


def playable(body, ctype):
    """The body and type to store: H.264 for HEVC video, the upload itself otherwise."""
    if ctype not in VIDEO_TYPES:
        return body, ctype
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / 'in', Path(tmp) / 'out.mp4'
        src.write_bytes(body)
        try:
            stream = video_stream(src)
            if not stream or stream.get('codec_name') not in CONVERT_CODECS:
                return body, ctype
            with one_at_a_time:
                to_h264(src, dst, stream.get('color_transfer'))
            out = dst.read_bytes()
        except (subprocess.SubprocessError, OSError, ValueError) as e:
            print(f'kept the original: {e}', file=sys.stderr)
            return body, ctype
    if not 0 < len(out) <= MAX_BYTES:
        return body, ctype
    return out, 'video/mp4'


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('content-length') or 0)
        if not 0 < length <= MAX_BYTES:
            return self.answer(413, b'too large\n')
        body = self.rfile.read(length)
        ctype = (self.headers.get('content-type') or '').split(';')[0].strip().lower()
        body, ctype = playable(body, ctype)
        headers = {name: self.headers[name] for name in FORWARD if self.headers.get(name)}
        headers['content-type'] = ctype
        headers['user-agent'] = USER_AGENT
        request = urllib.request.Request(WORKER, data=body, method='POST', headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=WORKER_TIMEOUT_S) as res:
                self.answer(res.status, res.read(), res.headers.get('location'))
        except urllib.error.HTTPError as e:
            self.answer(e.code, e.read())
        except (urllib.error.URLError, TimeoutError) as e:
            print(f'worker unreachable: {e}', file=sys.stderr)
            self.answer(502, b'storage unreachable\n')

    def answer(self, status, body, location=None):
        self.send_response(status)
        self.send_header('content-type', 'text/plain')
        self.send_header('content-length', str(len(body)))
        if location:
            self.send_header('location', location)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    http.server.ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
