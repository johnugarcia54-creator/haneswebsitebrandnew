/* The sign-in pages (stream W2; ADDENDUM §2.2, §3.3, §4.3, §6.3, §10.2 and §12.2).
   auth/auth-lib.js is imported as it is served; supabase-js and our server are stubs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as lib from '../auth/auth-lib.js';
import { AUTH_CONFIG, pickConfig, SUPABASE_URL, PRODUCTION_HOSTS } from '../auth/config.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = f => readFileSync(root + f, 'utf8');
const ORIGIN = 'https://hanes-the-website-new.vercel.app';
const safe = n => lib.safeNext(n, ORIGIN);

/* ---------- safeNext (§2.2, MF-11) ---------- */
test('safeNext keeps paths into the studio and the sign-in pages of this site', () => {
  for (const [n, want] of [
    ['/studio/#/account', '/studio/#/account'],
    ['/studio/#/backoffice', '/studio/#/backoffice'],
    ['/studio/consultant.html', '/studio/consultant.html'],
    ['/studio/#/open?project=p-123', '/studio/#/open?project=p-123'],
    ['/studio/?x=1#/book', '/studio/?x=1#/book'],
    ['/auth/update-password.html?invite=1', '/auth/update-password.html?invite=1'],
    ['/studio/%23/backoffice', '/studio/%23/backoffice']
  ]) assert.equal(safe(n), want, n);
});

test('safeNext refuses every open-redirect and script trick (§12.2)', () => {
  const bad = [
    '//evil.example', '//evil.example/studio/', '/\\evil.example', '/studio/\\evil', '\\\\evil.example',
    'https://evil.example/studio/', 'https:evil.example', 'http://hanes-the-website-new.vercel.app/studio/', `${ORIGIN}/studio/`,
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,x', 'vbscript:x',
    '/studio/%2e%2e/evil', '/studio/%2E%2E/evil', '/studio/.%2e/x', '/%2e%2e/studio/', '/studio/../', '/studio/../index.html',
    '/studio/./x', '/auth/..', '/studio/x/../../evil',
    '/studio/%2f%2fevil.example', '/studio/%2F', '/studio/%5cevil', '/studio/%5C', '/studio/%252e%252e/',
    '/studio/\u0000', '/studio/\n//evil', '/studio/\r', '/studio/\t', '/studio/\u007f', '/studio/\u2028', '/studio/ x',
    '/studio/%0a', '/studio/%0D%0ALocation:x', '/studio/%00', '/studio/%7f', '/studio/%20',
    '/studio/' + 'a'.repeat(300 - 8 + 1),
    '/', '/index.html', '/bargainhub.html', '/api/session', '/studiox/', '/studio', '/auth', 'studio/', '?next=/studio/',
    '', null, undefined, 42, {}, ['/studio/']
  ];
  for (const n of bad) assert.equal(safe(n), null, JSON.stringify(n));
  // exactly 300 characters is still fine; 301 is not
  assert.equal(safe('/studio/' + 'a'.repeat(292)), '/studio/' + 'a'.repeat(292));
  assert.equal(safe('/studio/' + 'a'.repeat(293)), null);
  // no origin to compare with: nothing passes
  assert.equal(lib.safeNext('/studio/', ''), null);
  assert.equal(lib.safeNext('/studio/', undefined), null);
});

test('safeNext compares against the page origin, so a next can never leave it', () => {
  assert.equal(lib.safeNext('/studio/#/account', 'http://localhost:3000'), '/studio/#/account');
  assert.equal(lib.safeNext('/studio/@evil.example', ORIGIN), '/studio/@evil.example'); // a path, not a host
});

/* ---------- landingFor (§2.2) ---------- */
test('landingFor: the Friday landing for each level, the studio for anything else', () => {
  assert.equal(lib.landingFor({ level: 'client' }), '/studio/#/account');
  assert.equal(lib.landingFor({ level: 'consultant' }), '/studio/consultant.html');
  assert.equal(lib.landingFor({ level: 'backoffice' }), '/studio/#/backoffice');
  assert.equal(lib.landingFor({ level: 'admin' }), '/studio/#/backoffice');
  for (const s of [{ level: 'visitor' }, { level: 'constructor' }, { level: '__proto__' }, { level: 7 }, {}, null, undefined, 'client'])
    assert.equal(lib.landingFor(s), '/studio/', JSON.stringify(s));
});

test('destination: a safe next wins, then the next one, else the landing', () => {
  globalThis.location = { origin: ORIGIN };
  try {
    assert.equal(lib.destination({ level: 'client' }, '//evil', '/studio/#/book'), '/studio/#/book');
    assert.equal(lib.destination({ level: 'admin' }, null, 'https://evil.example'), '/studio/#/backoffice');
    assert.equal(lib.destination({ level: 'consultant' }), '/studio/consultant.html');
  } finally { delete globalThis.location; }
});

/* ---------- messageFor: every error code of §4.3 ---------- */
const EXCHANGE_CODES = ['invalid_input', 'privacy_ack_required', 'invalid_token', 'session_ended', 'email_unconfirmed', 'reauth_required',
  'cross_origin', 'origin_required', 'not_allowed_here', 'signup_closed', 'account_disabled', 'invitation_needs_link',
  'link_requires_invitation', 'rate_limited', 'auth_unavailable', 'auth_settings_unsafe'];

test('messageFor has its own message for every error code of §4.3, with the wording the addendum fixes', () => {
  for (const c of EXCHANGE_CODES) {
    assert.ok(Object.hasOwn(lib.MESSAGES, c), c);
    assert.notEqual(lib.messageFor(c), lib.MESSAGES.unexpected, c);
    assert.match(lib.messageFor(c), /^[A-Z“].*[.]$/, `${c}: a sentence`);
  }
  assert.equal(lib.messageFor('signup_closed'), 'Your account is confirmed. Accounts open soon.');
  assert.equal(lib.messageFor('link_requires_invitation'), 'This email belongs to a staff account. Use the invitation we sent, or ask Back Office.');
  assert.equal(lib.messageFor('account_disabled'), 'This account is disabled. Contact us.');
  assert.equal(lib.messageFor('invitation_needs_link'), 'This invitation link has expired or was already used. Ask for a new one.');
  assert.match(lib.messageFor('privacy_ack_required'), /privacy statement/);
  assert.match(lib.messageFor('reauth_required'), /sign in again/);
  for (const c of ['auth_unavailable', 'network', 'unavailable']) assert.equal(lib.messageFor(c), "You're signed in, but the studio is unavailable for a moment.");
  assert.equal(lib.MESSAGES.bad_credentials, "That email and password don't match, or the account isn't confirmed yet.");
  assert.equal(lib.MESSAGES.accounts_closed, "Accounts open soon. Send us an enquiry and we'll set you up, or ask your consultant for an invitation.");
  assert.equal(lib.MESSAGES.reset_sent, "If that email has an account, we've sent a link.");
  assert.equal(lib.MESSAGES.signup_sent, 'Check your email to confirm your account.');
});

