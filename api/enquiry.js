/* POST /api/enquiry: sends a website enquiry to the Hanes inbox (see api/_lib/enquiry.js).
   GET /api/enquiry: a health check that says whether sending is configured. */
import { validate, compose, send, configured, limited } from './_lib/enquiry.js';

const json = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' || req.method === 'HEAD') return json(res, 200, { ok: true, configured: configured() });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return json(res, 405, { error: 'Method not allowed.' }); }

  // only this website's own pages may post here
  const origin = req.headers.origin, host = req.headers['x-forwarded-host'] || req.headers.host;
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === host; } catch {}
    if (!ok) return json(res, 403, { error: 'Forbidden.' });
  }

  let body = req.body;
  if (body === undefined) { // a plain Node server: read the stream
    let raw = '';
    for await (const c of req) { raw += c; if (raw.length > 60000) break; }
    body = raw;
  }
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (body && JSON.stringify(body).length > 60000) return json(res, 413, { error: 'Your message is too long. Please shorten it and try again.' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (limited(ip, Date.now(), Number(process.env.ENQUIRY_RATE_MAX) || 5)) return json(res, 429, { error: 'too_many' });

  const v = validate(body);
  if (v.spam) return json(res, 200, { ok: true });
  if (v.error) return json(res, 400, { error: v.error, field: v.field || null });
  if (!configured()) return json(res, 503, { error: 'not_configured' });

  try {
    const r = await send(compose(v.data));
    console.log(`enquiry sent via ${r.provider}: ${v.data.form} ${r.id || ''}`);
    return json(res, 200, { ok: true });
  } catch (e) {
    console.error('enquiry send failed:', e.message);
    return json(res, 502, { error: 'send_failed' });
  }
}
