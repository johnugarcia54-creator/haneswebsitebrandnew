/* Tests for the CRM forward of website enquiries (ADDENDUM §7.3, §12.2): npm test.
   Every studio answer comes from a stand-in HTTP server on 127.0.0.1, so nothing leaves this machine. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import { validate, compose } from '../api/_lib/enquiry.js';
import handler from '../api/enquiry.js';
import { FORMS, BRANDS, GENERAL_BRAND, EDGE_HOSTS, edgeAllowed, NOTICE_VERSION, TIMEOUT_MS, MAX_BODY, formFor, brandFor, leadFrom, signature, forwardLead, emailLine } from '../api/_lib/crm-forward.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha = s => createHash('sha256').update(s).digest('hex');
const good = { name: 'Aroha Smith', email: 'aroha@example.co.nz', subject: 'Hanesteel quote', form: 'test', page: '/hanesteel.html', elapsed: 9000, website: '',
  fields: [['Phone', '021 000 000'], ['Message', 'Six windows\nand a door']] };

/* ---------- validate: the two keys assets/enquiry.js sends at the top level ---------- */
test('validate keeps a UUID submissionId and makes one when it is missing or not a UUID', () => {
  assert.equal(validate({ ...good, submissionId: '0F8FAD5B-D9CB-469F-A165-70867728950E' }).data.submissionId, '0f8fad5b-d9cb-469f-a165-70867728950e');
  for (const submissionId of [undefined, '', 'abc', 42, '0f8fad5b-d9cb-469f-a165-70867728950e ', '0f8fad5b-d9cb-469f-a165-70867728950e\n', { id: 1 }]) {
    const id = validate({ ...good, submissionId }).data.submissionId;
    assert.match(id, UUID, String(submissionId));
  }
  assert.notEqual(validate(good).data.submissionId, validate(good).data.submissionId);
});

test('validate reads marketingOptIn as true only when it is exactly true', () => {
  assert.equal(validate({ ...good, marketingOptIn: true }).data.marketingOptIn, true);
  for (const marketingOptIn of [undefined, false, 'true', 'yes', 1, null]) assert.equal(validate({ ...good, marketingOptIn }).data.marketingOptIn, false);
});

/* ---------- compose: byte-identical without the CRM line ---------- */
test('compose without a note is byte for byte the email from before the forward', () => {
  // sha256 of JSON.stringify(compose(validate(good).data)) at 7c5c7a6, before C1a
  assert.equal(sha(JSON.stringify(compose(validate(good).data))), 'c18cd0a41601077046b312a17260460c4a2f49318ba6842a971287918457d8bd');
  assert.deepEqual(compose(validate(good).data, ''), compose(validate(good).data));
});

test('compose adds the note as one last line, escaped in the HTML', () => {
  const d = validate(good).data, base = compose(d), m = compose(d, 'CRM: NOT stored (400), enter by hand <x>');
  assert.equal(m.text, `${base.text}\nCRM: NOT stored (400), enter by hand <x>`);
  assert.ok(m.html.includes('CRM: NOT stored (400), enter by hand &lt;x&gt;</p>'));
  assert.ok(!m.html.includes('<x>'));
  assert.equal(m.subject, base.subject);
  assert.equal(m.replyTo, base.replyTo);
});

/* ---------- crm-forward: mapping ---------- */
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const KEYS = ['eventId', 'form', 'brand', 'page', 'name', 'email', 'phone', 'company', 'subject', 'message', 'marketingOptIn', 'noticeVersion', 'submittedAt'];
const dialog = { ...good, form: 'quote dialog', submissionId: ID, marketingOptIn: true,
  fields: [['Topic', 'Hanesteel windows and doors'], ['Phone', '021 000 000'], ['Business', 'Smith Builders'], ['Region', 'Canterbury'], ['Message', 'Six windows\nand a door']] };

test('formFor maps every form on the site to the §7.3 enum', () => {
  assert.deepEqual(Object.entries(FORMS).map(([k]) => formFor(k)), ['contact', 'quote-dialog', 'hanestone-pricing', 'hanewood-pricing', 'hanesulation-pricing', 'hisense', 'tracking']);
  for (const v of Object.values(FORMS)) assert.equal(formFor(v), v);
  assert.equal(formFor('Quote Dialog'), 'quote-dialog');
  assert.equal(formFor('form'), 'contact');
  assert.equal(formFor(undefined), 'contact');
});

