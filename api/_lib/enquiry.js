/* =========================================================================================
   Hanes enquiries: checks an enquiry sent from any form on the website, writes it up as an
   email and sends it to the Hanes inbox, with Reply-To set to the customer.

   Sending, in order of preference (set these in Vercel > Project > Settings > Environment Variables):
     RESEND_API_KEY                          send through Resend (resend.com)
     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS[, SMTP_SECURE]
                                             or send through any SMTP mailbox (Microsoft 365, Google Workspace…)
   Optional:
     ENQUIRY_TO     where enquiries go (default Enquiry@hanesdistribution.co.nz; separate several with commas)
     ENQUIRY_RATE_MAX  enquiries allowed from one address in ten minutes (default 5)
     ENQUIRY_FROM   the sender, on a domain your provider has verified
                    (default "Hanes Distribution website <onboarding@resend.dev>" for Resend, SMTP_USER for SMTP)
   ========================================================================================= */
export const DEFAULT_TO = 'Enquiry@hanesdistribution.co.nz';
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;
const LIMITS = { name: 120, email: 254, subject: 140, form: 60, page: 300, label: 60, value: 5000, fields: 30, total: 20000 };

// strip control characters (keeping line breaks in long answers) and trim to a length
const clean = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
const line = (v, max) => clean(v, max).replace(/\s+/g, ' ');
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function configured(env = process.env) {
  return Boolean(env.RESEND_API_KEY || env.SMTP_HOST);
}

/* Returns { data } for a good enquiry, { spam: true } for a bot, or { error, field } to show the customer. */
export function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Something went wrong with the form. Please try again.' };
  // bots fill in the hidden "website" field, or post the moment the page loads
  if (clean(body.website, 200)) return { spam: true };
  if (typeof body.elapsed === 'number' && body.elapsed >= 0 && body.elapsed < 2000) return { spam: true };
  const name = line(body.name, LIMITS.name), email = line(body.email, LIMITS.email);
  const subject = line(body.subject, LIMITS.subject) || 'Website enquiry';
  const form = line(body.form, LIMITS.form) || 'form', page = line(body.page, LIMITS.page);
  if (!name) return { error: 'Please enter your name.', field: 'name' };
  if (!EMAIL.test(email)) return { error: 'Please enter a valid email address.', field: 'email' };
  const rows = Array.isArray(body.fields) ? body.fields.slice(0, LIMITS.fields) : [];
  const fields = [];
  let total = 0;
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const k = line(r[0], LIMITS.label), v = clean(r[1], LIMITS.value);
    if (!k || !v || /^(name|email)$/i.test(k)) continue;
    total += v.length;
    fields.push([k, v]);
  }
  if (total > LIMITS.total) return { error: 'Your message is too long. Please shorten it and try again.' };
  return { data: { name, email, subject, form, page, fields } };
}

/* The email the Hanes team receives: plain text and a simple HTML table, every value escaped. */
export function compose(d) {
  const rows = [['Name', d.name], ['Email', d.email], ...d.fields];
  const subject = `Website enquiry: ${d.subject} (${d.name})`.slice(0, 200);
  const from = d.page ? `Sent from ${d.page}` : 'Sent from the Hanes Distribution website';
  const text = [
    d.subject, '',
    ...rows.map(([k, v]) => v.includes('\n') ? `${k}:\n${v}\n` : `${k}: ${v}`), '',
    `${from} (${d.form}).`,
    `Reply to this email to answer ${d.name} directly.`
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f7">
<div style="max-width:640px;margin:0 auto;padding:28px;border-radius:16px;background:#fff;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1d1d1f">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#86868b">Website enquiry</p>
<h1 style="margin:0 0 18px;font-size:22px;line-height:1.25">${esc(d.subject)}</h1>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
${rows.map(([k, v]) => `<tr><td style="padding:10px 16px 10px 0;border-top:1px solid #e8e8ed;vertical-align:top;color:#6e6e73;white-space:nowrap">${esc(k)}</td><td style="padding:10px 0;border-top:1px solid #e8e8ed;vertical-align:top;white-space:pre-wrap">${k === 'Email' ? `<a href="mailto:${esc(v)}" style="color:#0066cc">${esc(v)}</a>` : esc(v)}</td></tr>`).join('\n')}
</table>
<p style="margin:22px 0 0;font-size:13px;color:#86868b">${esc(from)} (${esc(d.form)}). Reply to this email to answer ${esc(d.name)} directly.</p>
</div></body></html>`;
  return { subject, text, html, replyTo: d.email };
}

/* Sends the email. Throws an error with code NOT_CONFIGURED when no provider is set. */
export async function send(msg, env = process.env) {
  const to = env.ENQUIRY_TO || DEFAULT_TO;
  if (env.RESEND_API_KEY) {
    const r = await fetch(`${env.RESEND_API_URL || 'https://api.resend.com'}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.ENQUIRY_FROM || 'Hanes Distribution website <onboarding@resend.dev>', to: to.split(',').map(s => s.trim()), reply_to: msg.replyTo, subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) throw new Error(`Resend responded ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json().catch(() => ({}));
    return { provider: 'resend', id: j.id || null };
  }
  if (env.SMTP_HOST) {
    const { default: nodemailer } = await import('nodemailer');
    const port = Number(env.SMTP_PORT || 587);
    const t = nodemailer.createTransport({
      host: env.SMTP_HOST, port, secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
    });
    const info = await t.sendMail({ from: env.ENQUIRY_FROM || env.SMTP_USER, to, replyTo: msg.replyTo, subject: msg.subject, text: msg.text, html: msg.html });
    return { provider: 'smtp', id: info.messageId || null };
  }
  const e = new Error('Email sending is not configured.');
  e.code = 'NOT_CONFIGURED';
  throw e;
}

/* A light limit on repeat sends from one address, kept in memory for as long as the function stays warm. */
const hits = new Map();
export function limited(key, now = Date.now(), max = 5, windowMs = 10 * 60 * 1000) {
  const list = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (list.length >= max) { hits.set(key, list); return true; }
  list.push(now); hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return false;
}
