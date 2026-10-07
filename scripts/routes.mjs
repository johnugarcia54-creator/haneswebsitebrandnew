/* =========================================================================================
   The route evaluator shared by scripts/dev.mjs and the tests: it walks vercel.json's
   `routes` array the way Vercel does, so the local server and the tests route a request
   exactly as the live site will (ADDENDUM §2.3).

   matchRoute(routes, { path, host, env, filesystem })
     path        the request target, e.g. '/studio/src/app.js?v=2' (pathname plus optional query)
     host        the Host header ('hanes-the-website-new.vercel.app', 'localhost:3000'…)
     env         the environment variables a transform may read (process.env on the server)
     filesystem  (pathname) => boolean: does the deployment have a static file or function here?

   Vercel's semantics, as implemented here:
   - Routes run in order. `src` is a regular expression on the pathname, case-insensitive
     unless the route says caseSensitive:true. `has` / `missing` with type host must (not)
     match the request's host name (port removed, lower case), anchored like `src`.
   - A matching route with continue:true adds its headers (later ones replace earlier ones of
     the same name) and, with a local `dest`, rewrites the path; then the walk goes on.
   - The first matching route without continue ends the walk: `status` answers with that status
     and the route's headers (a redirect when they hold Location); an external `dest` is proxied
     with the route's request transforms; a local `dest` is looked up in the filesystem.
   - {"handle":"filesystem"}: a request that reaches it and names a file or function is served
     from the deployment; otherwise the walk continues with the routes after it.
   - `$1`, `$2`… in dest and header values are the src capture groups (empty when unmatched).
   - Request transforms (type request.headers, op set / append / delete) expand `$NAME` and
     `${NAME}` only for names listed in the transform's `env` array. A listed name with no value
     expands to an empty string and is reported in `missingEnv`.
   - The query string travels with rewrites and proxies; redirects send Location as written.
   - Nothing left: 404 with the headers collected so far.

   Returns { kind, status, headers, location?, path?, dest?, requestHeaders, respectOriginCacheControl?,
             missingEnv, route? } where kind is 'redirect' | 'status' | 'filesystem' | 'proxy' | 'notfound'.
   ========================================================================================= */

import { statSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

const lower = s => String(s).toLowerCase();

function splitTarget(target) {
  const s = String(target || '/');
  const q = s.indexOf('?');
  return q < 0 ? { pathname: s, search: '' } : { pathname: s.slice(0, q), search: s.slice(q) };
}

export function hostName(host) {
  const h = lower(host || '').trim();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1); // [::1]:3000
  return h.replace(/:\d+$/, '');
}

function compile(route) {
  return new RegExp(route.src, route.caseSensitive ? '' : 'i');
}

function hostMatches(cond, host) {
  if (cond.type !== 'host') throw new Error(`routes.mjs: has/missing type "${cond.type}" is not supported`);
  if (typeof cond.value !== 'string') throw new Error('routes.mjs: only string host values are supported');
  return new RegExp(`^(?:${cond.value})$`, 'i').test(host);
}

function conditionsPass(route, host) {
  for (const c of route.has || []) if (!hostMatches(c, host)) return false;
  for (const c of route.missing || []) if (hostMatches(c, host)) return false;
  return true;
}

export function substitute(template, m) {
  return String(template).replace(/\$(\d+)/g, (_, n) => (m[Number(n)] ?? ''));
}

export function expandEnv(value, names = [], env = {}, missing = []) {
  let out = String(value);
  // longest names first, so $A_B is not read as $A followed by "_B"
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const v = env[name];
    if (v === undefined || v === null || v === '') { if (!missing.includes(name)) missing.push(name); }
    const val = v == null ? '' : String(v);
    out = out.split('${' + name + '}').join(val);
    out = out.replace(new RegExp('\\$' + name + '(?![A-Za-z0-9_])', 'g'), () => val);
  }
  return out;
}

function setHeaders(acc, headers, m) {
  for (const [k, v] of Object.entries(headers || {})) {
    for (const existing of Object.keys(acc)) if (lower(existing) === lower(k)) delete acc[existing];
    acc[k] = substitute(v, m);
  }
}

function applyTransforms(route, env, requestHeaders, missingEnv) {
  for (const t of route.transforms || []) {
    if (t.type !== 'request.headers') throw new Error(`routes.mjs: transform type "${t.type}" is not supported`);
    const key = lower(t.target && t.target.key);
    if (!key) throw new Error('routes.mjs: transform without target.key');
    if (t.op === 'delete') { delete requestHeaders[key]; continue; }
    const value = expandEnv(t.args ?? '', t.env || [], env, missingEnv);
    if (t.op === 'set') requestHeaders[key] = value;
    else if (t.op === 'append') requestHeaders[key] = requestHeaders[key] ? `${requestHeaders[key]}${value}` : value;
    else throw new Error(`routes.mjs: transform op "${t.op}" is not supported`);
  }
}

