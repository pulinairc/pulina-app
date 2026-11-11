// Pulina's file host. nginx on chat.pulina.fi proxies up.pulina.fi here and adds the secret
// header, so the public can only reach it through nginx's size and rate limits.
//   POST /upload            raw body, Content-Type, Content-Disposition -> 201, Location
//   GET  /p/<id>/<name>     the file
//   DELETE /p/<id>/<name>   with the secret: takes one file down
const MAX_BYTES = 20 * 1024 * 1024;
const PUBLIC = 'https://up.pulina.fi/p/';
// Only these, by declared type; the extension always comes from the type, never the name.
const TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
};

const same = (a, b) => {
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

function stem(disposition) {
  const m = /filename\*=UTF-8''([^;]+)/i.exec(disposition) || /filename="?([^";]+)"?/i.exec(disposition);
  let name = 'file';
  try {
    name = m ? decodeURIComponent(m[1]) : name;
  } catch {
    /* keep the plain name */
  }
  name = name.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return name.slice(0, 64) || 'file';
}

async function upload(request, env) {
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = TYPES[type];
  if (!ext) {
    return new Response('type not allowed\n', { status: 415 });
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (!(length > 0 && length <= MAX_BYTES)) {
    return new Response('too large\n', { status: 413 });
  }
  const id = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const key = `${id}/${stem(request.headers.get('content-disposition') || '')}.${ext}`;
  await env.FILES.put(key, request.body, { httpMetadata: { contentType: type } });
  const url = PUBLIC + key;
  return new Response(`${url}\n`, { status: 201, headers: { Location: url, 'Content-Type': 'text/plain' } });
}

export default {
  async fetch(request, env) {
    if (!same(request.headers.get('x-upload-key') || '', env.UPLOAD_KEY || '')) {
      return new Response('not found\n', { status: 404 });
    }
    const url = new URL(request.url);
    if (url.pathname === '/upload' && request.method === 'POST') {
      return upload(request, env);
    }
    if (!url.pathname.startsWith('/p/')) {
      return new Response('not found\n', { status: 404 });
    }
    const key = decodeURIComponent(url.pathname.slice(3));
    if (!/^[0-9a-f]{16}\/[A-Za-z0-9._-]+$/.test(key)) {
      return new Response('not found\n', { status: 404 });
    }
    if (request.method === 'DELETE') {
      if (!same(request.headers.get('x-admin-key') || '', env.ADMIN_KEY || '')) {
        return new Response('not found\n', { status: 404 });
      }
      await env.FILES.delete(key);
      return new Response('deleted\n');
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed\n', { status: 405 });
    }
    const object = await env.FILES.get(key, { range: request.headers });
    if (!object) {
      return new Response('not found\n', { status: 404 });
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('cache-control', 'public, max-age=31536000, immutable');
    headers.set('x-content-type-options', 'nosniff');
    headers.set('content-security-policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
    if (object.range && request.headers.has('range')) {
      const { offset = 0, length = object.size - offset } = object.range;
      headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
      return new Response(object.body, { status: 206, headers });
    }
    return new Response(request.method === 'HEAD' ? null : object.body, { headers });
  },
};
