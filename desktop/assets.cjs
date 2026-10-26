const { createReadStream } = require('node:fs');
const { stat, realpath } = require('node:fs/promises');
const { resolve, relative, extname, sep } = require('node:path');
const { Readable } = require('node:stream');
const { createGunzip } = require('node:zlib');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.rsc': 'text/x-component',
  '.bin': 'application/octet-stream', '.gpx': 'application/gpx+xml; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.pdf': 'application/pdf',
};
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
function isInternalUrl(value) {
  try { const url = new URL(value); return url.protocol === 'shenzhen:' && url.hostname.toLowerCase() === 'app' && !url.port && !url.username && !url.password; }
  catch { return false; }
}
function isExternalUrl(value) {
  try { const url = new URL(value); return (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname && !url.username && !url.password; }
  catch { return false; }
}
const within = (root, path) => path === root || path.startsWith(root + sep);
async function fileInfo(path) {
  try { const info = await stat(path); return info.isFile() ? info : null; }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
}

function createAssetHandler(directory, { manifest } = {}) {
  const root = resolve(directory);
  const records = manifest ? new Map(manifest.assets.map(asset => [asset.path, asset])) : null;
  const rootCanonical = realpath(root).catch(() => null);
  const plain = (message, status, method, headers = {}) => new Response(method === 'HEAD' ? null : message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers } });
  async function candidate(path) {
    if (!within(root, path)) return null;
    const logical = relative(root, path).split(sep).join('/'), record = records?.get(logical);
    if (records && !record) return null;
    let physical, info, compressed;
    if (record) {
      physical = resolve(root, record.storedPath); compressed = record.storage === 'gzip';
      if (!within(root, physical)) return null;
      info = await fileInfo(physical);
    } else {
      info = await fileInfo(path + '.gz'); compressed = !!info; physical = compressed ? path + '.gz' : path;
      if (!info) info = await fileInfo(path);
    }
    if (!info) return null;
    const canonical = await realpath(physical);
    const canonicalRoot = await rootCanonical;
    if (!canonicalRoot || !within(canonicalRoot, canonical)) return null;
    const logicalBytes = record?.logicalBytes ?? (compressed ? (await fileInfo(path))?.size : info.size);
    return { logical, physical, info, compressed, logicalBytes, hash: record?.sha256 };
  }
  return async request => {
    const method = request.method.toUpperCase();
    if (!isInternalUrl(request.url)) return plain('此地址不属于应用资源。', 403, method);
    if (method !== 'GET' && method !== 'HEAD') return plain('此资源仅支持读取。', 405, method, { Allow: 'GET, HEAD' });
    try {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').includes('..')) return plain('无法访问这个资源路径。', 403, method);
      const path = resolve(root, '.' + pathname);
      if (!within(root, path)) return plain('无法访问这个资源路径。', 403, method);
      // Next导出可能同时包含同名RSC目录，页面文件始终优先。
      const html = path.replace(/\/+$/, '') + '.html';
      const asset = await candidate(html) || await candidate(path) || ((pathname.endsWith('/') || path === root) ? await candidate(resolve(path, 'index.html')) : null);
      if (!asset) return plain('没有找到这个页面或文件。', 404, method);
      const etag = `"${asset.hash || `${asset.info.size.toString(16)}-${Math.trunc(asset.info.mtimeMs).toString(16)}`}"`;
      const headers = {
        'Content-Type': MIME[extname(asset.logical)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer', ETag: etag,
        'Cache-Control': pathname.startsWith('/_next/static/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        ...(asset.logicalBytes === undefined ? {} : { 'Content-Length': String(asset.logicalBytes) }),
      };
      if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
      if (method === 'HEAD') return new Response(null, { status: 200, headers });
      const source = createReadStream(asset.physical), body = asset.compressed ? source.pipe(createGunzip()) : source;
      const abort = () => { source.destroy(); if (body !== source) body.destroy(); };
      request.signal?.addEventListener('abort', abort, { once: true });
      source.on('error', error => body.destroy(error));
      body.once('close', () => { source.destroy(); request.signal?.removeEventListener('abort', abort); });
      if (request.signal?.aborted) abort();
      return new Response(Readable.toWeb(body), { status: 200, headers });
    } catch (error) {
      return plain(error instanceof URIError ? '资源地址格式不正确。' : '无法读取这个应用资源。', error instanceof URIError ? 400 : 404, method);
    }
  };
}

module.exports = { createAssetHandler, isInternalUrl, isExternalUrl };
