/* =========================================================================================
   The CRM forward (ADDENDUM §7.3): after an enquiry passes validation, the spam trap and the
   rate limit, and before its email is sent, api/enquiry.js hands it to forwardLead(), which
   posts it, HMAC-signed, to the studio's POST /api/leads/ingest. The studio keeps it in its CRM
   outbox (event id enquiry.submitted:<eventId>) until it is sent on to Base44.

   Settings (Vercel > Project > Settings > Environment Variables, Production only):
     STUDIO_INGEST_URL        https://bargainhub-studio.fly.dev/api/leads/ingest
     LEADS_INGEST_SECRET      the HMAC key the studio shares
     STUDIO_EDGE_SECRET_PROD  the x-studio-edge value the studio's edge gate expects
   Without STUDIO_INGEST_URL or LEADS_INGEST_SECRET (previews, tests, local dev) nothing is
   forwarded and the email is exactly as it was before the forward existed.

   The email stays primary: one attempt, a 3 second limit, no retry, and the forward never
   throws. emailLine() turns the result into the one line the Enquiry@ email gains, so the
   team knows whether to enter the enquiry into Base44 by hand. Nothing here logs.
   ========================================================================================= */
import { createHmac } from 'node:crypto';

export const NOTICE_VERSION = '2026-10-09'; // the §11.2 enquiry notice the forms show
export const TIMEOUT_MS = 3000;
export const MAX_BODY = 16 * 1024; // bytes; the studio refuses anything larger with 413
export const MAX_MESSAGE = 4000;

// the label each form sends (assets/enquiry.js callers) -> the §7.3 form enum
export const FORMS = {
  'contact page': 'contact', 'quote dialog': 'quote-dialog', 'hanestone pricing': 'hanestone-pricing',
  'hanewood pricing': 'hanewood-pricing', 'hanesulation pricing': 'hanesulation-pricing', 'hisense page': 'hisense', 'hanes track': 'tracking'
};
const FORM_ENUM = new Set(Object.values(FORMS));
export const BRANDS = ['bargainhub', 'hanesteel', 'hanestone', 'hanewood', 'hanesulation', 'hisense'];
const FORM_BRAND = { 'hanestone-pricing': 'hanestone', 'hanewood-pricing': 'hanewood', 'hanesulation-pricing': 'hanesulation', hisense: 'hisense' };
export const GENERAL_BRAND = 'hanes'; // Hanes Distribution itself: tracking, "Something else", the home page

const REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/; // a ref goes into the email: nothing else gets through
const STORED = new Set(['held', 'queued']);
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/* The §7.3 form value for a form label; an unknown label is a general website enquiry. */
export function formFor(label) {
  const k = String(label ?? '').trim().toLowerCase();
  return FORM_ENUM.has(k) ? k : FORMS[k] || 'contact';
}

/* The brand the enquiry is about: the pricing and Hisense forms by form, the contact page and the
   quote dialog by the topic chosen, then by the page it came from, else Hanes Distribution. */
