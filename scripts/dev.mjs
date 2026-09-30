/* Local preview of the whole site with the /api functions, no Vercel account needed.
   npm run dev            -> http://localhost:3000
   PORT=4000 npm run dev  -> another port
   Without RESEND_API_KEY or SMTP_HOST set, the enquiry API answers "not configured". */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT || 3000);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
      const mod = await import(`../api/${name}.js`);
      return await mod.default(req, res);
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (path === '' || path.endsWith('/')) path += 'index.html';
    let file = join(root, path);
    if (!file.startsWith(root) || path.split(/[/\\]/).some(p => p.startsWith('.') || p === 'node_modules' || p === 'api')) throw Object.assign(new Error(), { code: 'ENOENT' });
    try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); }
    catch { if (!extname(file)) file += '.html'; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ERR_MODULE_NOT_FOUND') { res.writeHead(404, { 'Content-Type': types['.html'] }); res.end(await readFile(join(root, '404.html'))); }
    else { console.error(e); res.writeHead(500); res.end('Server error'); }
  }
}).listen(port, () => console.log(`Hanes website on http://localhost:${port}`));
