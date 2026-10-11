/* The Chinese sign-in pages (RP-29): /auth/zh/{login,confirm,reset,update-password}.html,
   auth/messages-zh.js and the language the flows keep. auth/auth-lib.js is imported as it is
   served; supabase-js and our server are stubs, as in tests/auth.test.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as lib from '../auth/auth-lib.js';
import { MESSAGES_ZH, UI_ZH, ZH_REVIEWED } from '../auth/messages-zh.js';
import { SUPABASE_URL } from '../auth/config.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = f => readFileSync(root + f, 'utf8');
const ORIGIN = 'https://hanes-the-website-new.vercel.app';
const HAN = /[一-鿿]/;
const ZH = ['login', 'confirm', 'reset', 'update-password'];

/* ---------- MESSAGES_ZH and UI_ZH ---------- */
test('MESSAGES_ZH is keyed exactly like MESSAGES (same keys, same order), frozen, every value Chinese', () => {
  assert.deepEqual(Object.keys(MESSAGES_ZH), Object.keys(lib.MESSAGES));
  assert.ok(Object.isFrozen(MESSAGES_ZH));
  for (const [k, m] of Object.entries(MESSAGES_ZH)) {
    assert.equal(typeof m, 'string', k);
    assert.ok(HAN.test(m), `${k}: Chinese`);
    assert.match(m, /。$/, `${k}: a sentence`);
    assert.doesNotMatch(m, /\s{2}|^\s|\s$/, `${k}: no stray spaces`);
  }
  // the same message where English says the same thing
  for (const [a, b] of Object.entries({ origin_required: 'cross_origin', auth_settings_unsafe: 'auth_unavailable', unavailable: 'auth_unavailable', network: 'auth_unavailable' })) {
    assert.equal(lib.MESSAGES[a], lib.MESSAGES[b], `en ${a}`);
    assert.equal(MESSAGES_ZH[a], MESSAGES_ZH[b], `zh ${a}`);
  }
  // auth-lib.js cannot be imported by messages-zh.js (it imports it), so the numbers are repeated: they agree
  assert.ok(MESSAGES_ZH.password_length.includes(String(lib.PASSWORD_MIN)) && MESSAGES_ZH.password_length.includes(String(lib.PASSWORD_MAX)));
  assert.ok(MESSAGES_ZH.reset_too_slow.includes('10'), 'the same 10 minutes');
});

test('UI_ZH has exactly the keys of UI, the same shapes, and the same placeholders', () => {
  assert.deepEqual(Object.keys(UI_ZH), Object.keys(lib.UI));
  assert.ok(Object.isFrozen(UI_ZH) && Object.isFrozen(lib.UI));
  for (const k of Object.keys(lib.UI)) {
    const en = lib.UI[k], zh = UI_ZH[k];
    assert.equal(Array.isArray(zh), Array.isArray(en), k);
    // the title suffix is the brand alone, in Latin script (review, 11 Oct): "Bargainhub Studio"
    for (const s of [].concat(zh)) assert.ok(typeof s === 'string' && s.length && (k === 'title_suffix' || HAN.test(s)), `${k}: Chinese`);
    if (Array.isArray(en)) assert.equal(zh.length, en.length, k);
    for (const ph of [].concat(en).join(' ').match(/\{[a-z]+\}/g) || []) assert.ok([].concat(zh).join(' ').includes(ph), `${k}: ${ph}`);
  }
  assert.equal(UI_ZH.title_suffix, ' — Bargainhub Studio');
  assert.deepEqual(lib.textsFor('zh'), { messages: MESSAGES_ZH, ui: UI_ZH });
  assert.deepEqual(lib.textsFor('en'), { messages: lib.MESSAGES, ui: lib.UI });
  for (const x of [undefined, null, 'zh-CN', 'ZH', 'fr', {}]) assert.deepEqual(lib.textsFor(x), { messages: lib.MESSAGES, ui: lib.UI }, String(x));
});