const isExternal = d => /^https?:\/\//i.test(d);
const withSearch = (dest, search) => (search ? dest + (dest.includes('?') ? '&' + search.slice(1) : search) : dest);

export function matchRoute(routes, { path = '/', host = '', env = {}, filesystem = () => false } = {}) {
  if (!Array.isArray(routes)) throw new TypeError('matchRoute: routes must be an array');
  const h = hostName(host);
  let { pathname, search } = splitTarget(path);
  const headers = {}, requestHeaders = {}, missingEnv = [];
  const done = (kind, extra) => ({ kind, headers, requestHeaders, missingEnv, ...extra });
  const serveFile = (route) => filesystem(pathname)
    ? done('filesystem', { status: 200, path: pathname, route })
    : null;

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    if (route.handle) {
      if (route.handle !== 'filesystem') throw new Error(`routes.mjs: handle "${route.handle}" is not supported`);
      const hit = serveFile(route);
      if (hit) return hit;
      continue;
    }
    const m = compile(route).exec(pathname);
    if (!m || !conditionsPass(route, h)) continue;

    setHeaders(headers, route.headers, m);
    applyTransforms(route, env, requestHeaders, missingEnv);
    const dest = route.dest !== undefined ? expandEnv(substitute(route.dest, m), route.env || [], env, missingEnv) : undefined;

    if (route.continue) {
      if (dest !== undefined && !isExternal(dest)) ({ pathname } = splitTarget(dest));
      continue;
    }
    const status = route.status ?? route.statusCode;
    if (status !== undefined && dest === undefined) {
      const loc = Object.entries(headers).find(([k]) => lower(k) === 'location');
      return done(loc && status >= 300 && status < 400 ? 'redirect' : 'status', { status, location: loc ? loc[1] : undefined, route });
    }
    if (dest !== undefined && isExternal(dest)) {
      return done('proxy', { status: status ?? null, dest: withSearch(dest, search), respectOriginCacheControl: route.respectOriginCacheControl, route });
    }
    if (dest !== undefined) ({ pathname } = splitTarget(dest));
    // a non-continue route that does not answer itself: serve what the path names, else 404
    return serveFile(route) || done('notfound', { status: 404, path: pathname, route });
  }
  return done('notfound', { status: 404, path: pathname });
}

/* ---------- The deployment's filesystem, as Vercel sees this repository ----------
   resolveFile(root, pathname) -> { type: 'static' | 'function', file } or null
   - api/<name>.js is the function at /api/<name> (no segment starting with _ or .: api/_lib is
     shared code, never a function); nothing under api/ is served as a static file.
   - '/' and paths ending in '/' serve that folder's index.html; no extension guessing
     (the project has no cleanUrls), no folder listings.
   - Never served: dot files and folders, node_modules, and whatever .vercelignore keeps out of
     the upload (scripts/, tests/, .github/, README.md…), plus the project's own config files. */

const PRIVATE = new Set(['node_modules', 'vercel.json', 'package.json', 'package-lock.json']);

function ignoredByVercel(root) {
  let lines = [];
  try { lines = readFileSync(join(root, '.vercelignore'), 'utf8').split(/\r?\n/); } catch {}
  return lines.map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.replace(/^\/+|\/+$/g, ''));
}

const isFile = f => { try { return statSync(f).isFile(); } catch { return false; } };

export function resolveFile(root, pathname) {
  let p;
  try { p = decodeURIComponent(String(pathname || '/')); } catch { return null; }
  if (!p.startsWith('/') || p.includes('\0') || p.includes('\\')) return null;
  const parts = p.split('/').slice(1);
  if (parts.some(s => s === '..' || s === '.' || (s.startsWith('.') && s !== ''))) return null;
  if (parts[0] === 'api') {
    const segs = parts.slice(1);
    if (!segs.length || segs.some(s => !s || s.startsWith('_') || s.startsWith('.'))) return null;
    const file = join(root, 'api', ...segs) + '.js';
    return !segs[segs.length - 1].endsWith('.js') && isFile(file) ? { type: 'function', file } : null;
  }
  if (PRIVATE.has(parts[0])) return null;
  const ignored = ignoredByVercel(root);
  if (ignored.some(i => parts.join('/') === i || parts.join('/').startsWith(i + '/'))) return null;
  const rel = p.endsWith('/') ? p + 'index.html' : p;
  const file = join(root, ...rel.split('/').filter(Boolean));
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep) && file !== root) return null;
  return isFile(file) ? { type: 'static', file } : null;
}