test('messageFor: unknown codes, prototype names and non-strings get the general message', () => {
  for (const c of ['nope', 'constructor', 'toString', '__proto__', '', null, undefined, 5]) assert.equal(lib.messageFor(c), lib.MESSAGES.unexpected);
});

test('no message reveals whether an account exists', () => {
  for (const [k, m] of Object.entries(lib.MESSAGES)) {
    if (k === 'link_requires_invitation') continue; // only after a successful sign-in with that account's own password
    assert.doesNotMatch(m, /\b(no account|not registered|already registered|already exists|unknown email|doesn't exist|does not exist)\b/i, k);
  }
});

/* ---------- rememberChoice (§3.3.4) ---------- */
function storage(init = {}, { throws = false } = {}) {
  const m = new Map(Object.entries(init));
  const s = {
    get length() { if (throws) throw new Error('SecurityError'); return m.size; },
    key: i => [...m.keys()][i] ?? null,
    getItem: k => { if (throws) throw new Error('SecurityError'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (throws) throw new Error('SecurityError'); m.set(k, String(v)); },
    removeItem: k => { if (throws) throw new Error('SecurityError'); m.delete(k); },
    dump: () => Object.fromEntries(m)
  };
  return s;
}
function win({ store = storage(), cookie = '', fetch } = {}) {
  const writes = [];
  const document = { get cookie() { return cookie; }, set cookie(v) { writes.push(v); } };
  const calls = [];
  return { localStorage: store, document, writes, calls, fetch: fetch || ((u, o) => { calls.push([u, o]); return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: { id: 'u' }, csrfToken: 'c' }) }); }) };
}

test('rememberChoice: ticked keeps bh_remember and drops bh_live; unticked sets the session cookie and drops bh_remember', () => {
  let w = win({ store: storage({ x: '1' }) });
  assert.equal(lib.rememberChoice(true, w), 'remember');
  assert.deepEqual(w.localStorage.dump(), { x: '1', bh_remember: '1' });
  assert.deepEqual(w.writes, ['bh_live=; Path=/; SameSite=Strict; Secure; Max-Age=0']);
  w = win({ store: storage({ bh_remember: '1' }) });
  assert.equal(lib.rememberChoice(false, w), 'session');
  assert.deepEqual(w.localStorage.dump(), {});
  assert.deepEqual(w.writes, ['bh_live=1; Path=/; SameSite=Strict; Secure']);
  assert.doesNotMatch(w.writes[0], /Max-Age|Expires/i, 'a session cookie: gone when the browser closes');
  // blocked storage never throws
  w = win({ store: storage({}, { throws: true }) });
  assert.equal(lib.rememberChoice(false, w), 'session');
  assert.equal(lib.isRemembered(w), false);
});

test('keepChoice (the confirm page): keeps a remembered browser remembered, else this browser session', () => {
  let w = win({ store: storage({ bh_remember: '1' }) });
  lib.keepChoice(w);
  assert.equal(w.localStorage.dump().bh_remember, '1');
  w = win();
  lib.keepChoice(w);
  assert.deepEqual(w.writes, ['bh_live=1; Path=/; SameSite=Strict; Secure']);
});

test('rememberChoice and bhAuthHygiene agree: the marker each choice writes keeps the session on the next page', () => {
  const TOKEN = 'sb-mputtezdhevwwjgwktvi-auth-token';
  // ticked
  let w = win({ store: storage({ [TOKEN]: 't' }) });
  lib.rememberChoice(true, w);
  assert.equal(lib.bhAuthHygiene(w), 'kept');
  // unticked, browser still open: the cookie it wrote is there
  w = win({ store: storage({ [TOKEN]: 't' }) });
  lib.rememberChoice(false, w);
  const live = win({ store: w.localStorage, cookie: w.writes[0].split(';')[0] });
  assert.equal(lib.bhAuthHygiene(live), 'kept');
  // unticked, browser closed: the session cookie is gone, so the token goes
  const closed = win({ store: w.localStorage, cookie: '' });
  assert.equal(lib.bhAuthHygiene(closed), 'cleared');
  assert.deepEqual(closed.localStorage.dump(), {});
});

/* ---------- bhAuthHygiene: the same function as assets/site.js ---------- */
// the contract block, with its common indentation removed (as tests/site.test.mjs reads it)
const hygieneBlock = s => {
  const m = s.match(/\n([ \t]*)\/\/ BEGIN bhAuthHygiene\n([\s\S]*?)\n[ \t]*\/\/ END bhAuthHygiene/);
  if (!m) return null;
  return m[2].split('\n').map(l => (l.startsWith(m[1]) ? l.slice(m[1].length) : l)).join('\n');
};

test('bhAuthHygiene in auth/auth-lib.js is byte-identical to assets/site.js (indentation aside), and the only copy under auth/', () => {
  const site = hygieneBlock(read('assets/site.js')), mine = hygieneBlock(read('auth/auth-lib.js'));
  assert.ok(site && mine);
  assert.equal(mine, site);
  assert.equal(String(lib.bhAuthHygiene), site, 'the exported function is that block');
  for (const f of readdirSync(root + 'auth').filter(f => f.endsWith('.js') && f !== 'auth-lib.js'))
    assert.doesNotMatch(read('auth/' + f), /function bhAuthHygiene/, `${f} imports it instead of copying it`);
});

test('bhAuthHygiene (the auth-lib export) behaves by the §3.3.4 table', async () => {
  const TOKEN = 'sb-mputtezdhevwwjgwktvi-auth-token';
  const cases = [
    [{}, '', 'none', 0], [{ [TOKEN]: 't', bh_remember: '1' }, '', 'kept', 0], [{ [TOKEN]: 't' }, 'bh_live=1', 'kept', 0],
    [{ [TOKEN]: 't' }, '', 'cleared', 2], [{ [TOKEN]: 't' }, 'xbh_live=1; bh_live=10', 'cleared', 2]
  ];
  for (const [init, cookie, want, calls] of cases) {
    const w = win({ store: storage(init), cookie });
    assert.equal(lib.bhAuthHygiene(w), want);
    await new Promise(r => setTimeout(r, 5));
    assert.equal(w.calls.length, calls);
    if (calls) assert.deepEqual([w.calls[0][0], w.calls[1][0], w.calls[1][1].headers['X-CSRF-Token']], ['/api/session', '/api/auth/logout', 'c']);
  }
  assert.equal(lib.bhAuthHygiene(win({ store: storage({}, { throws: true }) })), 'unavailable');
});