test('brandFor: by form, then the topic, then the page, else Hanes', () => {
  assert.equal(brandFor('hanestone-pricing', 'Hisense', '/bargainhub.html'), 'hanestone');
  assert.equal(brandFor('hanewood-pricing'), 'hanewood');
  assert.equal(brandFor('hanesulation-pricing'), 'hanesulation');
  assert.equal(brandFor('hisense'), 'hisense');
  assert.equal(brandFor('tracking', 'Bargainhub', '/bargainhub.html'), 'hanes');
  assert.equal(brandFor('quote-dialog', 'Bargainhub kitchens and interiors', '/index.html'), 'bargainhub');
  assert.equal(brandFor('quote-dialog', 'Project enquiry', '/hanesteel.html'), 'hanesteel');
  assert.equal(brandFor('quote-dialog', 'Project enquiry', '/'), 'hanes');
  assert.equal(brandFor('contact', 'Hanewood plywood, board and LVL', '/contact.html'), 'hanewood');
  assert.equal(brandFor('contact', 'Something else', '/contact.html'), 'hanes');
  assert.ok(BRANDS.includes(brandFor('contact', 'Hisense appliances')));
});

test('the brand contract with the studio: a fixed list of values, and nothing else is ever sent', () => {
  // docs/api/CRM.md (studio) must accept exactly these; a change here is a change to that contract
  const CONTRACT = ['bargainhub', 'hanesteel', 'hanestone', 'hanewood', 'hanesulation', 'hisense', 'hanes'];
  assert.deepEqual([...BRANDS, GENERAL_BRAND], CONTRACT);
  const topics = ['', 'Something else', 'Shipment tracking', 'Bargainhub kitchens', 'HANESTEEL', 'Hisense appliances', 'Project enquiry'];
  const pages = ['', '/', '/index.html', '/contact.html', '/tracking.html', ...CONTRACT.map(b => `/${b}.html`), '/hanestone.html?x=1#y'];
  for (const form of Object.values(FORMS)) for (const t of topics) for (const p of pages) assert.ok(CONTRACT.includes(brandFor(form, t, p)), `${form} ${t} ${p}`);
});

test('leadFrom builds exactly the §7.3 body', () => {
  const now = new Date('2026-10-09T01:02:03.004Z');
  const lead = leadFrom(validate(dialog).data, now);
  assert.deepEqual(lead, {
    eventId: ID, form: 'quote-dialog', brand: 'hanesteel', page: '/hanesteel.html', name: 'Aroha Smith', email: 'aroha@example.co.nz',
    phone: '021 000 000', company: 'Smith Builders', subject: 'Hanesteel quote',
    message: 'Topic: Hanesteel windows and doors\nRegion: Canterbury\nMessage:\nSix windows\nand a door',
    marketingOptIn: true, noticeVersion: '2026-10-09', submittedAt: '2026-10-09T01:02:03.004Z'
  });
  assert.equal(NOTICE_VERSION, '2026-10-09');
  // optional keys are left out when empty, and nothing outside the §7.3 set ever appears
  const bare = leadFrom(validate({ ...good, form: 'hanes track', fields: [] }).data);
  assert.deepEqual(Object.keys(bare), ['eventId', 'form', 'brand', 'page', 'name', 'email', 'subject', 'marketingOptIn', 'noticeVersion', 'submittedAt']);
  assert.equal(bare.marketingOptIn, false);
  assert.match(bare.eventId, UUID);
  for (const k of Object.keys(lead)) assert.ok(KEYS.includes(k), k);
  assert.ok(!/design|price|file|render|quote_?total/i.test(Object.keys(lead).join()));
});

test('leadFrom keeps the message to 4000 characters and the body to 16 KB', () => {
  const long = leadFrom(validate({ ...good, fields: [['Message', 'x'.repeat(5000)], ['More', 'y'.repeat(5000)]] }).data);
  assert.equal(long.message.length, 4000);
  // characters that take three bytes each, and quotes that JSON doubles, still fit in 16 KB
  for (const ch of ['€', '"', '😀']) {
    const big = leadFrom(validate({ ...good, name: ch.repeat(60), subject: ch.repeat(70), page: '/' + ch.repeat(140), fields: [['Phone', ch.repeat(20)], ['Business', ch.repeat(60)], ['Message', ch.repeat(4990)], ['More', ch.repeat(4990)]] }).data);
    assert.ok(Buffer.byteLength(JSON.stringify(big)) <= MAX_BODY, ch);
    assert.ok(big.message.length > 1000 && big.message.length <= 4000, ch);
    assert.ok(!/[\ud800-\udbff]$/.test(big.message), 'no half surrogate at the end');
  }
});

