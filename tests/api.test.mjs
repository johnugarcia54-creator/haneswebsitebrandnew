/* Tests for the enquiry API: npm test (Node 20+, no extra packages).
   Sends through a stand-in Resend API and a stand-in SMTP server, so nothing leaves this machine. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { validate, compose, send, configured, limited, record, DEFAULT_TO } from '../api/_lib/enquiry.js';
import handler from '../api/enquiry.js';

const good = { name: 'Aroha Smith', email: 'aroha@example.co.nz', subject: 'Hanesteel quote', form: 'test', page: '/hanesteel.html', elapsed: 9000, website: '',
  fields: [['Phone', '021 000 000'], ['Message', 'Six windows\nand a door']] };

test('validate accepts a good enquiry and cleans it', () => {
  const v = validate({ ...good, name: '  Aroha \n Smith ', fields: [...good.fields, ['Email', 'x@y.z'], ['Empty', '  '], ['Bad\u0001label', 'ok']] });
  assert.equal(v.data.name, 'Aroha Smith');
  assert.deepEqual(v.data.fields.map(f => f[0]), ['Phone', 'Message', 'Bad label']);
  assert.equal(v.data.fields[1][1], 'Six windows\nand a door');
});

test('validate rejects missing or bad details', () => {
  assert.equal(validate({ ...good, name: '' }).field, 'name');
  assert.equal(validate({ ...good, email: 'not-an-email' }).field, 'email');
  assert.equal(validate({ ...good, email: 'a@b' }).field, 'email');
  assert.ok(validate(null).error);
  assert.ok(validate({ ...good, fields: [['Message', 'x'.repeat(5000)], ['More', 'x'.repeat(5000)], ['More', 'x'.repeat(5000)], ['More', 'x'.repeat(5000)], ['More', 'x'.repeat(1000)]] }).error);
});

test('validate flags bots', () => {
  assert.equal(validate({ ...good, website: 'http://spam.example' }).spam, true);
  assert.equal(validate({ ...good, elapsed: 300 }).spam, true);
});

test('compose escapes everything the customer typed', () => {
  const m = compose(validate({ ...good, name: '<b>Bob</b>', fields: [['Message', '<script>alert(1)</script>']] }).data);
  assert.ok(!m.html.includes('<script>'));
  assert.ok(m.html.includes('&lt;script&gt;'));
  assert.ok(!m.html.includes('<b>Bob</b>'));
  assert.equal(m.replyTo, 'aroha@example.co.nz');
  assert.match(m.subject, /^Website enquiry: Hanesteel quote/);
  assert.match(compose(validate(good).data).text, /Message:\nSix windows\nand a door/);
});

test('send reports when email is not configured', async () => {
  assert.equal(configured({}), false);
  await assert.rejects(send(compose(validate(good).data), {}), e => e.code === 'NOT_CONFIGURED');
});

const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));

test('send delivers through Resend', async () => {
  let got = null;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => { got = { auth: req.headers.authorization, path: req.url, body: JSON.parse(b) }; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"test-123"}'); });
  });
  const port = await listen(srv);
  try {
    const r = await send(compose(validate(good).data), { RESEND_API_KEY: 'k_test', RESEND_API_URL: `http://127.0.0.1:${port}`, ENQUIRY_FROM: 'Website <web@hanesdistribution.co.nz>' });
    assert.deepEqual(r, { provider: 'resend', id: 'test-123' });
    assert.equal(got.auth, 'Bearer k_test');
    assert.equal(got.path, '/emails');
    assert.deepEqual(got.body.to, [DEFAULT_TO]);
    assert.equal(got.body.reply_to, 'aroha@example.co.nz');
    assert.equal(got.body.from, 'Website <web@hanesdistribution.co.nz>');
    assert.match(got.body.html, /Six windows/);
  } finally { srv.close(); }
});

test('send surfaces a Resend error', async () => {
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(422); res.end('{"message":"bad from"}'); }); });
  const port = await listen(srv);
  try { await assert.rejects(send(compose(validate(good).data), { RESEND_API_KEY: 'k', RESEND_API_URL: `http://127.0.0.1:${port}` }), /422/); }
  finally { srv.close(); }
});

// a minimal SMTP server that accepts one message and hands it back
const smtp = () => {
  let resolve; const message = new Promise(r => resolve = r);
  const srv = net.createServer(sock => {
    let data = false, buf = '', msg = { rcpt: [] };
    sock.write('220 test ESMTP\r\n');
    sock.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) { if (line === '.') { data = false; sock.write('250 OK queued\r\n'); resolve(msg); } else msg.body = (msg.body || '') + line + '\n'; continue; }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') sock.write('250-test\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (cmd === 'HELO') sock.write('250 test\r\n');
        else if (cmd === 'AUTH') { msg.auth = line; sock.write('235 OK\r\n'); }
        else if (cmd === 'MAIL') { msg.from = line; sock.write('250 OK\r\n'); }
        else if (cmd === 'RCPT') { msg.rcpt.push(line); sock.write('250 OK\r\n'); }
        else if (cmd === 'DATA') { data = true; sock.write('354 go\r\n'); }
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      }
    });
  });
  return { srv, message };
};

test('send delivers through SMTP', async () => {
  const { srv, message } = smtp();
  const port = await listen(srv);
  try {
    const r = await send(compose(validate(good).data), { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_SECURE: 'false', SMTP_USER: 'web@hanesdistribution.co.nz', SMTP_PASS: 'pw', ENQUIRY_TO: 'sales@hanesdistribution.co.nz' });
    assert.equal(r.provider, 'smtp');
    const m = await message;
    assert.match(m.rcpt.join(), /sales@hanesdistribution\.co\.nz/);
    assert.match(m.body, /Reply-To: aroha@example\.co\.nz/i);
    assert.match(m.body, /Subject: Website enquiry: Hanesteel quote/);
  } finally { srv.close(); }
});

test('limited allows five sends per address in ten minutes', () => {
  const t = 1e12;
  for (let i = 0; i < 5; i++) { assert.equal(limited('1.2.3.4', t + i), false); record('1.2.3.4', t + i); }
  assert.equal(limited('1.2.3.4', t + 10), true);
  assert.equal(limited('5.6.7.8', t + 10), false);
  assert.equal(limited('1.2.3.4', t + 11 * 60 * 1000), false);
});

/* ---------- The HTTP handler, end to end ---------- */
const call = async (method, body, headers = {}) => {
  const srv = http.createServer((req, res) => handler(req, res));
  const port = await listen(srv);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/enquiry`, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': headers.ip || `10.0.0.${Math.floor(Math.random() * 250)}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  } finally { srv.close(); }
};