/* ---------- exchange (§4.3; credentials same-origin, JSON, 10 s timeout) ---------- */
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: () => (body === undefined ? Promise.reject(new Error('not json')) : Promise.resolve(body)) });

test('exchange: POST /api/auth/exchange, same-origin credentials, JSON body with only the known keys', async () => {
  const calls = [];
  const fetch = (u, o) => { calls.push([u, o]); return Promise.resolve(res(200, { user: { id: 'u1' }, csrfToken: 'c', level: 'client' })); };
  const r = await lib.exchange('tok', { purpose: 'invite', privacyNoticeVersion: '2026-10-09', revokeOthers: true, role: 'admin', accessToken: 'other' }, { fetch });
  assert.deepEqual(r, { ok: true, status: 200, session: { user: { id: 'u1' }, csrfToken: 'c', level: 'client' } });
  const [url, o] = calls[0];
  assert.equal(url, '/api/auth/exchange');
  assert.equal(o.method, 'POST');
  assert.equal(o.credentials, 'same-origin');
  assert.equal(o.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(o.body), { accessToken: 'tok', purpose: 'invite', revokeOthers: true, privacyNoticeVersion: '2026-10-09' });
  assert.ok(o.signal, 'abortable');
  assert.doesNotMatch(url, /tok/, 'the token never travels in the URL');
});