/* ---------- crm-forward: the request and every answer ---------- */
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
// a stand-in for the studio's POST /api/leads/ingest: answer(req, res, raw) decides what it says
async function studio(answer) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let raw = ''; req.setEncoding('utf8');
    req.on('data', c => raw += c);
    req.on('end', () => { seen.push({ method: req.method, url: req.url, headers: req.headers, raw }); answer(req, res, raw); });
  });
  const port = await listen(srv);
  return { seen, port, url: `http://127.0.0.1:${port}/api/leads/ingest`, close: () => { srv.closeAllConnections(); srv.close(); } };
}
const reply = (status, body) => (req, res) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
const envFor = (url, extra = {}) => ({ STUDIO_INGEST_URL: url, LEADS_INGEST_SECRET: 'test-ingest-secret', STUDIO_EDGE_SECRET_PROD: 'test-edge-secret', ...extra });
const lead = () => leadFrom(validate(dialog).data);

test('forwardLead is skipped without STUDIO_INGEST_URL or LEADS_INGEST_SECRET', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('must not be called'); };
  for (const env of [{}, { STUDIO_INGEST_URL: 'https://studio.example/api/leads/ingest' }, { LEADS_INGEST_SECRET: 's', STUDIO_EDGE_SECRET_PROD: 'e' }, { STUDIO_INGEST_URL: '', LEADS_INGEST_SECRET: 's' }]) {
    assert.deepEqual(await forwardLead(lead(), env, { fetchImpl }), { status: 'skipped' });
  }
  assert.equal(calls, 0);
  assert.equal(emailLine({ status: 'skipped' }, ID), '');
});

test('forwardLead signs the raw body and sends the edge secret', async () => {
  const s = await studio(reply(202, { status: 'held', ref: 'b1c2d3e4-0000-4000-8000-000000000001' }));
  try {
    const l = lead(), t0 = Date.now();
    const r = await forwardLead(l, envFor(s.url));
    assert.deepEqual(r, { status: 'held', ref: 'b1c2d3e4-0000-4000-8000-000000000001' });
    assert.equal(s.seen.length, 1);
    const [q] = s.seen;
    assert.equal(q.method, 'POST');
    assert.equal(q.url, '/api/leads/ingest');
    assert.equal(q.headers['content-type'], 'application/json');
    assert.equal(q.headers['x-studio-edge'], 'test-edge-secret');
    const ts = q.headers['x-lead-timestamp'];
    assert.match(ts, /^\d{13}$/);
    assert.ok(Math.abs(Number(ts) - t0) < 5000);
    assert.equal(q.headers['x-lead-signature'], 'v1=' + createHmac('sha256', 'test-ingest-secret').update(`${ts}.${q.raw}`).digest('hex'));
    assert.equal(signature('test-ingest-secret', ts, q.raw), q.headers['x-lead-signature']);
    assert.notEqual(signature('test-ingest-secret', ts, q.raw + ' '), q.headers['x-lead-signature']);
    assert.deepEqual(JSON.parse(q.raw), l);
    assert.ok(Buffer.byteLength(q.raw) <= MAX_BODY);
    // the secrets travel only in their headers, never in the body
    assert.ok(!q.raw.includes('test-ingest-secret') && !q.raw.includes('test-edge-secret'));
  } finally { s.close(); }
});

test('forwardLead leaves x-studio-edge out when STUDIO_EDGE_SECRET_PROD is unset', async () => {
  const s = await studio(reply(202, { status: 'queued', ref: 'r-1' }));
  try {
    assert.deepEqual(await forwardLead(lead(), envFor(s.url, { STUDIO_EDGE_SECRET_PROD: '' })), { status: 'queued', ref: 'r-1' });
    assert.equal(s.seen[0].headers['x-studio-edge'], undefined);
  } finally { s.close(); }
});

