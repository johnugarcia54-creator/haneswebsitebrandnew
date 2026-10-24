/* POST /api/enquiry: sends a website enquiry to the Hanes inbox (see api/_lib/enquiry.js).
   In order: origin, size, rate limit, validation and the spam trap (and "not configured" when no
   email provider is set); then the CRM forward to the studio (api/_lib/crm-forward.js, ADDENDUM
   §7.3), then the email, which gains one line saying what the CRM did. The email is primary: a failed forward never fails the request, and spam,
   refused or rate-limited enquiries are never forwarded.
   GET /api/enquiry: a health check that says whether sending is configured. */
import { validate, compose, send, configured, limited, record } from './_lib/enquiry.js';
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
  // only sent enquiries (and spam-trap hits) use up the allowance; failed requests have their own, higher cap
  const sent = `sent:${ip}`, failed = `failed:${ip}`, fail = (status, b) => { record(failed); return json(res, status, b); };
  if (limited(sent, Date.now(), Number(process.env.ENQUIRY_RATE_MAX) || 5) || limited(failed, Date.now(), 20)) return json(res, 429, { error: 'too_many' });

  const v = validate(body);
  if (v.spam) { record(sent); return json(res, 200, { ok: true }); }
  if (v.error) return fail(400, { error: v.error, field: v.field || null });
  if (!configured()) return fail(503, { error: 'not_configured' });

  // hold a slot from here, before the awaited CRM forward and the send, so a parallel burst cannot
  // pass the check together; give it back if the send fails
  const release = record(sent);

  // without the forward's settings the line is '' and the email is exactly as before
  let note = '', crm = 'unconfirmed';
  try {
    const f = await forwardLead(leadFrom(v.data));
    crm = f.status;
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
    // the event id and the forward's status (no personal data), so a lead the CRM already holds
    // can be matched before the visitor's fallback email is entered by hand
    console.error('enquiry send failed:', e.message, `(event ${v.data.submissionId}, crm ${crm})`);
    release();
    return fail(502, { error: 'send_failed' });
  }
}