test('exchange: every §4.3 error code comes back as it was sent; 5xx, 408, 429, bad JSON and no answer are retryable', async () => {
  for (const [status, code] of [[400, 'invalid_input'], [400, 'privacy_ack_required'], [401, 'invalid_token'], [401, 'session_ended'], [401, 'email_unconfirmed'],
    [401, 'reauth_required'], [403, 'cross_origin'], [403, 'origin_required'], [403, 'not_allowed_here'], [403, 'signup_closed'], [403, 'account_disabled'],
    [409, 'invitation_needs_link'], [409, 'link_requires_invitation'], [429, 'rate_limited'], [503, 'auth_unavailable'], [503, 'auth_settings_unsafe']]) {
    const r = await lib.exchange('t', {}, { fetch: () => Promise.resolve(res(status, { error: { code, message: 'x' } })) });
    assert.deepEqual(r, { ok: false, status, code });
    assert.equal(lib.retryable(r), status >= 500 || status === 429, code);
  }
  let r = await lib.exchange('t', {}, { fetch: () => Promise.resolve(res(502, undefined)) });
  assert.deepEqual(r, { ok: false, status: 502, code: 'unavailable' });
  assert.ok(lib.retryable(r));
  r = await lib.exchange('t', {}, { fetch: () => Promise.resolve(res(408, undefined)) });
  assert.ok(lib.retryable(r), 'a 408 is the studio timing out, not a refusal');
  r = await lib.exchange('t', {}, { fetch: () => Promise.resolve(res(404, undefined)) });
  assert.deepEqual(r, { ok: false, status: 404, code: 'unexpected' });
  assert.ok(!lib.retryable(r));
  r = await lib.exchange('t', {}, { fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
  assert.deepEqual(r, { ok: false, status: 0, code: 'network' });
  assert.ok(lib.retryable(r));
  r = await lib.exchange('t', {}, { fetch: () => Promise.resolve(res(200, { user: null })) });
  assert.ok(!r.ok && lib.retryable(r), 'a 200 without a user is not a sign-in');
  r = await lib.exchange('', {}, { fetch: () => assert.fail('no call without a token') });
  assert.equal(r.code, 'invalid_token');
});

test('exchange gives up after the timeout (10 s by default)', async () => {
  assert.equal(lib.EXCHANGE_TIMEOUT_MS, 10000);
  const fetch = (u, o) => new Promise((_, reject) => o.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const t0 = Date.now();
  const r = await lib.exchange('t', {}, { fetch, timeoutMs: 40 });
  assert.deepEqual(r, { ok: false, status: 0, code: 'network' });
  assert.ok(Date.now() - t0 < 1000);
});

/* ---------- a stubbed supabase-js that records every call in one log with our server's ---------- */
function stub({ verify = 'ok', signIn = 'ok', update = 'ok', exchangeAnswers = [], signUp = 'ok', reset = 'ok', resend = 'ok', signedIn = false } = {}) {
  const log = [];
  let session = signedIn ? { access_token: 'otp-token' } : null;
  const err = code => ({ name: 'AuthApiError', status: code === 'network' ? 0 : 400, code: code === 'network' ? undefined : code, message: code });
  const supabase = {
    auth: {
      verifyOtp: async a => { log.push(['verifyOtp', a]); if (verify !== 'ok') return { data: { session: null, user: null }, error: err(verify) }; session = { access_token: 'otp-token' }; return { data: { session, user: { id: 's' } }, error: null }; },
      signInWithPassword: async a => { log.push(['signInWithPassword', a]); if (signIn !== 'ok') return { data: {}, error: err(signIn) }; session = { access_token: 'pw-token' }; return { data: { session }, error: null }; },
      updateUser: async a => { log.push(['updateUser', a]); return update === 'ok' ? { data: { user: {} }, error: null } : { data: {}, error: err(update) }; },
      getSession: async () => { log.push(['getSession']); return { data: { session }, error: null }; },
      signOut: async a => { log.push(['signOut', a]); session = null; return { error: null }; },
      signUp: async a => { log.push(['signUp', a]); return signUp === 'ok' ? { data: {}, error: null } : { data: {}, error: err(signUp) }; },
      resetPasswordForEmail: async (e, o) => { log.push(['resetPasswordForEmail', e, o]); return reset === 'ok' ? { data: {}, error: null } : { data: {}, error: err(reset) }; },
      resend: async a => { log.push(['resend', a]); return resend === 'ok' ? { data: {}, error: null } : { data: {}, error: err(resend) }; }
    }
  };
  const answers = [...exchangeAnswers];
  const exchange = async (token, extra) => {
    log.push(['exchange', token, extra]);
    const a = answers.length ? answers.shift() : { ok: true, status: 200, session: { user: { id: 'u' }, level: 'client' } };
    return a;
  };
  const marks = [];
  const deps = { supabase, exchange, w: {}, keepChoice: () => { log.push(['keepChoice']); marks.push('keep'); }, rememberChoice: r => { log.push(['rememberChoice', r]); } };
  return { log, deps, names: () => log.map(e => e[0]) };
}
const fail = (status, code) => ({ ok: false, status, code });

test('confirm, type=invite: verifyOtp, then the invite exchange at once, then update-password (§3.3.2)', async () => {
  const s = stub();
  const out = await lib.confirmFlow({ type: 'invite', tokenHash: 'abc123def456', privacyAck: true }, s.deps);
  assert.deepEqual(out, { action: 'go', to: '/auth/update-password.html?invite=1' });
  assert.deepEqual(s.names(), ['keepChoice', 'verifyOtp', 'getSession', 'exchange']);
  assert.deepEqual(s.log[1][1], { token_hash: 'abc123def456', type: 'invite' });
  assert.deepEqual(s.log[3], ['exchange', 'otp-token', { purpose: 'invite', privacyNoticeVersion: '2026-10-09' }]);
});

test('confirm, type=invite: no privacy tick means no token is used at all', async () => {
  const s = stub();
  const out = await lib.confirmFlow({ type: 'invite', tokenHash: 'abc123def456', privacyAck: false }, s.deps);
  assert.equal(out.code, 'privacy_ack_required');
  assert.deepEqual(s.log, []);
});

test('confirm, type=invite: 409 invitation_needs_link says so and ends the Supabase session here', async () => {
  const s = stub({ exchangeAnswers: [fail(409, 'invitation_needs_link')] });
  const out = await lib.confirmFlow({ type: 'invite', tokenHash: 'abc123def456', privacyAck: true }, s.deps);
  assert.deepEqual(out, { action: 'error', code: 'invitation_needs_link', message: 'This invitation link has expired or was already used. Ask for a new one.' });
  assert.deepEqual(s.names(), ['keepChoice', 'verifyOtp', 'getSession', 'exchange', 'signOut']);
  assert.deepEqual(s.log.at(-1)[1], { scope: 'local' });
});

test('confirm, type=invite: studio down gives Retry, which repeats only the exchange', async () => {
  const s = stub({ exchangeAnswers: [fail(0, 'network')] });
  const out = await lib.confirmFlow({ type: 'invite', tokenHash: 'abc123def456', privacyAck: true }, s.deps);
  assert.equal(out.message, "You're signed in, but the studio is unavailable for a moment.");
  assert.equal(typeof out.retry, 'function');
  const again = await out.retry();
  assert.deepEqual(again, { action: 'go', to: '/auth/update-password.html?invite=1' });
  assert.deepEqual(s.names(), ['keepChoice', 'verifyOtp', 'getSession', 'exchange', 'getSession', 'exchange']);
});

test('confirm, type=recovery: verifyOtp, then update-password, and no exchange until the password is set', async () => {
  const s = stub();
  const out = await lib.confirmFlow({ type: 'recovery', tokenHash: 'abc123def456' }, s.deps);
  assert.deepEqual(out, { action: 'go', to: '/auth/update-password.html' });
  assert.deepEqual(s.names(), ['keepChoice', 'verifyOtp']);
});

test('confirm, type=email and email_change: verifyOtp, then the plain exchange, then next or the landing', async () => {
  globalThis.location = { origin: ORIGIN };
  try {
    for (const type of ['email', 'email_change']) {
      let s = stub({ exchangeAnswers: [{ ok: true, status: 200, session: { user: {}, level: 'consultant' } }] });
      let out = await lib.confirmFlow({ type, tokenHash: 'abc123def456', next: [null] }, s.deps);
      assert.deepEqual(out, { action: 'go', to: '/studio/consultant.html' });
      assert.deepEqual(s.names(), ['keepChoice', 'verifyOtp', 'getSession', 'exchange']);
      assert.deepEqual(s.log[3][2], {});
      s = stub();
      out = await lib.confirmFlow({ type, tokenHash: 'abc123def456', next: ['/studio/#/account'] }, s.deps);
      assert.deepEqual(out, { action: 'go', to: '/studio/#/account' });
      s = stub();
      out = await lib.confirmFlow({ type, tokenHash: 'abc123def456', next: ['//evil.example'] }, s.deps);
      assert.deepEqual(out, { action: 'go', to: '/studio/#/account' }, 'an unsafe next falls back to the landing');
    }
  } finally { delete globalThis.location; }
});

test('confirm: a bad link or an unknown type never calls Supabase; an expired token says so', async () => {
  for (const [type, tokenHash] of [['magiclink', 'abc123def456'], ['signup', 'abc123def456'], ['', 'abc123def456'], ['email', ''], ['email', null], ['email', 'a b<c>'], ['email', 'x'.repeat(600)]]) {
    const s = stub();
    const out = await lib.confirmFlow({ type, tokenHash, privacyAck: true }, s.deps);
    assert.equal(out.code, 'link_incomplete', `${type}/${tokenHash}`);
    assert.deepEqual(s.log, []);
  }
  const s = stub({ verify: 'otp_expired' });
  const out = await lib.confirmFlow({ type: 'email', tokenHash: 'abc123def456' }, s.deps);
  assert.equal(out.message, 'This link has expired or was already used. Ask for a new one.');
  assert.deepEqual(s.names(), ['keepChoice', 'verifyOtp'], 'no exchange without a verified session');
});

test('update-password: updateUser first, then the exchange with revokeOthers:true (§3.3.2a, §3.3.5)', async () => {
  for (const invite of [true, false]) {
    const s = stub({ signedIn: true, exchangeAnswers: [{ ok: true, status: 200, session: { user: {}, level: 'backoffice' } }] });
    const out = await lib.passwordFlow({ password: 'correct horse battery', confirm: 'correct horse battery', invite }, s.deps);
    assert.deepEqual(out, { action: 'done', to: '/studio/#/backoffice', message: invite ? "Password set. You're signed in on this device only." : "Password changed. You're signed in on this device only." });
    assert.deepEqual(s.names(), ['updateUser', 'getSession', 'exchange']);
    assert.deepEqual(s.log[0][1], { password: 'correct horse battery' });
    assert.deepEqual(s.log[2].slice(1), ['otp-token', { revokeOthers: true }]);
  }
});

test('update-password: 401 reauth_required ends the session here and goes to sign in', async () => {
  const s = stub({ signedIn: true, exchangeAnswers: [fail(401, 'reauth_required')] });
  const out = await lib.passwordFlow({ password: 'a-long-enough-password' }, s.deps);
  assert.deepEqual(out, { action: 'go', to: '/auth/login.html?reason=reauth', code: 'reauth_required' });
  assert.deepEqual(s.names(), ['updateUser', 'getSession', 'exchange', 'signOut']);
});

test('update-password: checks the length (12 to 72) and the repeat before calling Supabase; weak passwords explained', async () => {
  for (const [password, confirm, code] of [['short', 'short', 'password_length'], ['x'.repeat(73), 'x'.repeat(73), 'password_length'], ['twelve chars', 'twelve charz', 'passwords_differ']]) {
    const s = stub();
    const out = await lib.passwordFlow({ password, confirm }, s.deps);
    assert.equal(out.code, code);
    assert.deepEqual(s.log, []);
  }
  const s = stub({ update: 'weak_password' });
  const out = await lib.passwordFlow({ password: 'password1234' }, s.deps);
  assert.equal(out.message, lib.MESSAGES.weak_password);
  assert.deepEqual(s.names(), ['updateUser'], 'no exchange when the password was not set');
});

test('sign-in: the remember choice, then signInWithPassword with Turnstile, then the exchange, then next or the landing', async () => {
  globalThis.location = { origin: ORIGIN };
  try {
    let s = stub({ exchangeAnswers: [{ ok: true, status: 200, session: { user: {}, level: 'admin' } }] });
    let out = await lib.loginFlow({ email: 'a@b.co', password: 'pw', remember: false, captchaToken: 'ts-1', next: ['/studio/#/backoffice'] }, s.deps);
    assert.deepEqual(out, { action: 'go', to: '/studio/#/backoffice' });
    assert.deepEqual(s.names(), ['rememberChoice', 'signInWithPassword', 'getSession', 'exchange']);
    assert.deepEqual(s.log[1][1], { email: 'a@b.co', password: 'pw', options: { captchaToken: 'ts-1' } });
    assert.deepEqual(s.log[3][2], {});
    s = stub();
    out = await lib.loginFlow({ email: 'a@b.co', password: 'pw', remember: true, captchaToken: 'ts-1', next: ['javascript:alert(1)'] }, s.deps);
    assert.deepEqual(out, { action: 'go', to: '/studio/#/account' });
    assert.deepEqual(s.log[0], ['rememberChoice', true]);
  } finally { delete globalThis.location; }
});

test('sign-in: one message for a wrong password, an unknown email and an unconfirmed account, with Resend offered', async () => {
  for (const code of ['invalid_credentials', 'email_not_confirmed', 'user_not_found', 'user_banned']) {
    const s = stub({ signIn: code });
    const out = await lib.loginFlow({ email: 'a@b.co', password: 'pw', captchaToken: 't' }, s.deps);
    assert.equal(out.message, "That email and password don't match, or the account isn't confirmed yet.", code);
    assert.equal(out.resend, true);
    assert.ok(!s.names().includes('exchange'));
  }
  let s = stub({ signIn: 'captcha_failed' });
  assert.equal((await lib.loginFlow({ email: 'a@b.co', password: 'pw', captchaToken: 't' }, s.deps)).message, lib.MESSAGES.captcha_failed);
  s = stub();
  const out = await lib.loginFlow({ email: 'a@b.co', password: 'pw', captchaToken: '' }, s.deps);
  assert.equal(out.code, 'captcha_needed');
  assert.deepEqual(s.log, [], 'no Supabase call without a Turnstile token');
});

test('sign-in: exchange refusals use the §3.3.3 wording and end the Supabase session; studio down offers Retry', async () => {
  for (const [status, code, msg] of [[403, 'signup_closed', 'Your account is confirmed. Accounts open soon.'],
    [409, 'link_requires_invitation', 'This email belongs to a staff account. Use the invitation we sent, or ask Back Office.'],
    [403, 'account_disabled', 'This account is disabled. Contact us.']]) {
    const s = stub({ exchangeAnswers: [fail(status, code)] });
    const out = await lib.loginFlow({ email: 'a@b.co', password: 'pw', captchaToken: 't' }, s.deps);
    assert.deepEqual(out, { action: 'error', code, message: msg });
    assert.equal(s.names().at(-1), 'signOut');
  }
  for (const r of [fail(0, 'network'), fail(503, 'auth_unavailable'), fail(500, 'unavailable'), fail(408, 'unavailable'), fail(429, 'rate_limited')]) {
    const s = stub({ exchangeAnswers: [r] });
    const out = await lib.loginFlow({ email: 'a@b.co', password: 'pw', captchaToken: 't' }, s.deps);
    assert.equal(out.message, r.status === 429 ? lib.MESSAGES.rate_limited : "You're signed in, but the studio is unavailable for a moment.");
    assert.equal(typeof out.retry, 'function');
    assert.ok(!s.names().includes('signOut'), 'kept signed in to Supabase so Retry can work');
    assert.equal((await out.retry()).action, 'go');
  }
});

test('Turnstile goes with every Supabase call that accepts it: sign-up, sign-in, resend and reset', async () => {
  const origin = ORIGIN;
  let s = stub();
  let out = await lib.signupFlow({ name: ' Aroha ', email: 'a@b.co', password: 'twelve chars!', code: 'SARAH-7K2Q', privacyAck: true, marketing: false, captchaToken: 'ts', origin }, s.deps);
  assert.deepEqual(out, { action: 'done', message: 'Check your email to confirm your account.' });
  assert.deepEqual(s.log[0][1], { email: 'a@b.co', password: 'twelve chars!', options: { emailRedirectTo: origin + '/auth/confirm.html', captchaToken: 'ts',
    data: { name: 'Aroha', signup_code: 'SARAH-7K2Q', privacy_notice_version: '2026-10-09', marketing_opt_in: false } } });
  s = stub();
  out = await lib.resetFlow({ email: 'a@b.co', captchaToken: 'ts', origin }, s.deps);
  assert.deepEqual(out, { action: 'done', message: "If that email has an account, we've sent a link." });
  assert.deepEqual(s.log[0], ['resetPasswordForEmail', 'a@b.co', { redirectTo: origin + '/auth/confirm.html', captchaToken: 'ts' }]);
  s = stub();
  out = await lib.resendFlow({ email: 'a@b.co', captchaToken: 'ts', origin }, s.deps);
  assert.equal(out.action, 'done');
  assert.deepEqual(s.log[0][1], { type: 'signup', email: 'a@b.co', options: { captchaToken: 'ts', emailRedirectTo: origin + '/auth/confirm.html' } });
  for (const f of ['signupFlow', 'resetFlow', 'resendFlow']) {
    s = stub();
    out = await lib[f]({ name: 'A', email: 'a@b.co', password: 'twelve chars!', privacyAck: true, captchaToken: '', origin }, s.deps);
    assert.equal(out.code, 'captcha_needed', f);
    assert.deepEqual(s.log, [], `${f}: nothing sent without a token`);
  }
});

test('sign-up and reset answer the same whether or not the account exists', async () => {
  for (const code of ['user_already_exists', 'email_exists']) {
    const s = stub({ signUp: code });
    const out = await lib.signupFlow({ name: 'A', email: 'a@b.co', password: 'twelve chars!', privacyAck: true, captchaToken: 't', origin: ORIGIN }, s.deps);
    assert.deepEqual(out, { action: 'done', message: 'Check your email to confirm your account.' });
  }
  for (const code of ['user_not_found', 'email_address_invalid', 'unexpected_failure']) {
    const s = stub({ reset: code });
    assert.equal((await lib.resetFlow({ email: 'a@b.co', captchaToken: 't', origin: ORIGIN }, s.deps)).message, "If that email has an account, we've sent a link.");
  }
});

test('the per-email send limit (sent only for an email with an account) gets the uniform answer in reset, resend and sign-up', async () => {
  const code = 'over_email_send_rate_limit';
  let out = await lib.resetFlow({ email: 'a@b.co', captchaToken: 't', origin: ORIGIN }, stub({ reset: code }).deps);
  assert.deepEqual(out, { action: 'done', message: "If that email has an account, we've sent a link." });
  out = await lib.resendFlow({ email: 'a@b.co', captchaToken: 't', origin: ORIGIN }, stub({ resend: code }).deps);
  assert.deepEqual(out, { action: 'done', message: "If that email has an account waiting for confirmation, we've sent a new link." });
  assert.deepEqual(out, await lib.resendFlow({ email: 'a@b.co', captchaToken: 't', origin: ORIGIN }, stub().deps), 'resend: the same as success');
  out = await lib.signupFlow({ name: 'A', email: 'a@b.co', password: 'twelve chars!', privacyAck: true, captchaToken: 't', origin: ORIGIN }, stub({ signUp: code }).deps);
  assert.deepEqual(out, { action: 'done', message: 'Check your email to confirm your account.' });
  // answers that do not depend on the account still say what happened
  for (const c of ['over_request_rate_limit', 'too_many_requests']) {
    assert.equal((await lib.resetFlow({ email: 'a@b.co', captchaToken: 't', origin: ORIGIN }, stub({ reset: c }).deps)).message, lib.MESSAGES.rate_limited, c);
    assert.equal((await lib.resendFlow({ email: 'a@b.co', captchaToken: 't', origin: ORIGIN }, stub({ resend: c }).deps)).message, lib.MESSAGES.rate_limited, c);
  }
  assert.equal((await lib.resetFlow({ email: 'a@b.co', captchaToken: 't', origin: ORIGIN }, stub({ reset: 'captcha_failed' }).deps)).action, 'error');
  assert.equal((await lib.resetFlow({ email: 'a@b.co', captchaToken: 't', origin: ORIGIN }, stub({ reset: 'network' }).deps)).action, 'error');
});

test('sign-up checks its fields before anything is sent (name 1-120, email, password 12-72, the privacy tick)', async () => {
  const base = { name: 'Aroha', email: 'a@b.co', password: 'twelve chars!', privacyAck: true, captchaToken: 't', origin: ORIGIN };
  for (const [patch, code] of [[{ name: ' ' }, 'invalid_name'], [{ name: 'x'.repeat(121) }, 'invalid_name'], [{ email: 'nope' }, 'invalid_email'],
    [{ password: 'elevenchars' }, 'password_length'], [{ password: 'x'.repeat(73) }, 'password_length'], [{ privacyAck: false }, 'privacy_ack_required']]) {
    const s = stub();
    assert.equal((await lib.signupFlow({ ...base, ...patch }, s.deps)).code, code, JSON.stringify(patch));
    assert.deepEqual(s.log, []);
  }
  const s = stub();
  await lib.signupFlow({ ...base, code: '<script>' }, s.deps);
  assert.equal(s.log[0][1].options.data.signup_code, null, 'a malformed code is not sent');
});

/* ---------- the public reads ---------- */
test('publicSignupOpen: open only when the studio says publicSignup is true; a failed read means closed', async () => {
  const f = body => () => Promise.resolve(res(200, body));
  assert.equal(await lib.publicSignupOpen({ fetch: f({ settings: { accounts: { publicSignup: true } } }) }), true);
  for (const body of [{ settings: { accounts: { publicSignup: false } } }, { settings: { accounts: { publicSignup: 'true' } } }, { settings: {} }, {}, null])
    assert.equal(await lib.publicSignupOpen({ fetch: f(body) }), false, JSON.stringify(body));
  assert.equal(await lib.publicSignupOpen({ fetch: () => Promise.resolve(res(503, { error: {} })) }), false);
  assert.equal(await lib.publicSignupOpen({ fetch: () => Promise.reject(new Error('offline')) }), false);
  const calls = [];
  await lib.publicSignupOpen({ fetch: (u, o) => { calls.push([u, o]); return Promise.resolve(res(200, {})); } });
  assert.equal(calls[0][0], '/api/settings/public');
  assert.equal(calls[0][1].credentials, 'same-origin');
});

test('previewCode: the §3.3.1 wording, built from data as text', async () => {
  const calls = [];
  const f = body => (u, o) => { calls.push([u, o]); return Promise.resolve(res(200, body)); };
  assert.deepEqual(await lib.previewCode('SARAH-7K2Q', { fetch: f({ valid: true, consultantFirstName: 'Sarah', percentBp: 500 }) }),
    { state: 'valid', message: 'Code recorded: your consultant Sarah will apply your 5% discount on your quote.' });
  assert.equal(calls[0][0], '/api/codes/preview');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { code: 'SARAH-7K2Q' });
  assert.deepEqual(await lib.previewCode('ZZZZ', { fetch: f({ valid: false }) }), { state: 'invalid', message: "We don't recognise that code." });
  assert.deepEqual(await lib.previewCode('ZZZZ', { fetch: () => Promise.reject(new Error('x')) }), { state: 'unknown' });
  assert.equal(await lib.previewCode('', { fetch: () => assert.fail() }), null);
  assert.equal(await lib.previewCode('<b>x</b>', { fetch: () => assert.fail() }), null);
});

/* ---------- config.js ---------- */
test('config.js: production and staging both use our one Supabase project; keys are marked placeholders until the owner sends them', () => {
  assert.equal(SUPABASE_URL, 'https://mputtezdhevwwjgwktvi.supabase.co');
  for (const env of ['production', 'staging']) {
    assert.equal(AUTH_CONFIG[env].supabaseUrl, SUPABASE_URL);
    for (const k of ['publishableKey', 'turnstileSiteKey']) assert.match(AUTH_CONFIG[env][k], /^(PLACEHOLDER_[A-Z_]+|sb_publishable_[A-Za-z0-9_-]+|0x[A-Za-z0-9_-]+)$/, `${env}.${k}`);
  }
  assert.deepEqual([...PRODUCTION_HOSTS], ['hanes-the-website-new.vercel.app']);
  const cfg = read('auth/config.js');
  assert.doesNotMatch(cfg, /sb_secret_|service_role|eyJ[A-Za-z0-9_-]{20,}/, 'never a secret key or a JWT');
});

test('pickConfig: chosen by host; placeholders and test keys are never ready on production', () => {
  assert.equal(pickConfig('hanes-the-website-new.vercel.app').name, 'production');
  assert.equal(pickConfig('HANES-THE-WEBSITE-NEW.VERCEL.APP').name, 'production');
  for (const h of ['hanes-the-website-new-git-staging-x.vercel.app', 'localhost:3000', 'evil.example', '', undefined]) assert.equal(pickConfig(h).name, 'staging', String(h));
  const p = pickConfig('hanes-the-website-new.vercel.app');
  if (/PLACEHOLDER/.test(AUTH_CONFIG.production.publishableKey)) assert.equal(p.supabaseReady, false);
  const fake = (pk, ts) => ({ production: { supabaseUrl: SUPABASE_URL, publishableKey: pk, turnstileSiteKey: ts }, staging: { supabaseUrl: SUPABASE_URL, publishableKey: pk, turnstileSiteKey: ts } });
  const real = fake('sb_publishable_abcdefghijkl', '0x4AAAAAAABBBBBBBB');
  assert.deepEqual([pickConfig('hanes-the-website-new.vercel.app', real).supabaseReady, pickConfig('hanes-the-website-new.vercel.app', real).turnstileReady], [true, true]);
  const testKey = fake('sb_publishable_abcdefghijkl', '1x00000000000000000000AA');
  assert.equal(pickConfig('hanes-the-website-new.vercel.app', testKey).turnstileReady, false, "Cloudflare's always-pass key never on production");
  assert.equal(pickConfig('localhost:3000', testKey).turnstileReady, true);
  assert.equal(pickConfig('x', fake('PLACEHOLDER_SUPABASE_PUBLISHABLE_KEY', 'PLACEHOLDER_TURNSTILE_SITE_KEY')).supabaseReady, false);
  assert.equal(pickConfig('x', fake('sb_secret_abcdefghijkl', '0x4AAAAAAABBBBBBBB')).supabaseReady, false, 'a secret key is refused');
  const otherProject = { staging: { supabaseUrl: 'https://otherproject1.supabase.co', publishableKey: 'sb_publishable_abcdefghijkl', turnstileSiteKey: '0x4AAAAAAABBBBBBBB' } };
  assert.equal(pickConfig('x', otherProject).supabaseReady, false, 'only the project the CSP allows');
});

/* ---------- auth/ has no HTML sinks ---------- */
test('no innerHTML, outerHTML, insertAdjacentHTML or document.write anywhere in auth/', () => {
  for (const f of readdirSync(root + 'auth')) assert.doesNotMatch(read('auth/' + f), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, f);
});


/* ---------- the five pages (§6.3) ---------- */
const PAGES = ['login', 'signup', 'reset', 'confirm', 'update-password'];
const SDK_FILES = readdirSync(root + 'vendor').filter(f => /^supabase-js-\d+\.\d+\.\d+\.min\.js$/.test(f));

test('exactly one vendored supabase-js build, its licence names that version, and auth.js loads it only when needed', () => {
  assert.equal(SDK_FILES.length, 1, SDK_FILES.join());
  const version = SDK_FILES[0].match(/(\d+\.\d+\.\d+)/)[1];
  const licence = read('vendor/supabase-js-LICENSE.txt');
  assert.match(licence, new RegExp(`@supabase/supabase-js ${version.replaceAll('.', '\\.')}`));
  assert.match(licence, /MIT License/);
  assert.match(licence, /sha512-[A-Za-z0-9+/=]+/, 'records the tarball integrity');
  assert.match(read('vendor/' + SDK_FILES[0]), /^var supabase=/, 'the UMD build (window.supabase)');
  assert.doesNotMatch(read('package.json'), /supabase/, 'not a dependency of the site');
  // §6.7: no page loads supabase-js up front; auth.js adds that one build once the keys are real
  for (const p of PAGES) assert.doesNotMatch(read(`auth/${p}.html`), /supabase-js/, p);
  const js = read('auth/auth.js');
  assert.ok(js.includes(`const SUPABASE_SRC = '/vendor/${SDK_FILES[0]}';`), 'auth.js names the vendored build');
  assert.equal((js.match(/vendor\/supabase-js/g) || []).length, 1, 'and no other');
  const client = js.slice(js.indexOf('async function supabaseClient()'));
  assert.ok(client.indexOf('if (!cfg.supabaseReady) return null;') >= 0 && client.indexOf('if (!cfg.supabaseReady) return null;') < client.indexOf('await loadSupabase()'), 'placeholder keys: the build is never fetched');
  const signup = js.slice(js.indexOf('async function signupPage()'));
  assert.ok(signup.indexOf('if (!open)') < signup.indexOf('supabaseClient()'), 'closed sign-up: the build is never fetched');
});

for (const p of PAGES) {
  test(`auth/${p}.html: noindex, one h1, en-NZ, no inline code, root-absolute paths, the simplified bar and footer`, () => {
    const s = read(`auth/${p}.html`);
    assert.match(s, /^<!doctype html>\n<html lang="en-NZ">/);
    assert.match(s, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(s, /<meta name="referrer" content="no-referrer">/);
    assert.equal((s.match(/<h1\b/g) || []).length, 1);
    assert.match(s, new RegExp(`<body class="auth-page" data-page="${p}">`));
    for (const x of s.matchAll(/<script\b([^>]*)>/g)) assert.match(x[1], /\ssrc="\/[^"]+"/, 'external scripts only');
    assert.doesNotMatch(s, /<style\b|\sstyle=|\son[a-z]+=|javascript:/i);
    for (const x of s.matchAll(/\s(?:href|src|action)="([^"]*)"/g)) assert.match(x[1], /^(\/$|\/[^/]|#[a-z])/, `root-absolute: ${x[1]}`);
    assert.ok(s.includes('<script type="module" src="/auth/auth.js"></script>'));
    assert.ok(s.includes('<link rel="stylesheet" href="/assets/site.css">') && s.includes('<link rel="stylesheet" href="/auth/auth.css">'));
    assert.doesNotMatch(s, /challenges\.cloudflare\.com/, 'Turnstile is loaded by auth.js, only when the keys are real');
    // the bar: the logo and Back to the site, nothing else
    const bar = s.slice(s.indexOf('<header class="gb"'), s.indexOf('</header>'));
    assert.deepEqual([...bar.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)].map(m => m[1]), ['/', '/']);
    assert.match(bar, /class="gb__logo" href="\/">Hanes <span>Distribution<\/span><\/a>/);
    assert.match(bar, /class="gb__back" href="\/">.*Back to the site<\/a>/);
    const foot = s.slice(s.indexOf('<footer'), s.indexOf('</footer>'));
    assert.ok(foot.includes('<a href="/privacy.html">Privacy</a>') && foot.includes('<a href="/contact.html">Contact</a>'));
    assert.ok(foot.includes('<span>© 2026 Hanes Distribution. All rights reserved.</span>'), 'the site footer wording');
    // the messages are live regions, the form starts hidden until auth.js knows it can work
    assert.match(s, /id="notice" role="status"/);
    assert.match(s, /id="alert" role="alert"/);
    // the form starts hidden, and even a submit without auth.js would never put a password in a URL
    assert.match(s, /<form class="auth__form" id="form" method="post" novalidate hidden>/);
    assert.equal((s.match(/<form\b/g) || []).length, 1);
    // every input has a label
    for (const x of s.matchAll(/<input\b[^>]*\sid="([^"]+)"[^>]*>/g)) {
      const id = x[1];
      assert.ok(s.includes(`<label for="${id}"`) || new RegExp(`<label class="auth__check"><input[^>]*id="${id}"`).test(s), `${p}: #${id} has a label`);
    }
    assert.doesNotMatch(s, /\b(claude|opus|sonnet|gpt|openai)\b/i);
  });
}

test('the wording the addendum fixes is on the pages, as static text', () => {
  const login = read('auth/login.html'), signup = read('auth/signup.html');
  assert.ok(login.includes('Keep me signed in on this device'));
  assert.ok(login.includes("We'll sign you out when you close your browser. Some browsers keep you signed in if they restore your tabs; on a shared computer, use Sign out."));
  assert.match(login, /<input id="remember" name="remember" type="checkbox" aria-describedby="remember-help">/, 'unticked by default');
  assert.ok(login.includes('Resend confirmation'));
  assert.match(login, /<input id="password" name="password" type="password" autocomplete="current-password" maxlength="72" required>/, 'sign-in never refuses a password by its length');
  for (const f of ['signup', 'update-password']) assert.match(read(`auth/${f}.html`), /autocomplete="new-password" maxlength="72" data-min="12"/, `${f}: 12 to 72`);
  assert.ok(signup.includes(lib.MESSAGES.accounts_closed), 'the closed state of §3.3.1');
  assert.ok(signup.includes('By creating an account you agree that Bargainhub (Hanes Distribution) can keep your designs and contact details and contact you about your project. Sign-in is handled by Supabase in Sydney; your contact details also go into our customer system, run by Base44 in the United States. <a href="/privacy.html">Privacy statement</a>'), 'the §11.2 sign-up notice');
  assert.match(signup, /<input id="privacy" name="privacy" type="checkbox" required[^>]*><span>I've read the privacy statement\.<\/span>/);
  assert.match(signup, /<input id="marketing" name="marketing" type="checkbox"><span>Send me occasional news and offers\.<\/span>/, 'optional, unticked');
  const confirm = read('auth/confirm.html');
  assert.match(confirm, /<input id="privacy" name="privacy" type="checkbox"[^>]*><span>I've read the privacy statement\.<\/span>/, 'the invite tick of §3.3.2');
  // the statement opens in its own tab: Back would reload the page without its (already stripped) token
  assert.ok(confirm.includes('<a href="/privacy.html" target="_blank" rel="noopener noreferrer">Read the privacy statement (opens in a new tab)</a>'), 'confirm: the privacy statement opens in a new tab');
  assert.ok(read('privacy.html').includes(lib.PRIVACY_NOTICE_VERSION), 'the notice version is the privacy statement version');
});

test('auth.js: bhAuthHygiene runs first, token_hash leaves the address bar before Supabase is touched, Turnstile only on three pages', () => {
  const s = read('auth/auth.js');
  const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const statements = code.replace(/import\s*\{[\s\S]*?\}\s*from\s*'[^']+';|import\s+[^;]+;/g, '').trim();
  assert.match(statements, /^bhAuthHygiene\(window\);/, 'the first statement after the imports');
  assert.ok(code.indexOf('history.replaceState') < code.indexOf('createClient('), 'token_hash goes first');
  assert.ok(code.indexOf("params.delete('token_hash')") < code.indexOf('history.replaceState'));
  assert.match(s, /const TURNSTILE_SRC = 'https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit';/);
  assert.match(s, /const NEEDS_TURNSTILE = new Set\(\['login', 'signup', 'reset'\]\);/);
  assert.equal((s.match(/mountCaptcha\(\$\('captcha'\), '(login|signup|reset)'\)/g) || []).length, 3);
  assert.match(s, /detectSessionInUrl: false/, 'supabase-js never reads tokens from the address');
  // every page shows its form only after its submit handler is attached
  for (const fn of s.split(/\nasync function /).slice(1)) {
    const shown = fn.indexOf('show(form, true)'), handler = fn.indexOf("form.addEventListener('submit'");
    if (shown >= 0) assert.ok(handler >= 0 && handler < shown, fn.slice(0, 20));
  }
  for (const imp of s.matchAll(/from '([^']+)'/g)) assert.match(imp[1], /^\/auth\/[a-z-]+\.js$/, 'root-absolute imports');
  const r = spawnSync(process.execPath, ['--check', root + 'auth/auth.js'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('the sign-in pages are noindex and outside the sitemap', () => {
  assert.doesNotMatch(read('sitemap.xml'), /\/auth\//);
});
