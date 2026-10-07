/* =========================================================================================
   Local preview of the whole site, routed exactly as Vercel routes it: every request walks
   vercel.json's `routes` through scripts/routes.mjs (header routes, redirects, the filesystem,
   then the rewrites), so what works here works on the live site (ADDENDUM §2.3, §6.6).

   npm run dev                         -> http://localhost:3000
   PORT=4000 npm run dev               -> another port
   STUDIO_DEV_URL=http://127.0.0.1:4190   where the rewrites go: the studio server (default shown)
   STUDIO_EDGE_SECRET_STAGING=…        the x-studio-edge value the studio's edge gate expects
                                       (local requests match the staging rules)
   HOST=0.0.0.0 npm run dev            listen on every interface (default 127.0.0.1 only, so
                                       nobody else on the network can use it as a proxy)

   Only STUDIO_EDGE_SECRET_STAGING ever reaches the routes here: the production secret is never
   sent from a workstation, even for a request whose Host is the production domain.

   - Static files and api/<name>.js functions are served in the filesystem phase, so
     /api/enquiry runs here; every other /api/* path (including nested ones such as
     /api/enquiry/x) and everything under /studio/ goes to the studio.
   - Like Vercel, the proxy replaces X-Forwarded-For and X-Real-IP with the visitor's address
     (forged values never reach the studio), sets X-Forwarded-Host and X-Forwarded-Proto, and
     never passes on an x-studio-edge header sent by the browser.
   - Without RESEND_API_KEY or SMTP_HOST set, the enquiry API answers "not configured".
   ========================================================================================= */
import http from 'node:http';
import https from 'node:https';
import { readFileSync, createReadStream, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { matchRoute, resolveFile } from './routes.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.pdf': 'application/pdf' };
// headers that belong to one connection and are never forwarded (RFC 9110 §7.6.1)
const HOP = ['connection', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection'];
// what Vercel sets itself; a visitor's own copies never get through
const EDGE_SET = ['x-forwarded-for', 'x-real-ip', 'x-vercel-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-studio-edge'];

// the only secret dev ever sends (ADDENDUM §6.6): the production rules find no value here
export const devRouteEnv = env => (env.STUDIO_EDGE_SECRET_STAGING ? { STUDIO_EDGE_SECRET_STAGING: env.STUDIO_EDGE_SECRET_STAGING } : {});

const clientAddress = req => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '') || '127.0.0.1';

export function createDevServer({ root = ROOT, env = process.env, studioUrl = env.STUDIO_DEV_URL || 'http://127.0.0.1:4190', log = console } = {}) {
  const studio = new URL(studioUrl);
  const routeEnv = devRouteEnv(env);
  const warned = new Set();
  const routes = () => JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).routes; // read per request: edits apply at once
  const filesystem = p => !!resolveFile(root, p);
  const notFoundPage = () => { try { return readFileSync(join(root, '404.html')); } catch { return 'Not found'; } };

  const applyHeaders = (res, headers) => { for (const [k, v] of Object.entries(headers)) res.setHeader(k, v); };

  async function serveFile(req, res, r) {
    const hit = resolveFile(root, r.path);
    if (!hit) return notFound(res, r);
    applyHeaders(res, r.headers);
    if (hit.type === 'function') {
      const mod = await import(pathToFileURL(hit.file).href);
      return mod.default(req, res);
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', TYPES[extname(hit.file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Content-Length', statSync(hit.file).size);
    if (req.method === 'HEAD') return res.end();
    createReadStream(hit.file).pipe(res);
  }

  function notFound(res, r) {
    applyHeaders(res, r.headers);
    res.writeHead(404, { 'Content-Type': TYPES['.html'] });
    res.end(notFoundPage());
  }

  function proxy(req, res, r) {
    const live = new URL(r.dest);
    const target = new URL(live.pathname + live.search, studio); // the live destination's path, on the local studio
    for (const name of r.missingEnv) if (!warned.has(name)) {
      warned.add(name);
      log.warn(name === 'STUDIO_EDGE_SECRET_STAGING'
        ? `dev: ${name} is not set, so proxied requests carry no x-studio-edge header (the studio's edge gate will answer 403)`
        : `dev: requests for the production host carry no x-studio-edge header (dev never sends ${name})`);
    }
    const headers = {};
    const connectionListed = String(req.headers.connection || '').toLowerCase().split(',').map(s => s.trim());
    for (const [k, v] of Object.entries(req.headers)) {
      const key = k.toLowerCase();
      if (HOP.includes(key) || connectionListed.includes(key) || EDGE_SET.includes(key) || key === 'host') continue;
      headers[key] = v;
    }
    const ip = clientAddress(req);
    Object.assign(headers, {
      host: target.host,
      'x-forwarded-for': ip,
      'x-real-ip': ip,
      'x-forwarded-host': req.headers.host || '',
      'x-forwarded-proto': 'http'
    });
    for (const [k, v] of Object.entries(r.requestHeaders)) if (v !== '') headers[k] = v;

    const lib = target.protocol === 'https:' ? https : http;
    const up = lib.request(target, { method: req.method, headers }, upRes => {
      const out = {};
      const upConn = String(upRes.headers.connection || '').toLowerCase().split(',').map(s => s.trim());
      for (const [k, v] of Object.entries(upRes.headers)) if (!HOP.includes(k) && !upConn.includes(k)) out[k] = v;
      // the route's headers go on top of the studio's, as Vercel adds them to proxied responses
      for (const [k, v] of Object.entries(r.headers)) out[k.toLowerCase()] = v;
      res.writeHead(upRes.statusCode, out);
      upRes.pipe(res);
    });
    up.on('error', e => {
      if (res.headersSent) return res.destroy(e);
      applyHeaders(res, r.headers);
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`The studio at ${studio.origin} did not answer (${e.code || e.message}). Start it, or set STUDIO_DEV_URL.`);
    });
    req.pipe(up);
  }

  return http.createServer(async (req, res) => {
    try {
      const r = matchRoute(routes(), { path: req.url || '/', host: req.headers.host || '', env: routeEnv, filesystem });
      if (r.kind === 'redirect' || r.kind === 'status') {
        applyHeaders(res, r.headers);
        res.writeHead(r.status);
        return res.end();
      }
      if (r.kind === 'proxy') return proxy(req, res, r);
      if (r.kind === 'filesystem') return await serveFile(req, res, r);
      return notFound(res, r);
    } catch (e) {
      log.error(e);
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Server error'); }
      else res.destroy();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1'; // loopback unless asked: the proxy adds the edge header
  createDevServer().listen(port, host, () => {
    console.log(`Hanes website on http://${host.includes(':') ? `[${host}]` : host}:${port}`);
    console.log(`Studio rewrites go to ${process.env.STUDIO_DEV_URL || 'http://127.0.0.1:4190'}`);
  });
}