test('the reviewed Chinese wording (integrator review, 11 Oct): exact texts, 验证 for email, no 索取, no jargon', () => {
  const want = {
    auth_unavailable: '您已登录，但系统暂时无法访问，请稍后重试。', network: '您已登录，但系统暂时无法访问，请稍后重试。',
    invalid_token: '登录失败，请重新登录。', session_ended: '您的登录已过期，请重新登录。',
    not_allowed_here: '此邮箱无法在本网站登录。', signup_closed: '您的账户已确认，平台即将开放使用。',
    email_unconfirmed: '请先验证您的邮箱：点击我们发送给您的邮件中的链接。', exchange_race: '检测到另一次登录正在进行，请重新登录。',
    weak_password: '该密码过于简单，或曾出现在数据泄露中，请换一个密码。', mfa_required: '此账户需要二次验证，本页面暂不支持。请联系我们，我们会协助您。',
    bad_credentials: '邮箱或密码错误，或账户尚未激活。'
  };
  for (const [k, v] of Object.entries(want)) assert.equal(MESSAGES_ZH[k], v, k);
  for (const k of ['invitation_needs_link', 'link_expired_invite']) assert.match(MESSAGES_ZH[k], /请联系邀请人重新发送邀请。$/, k);
  const all = [...Object.values(MESSAGES_ZH), ...Object.values(UI_ZH).flat(), ...['login', 'confirm', 'reset', 'update-password'].map(p => read(`auth/zh/${p}.html`))].join('\n');
  assert.doesNotMatch(all, /索取|向我们发送咨询|工作室|确认邮件|跳到表单/, 'the replaced wording is gone');
  assert.doesNotMatch([MESSAGES_ZH.paste_not_link, MESSAGES_ZH.paste_lost].join(' '), /Supabase|localhost/i, 'no jargon in the paste messages');
  const login = read('auth/zh/login.html'), reset = read('auth/zh/reset.html'), confirm = read('auth/zh/confirm.html');
  assert.ok(login.includes('>重新发送验证邮件</button>') && confirm.includes('“重新发送验证邮件”'), '验证 for email verification');
  assert.ok(login.includes('关闭浏览器后将自动退出登录。部分浏览器恢复标签页时会保持登录状态；使用公用电脑时，请手动“退出登录”。'));
  assert.ok(login.includes('<p class="auth__alt">账户仅限受邀开通。尚未收到邀请？<a href="/contact.html#enquiry" hreflang="en-NZ">请联系我们</a></p>'));
  assert.ok(reset.includes('<p class="auth__alt">想起密码了？<a href="/auth/zh/login.html">返回登录</a></p>'));
  assert.ok(read('auth/zh/update-password.html').includes('建议使用几个词语组合，既好记又安全。'));
  for (const p of ['login', 'confirm', 'reset', 'update-password']) {
    const s = read(`auth/zh/${p}.html`);
    assert.ok(s.includes('<a class="auth__skip" href="#main">跳至表单</a>'), p);
    assert.ok(s.includes('>联系我们咨询</a>'), `${p}: 联系我们咨询`);
  }
  assert.ok(MESSAGES_ZH.accounts_closed.includes('请联系我们咨询') && MESSAGES_ZH.not_configured.includes('请联系我们咨询'));
  // polish: the paste box's help text has air before the field's label (en and zh share auth.css)
  assert.match(read('auth/auth.css'), /#pasteBox \.auth__help\{margin-bottom:12px\}/);
});

test('the Chinese copy is ours and waits for a native speaker: ZH_REVIEWED stays false until then', () => {
  assert.equal(ZH_REVIEWED, false);
  assert.match(read('auth/messages-zh.js'), /a native speaker checks it before production/);
});

test('messageFor(code, "zh"): every code has its own Chinese message; unknown codes get the general one', () => {
  for (const c of Object.keys(lib.MESSAGES)) assert.equal(lib.messageFor(c, 'zh'), MESSAGES_ZH[c], c);
  for (const c of ['invalid_input', 'mfa_required', 'email_in_use', 'account_already_linked', 'confirm_link_required', 'exchange_race', 'link_requires_invitation']) {
    assert.notEqual(lib.messageFor(c, 'zh'), MESSAGES_ZH.unexpected, c);
  }
  for (const c of ['nope', 'constructor', 'toString', '__proto__', '', null, undefined, 5]) assert.equal(lib.messageFor(c, 'zh'), MESSAGES_ZH.unexpected);
  assert.equal(lib.messageFor('mfa_required'), lib.MESSAGES.mfa_required, 'English stays the default');
});

// the mirror of "no message reveals whether an account exists" in tests/auth.test.mjs
test('no Chinese message reveals whether an account exists', () => {
  for (const [k, m] of Object.entries(MESSAGES_ZH)) {
    assert.doesNotMatch(m, /没有账户|没有帐户|无此账户|账户不存在|帐户不存在|用户不存在|邮箱不存在|未注册|已注册|已经注册|已存在|已经存在/, k);
    assert.doesNotMatch(m, /属于|另一个账户|其他账户|已被关联|已关联|邮箱已被使用|邮箱已被占用|已被占用|已有账户|员工账户/, k);
  }
  for (const [k, m] of Object.entries(UI_ZH)) assert.doesNotMatch([].concat(m).join(' '), /账户不存在|未注册|已注册|已存在|已被占用/, k);
  // the uniform answers say the same thing for an email with and without an account
  for (const k of ['bad_credentials', 'reset_sent', 'resend_sent', 'signup_sent']) assert.ok(MESSAGES_ZH[k], k);
  assert.match(MESSAGES_ZH.reset_sent, /^如果/, 'reset: "if", never "we found"');
  assert.match(MESSAGES_ZH.resend_sent, /^如果/, 'resend: "if"');
  assert.match(MESSAGES_ZH.bad_credentials, /或/, 'one message for a wrong password and an unconfirmed account');
});

test('the Chinese wording names no one group either: no staff, no Back Office', () => {
  for (const [k, m] of Object.entries(MESSAGES_ZH)) assert.doesNotMatch(m, /员工|职员|后台|back office|staff/i, k);
});

/* ---------- the flows keep the language ---------- */
function stub({ verify = 'ok', signIn = 'ok', update = 'ok', exchangeAnswers = [], reset = 'ok', resend = 'ok' } = {}) {
  const log = [];
  let session = null;
  const err = code => ({ name: 'AuthApiError', status: code === 'network' ? 0 : 400, code: code === 'network' ? undefined : code, message: code });
  const supabase = {
    auth: {
      setSession: async a => { log.push(['setSession', a]); if (verify !== 'ok') return { data: { session: null }, error: err(verify) }; session = { access_token: a.access_token }; return { data: { session }, error: null }; },
      verifyOtp: async a => { log.push(['verifyOtp', a]); if (verify !== 'ok') return { data: { session: null }, error: err(verify) }; session = { access_token: 'otp-token' }; return { data: { session }, error: null }; },
      signInWithPassword: async a => { log.push(['signInWithPassword', a]); if (signIn !== 'ok') return { data: {}, error: err(signIn) }; session = { access_token: 'pw-token' }; return { data: { session }, error: null }; },
      updateUser: async a => { log.push(['updateUser', a]); return update === 'ok' ? { data: {}, error: null } : { data: {}, error: err(update) }; },
      getSession: async () => { log.push(['getSession']); return { data: { session }, error: null }; },
      signOut: async a => { log.push(['signOut', a]); session = null; return { error: null }; },
      resetPasswordForEmail: async (e, o) => { log.push(['resetPasswordForEmail', e, o]); return reset === 'ok' ? { data: {}, error: null } : { data: {}, error: err(reset) }; },
      resend: async a => { log.push(['resend', a]); return resend === 'ok' ? { data: {}, error: null } : { data: {}, error: err(resend) }; }
    }
  };
  const answers = [...exchangeAnswers];
  const exchange = async (token, extra) => { log.push(['exchange', token, extra]); return answers.length ? answers.shift() : { ok: true, status: 200, session: { user: { id: 'u' }, level: 'client' } }; };
  return { log, deps: { supabase, exchange, w: {}, keepChoice: () => log.push(['keepChoice']), rememberChoice: () => log.push(['rememberChoice']), lang: 'zh' }, names: () => log.map(e => e[0]) };
}

test('authPage: Chinese pages for zh where they exist, English otherwise; sign-up has no Chinese page', () => {
  assert.deepEqual(lib.ZH_PAGES, ZH);
  for (const p of ZH) {
    assert.equal(lib.authPage(p, 'zh'), `/auth/zh/${p}.html`);
    assert.equal(lib.authPage(p, 'en'), `/auth/${p}.html`);
    assert.equal(lib.authPage(p), `/auth/${p}.html`);
  }
  assert.equal(lib.authPage('signup', 'zh'), '/auth/signup.html');
  assert.equal(lib.authPage('login', 'zh-CN'), '/auth/login.html', 'only the exact language code');
});

test('zh sign-in: a wrong password, an unknown email and an unconfirmed account get one Chinese message, with Resend', async () => {
  for (const code of ['invalid_credentials', 'email_not_confirmed', 'user_not_found', 'user_banned']) {
    const s = stub({ signIn: code });
    const out = await lib.loginFlow({ email: 'a@example.test', password: 'pw', captchaToken: 't' }, s.deps);
    assert.equal(out.message, MESSAGES_ZH.bad_credentials, code);
    assert.equal(out.resend, true);
    assert.ok(!s.names().includes('exchange'));
  }
  for (const [code, key] of [['network', 'supabase_network'], ['over_request_rate_limit', 'rate_limited'], ['captcha_failed', 'captcha_failed']]) {
    const s = stub({ signIn: code });
    assert.equal((await lib.loginFlow({ email: 'a@example.test', password: 'pw', captchaToken: 't' }, s.deps)).message, MESSAGES_ZH[key], code);
  }
  const s = stub();
  assert.equal((await lib.loginFlow({ email: 'a@example.test', password: 'pw', captchaToken: '' }, s.deps)).message, MESSAGES_ZH.captcha_needed);
});

test('zh sign-in: exchange refusals in Chinese; reauth goes to the Chinese sign-in page; Retry keeps Chinese', async () => {
  for (const [status, code] of [[403, 'signup_closed'], [409, 'link_requires_invitation'], [403, 'account_disabled'], [401, 'mfa_required'], [409, 'exchange_race'], [400, 'whatever']]) {
    const s = stub({ exchangeAnswers: [{ ok: false, status, code }] });
    const out = await lib.loginFlow({ email: 'a@example.test', password: 'pw', captchaToken: 't' }, s.deps);
    assert.equal(out.message, lib.messageFor(code, 'zh'), code);
    assert.ok(HAN.test(out.message), code);
    assert.equal(s.names().at(-1), 'signOut', `${code}: the Supabase session ends here`);
  }
  let s = stub({ exchangeAnswers: [{ ok: false, status: 401, code: 'reauth_required' }] });
  assert.deepEqual(await lib.loginFlow({ email: 'a@example.test', password: 'pw', captchaToken: 't' }, s.deps), { action: 'go', to: '/auth/zh/login.html?reason=reauth', code: 'reauth_required' });
  s = stub({ exchangeAnswers: [{ ok: false, status: 0, code: 'network' }, { ok: false, status: 503, code: 'unavailable' }] });
  const out = await lib.loginFlow({ email: 'a@example.test', password: 'pw', captchaToken: 't' }, s.deps);
  assert.equal(out.message, MESSAGES_ZH.network);
  assert.equal((await out.retry()).message, MESSAGES_ZH.unavailable);
});

test('zh reset and resend: the emailed link comes back to the Chinese confirm page, with the same answer for any email', async () => {
  for (const reset of ['ok', 'user_not_found', 'over_email_send_rate_limit']) {
    const s = stub({ reset });
    const out = await lib.resetFlow({ email: 'a@example.test', captchaToken: 't', origin: ORIGIN }, s.deps);
    assert.deepEqual(out, { action: 'done', message: MESSAGES_ZH.reset_sent }, reset);
    assert.equal(s.log[0][2].redirectTo, ORIGIN + '/auth/zh/confirm.html');
  }
  for (const resend of ['ok', 'over_email_send_rate_limit']) {
    const s = stub({ resend });
    const out = await lib.resendFlow({ email: 'a@example.test', captchaToken: 't', origin: ORIGIN }, s.deps);
    assert.deepEqual(out, { action: 'done', message: MESSAGES_ZH.resend_sent }, resend);
    assert.equal(s.log[0][1].options.emailRedirectTo, ORIGIN + '/auth/zh/confirm.html');
  }
  // English is unchanged
  const s = stub();
  await lib.resetFlow({ email: 'a@example.test', captchaToken: 't', origin: ORIGIN }, { ...s.deps, lang: undefined });
  assert.equal(s.log[0][2].redirectTo, ORIGIN + '/auth/confirm.html');
});

test('zh confirm: invite and recovery go on to the Chinese update-password page; errors are Chinese', async () => {
  let s = stub();
  assert.deepEqual(await lib.confirmFlow({ type: 'invite', tokenHash: 'abc123def456', privacyAck: true }, s.deps), { action: 'go', to: '/auth/zh/update-password.html?invite=1' });
  assert.deepEqual(s.names(), ['keepChoice', 'verifyOtp', 'getSession', 'exchange'], 'the same order as English');
  s = stub();
  assert.deepEqual(await lib.confirmFlow({ type: 'recovery', tokenHash: 'abc123def456' }, s.deps), { action: 'go', to: '/auth/zh/update-password.html' });
  s = stub();
  assert.equal((await lib.confirmFlow({ type: 'invite', tokenHash: 'abc123def456', privacyAck: false }, s.deps)).message, MESSAGES_ZH.privacy_ack_required);
  assert.equal((await lib.confirmFlow({ type: 'bogus', tokenHash: 'abc123def456' }, s.deps)).message, MESSAGES_ZH.link_incomplete);
  assert.deepEqual(s.log, [], 'no token used');
  for (const [type, key] of [['invite', 'link_expired_invite'], ['email', 'link_expired']]) {
    s = stub({ verify: 'otp_expired' });
    assert.equal((await lib.confirmFlow({ type, tokenHash: 'abc123def456', privacyAck: true }, s.deps)).message, MESSAGES_ZH[key], type);
  }
  s = stub({ verify: 'network' });
  assert.equal((await lib.confirmFlow({ type: 'email', tokenHash: 'abc123def456' }, s.deps)).message, MESSAGES_ZH.supabase_network);
  // (b): the session hash of Supabase's default link
  const AT = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlLXNpZw';
  s = stub();
  assert.deepEqual(await lib.confirmSessionFlow({ type: 'invite', accessToken: AT, refreshToken: 'r-123456', privacyAck: true }, s.deps), { action: 'go', to: '/auth/zh/update-password.html?invite=1' });
  s = stub({ verify: 'session_expired' });
  assert.equal((await lib.confirmSessionFlow({ type: 'invite', accessToken: AT, refreshToken: 'r-123456', privacyAck: true }, s.deps)).message, MESSAGES_ZH.link_expired_invite);
  assert.equal(lib.hashLinkError('invite', 'zh').message, MESSAGES_ZH.link_expired_invite);
  assert.equal(lib.hashLinkError('recovery', 'zh').message, MESSAGES_ZH.link_expired);
  assert.equal(lib.hashLinkError('recovery').message, lib.MESSAGES.link_expired);
});

test('zh update-password: Chinese checks and outcomes; the studio still decides the landing', async () => {
  let s = stub();
  assert.equal((await lib.passwordFlow({ password: 'short' }, s.deps)).message, MESSAGES_ZH.password_length);
  assert.equal((await lib.passwordFlow({ password: 'a-good-long-password', confirm: 'other-long-password' }, s.deps)).message, MESSAGES_ZH.passwords_differ);
  for (const [code, key] of [['weak_password', 'weak_password'], ['same_password', 'same_password'], ['session_not_found', 'session_missing']]) {
    s = stub({ update: code });
    assert.equal((await lib.passwordFlow({ password: 'a-good-long-password' }, s.deps)).message, MESSAGES_ZH[key], code);
  }
  globalThis.location = { origin: ORIGIN };
  try {
    s = stub({ exchangeAnswers: [{ ok: true, status: 200, session: { user: {}, level: 'client', auth: { landing: '/studio/home.html' } } }] });
    await s.deps.supabase.auth.verifyOtp({});
    assert.deepEqual(await lib.passwordFlow({ password: 'a-good-long-password', invite: true }, s.deps), { action: 'done', message: MESSAGES_ZH.password_set, to: '/studio/home.html' });
    s = stub();
    await s.deps.supabase.auth.verifyOtp({});
    assert.equal((await lib.passwordFlow({ password: 'a-good-long-password' }, s.deps)).message, MESSAGES_ZH.password_changed);
  } finally { delete globalThis.location; }
});

/* ---------- the pasted link keeps the language ---------- */
test('pastedLinkTarget(…, "zh"): every kind of link opens the Chinese confirm page; English stays the default', () => {
  const H = 'bd974a15d49b6691833dbc7717e8c2a7ae19ca5913133675a3b11cbd';
  const verify = type => `https://${new URL(SUPABASE_URL).host}/auth/v1/verify?token=${H}&type=${type}&redirect_to=http://localhost:3000`;
  const P = (t, type = null) => lib.pastedLinkTarget(t, SUPABASE_URL, type, 'zh');
  assert.equal(P(verify('recovery')), `/auth/zh/confirm.html?token_hash=${H}&type=recovery`);
  assert.equal(P(verify('invite')), `/auth/zh/confirm.html?token_hash=${H}&type=invite`);
  const hash = '#access_token=eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlLXNpZw&refresh_token=r-123456&type=invite';
  assert.equal(P('http://localhost:3000/' + hash), '/auth/zh/confirm.html' + hash);
  const err = '#error=access_denied&error_code=otp_expired';
  assert.equal(P('http://localhost:3000/' + err, 'recovery'), '/auth/zh/confirm.html?type=recovery' + err);
  // (c) our own link, from either language's confirm page, opens on the page it was pasted on
  for (const from of ['/auth/confirm.html', '/auth/zh/confirm.html']) {
    assert.equal(P(`${ORIGIN}${from}?token_hash=${H}&type=invite`), `/auth/zh/confirm.html?token_hash=${H}&type=invite`, from);
    assert.equal(lib.pastedLinkTarget(`${ORIGIN}${from}?token_hash=${H}&type=invite`, SUPABASE_URL), `/auth/confirm.html?token_hash=${H}&type=invite`, from);
  }
  for (const bad of [`${ORIGIN}/auth/zh/x/confirm.html?token_hash=${H}&type=invite`, `${ORIGIN}/auth/zh/confirm.html?token_hash=${H}&type=bogus`, 'javascript:alert(1)//' + hash, 'hello']) assert.equal(P(bad), null, bad);
  assert.equal(lib.pastedLinkTarget(verify('recovery'), SUPABASE_URL, null, 'fr'), `/auth/confirm.html?token_hash=${H}&type=recovery`, 'an unknown language is English');
});

/* ---------- 中文 / English ---------- */
test('otherLangPage: the same page in the other language, with only what that page uses', () => {
  globalThis.location = { origin: ORIGIN };
  try {
    for (const p of ZH) {
      assert.equal(lib.otherLangPage(`/auth/${p}.html`, ''), `/auth/zh/${p}.html`);
      assert.equal(lib.otherLangPage(`/auth/zh/${p}.html`, ''), `/auth/${p}.html`);
    }
    for (const no of ['/auth/signup.html', '/auth/zh/signup.html', '/auth/zh/zh/login.html', '/auth/login.htm', '/index.html', '/auth/', '', null, 5]) assert.equal(lib.otherLangPage(no, ''), null, String(no));
    assert.equal(lib.otherLangPage('/auth/zh/login.html', '?next=/studio/home.html&utm=x'), '/auth/login.html?next=%2Fstudio%2Fhome.html');
    assert.equal(lib.otherLangPage('/auth/login.html', '?next=/studio/home.html'), '/auth/zh/login.html?next=%2Fstudio%2Fhome.html');
    for (const evil of ['//evil.example', 'https://evil.example/', 'javascript:alert(1)', '/studio/%2e%2e/x', '/index.html']) assert.equal(lib.otherLangPage('/auth/login.html', '?next=' + encodeURIComponent(evil)), '/auth/zh/login.html', evil);
    assert.equal(lib.otherLangPage('/auth/login.html', '?reason=reauth'), '/auth/zh/login.html?reason=reauth');
    assert.equal(lib.otherLangPage('/auth/login.html', '?reason=other'), '/auth/zh/login.html');
    assert.equal(lib.otherLangPage('/auth/update-password.html', '?invite=1'), '/auth/zh/update-password.html?invite=1');
    assert.equal(lib.otherLangPage('/auth/confirm.html', '?type=recovery'), '/auth/zh/confirm.html?type=recovery');
    assert.equal(lib.otherLangPage('/auth/confirm.html', '?type=bogus&invite=1&reason=reauth'), '/auth/zh/confirm.html', 'only what that page uses');
    // a token never rides along unless auth.js passes the link it holds (only when the button is pressed)
    assert.equal(lib.otherLangPage('/auth/confirm.html', '?token_hash=abc123def456&type=invite'), '/auth/zh/confirm.html?type=invite');
    assert.equal(lib.otherLangPage('/auth/confirm.html', '?type=invite', { tokenHash: 'abc123def456', type: 'invite', hash: null }), '/auth/zh/confirm.html?type=invite&token_hash=abc123def456');
    assert.equal(lib.otherLangPage('/auth/login.html', '', { tokenHash: 'abc123def456', type: 'invite' }), '/auth/zh/login.html', 'confirm only');
    for (const bad of [{ tokenHash: 'abc', type: 'invite' }, { tokenHash: 'abc123def456"><x', type: 'invite' }, { tokenHash: 'abc123def456', type: 'magiclink' }]) {
      assert.equal(lib.otherLangPage('/auth/confirm.html', '', bad), '/auth/zh/confirm.html', JSON.stringify(bad));
    }
    const AT = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlLXNpZw';
    const held = lib.hashLink(`#access_token=${AT}&refresh_token=r-123456&type=signup&expires_in=3600`);
    const to = lib.otherLangPage('/auth/zh/confirm.html', '', { tokenHash: null, type: null, hash: held });
    assert.equal(to, `/auth/confirm.html#access_token=${AT}&refresh_token=r-123456&type=email`);
    assert.deepEqual(lib.hashLink(to.slice(to.indexOf('#'))), { ...held }, 'the other page reads the same link');
    const spent = lib.hashLink('#error=access_denied&error_code=otp_expired');
    assert.equal(lib.otherLangPage('/auth/confirm.html', '?type=recovery', { hash: spent }), '/auth/zh/confirm.html?type=recovery#error_code=otp_expired');
    assert.equal(lib.otherLangPage('/auth/confirm.html', '', { hash: lib.hashLink(`#access_token=bad&refresh_token=x`) }), '/auth/zh/confirm.html', 'a malformed session is left behind');
  } finally { delete globalThis.location; }
});

/* ---------- the four pages ---------- */
const inputs = s => [...s.matchAll(/<input\b[^>]*>/g)].map(m => m[0].replace(/\sdata-required="[^"]*"/, ''));
const ids = s => [...s.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);

for (const p of ZH) {
  test(`auth/zh/${p}.html: zh-CN, the same structure rules as the English page, no sign-up link, the English button`, () => {
    const s = read(`auth/zh/${p}.html`), en = read(`auth/${p}.html`);
    assert.match(s, /^<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">/);
    assert.match(s, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(s, /<meta name="referrer" content="no-referrer">/);
    assert.match(s, /<title>[^<]*[一-鿿][^<]* — Bargainhub Studio<\/title>/);
    assert.doesNotMatch(s, /工作室/, 'the brand is written "Bargainhub Studio" in Latin script');
    assert.match(s, /<meta name="description" content="[^"]*[一-鿿][^"]*">/);
    assert.equal((s.match(/<h1\b/g) || []).length, 1);
    assert.match(s, /<h1 id="title">[一-鿿]+<\/h1>/);
    assert.match(s, new RegExp(`<body class="auth-page" data-page="${p}">`), 'auth.js runs the same page');
    for (const x of s.matchAll(/<script\b([^>]*)>/g)) assert.match(x[1], /\ssrc="\/[^"]+"/, 'external scripts only');
    assert.doesNotMatch(s, /<style\b|\sstyle=|\son[a-z]+=|javascript:/i);
    for (const x of s.matchAll(/\s(?:href|src|action)="([^"]*)"/g)) assert.match(x[1], /^(\/$|\/[^/]|#[a-z])/, `root-absolute: ${x[1]}`);
    assert.ok(s.includes('<script type="module" src="/auth/auth.js"></script>'));
    assert.ok(s.includes('<link rel="stylesheet" href="/assets/site.css">') && s.includes('<link rel="stylesheet" href="/auth/auth.css">'));
    assert.doesNotMatch(s, /challenges\.cloudflare\.com|supabase-js/);
    // the bar: the logo and Back to the site, nothing else
    const bar = s.slice(s.indexOf('<header class="gb"'), s.indexOf('</header>'));
    assert.deepEqual([...bar.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)].map(m => m[1]), ['/', '/']);
    assert.match(bar, /class="gb__logo" href="\/">Hanes <span>Distribution<\/span><\/a>/);
    assert.match(bar, /class="gb__back" href="\/">.*返回网站<\/a>/);
    assert.doesNotMatch(bar, /langSwitch|English/, 'the language button is not in the bar');
    const foot = s.slice(s.indexOf('<footer'), s.indexOf('</footer>'));
    assert.ok(foot.includes('<a href="/privacy.html" hreflang="en-NZ">隐私</a>') && foot.includes('<a href="/contact.html" hreflang="en-NZ">联系我们</a>'));
    assert.ok(foot.includes('<span>© 2026 Hanes Distribution 保留所有权利。</span>'));
    assert.match(s, /id="notice" role="status"/);
    assert.match(s, /id="alert" role="alert"/);
    assert.match(s, /<form class="auth__form" id="form" method="post" novalidate hidden>/);
    assert.equal((s.match(/<form\b/g) || []).length, 1);
    for (const x of s.matchAll(/<input\b[^>]*\sid="([^"]+)"[^>]*>/g)) {
      const id = x[1];
      assert.ok(new RegExp(`<label for="${id}">[^<]*[\\u4e00-\\u9fff]`).test(s) || new RegExp(`<label class="auth__check"><input[^>]*id="${id}"[^>]*><span>[^<]*[\\u4e00-\\u9fff]`).test(s), `${p}: #${id} has a Chinese label`);
    }
    // what auth.js needs is all there: the same ids, in the same order, and the same fields
    assert.deepEqual(ids(s), ids(en), 'the same ids as the English page');
    assert.deepEqual(inputs(s), inputs(en), 'the same inputs (types, autocomplete, limits)');
    assert.equal((s.match(/<button\b/g) || []).length, (en.match(/<button\b/g) || []).length);
    // no sign-up: suppliers are invited
    assert.doesNotMatch(s, /signup|sign-up|注册/i, 'no sign-up link');
    // links to pages that exist in Chinese stay in Chinese; the English-only pages say so (hreflang)
    for (const x of s.matchAll(/<a\b([^>]*)\shref="(\/[^"]*)"([^>]*)>/g)) {
      const href = x[2], attrs = x[1] + x[3];
      if (href === '/' || href === '/studio/' || /id="langSwitch"/.test(attrs)) continue; // the English button is checked below
      if (/^\/auth\//.test(href)) assert.match(href, /^\/auth\/zh\/[a-z-]+\.html$/, `${p}: ${href} stays in Chinese`);
      else assert.match(attrs, /hreflang="en-NZ"/, `${p}: ${href} is marked as English`);
    }
    // the English button
    assert.ok(s.includes(`<div class="auth__top"><p class="auth__eyebrow">Bargainhub Studio</p><a class="auth__lang" id="langSwitch" href="/auth/${p}.html" hreflang="en-NZ" lang="en-NZ">English</a></div>`), 'the English button');
    assert.doesNotMatch(s, /\b(claude|opus|sonnet|gpt|openai)\b/i);
    // fictional data only
    assert.doesNotMatch(s.replace(/name@example\.com/g, ''), /@[a-z0-9-]+\.[a-z]/i, 'no real addresses');
  });
}

test('the Chinese confirm and reset pages keep the paste box, the invite tick and the 10 minutes', () => {
  for (const p of ['confirm', 'reset']) {
    const s = read(`auth/zh/${p}.html`);
    assert.match(s, /<div class="auth__form" id="pasteBox" role="group" aria-labelledby="pasteHelp" hidden>/, p);
    assert.match(s, /<label for="pasted">邮件中的链接<\/label>/, p);
    assert.match(s, /<button class="auth__go" id="pasteGo" type="button">继续<\/button>/, p);
    assert.ok(s.includes('10 分钟') && s.includes('第一个') && s.includes('复制链接地址') && s.includes('垃圾邮件'), `${p}: the time limit, the first page, the computer alternative, spam`);
    const help = (s.match(/<p class="auth__help" id="pasteHelp">([^<]*)<\/p>/) || [])[1] || '';
    assert.ok(help && HAN.test(help), `${p}: the paste help is Chinese`);
    assert.doesNotMatch(help, /Supabase|localhost|Auth/i, `${p}: no jargon for suppliers`);
  }
  const confirm = read('auth/zh/confirm.html');
  assert.match(confirm, /<input id="privacy" name="privacy" type="checkbox" data-required="请勾选“我已阅读隐私声明”后继续。" aria-describedby="privacy-read"><span>我已阅读隐私声明。<\/span>/);
  assert.ok(confirm.includes('<a href="/privacy.html" target="_blank" rel="noopener noreferrer" hreflang="en-NZ">隐私声明（英文版，新窗口打开）</a>'), 'opens in a new tab, says it is in English');
  assert.ok(confirm.includes('<p class="auth__help">如需新的邀请，请联系邀请您的人。</p>'), 'an invitee asks whoever invited them');
  assert.ok(read('auth/zh/update-password.html').includes('<p class="auth__help">如需新的邀请，请联系邀请您的人。</p>'), 'update-password says the same (RP-14)');
  // RP-14: the invitation may arrive as a link (email or WeChat), so "the invitation link you were sent", not "emailed"
  assert.equal(MESSAGES_ZH.link_requires_invitation, '首次登录时，请打开您收到的邀请链接。如需新的邀请，请联系邀请您的人。');
  assert.doesNotMatch(MESSAGES_ZH.link_requires_invitation, /邮件/);
  assert.equal(MESSAGES_ZH.privacy_ack_required, '请勾选“我已阅读隐私声明”后继续。', 'the tick says the same as the message');
  const login = read('auth/zh/login.html');
  assert.match(login, /<input id="remember" name="remember" type="checkbox" aria-describedby="remember-help">/, 'unticked by default');
  assert.match(login, /<input id="password" name="password" type="password" autocomplete="current-password" maxlength="72" required>/);
  assert.match(read('auth/zh/update-password.html'), /autocomplete="new-password" maxlength="72" data-min="12"/);
  assert.ok(read('auth/zh/update-password.html').includes('12 至 72 个字符'));
});

/* ---------- auth.js and auth.css ---------- */
test('auth.js: the page lang picks the words, every flow gets lang, and no English is left on a page that has a Chinese copy', () => {
  const js = read('auth/auth.js');
  assert.match(js, /const LANG = langOf\(document\.documentElement\.lang === 'zh-CN' \? 'zh' : 'en'\);/);
  assert.match(js, /const \{ messages: MESSAGES, ui: UI \} = textsFor\(LANG\);/);
  assert.ok(js.indexOf('const LANG') > js.indexOf('bhAuthHygiene(window);'), 'hygiene still runs first');
  for (const f of ['loginFlow', 'resendFlow', 'resetFlow', 'passwordFlow']) assert.match(js.slice(js.indexOf(`await ${f}(`)), /^await \w+\([\s\S]*?\}, \{[^}]*lang: LANG \}\);/, `${f} gets lang`);
  assert.match(js, /const deps = \{ supabase: sb, exchange, keepChoice, w: window, lang: LANG \};/, 'confirm gets lang');
  assert.match(js, /hashLinkError\(type, LANG\)/);
  // outside sign-up (English only), every word on the page comes from UI or MESSAGES
  const shared = js.slice(0, js.indexOf('async function signupPage()')) + js.slice(js.indexOf('async function resetPage('));
  const code = shared.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const words = [...code.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map(m => m[2]).filter(t => /[A-Z][a-z]+ [a-z]+/.test(t) && !/^https?:|challenges|turnstile/i.test(t));
  assert.deepEqual(words, [], 'English words in auth.js outside UI');
  // the button: the same page in the other language; a link it holds goes only when pressed
  assert.match(js, /const to = otherLangPage\(location\.pathname, '\?' \+ params\.toString\(\)\);/);
  assert.match(js, /const withLink = otherLangPage\(location\.pathname, '\?' \+ params\.toString\(\), confirmLink\);/);
  assert.ok(js.indexOf("params.delete('token_hash')") < js.indexOf('otherLangPage(location.pathname'), 'the href is built after the token left the query');
  for (const imp of js.matchAll(/from '([^']+)'/g)) assert.match(imp[1], /^\/auth\/[a-z-]+\.js$/);
  assert.match(read('auth/auth-lib.js'), /^import \{ MESSAGES_ZH, UI_ZH \} from '\.\/messages-zh\.js';$/m, 'auth-lib loads the Chinese words relative to itself (served and in Node)');
  const r = spawnSync(process.execPath, ['--check', root + 'auth/messages-zh.js'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('auth.css: :lang(zh) uses a CJK font stack and normal letter-spacing; the language button is a 44 px target', () => {
  const css = read('auth/auth.css');
  const cjk = (css.match(/--cjk:([^}]+)\}/) || [])[1] || '';
  for (const f of ['"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', '"Noto Sans CJK SC"', 'sans-serif']) assert.ok(cjk.includes(f), f);
  assert.match(css, /body\.auth-page:lang\(zh\),\.auth__lang:lang\(zh\)\{font-family:[^;}]*var\(--cjk\);letter-spacing:normal\}/);
  assert.match(css, /\.gb:lang\(zh\),\.gf:lang\(zh\)\{font-family:[^;}]*var\(--cjk\);letter-spacing:normal\}/);
  assert.match(css, /\.auth:lang\(zh\) h1\{font-family:[^;}]*var\(--cjk\);letter-spacing:normal;/, 'the heading drops its negative tracking');
  assert.match(css, /\.auth__eyebrow:lang\(zh\)\{[^}]*text-transform:none\}/);
  assert.match(css, /\.auth a\.auth__lang\{[^}]*min-width:44px;min-height:44px;/);
  assert.doesNotMatch(css, /:lang\(zh\)[^{]*\{[^}]*letter-spacing:-/, 'no negative tracking on Chinese');
});

/* ---------- check.mjs: the en-NZ rule, extended with the zh allow-list ---------- */
const check = fileURLToPath(new URL('../scripts/check.mjs', import.meta.url));
const appPage = lang => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Sign in</title><meta name="robots" content="noindex"><script src="/auth/app.js"></script></head><body><h1>Sign in</h1></body></html>`;
function runCheck(files) {
  const dir = mkdtempSync(join(tmpdir(), 'site-check-zh-'));
  try {
    const all = { 'package.json': JSON.stringify({ homepage: 'https://example.test' }), 'sitemap.xml': '<urlset></urlset>', 'robots.txt': 'Sitemap: https://example.test/sitemap.xml\n', 'assets/enquiry.js': '', 'auth/app.js': '', ...files };
    for (const [f, s] of Object.entries(all)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), s); }
    const r = spawnSync(process.execPath, [check], { env: { ...process.env, SITE_CHECK_ROOT: dir }, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('check.mjs: the four Chinese pages must be zh-CN, every other app page must still be en-NZ', () => {
  const zh = Object.fromEntries(ZH.map(p => [`auth/zh/${p}.html`, appPage('zh-CN')]));
  let r = runCheck({ 'auth/login.html': appPage('en-NZ'), ...zh });
  assert.equal(r.code, 0, r.out);
  r = runCheck({ 'auth/login.html': appPage('zh-CN') });
  assert.equal(r.code, 1);
  assert.match(r.out, /ERROR {4}auth\/login\.html: missing lang="en-NZ"/, 'an English page cannot turn Chinese');
  r = runCheck({ 'auth/zh/login.html': appPage('en-NZ') });
  assert.match(r.out, /ERROR {4}auth\/zh\/login\.html: missing lang="zh-CN"/, 'a Chinese page cannot turn English');
  r = runCheck({ 'auth/zh/signup.html': appPage('zh-CN') });
  assert.equal(r.code, 1);
  assert.match(r.out, /ERROR {4}auth\/zh\/signup\.html: missing lang="en-NZ" \(not in ZH_APP_PAGES/, 'only the allow-list');
  r = runCheck({ 'auth/zh/reset.html': appPage('zh-cn') });
  assert.match(r.out, /auth\/zh\/reset\.html: missing lang="zh-CN"/, 'exactly zh-CN');
});

test('npm run check passes on the real site with the Chinese pages in it', () => {
  const r = spawnSync(process.execPath, [check], { encoding: 'utf8', env: { ...process.env, SITE_CHECK_ROOT: '' } });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /and 9 app pages: 0 errors/);
});
