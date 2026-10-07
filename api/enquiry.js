/* POST /api/enquiry: sends a website enquiry to the Hanes inbox (see api/_lib/enquiry.js).
   In order: origin, size, rate limit, validation and the spam trap (and "not configured" when no
   email provider is set); then the CRM forward to the studio (api/_lib/crm-forward.js, ADDENDUM
   §7.3), then the email, which gains one line saying what the CRM did. The email is primary: a failed forward never fails the request, and spam,
   refused or rate-limited enquiries are never forwarded.
   GET /api/enquiry: a health check that says whether sending is configured. */
import { validate, compose, send, configured, limited } from './_lib/enquiry.js';
import { leadFrom, forwardLead, emailLine } from './_lib/crm-forward.js';

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

  // without the forward's settings the line is '' and the email is exactly as before
  let note = '';
  try {
    const f = await forwardLead(leadFrom(v.data));
    note = emailLine(f, v.data.submissionId);
    if (f.status !== 'skipped') console.log(`enquiry crm forward: ${f.status}${f.http ? ` ${f.http}` : ''}${f.reason ? ` ${f.reason}` : ''} (event ${v.data.submissionId})`);
  } catch {
    note = emailLine({ status: 'unconfirmed' }, v.data.submissionId);
  }

  try {
    const r = await send(compose(v.data, note));
    console.log(`enquiry sent via ${r.provider}: ${v.data.form} ${r.id || ''}`);
    return json(res, 200, { ok: true });
  } catch (e) {
    console.error('enquiry send failed:', e.message);
    return json(res, 502, { error: 'send_failed' });
  }
}
