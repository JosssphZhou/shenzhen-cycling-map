import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const option = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const root = resolve(option('--dir') || 'out');
const port = Number(option('--port') || 3701);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口应为1至65535的整数。');
await stat(resolve(root, 'index.html')).catch(() => { throw new Error('没有找到构建输出，请先运行 npm run build。'); });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.gz': 'application/gzip' };
const exists = async path => { try { const info = await stat(path); return info.isFile() ? info : null; } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; return null; } };

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let path = resolve(root, '.' + pathname);
    if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
    const html = path.replace(/\/+$/, '') + '.html';
    if (await exists(html)) path = html;
    else if (pathname.endsWith('/') || path === root) path = resolve(path, 'index.html');
    let info = await exists(path);
    if (!info) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('没有找到这个页面或文件。'); return; }
    const type = mime[extname(path)] || 'application/octet-stream';
    let encoded = false;
    if (/\bgzip\b/.test(request.headers['accept-encoding'] || '')) {
      const compressed = await exists(path + '.gz');
      if (compressed) { path += '.gz'; info = compressed; encoded = true; }
    }
    const etag = `"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}${encoded ? '-gz' : ''}"`;
    const headers = { 'Content-Type': type, 'Content-Length': info.size, Vary: 'Accept-Encoding', ETag: etag, 'Cache-Control': pathname.startsWith('/_next/static/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff', ...(encoded ? { 'Content-Encoding': 'gzip' } : {}) };
    if (request.headers['if-none-match'] === etag) { response.writeHead(304, headers); response.end(); return; }
    response.writeHead(200, headers);
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = createReadStream(path);
    stream.on('error', error => response.destroy(error));
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  } catch { if (!response.headersSent) response.writeHead(400); response.end(); }
});
server.listen(port, '127.0.0.1', () => console.log(`深圳体验预览：http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