test('x-studio-edge goes only to the production studio host or this machine, and only from Production', async () => {
  const u = h => new URL(`https://${h}/api/leads/ingest`);
  assert.deepEqual([...EDGE_HOSTS], ['bargainhub-studio.fly.dev']);
  assert.equal(edgeAllowed(u('bargainhub-studio.fly.dev'), {}), true);
  assert.equal(edgeAllowed(u('bargainhub-studio.fly.dev'), { VERCEL_ENV: 'production' }), true);
  assert.equal(edgeAllowed(new URL('http://127.0.0.1:1/x'), {}), true);
  for (const [target, env] of [
    [u('bargainhub-studio-staging.fly.dev'), {}], [u('studio.example'), { VERCEL_ENV: 'production' }],
    [u('bargainhub-studio.fly.dev.example'), {}], [u('bargainhub-studio.fly.dev'), { VERCEL_ENV: 'preview' }],
    [u('bargainhub-studio.fly.dev'), { VERCEL_ENV: 'development' }], [new URL('http://127.0.0.1:1/x'), { VERCEL_ENV: 'preview' }]
  ]) assert.equal(edgeAllowed(target, env), false, `${target.host} ${env.VERCEL_ENV}`);

  // the forward still goes (the edge gate then refuses it truthfully), but without the secret
  const sent = [];
  const fetchImpl = async (href, init) => { sent.push([href, init.headers]); return new Response('{"error":"forbidden"}', { status: 403 }); };
  for (const env of [envFor('https://bargainhub-studio-staging.fly.dev/api/leads/ingest'), envFor('https://bargainhub-studio.fly.dev/api/leads/ingest', { VERCEL_ENV: 'preview' })]) {
    const r = await forwardLead(lead(), env, { fetchImpl });
    assert.deepEqual(r, { status: 'not_stored', http: 403 });
    assert.equal(emailLine(r, ID), 'CRM: NOT stored (403), enter by hand');
  }
  assert.equal(sent.length, 2);
  for (const [, h] of sent) assert.ok(!('x-studio-edge' in h) && !JSON.stringify(h).includes('test-edge-secret'));
  // the production host from Production does carry it
  const r = await forwardLead(lead(), envFor('https://bargainhub-studio.fly.dev/api/leads/ingest', { VERCEL_ENV: 'production' }), { fetchImpl });
  assert.equal(r.status, 'not_stored');
  assert.equal(sent[2][1]['x-studio-edge'], 'test-edge-secret');
});

test('the email line for queued, held and a duplicate', async () => {
  const cases = [
    [202, { status: 'queued', ref: 'ref-q' }, 'CRM: queued ref-q'],
    [202, { status: 'held', ref: 'ref-h' }, 'CRM: held ref-h'],
    [200, { status: 'duplicate', ref: 'ref-d', state: 'held' }, 'CRM: held ref-d'],
    [200, { status: 'duplicate', ref: 'ref-d', state: 'queued' }, 'CRM: queued ref-d'],
    [200, { status: 'duplicate', ref: 'ref-d' }, 'CRM: already stored ref-d']
  ];
  for (const [status, body, line] of cases) {
    const s = await studio(reply(status, body));
    try { assert.equal(emailLine(await forwardLead(lead(), envFor(s.url)), ID), line); } finally { s.close(); }
  }
});

test('the email line says NOT stored on a 4xx', async () => {
  for (const status of [400, 401, 403, 409, 413, 429]) {
    const s = await studio(reply(status, { error: 'x' }));
    try {
      const r = await forwardLead(lead(), envFor(s.url));
      assert.deepEqual(r, { status: 'not_stored', http: status });
      assert.equal(emailLine(r, ID), `CRM: NOT stored (${status}), enter by hand`);
      assert.equal(s.seen.length, 1, 'no retry');
    } finally { s.close(); }
  }
});

const UNCONFIRMED = `CRM unconfirmed (event ${ID}): check Base44 for this event before entering by hand`;

test('the email line says unconfirmed on a 5xx, once, without a retry', async () => {
  for (const status of [500, 502, 503, 504]) {
    const s = await studio(reply(status, 'oops'));
    try {
      const r = await forwardLead(lead(), envFor(s.url));
      assert.deepEqual(r, { status: 'unconfirmed', reason: 'http_5xx', http: status });
      assert.equal(emailLine(r, ID), UNCONFIRMED);
      assert.equal(s.seen.length, 1, 'no retry');
    } finally { s.close(); }
  }
});