export function brandFor(form, topic = '', page = '') {
  if (FORM_BRAND[form]) return FORM_BRAND[form];
  if (form === 'tracking') return GENERAL_BRAND;
  const find = s => BRANDS.find(b => new RegExp(`\\b${b}\\b`, 'i').test(String(s)));
  return find(topic) || BRANDS.find(b => new RegExp(`(^|/)${b}\\.html$`, 'i').test(String(page).split(/[?#]/)[0])) || GENERAL_BRAND;
}

// cut a string to n UTF-16 units without leaving half of a surrogate pair at the end
const cut = (s, n) => { let t = s.slice(0, Math.max(0, n)); if (/[\ud800-\udbff]$/.test(t)) t = t.slice(0, -1); return t; };

/* The ingest body for a validated enquiry (api/_lib/enquiry.js validate().data). Exactly the §7.3
   keys; optional ones are left out when empty. The message carries every other answer as
   "Label: value" lines, at most 4000 characters, shortened further if the body would pass 16 KB. */
export function leadFrom(d, now = new Date()) {
  const form = formFor(d.form);
  let phone = '', company = '', topic = '';
  const rest = [];
  for (const [k, v] of d.fields || []) {
    if (/^phone$/i.test(k) && !phone) phone = cut(v.replace(/\s+/g, ' '), 40);
    else if (/^(business|company)$/i.test(k) && !company) company = cut(v.replace(/\s+/g, ' '), 120);
    else { if (/^topic$/i.test(k) && !topic) topic = v; rest.push(v.includes('\n') ? `${k}:\n${v}` : `${k}: ${v}`); }
  }
  const lead = {
    eventId: d.submissionId, form, brand: brandFor(form, topic || d.subject, d.page), page: d.page, name: d.name, email: d.email,
    ...(phone && { phone }), ...(company && { company }), ...(d.subject && { subject: d.subject }),
    message: cut(rest.join('\n'), MAX_MESSAGE),
    marketingOptIn: d.marketingOptIn === true, noticeVersion: NOTICE_VERSION, submittedAt: now.toISOString()
  };
  for (let over = bodyBytes(lead) - MAX_BODY; over > 0 && lead.message; over = bodyBytes(lead) - MAX_BODY) lead.message = cut(lead.message, lead.message.length - over);
  if (!lead.message) delete lead.message;
  return lead;
}
const bodyBytes = o => Buffer.byteLength(JSON.stringify(o));

/* X-Lead-Signature: v1=<hex HMAC-SHA256(secret, timestamp + '.' + rawBody)> */
export function signature(secret, timestamp, rawBody) {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

/* Posts the lead once. Resolves (never rejects) to one of:
     { status: 'skipped' }                                  the forward is not set up here
     { status: 'held' | 'queued', ref }                     202: stored
     { status: 'duplicate', ref, state? }                   200: stored earlier under this eventId
     { status: 'not_stored', http }                         a 4xx (or a setup error): enter by hand
     { status: 'unconfirmed', reason, http? }               timeout, network error, 5xx or an answer
                                                            we cannot read: it may have been stored */
export async function forwardLead(lead, env = process.env, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS, now = Date.now } = {}) {
  const url = env.STUDIO_INGEST_URL, secret = env.LEADS_INGEST_SECRET;
  if (!url || !secret) return { status: 'skipped' };
  let target;
  try { target = new URL(url); } catch { return { status: 'not_stored', http: 'config' }; }
  // the signature and the edge secret only ever travel over TLS (plain http only to this machine)
  if (!(target.protocol === 'https:' || (target.protocol === 'http:' && LOOPBACK.has(target.hostname)))) return { status: 'not_stored', http: 'config' };

  const raw = JSON.stringify(lead), timestamp = String(now());
  if (Buffer.byteLength(raw) > MAX_BODY) return { status: 'not_stored', http: 413 };
  const headers = { 'Content-Type': 'application/json', 'X-Lead-Timestamp': timestamp, 'X-Lead-Signature': signature(secret, timestamp, raw) };
  if (env.STUDIO_EDGE_SECRET_PROD) headers['x-studio-edge'] = env.STUDIO_EDGE_SECRET_PROD;

  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    // redirect 'error': a redirect never carries the signed body or the edge secret anywhere else
    const r = await fetchImpl(target.href, { method: 'POST', headers, body: raw, redirect: 'error', signal: ac.signal });
    const text = await r.text(); // still under the same 3 s limit
    let j = null;
    try { j = JSON.parse(text); } catch {}
    const ref = j && typeof j.ref === 'string' && REF.test(j.ref) ? j.ref : null;
    if (r.status === 202 && ref && STORED.has(j.status)) return { status: j.status, ref };
    if (r.status === 200 && ref && j.status === 'duplicate') return STORED.has(j.state) ? { status: 'duplicate', ref, state: j.state } : { status: 'duplicate', ref };
    if (r.status >= 400 && r.status < 500) return { status: 'not_stored', http: r.status };
    return { status: 'unconfirmed', reason: r.status >= 500 ? 'http_5xx' : 'unexpected_answer', http: r.status };
  } catch {
    return { status: 'unconfirmed', reason: ac.signal.aborted ? 'timeout' : 'network' };
  } finally { clearTimeout(timer); }
}

/* The one line the Enquiry@ email gains ('' when the forward is not set up, so the email is unchanged). */
export function emailLine(result, eventId) {
  switch (result && result.status) {
    case 'skipped': return '';
    case 'held': case 'queued': return `CRM: ${result.status} ${result.ref}`;
    case 'duplicate': return result.state ? `CRM: ${result.state} ${result.ref}` : `CRM: already stored ${result.ref}`;
    case 'not_stored': return `CRM: NOT stored (${result.http}), enter by hand`;
    default: return `CRM unconfirmed (event ${eventId}): check Base44 for this event before entering by hand`;
  }
}