test('handler: health check, method, origin and validation', async () => {
  delete process.env.RESEND_API_KEY; delete process.env.SMTP_HOST;
  assert.deepEqual(await call('GET'), { status: 200, body: { ok: true, configured: false } });
  assert.equal((await call('PUT', {})).status, 405);
  assert.equal((await call('POST', good, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('POST', { ...good, email: 'nope' })).status, 400);
  assert.deepEqual(await call('POST', { ...good, website: 'spam' }), { status: 200, body: { ok: true } });
  assert.deepEqual(await call('POST', good), { status: 503, body: { error: 'not_configured' } });
});

test('handler: sends a real enquiry, then slows down a flood', async () => {
  let n = 0;
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { n++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"x"}'); }); });
  const port = await listen(srv);
  process.env.RESEND_API_KEY = 'k'; process.env.RESEND_API_URL = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 5; i++) assert.deepEqual(await call('POST', good, { ip: '9.9.9.9' }), { status: 200, body: { ok: true } });
    assert.equal((await call('POST', good, { ip: '9.9.9.9' })).status, 429);
    assert.equal(n, 5);
  } finally { srv.close(); delete process.env.RESEND_API_KEY; delete process.env.RESEND_API_URL; }
});

test('handler: failed requests do not use up the send allowance, but are capped too (#22)', async () => {
  let n = 0;
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { n++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"x"}'); }); });
  const port = await listen(srv);
  process.env.RESEND_API_KEY = 'k'; process.env.RESEND_API_URL = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 5; i++) assert.equal((await call('POST', { ...good, email: 'nope' }, { ip: '8.8.8.8' })).status, 400);
    assert.deepEqual(await call('POST', good, { ip: '8.8.8.8' }), { status: 200, body: { ok: true } });
    assert.equal(n, 1);
    for (let i = 0; i < 15; i++) assert.equal((await call('POST', { ...good, name: '' }, { ip: '8.8.8.8' })).status, 400);
    assert.equal((await call('POST', good, { ip: '8.8.8.8' })).status, 429);
    assert.equal(n, 1);
  } finally { srv.close(); delete process.env.RESEND_API_KEY; delete process.env.RESEND_API_URL; }
});

test('handler: a parallel burst cannot slip past the send allowance, and a failed send gives its slot back (#22)', async () => {
  let n = 0, ok = false;
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => setTimeout(() => {
    if (!ok) { res.writeHead(500); return res.end('{"message":"down"}'); }
    n++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"x"}');
  }, 30)); });
  const port = await listen(srv);
  process.env.RESEND_API_KEY = 'k'; process.env.RESEND_API_URL = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 5; i++) assert.equal((await call('POST', good, { ip: '6.6.6.6' })).status, 502);
    ok = true;
    const statuses = await Promise.all(Array.from({ length: 12 }, () => call('POST', good, { ip: '6.6.6.6' }).then(r => r.status)));
    assert.equal(statuses.filter(s => s === 200).length, 5);
    assert.equal(statuses.filter(s => s === 429).length, 7);
    assert.equal(n, 5);
  } finally { srv.close(); delete process.env.RESEND_API_KEY; delete process.env.RESEND_API_URL; }
});