test('the email line says unconfirmed on a network error', async () => {
  const s = await studio(reply(202, {}));
  const url = s.url; s.close();
  const r = await forwardLead(lead(), envFor(url));
  assert.deepEqual(r, { status: 'unconfirmed', reason: 'network' });
  assert.equal(emailLine(r, ID), UNCONFIRMED);
  // a timeout must never read as "not stored"
  assert.ok(!emailLine(r, ID).includes('NOT stored'));
});

test('a 3 second timeout, then unconfirmed (never "not stored")', async () => {
  assert.equal(TIMEOUT_MS, 3000);
  const s = await studio(() => {}); // takes the body, never answers
  try {
    const t0 = Date.now();
    const r = await forwardLead(lead(), envFor(s.url));
    const took = Date.now() - t0;
    assert.deepEqual(r, { status: 'unconfirmed', reason: 'timeout' });
    assert.ok(took >= 2900 && took < 4500, `took ${took} ms`);
    assert.equal(emailLine(r, ID), UNCONFIRMED);
    assert.equal(s.seen.length, 1, 'no retry');
  } finally { s.close(); }
});

test('the timeout also covers an answer whose body never finishes', async () => {
  const s = await studio((req, res) => { res.writeHead(202, { 'Content-Type': 'application/json' }); res.write('{"status":"held",'); });
  try {
    const r = await forwardLead(lead(), envFor(s.url), { timeoutMs: 300 });
    assert.deepEqual(r, { status: 'unconfirmed', reason: 'timeout' });
  } finally { s.close(); }
});

test('an answer that cannot be read is unconfirmed, and nothing odd reaches the email', async () => {
  const bad = [
    [202, 'not json'], [202, { status: 'held' }], [202, { status: 'sent', ref: 'r' }], [202, { status: 'held', ref: 'r\nBcc: x@y.z' }],
    [202, { status: 'held', ref: '<b>x</b>' }], [200, { status: 'held', ref: 'r' }], [201, { status: 'queued', ref: 'r' }], [204, '']
  ];
  for (const [status, body] of bad) {
    const s = await studio(reply(status, body));
    try {
      const r = await forwardLead(lead(), envFor(s.url));
      assert.equal(r.status, 'unconfirmed', JSON.stringify(body));
      assert.equal(emailLine(r, ID), UNCONFIRMED);
    } finally { s.close(); }
  }
});

test('a redirect is never followed, so the signed body and the edge secret go nowhere else', async () => {
  const other = await studio(reply(202, { status: 'held', ref: 'r' }));
  const s = await studio((req, res) => { res.writeHead(307, { Location: other.url }); res.end(); });
  try {
    const r = await forwardLead(lead(), envFor(s.url));
    assert.equal(r.status, 'unconfirmed');
    assert.equal(other.seen.length, 0);
  } finally { s.close(); other.close(); }
});

test('a plain-http ingest URL off this machine, or a broken one, is refused before sending', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('{}'); };
  for (const url of ['http://studio.example/api/leads/ingest', 'ftp://studio.example/x', 'not a url']) {
    const r = await forwardLead(lead(), envFor(url), { fetchImpl });
    assert.deepEqual(r, { status: 'not_stored', http: 'config' });
    assert.equal(emailLine(r, ID), 'CRM: NOT stored (config), enter by hand');
  }
  assert.equal(calls, 0);
});

/* ---------- the handler: forward, then the email, which is primary ---------- */

const FORWARD_ENV = ['STUDIO_INGEST_URL', 'LEADS_INGEST_SECRET', 'STUDIO_EDGE_SECRET_PROD'];
// a stand-in Resend that keeps every email it is given
async function mailbox(status = 200) {
  const mails = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => { mails.push(b); res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(status === 200 ? '{"id":"m-1"}' : '{"message":"down"}'); });
  });
  const port = await listen(srv);
  return { mails, last: () => JSON.parse(mails.at(-1)), url: `http://127.0.0.1:${port}`, close: () => srv.close() };
}
let ip = 0;
async function post(body, env = {}) {
  const mail = await mailbox(env.mailStatus);
  Object.assign(process.env, { RESEND_API_KEY: 'k_test', RESEND_API_URL: mail.url });
  for (const k of FORWARD_ENV) delete process.env[k];
  for (const k of FORWARD_ENV) if (env[k]) process.env[k] = env[k];
  const logs = [], orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...a) => logs.push(a.join(' '));
  const srv = http.createServer((req, res) => handler(req, res));
  const port = await listen(srv);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/enquiry`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.${Math.floor(++ip / 250)}.${ip % 250}` }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json(), mails: mail.mails, mail: mail.mails.length ? mail.last() : null, logs };
  } finally {
    Object.assign(console, orig);
    srv.close(); mail.close();
    for (const k of [...FORWARD_ENV, 'RESEND_API_KEY', 'RESEND_API_URL']) delete process.env[k];
  }
}
const golden = { name: 'Aroha Smith', email: 'aroha@example.co.nz', subject: 'Hanesteel quote', form: 'quote dialog', page: '/hanesteel.html', elapsed: 9000, website: '', marketingOptIn: true, submissionId: ID,
  fields: [['Topic', 'Hanesteel windows and doors'], ['Phone', '021 000 000'], ['Business', 'Smith Builders'], ['Region', 'Canterbury'], ['Message', 'Six windows\nand a door <b>&</b>']] };
const fwd = url => ({ STUDIO_INGEST_URL: url, LEADS_INGEST_SECRET: 'test-ingest-secret', STUDIO_EDGE_SECRET_PROD: 'test-edge-secret' });

test('handler: without the forward settings the email is byte-identical to the one before C1a', async () => {
  const r = await post(golden);
  assert.deepEqual([r.status, r.body], [200, { ok: true }]);
  // sha256 of the Resend request body the handler sent for this enquiry at 7c5c7a6, before C1a
  assert.equal(sha(r.mails[0]), '968940ead5f6c08d4b730eca472631bf3c649c6e31fb212935419360274cb4cc');
  assert.ok(!r.mail.text.includes('CRM'));
});

test('handler: forwards once, then emails with the stored line', async () => {
  const s = await studio(reply(202, { status: 'held', ref: 'b1c2d3e4-0000-4000-8000-000000000001' }));
  try {
    const r = await post(golden, fwd(s.url));
    assert.deepEqual([r.status, r.body], [200, { ok: true }]);
    assert.equal(s.seen.length, 1);
    const sent = JSON.parse(s.seen[0].raw);
    assert.equal(sent.eventId, ID);
    assert.equal(sent.form, 'quote-dialog');
    assert.equal(sent.brand, 'hanesteel');
    assert.equal(sent.marketingOptIn, true);
    assert.equal(r.mails.length, 1);
    assert.ok(r.mail.text.endsWith('\nCRM: held b1c2d3e4-0000-4000-8000-000000000001'));
    assert.ok(r.mail.html.includes('>CRM: held b1c2d3e4-0000-4000-8000-000000000001</p>'));
  } finally { s.close(); }
});

test('handler: every forward failure still sends the email, with a line that tells the truth', async () => {
  const cases = [
    [reply(202, { status: 'queued', ref: 'ref-q' }), 'CRM: queued ref-q'],
    [reply(200, { status: 'duplicate', ref: 'ref-d', state: 'held' }), 'CRM: held ref-d'],
    [reply(400, { error: 'invalid_input' }), 'CRM: NOT stored (400), enter by hand'],
    [reply(401, { error: 'bad_signature' }), 'CRM: NOT stored (401), enter by hand'],
    [reply(429, { error: 'too_many' }), 'CRM: NOT stored (429), enter by hand'],
    [reply(500, 'boom'), UNCONFIRMED],
    [reply(503, 'down'), UNCONFIRMED],
    [(req, res) => req.socket.destroy(), UNCONFIRMED]
  ];
  for (const [answer, line] of cases) {
    const s = await studio(answer);
    try {
      const r = await post(golden, fwd(s.url));
      assert.deepEqual([r.status, r.body], [200, { ok: true }], line);
      assert.equal(r.mails.length, 1);
      assert.equal(r.mail.text.split('\n').at(-1), line);
      assert.equal(s.seen.length, 1, 'no retry');
    } finally { s.close(); }
  }
  // nothing listening at all
  const s = await studio(reply(202, {})); const url = s.url; s.close();
  const r = await post(golden, fwd(url));
  assert.deepEqual([r.status, r.mails.length, r.mail.text.split('\n').at(-1)], [200, 1, UNCONFIRMED]);
});

test('handler: a studio that never answers costs 3 seconds, then the email goes out unconfirmed', async () => {
  const s = await studio(() => {});
  try {
    const t0 = Date.now();
    const r = await post(golden, fwd(s.url));
    const took = Date.now() - t0;
    assert.deepEqual([r.status, r.body], [200, { ok: true }]);
    assert.ok(took >= 2900 && took < 5000, `took ${took} ms`);
    assert.equal(r.mail.text.split('\n').at(-1), UNCONFIRMED);
    assert.ok(!r.mail.text.includes('NOT stored'));
  } finally { s.close(); }
});

test('handler: a missing submissionId gets one made here, and the line names it', async () => {
  const s = await studio(reply(502, 'bad gateway'));
  try {
    const r = await post({ ...golden, submissionId: 'not-a-uuid' }, fwd(s.url));
    const made = JSON.parse(s.seen[0].raw).eventId;
    assert.match(made, UUID);
    assert.equal(r.mail.text.split('\n').at(-1), `CRM unconfirmed (event ${made}): check Base44 for this event before entering by hand`);
  } finally { s.close(); }
});

test('handler: spam, refused and rate-limited enquiries are never forwarded', async () => {
  const s = await studio(reply(202, { status: 'held', ref: 'r' }));
  try {
    for (const body of [{ ...golden, website: 'http://spam.example' }, { ...golden, elapsed: 300 }]) {
      const r = await post(body, fwd(s.url));
      assert.deepEqual([r.status, r.body, r.mails.length], [200, { ok: true }, 0]);
    }
    assert.equal((await post({ ...golden, email: 'nope' }, fwd(s.url))).status, 400);
    assert.equal(s.seen.length, 0);
    // a flood from one address: five go through, the sixth is refused and not forwarded
    const flood = async () => {
      const mail = await mailbox();
      Object.assign(process.env, { RESEND_API_KEY: 'k', RESEND_API_URL: mail.url }, fwd(s.url));
      const srv = http.createServer((req, res) => handler(req, res)); const port = await listen(srv);
      const log = console.log; console.log = () => {};
      try {
        const out = [];
        for (let i = 0; i < 6; i++) out.push((await fetch(`http://127.0.0.1:${port}/api/enquiry`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.200.0.1' }, body: JSON.stringify(golden) })).status);
        return out;
      } finally { console.log = log; srv.close(); mail.close(); for (const k of [...FORWARD_ENV, 'RESEND_API_KEY', 'RESEND_API_URL']) delete process.env[k]; }
    };
    assert.deepEqual(await flood(), [200, 200, 200, 200, 200, 429]);
    assert.equal(s.seen.length, 5);
  } finally { s.close(); }
});

test('handler: when the email fails after a forward, the request fails as before (the visitor falls back to email)', async () => {
  const s = await studio(reply(202, { status: 'held', ref: 'r' }));
  try {
    const r = await post(golden, { ...fwd(s.url), mailStatus: 500 });
    assert.deepEqual([r.status, r.body], [502, { error: 'send_failed' }]);
    assert.equal(s.seen.length, 1);
    // the failure log says the CRM already holds this event, so the fallback email can be matched
    const line = r.logs.find(l => l.startsWith('enquiry send failed:'));
    assert.ok(line && line.endsWith(`(event ${ID}, crm held)`), line);
    for (const pii of ['Aroha', 'aroha@example.co.nz', '021 000 000', 'test-edge-secret']) assert.ok(!r.logs.join('\n').includes(pii), pii);
  } finally { s.close(); }
});

test('handler: logs carry no secrets and no personal details', async () => {
  for (const answer of [reply(202, { status: 'held', ref: 'r' }), reply(401, '{}'), reply(500, '{}'), (req) => req.socket.destroy()]) {
    const s = await studio(answer);
    try {
      const r = await post(golden, fwd(s.url));
      const all = r.logs.join('\n');
      assert.ok(r.logs.length > 0);
      for (const secret of ['test-ingest-secret', 'test-edge-secret', 'k_test', 'Aroha', 'aroha@example.co.nz', '021 000 000', 'Smith Builders', 'Six windows', 'Canterbury']) assert.ok(!all.includes(secret), secret);
    } finally { s.close(); }
  }
});
