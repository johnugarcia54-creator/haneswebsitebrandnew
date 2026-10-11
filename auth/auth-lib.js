/* =========================================================================================
   auth/auth-lib.js: everything the sign-in pages decide, as plain functions (ADDENDUM §6.3).
   auth/auth.js wires these to the page; tests/auth.test.mjs runs them in Node with a stubbed
   supabase-js. Nothing here touches the DOM, and nothing here builds HTML.

   The server contract (stream A1). docs/api/S1-accounts.md did not exist when this was written,
   so these assumptions come straight from ADDENDUM §4.3 and §4.5 and are checked by the tests:
   - POST /api/auth/exchange, same origin, JSON body {accessToken, purpose?:'invite',
     revokeOthers?:boolean, privacyNoticeVersion?:string}; the token is never put in a URL.
     Our server checks Origin itself, so no CSRF token is sent (there is no session yet).
   - 200 = the S0 session payload {user, csrfToken, level, capabilities, features, home, ...};
     `auth.landing` picks the landing when it is a safe path into the studio; otherwise `level`
     (client | consultant | backoffice | admin) does, through LANDINGS.
   - Errors are {error:{code, message}} with the codes of §4.3: invalid_input,
     privacy_ack_required, invalid_token, session_ended, email_unconfirmed, reauth_required,
     cross_origin, origin_required, not_allowed_here, signup_closed, account_disabled,
     invitation_needs_link, link_requires_invitation, rate_limited, auth_unavailable,
     auth_settings_unsafe; and from the studio's accounts module: mfa_required, email_in_use,
     account_already_linked, confirm_link_required, exchange_race. Any other answer: a 5xx or
     no answer at all (network, the 10 s timeout) means "signed in, but the studio is
     unavailable for a moment" with Retry; any other 4xx gets a general message.
   - POST /api/codes/preview {code} -> {valid:true, consultantFirstName, percentBp} or
     {valid:false} (ADDENDUM §5.2, stream P1a).
   - GET /api/settings/public -> {settings:{accounts:{publicSignup}}} (S0 §1).
   If A1's contract differs, change it here and in tests/auth.test.mjs, nowhere else.
   ========================================================================================= */

import { MESSAGES_ZH, UI_ZH } from './messages-zh.js';

export const PRIVACY_NOTICE_VERSION = '2026-10-09';
export const EXCHANGE_PATH = '/api/auth/exchange';
export const EXCHANGE_TIMEOUT_MS = 10000;
export const CONFIRM_TYPES = Object.freeze(['email', 'recovery', 'invite', 'email_change']);
export const PASSWORD_MIN = 12, PASSWORD_MAX = 72, NAME_MAX = 120, NEXT_MAX = 300;

/* ---- where a person goes after signing in (ADDENDUM §2.2) -------------------------------- */
export const LANDINGS = Object.freeze({
  client: '/studio/#/account',
  consultant: '/studio/consultant.html',
  backoffice: '/studio/#/backoffice',
  admin: '/studio/#/backoffice'
});
export const DEFAULT_LANDING = '/studio/';

// The studio's own answer wins: the session's auth.landing (studio 10-accounts.cjs LANDING), when it
// passes safeNext and is a path into the studio (never the sign-in pages, never another origin).
// LANDINGS stays as the fallback for an older studio or a landing that fails those checks.
export function studioLanding(session, origin = globalThis.location && globalThis.location.origin) {
  const auth = session && typeof session === 'object' && session.auth && typeof session.auth === 'object' ? session.auth : null;
  const landing = auth && Object.hasOwn(auth, 'landing') ? safeNext(auth.landing, origin) : null;
  return landing && landing.startsWith('/studio/') ? landing : null;
}

export function landingFor(session, origin) {
  const fromStudio = studioLanding(session, origin);
  if (fromStudio) return fromStudio;
  const level = session && typeof session === 'object' ? session.level : null;
  return typeof level === 'string' && Object.hasOwn(LANDINGS, level) ? LANDINGS[level] : DEFAULT_LANDING;
}

// `next` is kept only when it is a path into the studio or the sign-in pages of this very site.
// Returns the normalised path (pathname + search + hash), or null.
export function safeNext(next, origin = globalThis.location && globalThis.location.origin) {
  if (typeof next !== 'string' || typeof origin !== 'string' || !origin) return null;
  if (!next || next.length > NEXT_MAX) return null;
  if (!next.startsWith('/studio/') && !next.startsWith('/auth/')) return null; // also refuses //host, schemes, javascript:
  if (next.includes('\\')) return null;
  if (/[\u0000-\u0020\u007f-\u00a0\u2028\u2029\ufeff]/.test(next)) return null; // control characters and spaces
  // encoded dots, slashes, backslashes, control characters, spaces and double encoding
  if (/%(?:2e|2f|5c|25|20|0[0-9a-f]|1[0-9a-f]|7f)/i.test(next)) return null;
  if (next.split(/[/?#]/).some(s => s === '.' || s === '..')) return null;
  let base, u;
  try { base = new URL(origin); u = new URL(next, base); } catch { return null; }
  if (u.origin !== base.origin || u.username || u.password) return null;
  if (!u.pathname.startsWith('/studio/') && !u.pathname.startsWith('/auth/')) return null;
  return u.pathname + u.search + u.hash;
}

// the first candidate that passes safeNext, else the landing for the session's level
export function destination(session, ...candidates) {
  for (const c of candidates) { const n = safeNext(c); if (n) return n; }
  return landingFor(session);
}

/* ---- the two languages (RP-29) -----------------------------------------------------------
   English pages live in /auth/, Chinese ones (for our suppliers and the China team) in /auth/zh/.
   Every flow takes deps.lang ('en', the default, or 'zh'): it picks the messages and keeps the
   person in their language for every page it sends them to and every link Supabase emails. */
export const LANGS = Object.freeze(['en', 'zh']);
// the pages that exist in Chinese; sign-up does not (suppliers are invited)
export const ZH_PAGES = Object.freeze(['login', 'confirm', 'reset', 'update-password']);
export const langOf = v => (v === 'zh' ? 'zh' : 'en');
// /auth/<name>.html or /auth/zh/<name>.html (English when there is no Chinese page)
export const authPage = (name, lang) => (langOf(lang) === 'zh' && ZH_PAGES.includes(name) ? '/auth/zh/' : '/auth/') + name + '.html';
const msgs = lang => (langOf(lang) === 'zh' ? MESSAGES_ZH : MESSAGES);
export const textsFor = lang => ({ messages: msgs(lang), ui: langOf(lang) === 'zh' ? UI_ZH : UI });

/* ---- what we say (NZ English; nothing reveals whether an account exists) ------------------ */
export const MESSAGES = Object.freeze({
  // the exchange (§4.3)
  invalid_input: "Something in that request wasn't right. Reload the page and try again.",
  privacy_ack_required: "Tick “I've read the privacy statement” to continue.",
  invalid_token: "Your sign-in didn't go through. Please sign in again.",
  session_ended: 'Your sign-in has ended. Please sign in again.',
  email_unconfirmed: 'Confirm your email first: open the link we sent you.',
  reauth_required: 'For your security, please sign in again with your password.',
  cross_origin: "You can only sign in from our own website. Open the sign-in page there and try again.",
  origin_required: "You can only sign in from our own website. Open the sign-in page there and try again.",
  not_allowed_here: "This email can't sign in on this version of the site.",
  signup_closed: 'Your account is confirmed. Accounts open soon.',
  account_disabled: 'This account is disabled. Contact us.',
  invitation_needs_link: 'This invitation link has expired or was already used. Ask for a new one.',
  link_requires_invitation: 'To sign in for the first time, open the invitation we emailed you. For a new one, ask whoever invited you.',
  mfa_required: "This sign-in needs a second step that this page can't do yet. Contact us and we'll help.",
  email_in_use: "We couldn't finish setting up this sign-in. Contact us and we'll sort it out.",
  account_already_linked: "We couldn't finish setting up this sign-in. Sign in the way you did before, or contact us.",
  confirm_link_required: 'To finish setting up, open the link in the email we sent you.',
  exchange_race: 'Two sign-ins crossed paths. Please sign in again.',
  rate_limited: 'Too many attempts. Wait a few minutes, then try again.',
  auth_unavailable: "You're signed in, but the studio is unavailable for a moment.",
  auth_settings_unsafe: "You're signed in, but the studio is unavailable for a moment.",
  unavailable: "You're signed in, but the studio is unavailable for a moment.",
  network: "You're signed in, but the studio is unavailable for a moment.",
  unexpected: 'Something went wrong. Please try again in a moment.',
  // the pages themselves
  bad_credentials: "That email and password don't match, or the account isn't confirmed yet.",
  captcha_failed: "The security check didn't pass. Please try it again.",
  captcha_needed: 'Please complete the security check first.',
  supabase_network: "We couldn't reach the sign-in service. Check your connection and try again.",
  weak_password: 'Choose a different password: that one is too easy to guess or has appeared in a data breach.',
  same_password: 'Choose a password you have not used for this account before.',
  password_length: `Use ${PASSWORD_MIN} to ${PASSWORD_MAX} characters for your password.`,
  passwords_differ: "The two passwords don't match.",
  link_incomplete: "This link is incomplete. Open the link from your email again, or ask for a new one.",
  paste_not_link: "That isn't one of our sign-in links. Paste the whole address of the page the email's button opened (it starts with localhost), or the button's own link.",
  paste_empty: 'Paste the link first.',
  paste_lost: 'This page lost its link. Paste it again below, or ask for a new one.',
  reset_too_slow: 'That took longer than 10 minutes after the email\'s link was opened. Ask for a new reset link and finish straight away.',
  link_expired: 'This link has expired or was already used. Ask for a new one.',
  link_expired_invite: 'This invitation link has expired or was already used. Ask for a new one.',
  session_missing: 'Your link has expired. Open the link from your email again, or ask for a new one.',
  signup_sent: 'Check your email to confirm your account.',
  reset_sent: "If that email has an account, we've sent a link.",
  resend_sent: "If that email has an account waiting for confirmation, we've sent a new link.",
  password_set: "Password set. You're signed in on this device only.",
  password_changed: "Password changed. You're signed in on this device only.",
  accounts_closed: "Accounts open soon. Send us an enquiry and we'll set you up, or ask your consultant for an invitation.",
  not_configured: "Sign-in is being set up. It will be ready here soon; until then, send us an enquiry and we'll help."
});

export function messageFor(code, lang) {
  const m = msgs(lang);
  return typeof code === 'string' && Object.hasOwn(m, code) ? m[code] : m.unexpected;
}

// the words auth.js puts on the page itself (UI_ZH in auth/messages-zh.js has the same keys)
export const UI = Object.freeze({
  title_suffix: ' — Bargainhub studio',
  spent_title: "This link can't be used",
  spent_sub: "If the email's link opened more than one page, paste the first page's address below. Otherwise ask for a new link.",
  paste_title: 'Paste the link from your email',
  paste_sub: 'Paste it below to continue.',
  choose_password: 'Choose your password',
  confirm_email: ['Confirm your email', 'Press Confirm to finish setting up your account.', 'Confirm'],
  confirm_email_change: ['Confirm your new email', 'Press Confirm to start using your new email address.', 'Confirm'],
  confirm_recovery: ['Reset your password', 'Press Confirm, then choose a new password.', 'Confirm'],
  confirm_invite: ['Accept your invitation', 'Read the privacy statement, tick the box, then press Confirm and continue to choose your password.', 'Confirm and continue'],
  reauth_note: 'Your new password is saved. Sign in with it to continue.',
  enter_email: 'Enter your email address.',
  enter_password: 'Enter your password.',
  enter_name: 'Enter your name.',
  enter_other: 'Enter this.',
  tick_box: 'Tick this box to continue.',
  email_format: 'Enter an email address, like name@example.co.nz.',
  min_chars: 'Use at least {n} characters.',
  max_chars: 'Use at most {n} characters.',
  show: 'Show',
  hide: 'Hide',
  show_password: 'Show password',
  hide_password: 'Hide password',
  signing_in: 'Signing in…',
  sending: 'Sending…',
  confirming: 'Confirming…',
  saving: 'Saving…',
  opening: 'Opening…',
  trying_again: 'Trying again…',
  captcha_load_failed: "The security check couldn't load. Reload the page, or check that nothing is blocking challenges.cloudflare.com."
});

// The same page in the other language (the 中文 / English button). It carries only what that page
// uses: a safe next, the confirm type, invite=1 and reason=reauth. On confirm.html the link held in
// memory goes too (`link`: auth.js passes it only when the button is pressed, so it is never in an
// href); the page it opens removes it from the address bar at once, as it does any email link.
// Returns a root-absolute path, or null when the page has no counterpart.
export function otherLangPage(pathname, search, link = null, origin = globalThis.location && globalThis.location.origin) {
  const m = typeof pathname === 'string' ? /^\/auth\/(zh\/)?([a-z-]+)\.html$/.exec(pathname) : null;
  if (!m || !ZH_PAGES.includes(m[2])) return null;
  const to = m[1] ? 'en' : 'zh', name = m[2];
  let p;
  try { p = new URLSearchParams(typeof search === 'string' ? search : ''); } catch { return null; }
  const q = new URLSearchParams();
  const next = safeNext(p.get('next'), origin);
  if (next) q.set('next', next);
  if (name === 'confirm' && CONFIRM_TYPES.includes(p.get('type'))) q.set('type', p.get('type'));
  if (name === 'update-password' && p.get('invite') === '1') q.set('invite', '1');
  if (name === 'login' && p.get('reason') === 'reauth') q.set('reason', 'reauth');
  let hash = '';
  if (name === 'confirm' && link && typeof link === 'object') {
    if (typeof link.tokenHash === 'string' && TOKEN_HASH_SHAPE.test(link.tokenHash) && CONFIRM_TYPES.includes(link.type)) {
      q.set('token_hash', link.tokenHash);
      q.set('type', link.type);
    } else if (link.hash && typeof link.hash === 'object') {
      const h = new URLSearchParams(), x = link.hash;
      if (typeof x.accessToken === 'string' && JWT_SHAPE.test(x.accessToken) && typeof x.refreshToken === 'string' && REFRESH_SHAPE.test(x.refreshToken)) {
        h.set('access_token', x.accessToken); h.set('refresh_token', x.refreshToken);
      }
      if (typeof x.errorCode === 'string' && /^[a-z_]{1,64}$/.test(x.errorCode)) h.set('error_code', x.errorCode);
      if (CONFIRM_TYPES.includes(x.type)) h.set('type', x.type);
      if (h.has('access_token') || h.has('error_code')) hash = '#' + h.toString();
    }
  }
  const qs = q.toString();
  return authPage(name, to) + (qs ? '?' + qs : '') + hash;
}

// the studio is down, unreachable, timed out (408) or busy (429), not a refusal: the Supabase
// session is kept and the person may retry the exchange, so a one-time link is never spent for nothing
export const retryable = r => !!r && !r.ok && (r.status === 0 || r.status === 408 || r.status === 429 || r.status >= 500);

/* ---- "Keep me signed in" (ADDENDUM §3.3.4) ------------------------------------------------ */
const COOKIE_ATTRS = '; Path=/; SameSite=Strict; Secure';
export function rememberChoice(remember, w = globalThis) {
  try {
    if (remember) w.localStorage.setItem('bh_remember', '1');
    else w.localStorage.removeItem('bh_remember');
  } catch { /* storage blocked: supabase-js cannot keep a session either */ }
  try { w.document.cookie = remember ? 'bh_live=' + COOKIE_ATTRS + '; Max-Age=0' : 'bh_live=1' + COOKIE_ATTRS; } catch { /* no cookie access */ }
  return remember ? 'remember' : 'session';
}
export function isRemembered(w = globalThis) {
  try { return w.localStorage.getItem('bh_remember') === '1'; } catch { return false; }
}
// a page that starts a session without the checkbox (confirm): keep the choice made before, or this browser session
export const keepChoice = (w = globalThis) => rememberChoice(isRemembered(w), w);

/* ---- bhAuthHygiene: the shared contract, identical to assets/site.js (ADDENDUM §3.3.4) ----- */
// BEGIN bhAuthHygiene
function bhAuthHygiene(w = globalThis) {
  let store, keys = [];
  try {
    store = w.localStorage;
    for (let i = 0; i < store.length; i++) { const k = store.key(i); if (/^sb-[a-z0-9]+-auth-token$/.test(k)) keys.push(k); }
  } catch { return 'unavailable'; }
  if (!keys.length) return 'none';
  let live = false, remember = false;
  try { live = /(?:^|;\s*)bh_live=1(?:;|$)/.test(String(w.document.cookie)); } catch { /* no cookie access */ }
  try { remember = store.getItem('bh_remember') === '1'; } catch { /* treat as not remembered */ }
  if (live || remember) return 'kept';
  try { for (const k of keys) store.removeItem(k); } catch { return 'unavailable'; }
  try {
    const get = { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    Promise.resolve(w.fetch('/api/session', get)).then(r => (r && r.ok ? r.json() : null)).then(s => {
      if (s && s.user && typeof s.csrfToken === 'string' && s.csrfToken) {
        return w.fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrfToken }, body: '{}' });
      }
    }).catch(() => {});
  } catch { /* fetch unavailable: the keys are gone, which is what matters */ }
  return 'cleared';
}
// END bhAuthHygiene
export { bhAuthHygiene };

/* ---- our server ---------------------------------------------------------------------------- */
const EXCHANGE_KEYS = ['purpose', 'revokeOthers', 'privacyNoticeVersion'];

// POST /api/auth/exchange. Resolves {ok:true, status, session} or {ok:false, status, code};
// status 0 means no answer (network or the 10 s timeout). Never throws.
export async function exchange(accessToken, extra = {}, { fetch = globalThis.fetch, timeoutMs = EXCHANGE_TIMEOUT_MS } = {}) {
  if (typeof accessToken !== 'string' || !accessToken) return { ok: false, status: 401, code: 'invalid_token' };
  const body = { accessToken };
  for (const k of EXCHANGE_KEYS) if (extra && extra[k] !== undefined) body[k] = extra[k];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(EXCHANGE_PATH, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (res.ok && data && typeof data === 'object' && data.user) return { ok: true, status: res.status, session: data };
    // with no error code in the answer (an edge or proxy wrote it), the status says what happened
    const code = data && data.error && typeof data.error.code === 'string' ? data.error.code
      : res.status >= 500 || res.ok || res.status === 408 ? 'unavailable' : res.status === 429 ? 'rate_limited' : 'unexpected';
    return { ok: false, status: res.ok ? 502 : res.status, code };
  } catch {
    return { ok: false, status: 0, code: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

// small JSON helper for the two public reads the pages make (same origin, 10 s)
export async function getJson(path, { fetch = globalThis.fetch, method = 'GET', body, timeoutMs = EXCHANGE_TIMEOUT_MS } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const init = { method, credentials: 'same-origin', cache: 'no-store', signal: ctl.signal, headers: { Accept: 'application/json' } };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const res = await fetch(path, init);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; } finally { clearTimeout(timer); }
}

// Sign-up is open only when the studio says so; a failed read means closed (ADDENDUM §3.3.1)
export async function publicSignupOpen(opts) {
  const s = await getJson('/api/settings/public', opts);
  return !!(s && s.settings && s.settings.accounts && s.settings.accounts.publicSignup === true);
}

export const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/;
export const cleanCode = c => (typeof c === 'string' && CODE_PATTERN.test(c.trim()) ? c.trim() : '');
export async function previewCode(code, opts) {
  const c = cleanCode(code);
  if (!c) return null;
  const r = await getJson('/api/codes/preview', { ...opts, method: 'POST', body: { code: c } });
  if (!r || typeof r.valid !== 'boolean') return { state: 'unknown' };
  if (!r.valid) return { state: 'invalid', message: "We don't recognise that code." };
  const name = typeof r.consultantFirstName === 'string' && r.consultantFirstName.trim() ? r.consultantFirstName.trim().slice(0, 60) : '';
  const pct = Number.isInteger(r.percentBp) && r.percentBp > 0 && r.percentBp <= 10000 ? `${r.percentBp / 100}%` : '';
  const who = name ? `your consultant ${name}` : 'your consultant';
  return { state: 'valid', message: `Code recorded: ${who} will apply your ${pct ? pct + ' ' : ''}discount on your quote.` };
}

/* ---- supabase-js answers ------------------------------------------------------------------- */
export function supabaseCode(error) {
  if (!error) return null;
  if (typeof error.code === 'string' && error.code) return error.code;
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) return 'network';
  if (error.name === 'AuthWeakPasswordError') return 'weak_password';
  if (error.name === 'AuthSessionMissingError') return 'session_missing';
  return 'unknown';
}
const RATE = new Set(['over_request_rate_limit', 'over_email_send_rate_limit', 'too_many_requests']);
const CAPTCHA = new Set(['captcha_failed']);
// Supabase sends over_email_send_rate_limit only for an email that has an account (an unknown
// email gets 200 before any email is sent), so reset, resend and sign-up answer it exactly as
// they answer success: anything else would say whether the account exists (§3.3.5).
const EMAIL_RATE = new Set(['over_email_send_rate_limit']);
// what a person sees for a Supabase error in each flow; never says whether an account exists
export function supabaseMessage(error, flow, lang) {
  const M = msgs(lang);
  const code = supabaseCode(error);
  if (code === 'network') return M.supabase_network;
  if (RATE.has(code)) return M.rate_limited;
  if (CAPTCHA.has(code)) return M.captcha_failed;
  if (code === 'weak_password') return M.weak_password;
  if (code === 'same_password') return M.same_password;
  if (flow === 'login') return M.bad_credentials;
  if (flow === 'password') return code === 'session_missing' || code === 'session_not_found' || code === 'no_authorization' ? M.session_missing : M.unexpected;
  return M.unexpected;
}

/* ---- the flows ----------------------------------------------------------------------------
   Each takes plain values and its collaborators ({supabase, exchange, ...}) and resolves an
   outcome: {action:'go', to}, {action:'done', message, to?} or {action:'error', message, code,
   retry?, resend?}. `retry` is a function that tries the exchange again (the studio was down).
   A refusal from our server ends the Supabase session in this browser (scope local), so the
   site never shows My account for a session our server will not accept. */
const signOutLocal = async supabase => { try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* best effort */ } };
const tokenOf = async supabase => {
  try { const { data } = await supabase.auth.getSession(); return (data && data.session && data.session.access_token) || null; } catch { return null; }
};

// run an exchange with the token of the current session; `onOk(session)` makes the outcome
async function exchangeStep(deps, extra, onOk) {
  const token = await tokenOf(deps.supabase);
  if (!token) return { action: 'error', code: 'session_missing', message: msgs(deps.lang).session_missing };
  const r = await deps.exchange(token, extra);
  if (r.ok) return onOk(r.session);
  if (retryable(r)) return { action: 'error', code: r.code, message: messageFor(r.code, deps.lang), retry: () => exchangeStep(deps, extra, onOk) };
  await signOutLocal(deps.supabase);
  if (r.code === 'reauth_required') return { action: 'go', to: authPage('login', deps.lang) + '?reason=reauth', code: r.code };
  return { action: 'error', code: r.code, message: messageFor(r.code, deps.lang) };
}

export const validEmail = e => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validPassword = p => typeof p === 'string' && [...p].length >= PASSWORD_MIN && [...p].length <= PASSWORD_MAX;

// `captcha` (sign-in, resend, reset): true (the default) while Turnstile is live, so a missing token
// stops the flow; false until its site key exists, when no token is sent at all (Supabase CAPTCHA
// protection stays off until the widget is live). Sign-up always needs a token: it fails closed.
const needsToken = (captcha, captchaToken) => captcha !== false && !captchaToken;

// sign-in (§3.3.3): the remember choice first, then Supabase (with Turnstile when on), then our server
export async function loginFlow({ email, password, remember, captchaToken, captcha = true, next = [] }, deps) {
  if (needsToken(captcha, captchaToken)) return { action: 'error', code: 'captcha_needed', message: msgs(deps.lang).captcha_needed };
  (deps.rememberChoice || rememberChoice)(!!remember, deps.w);
  const { error } = await deps.supabase.auth.signInWithPassword(captcha === false ? { email, password } : { email, password, options: { captchaToken } });
  if (error) {
    const code = supabaseCode(error);
    return { action: 'error', code, message: supabaseMessage(error, 'login', deps.lang), resend: code !== 'network' && !RATE.has(code) && !CAPTCHA.has(code) };
  }
  return exchangeStep(deps, {}, session => ({ action: 'go', to: destination(session, ...next) }));
}

// Resend confirmation (§3.3.3), with its own Turnstile token when on; the answer never depends on the account
export async function resendFlow({ email, captchaToken, captcha = true, origin }, deps) {
  const M = msgs(deps.lang);
  if (needsToken(captcha, captchaToken)) return { action: 'error', code: 'captcha_needed', message: M.captcha_needed };
  const redirect = { emailRedirectTo: origin + authPage('confirm', deps.lang) };
  const { error } = await deps.supabase.auth.resend({ type: 'signup', email, options: captcha === false ? redirect : { captchaToken, ...redirect } });
  const code = supabaseCode(error);
  if (EMAIL_RATE.has(code)) return { action: 'done', message: M.resend_sent };
  if (code === 'network' || RATE.has(code) || CAPTCHA.has(code)) return { action: 'error', code, message: supabaseMessage(error, 'resend', deps.lang) };
  return { action: 'done', message: M.resend_sent };
}

// Password reset (§3.3.5): always the same answer, unless nothing could be sent at all
export async function resetFlow({ email, captchaToken, captcha = true, origin }, deps) {
  const M = msgs(deps.lang);
  if (needsToken(captcha, captchaToken)) return { action: 'error', code: 'captcha_needed', message: M.captcha_needed };
  const redirect = { redirectTo: origin + authPage('confirm', deps.lang) };
  const { error } = await deps.supabase.auth.resetPasswordForEmail(email, captcha === false ? redirect : { ...redirect, captchaToken });
  const code = supabaseCode(error);
  if (EMAIL_RATE.has(code)) return { action: 'done', message: M.reset_sent };
  if (code === 'network' || RATE.has(code) || CAPTCHA.has(code)) return { action: 'error', code, message: supabaseMessage(error, 'reset', deps.lang) };
  return { action: 'done', message: M.reset_sent };
}

// Sign-up (§3.3.1): one answer for a new and an existing email (Supabase obfuscates the latter)
export async function signupFlow({ name, email, password, code, privacyAck, marketing, captchaToken, origin }, deps) {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n || n.length > NAME_MAX) return { action: 'error', code: 'invalid_name', message: `Enter your name (up to ${NAME_MAX} characters).` };
  if (!validEmail(email)) return { action: 'error', code: 'invalid_email', message: 'Enter your email address, like name@example.co.nz.' };
  if (!validPassword(password)) return { action: 'error', code: 'password_length', message: MESSAGES.password_length };
  if (!privacyAck)return { action: 'error', code: 'privacy_ack_required', message: MESSAGES.privacy_ack_required };
  if (!captchaToken) return { action: 'error', code: 'captcha_needed', message: MESSAGES.captcha_needed };
  const { error } = await deps.supabase.auth.signUp({
    email, password,
    options: {
      emailRedirectTo: origin + '/auth/confirm.html',
      captchaToken,
      data: { name: n, signup_code: cleanCode(code) || null, privacy_notice_version: PRIVACY_NOTICE_VERSION, marketing_opt_in: !!marketing }
    }
  });
  const c = supabaseCode(error);
  if (!error || c === 'user_already_exists' || c === 'email_exists' || EMAIL_RATE.has(c)) return { action: 'done', message: MESSAGES.signup_sent };
  if (c === 'signup_disabled') return { action: 'error', code: c, message: MESSAGES.accounts_closed, closed: true };
  return { action: 'error', code: c, message: supabaseMessage(error, 'signup') };
}

// The confirmation landing (§3.3.2), run only from the Confirm button. The order is the contract:
//   invite       -> verifyOtp, then the invite exchange at once, then update-password
//   recovery     -> verifyOtp, then update-password (no exchange until the password is set)
//   email, email_change -> verifyOtp, then the exchange, then next or the landing
export async function confirmFlow({ type, tokenHash, privacyAck, next = [] }, deps) {
  const M = msgs(deps.lang);
  if (!CONFIRM_TYPES.includes(type) || typeof tokenHash !== 'string' || !/^[A-Za-z0-9_-]{6,512}$/.test(tokenHash)) {
    return { action: 'error', code: 'link_incomplete', message: M.link_incomplete };
  }
  if (type === 'invite' && !privacyAck) return { action: 'error', code: 'privacy_ack_required', message: M.privacy_ack_required };
  (deps.keepChoice || keepChoice)(deps.w); // the new session survives the next page's hygiene
  const { data, error } = await deps.supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !data || !data.session) {
    if (supabaseCode(error) === 'network') return { action: 'error', code: 'network', message: M.supabase_network };
    return { action: 'error', code: 'link_expired', message: type === 'invite' ? M.link_expired_invite : M.link_expired };
  }
  return afterConfirm({ type, next }, deps);
}

/* ---- the fallback: Supabase's default {{ .ConfirmationURL }} link ---------------------------
   (a) above, the token_hash link of the §3.4 templates, is the primary path. Until those templates
   are applied, Supabase's default link goes to /auth/v1/verify first, which spends the token there
   and comes back to confirm.html with the session (or the error) in the address-bar hash. So a mail
   scanner that opens the link burns it before the person ever sees the page; that is why (a) stays
   primary and this is only the fallback. auth.js reads the hash once, before it removes it from the
   address bar, and nothing is sent to Supabase until the person presses the button.
   Supabase names an email confirmation 'signup' in the hash; magic links are not used (§3.4). */
const HASH_TYPES = Object.freeze({ invite: 'invite', recovery: 'recovery', signup: 'email', email: 'email', email_change: 'email_change' });
const JWT_SHAPE = /^[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{8,1024}$/;
const REFRESH_SHAPE = /^[A-Za-z0-9_-]{6,512}$/;

// {accessToken, refreshToken, type, errorCode} from the hash, or null when it carries no link at all
export function hashLink(hash) {
  if (typeof hash !== 'string' || hash.length < 2 || hash.length > 16384) return null;
  let p;
  try { p = new URLSearchParams(hash.replace(/^#/, '')); } catch { return null; }
  if (!['access_token', 'refresh_token', 'error', 'error_code'].some(k => p.has(k))) return null;
  const t = p.get('type');
  return {
    accessToken: p.get('access_token'),
    refreshToken: p.get('refresh_token'),
    type: t && Object.hasOwn(HASH_TYPES, t) ? HASH_TYPES[t] : null,
    errorCode: p.get('error_code') || p.get('error') || null
  };
}

/* ---- a pasted link ------------------------------------------------------------------------
   While Supabase's Site URL and redirect allow-list are not set (§14), the button in its email
   goes to /auth/v1/verify, which sends the browser on to the Site URL (localhost:3000, a page
   that never loads) instead of confirm.html. The person can copy the button's link, or the
   address the browser was sent to, and paste it on confirm.html or the reset page. This turns
   it into the confirm.html address that link was meant to open; nothing is sent anywhere and
   the token is still used only by the Confirm button:
     (a) Supabase's verify link of this project: its token is the token hash, so it opens the
         ?token_hash= link of the §3.4 templates (nothing is spent before Confirm);
     (b) any address carrying the session or error hash of a spent link: that hash on confirm.html;
     (c) our own ?token_hash= link: the same link, rebuilt.
   One layer of a mail provider's link wrapper (Google, Outlook Safe Links) is taken off first.
   Supabase's error hash names no type, so the page it was pasted on may give one (`type`: the reset
   page says recovery), which confirm.html then uses for its message and its way on.
   `lang` keeps the person in their language: 'zh' opens /auth/zh/confirm.html.
   Returns a root-absolute path on this site, or null. */
const PASTE_MAX = 8192;
const TOKEN_HASH_SHAPE = /^[A-Za-z0-9_-]{6,512}$/;
function unwrapMailLink(u) {
  const host = u.hostname.toLowerCase();
  if (/^(www\.)?google\.[a-z.]{2,10}$/.test(host) && u.pathname === '/url') return u.searchParams.get('q') || u.searchParams.get('url');
  if (/\.safelinks\.protection\.outlook\.com$/.test(host)) return u.searchParams.get('url');
  return null;
}
export function pastedLinkTarget(text, supabaseUrl, type = null, lang = 'en') {
  const confirmPage = authPage('confirm', lang);
  if (typeof text !== 'string' || typeof supabaseUrl !== 'string') return null;
  let s = text.replace(/\s+/g, '').replace(/^<(.*)>$/, '$1');
  if (!s || s.length > PASTE_MAX) return null;
  // an address bar shows localhost:3000/#… without its scheme; a pasted address is never opened, only read
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s;
  let u, sb;
  try { u = new URL(s); sb = new URL(supabaseUrl); } catch { return null; }
  for (let i = 0; i < 2; i++) {
    const inner = unwrapMailLink(u);
    if (!inner) break;
    try { u = new URL(inner); } catch { return null; }
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const tokenLink = (tokenHash, t) => {
    const type = t && Object.hasOwn(HASH_TYPES, t) ? HASH_TYPES[t] : null;
    if (!type || typeof tokenHash !== 'string' || !TOKEN_HASH_SHAPE.test(tokenHash) || tokenHash.startsWith('pkce_')) return null;
    return confirmPage + '?token_hash=' + encodeURIComponent(tokenHash) + '&type=' + type;
  };
  // (a)
  if (u.protocol === 'https:' && u.host === sb.host && u.pathname === '/auth/v1/verify') return tokenLink(u.searchParams.get('token'), u.searchParams.get('type'));
  // (b)
  const h = hashLink(u.hash);
  if (h) return confirmPage + (!h.type && CONFIRM_TYPES.includes(type) ? '?type=' + type : '') + u.hash;
  // (c) (either language's confirm.html; the page it was pasted on keeps its own)
  if ((u.pathname === '/auth/confirm.html' || u.pathname === '/auth/zh/confirm.html') && u.searchParams.has('token_hash')) return tokenLink(u.searchParams.get('token_hash'), u.searchParams.get('type'));
  return null;
}

// what a hash link that came back with an error says (Supabase spent or refused the token)
export function hashLinkError(type, lang) {
  const M = msgs(lang);
  return { action: 'error', code: 'link_expired', message: type === 'invite' ? M.link_expired_invite : M.link_expired };
}

// The same order as confirmFlow, with setSession in place of verifyOtp (the token is already spent)
export async function confirmSessionFlow({ type, accessToken, refreshToken, privacyAck, next = [] }, deps) {
  if (!CONFIRM_TYPES.includes(type) || typeof accessToken !== 'string' || !JWT_SHAPE.test(accessToken) ||
      typeof refreshToken !== 'string' || !REFRESH_SHAPE.test(refreshToken)) {
    return { action: 'error', code: 'link_incomplete', message: msgs(deps.lang).link_incomplete };
  }
  if (type === 'invite' && !privacyAck) return { action: 'error', code: 'privacy_ack_required', message: msgs(deps.lang).privacy_ack_required };
  (deps.keepChoice || keepChoice)(deps.w); // the new session survives the next page's hygiene
  const { data, error } = await deps.supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error || !data || !data.session) {
    if (supabaseCode(error) === 'network') return { action: 'error', code: 'network', message: msgs(deps.lang).supabase_network };
    return hashLinkError(type, deps.lang);
  }
  return afterConfirm({ type, next }, deps);
}

// the part after verifyOtp (or setSession); also what Retry runs when the studio was unavailable
export function afterConfirm({ type, next = [] }, deps) {
  if (type === 'invite') {
    return exchangeStep(deps, { purpose: 'invite', privacyNoticeVersion: PRIVACY_NOTICE_VERSION }, () => ({ action: 'go', to: authPage('update-password', deps.lang) + '?invite=1' }));
  }
  if (type === 'recovery') return { action: 'go', to: authPage('update-password', deps.lang) };
  return exchangeStep(deps, {}, session => ({ action: 'go', to: destination(session, ...next) }));
}

// Setting a password (§3.3.2a, §3.3.5 step 3): updateUser first, then the exchange with revokeOthers
export async function passwordFlow({ password, confirm, invite }, deps) {
  const M = msgs(deps.lang);
  if (!validPassword(password)) return { action: 'error', code: 'password_length', message: M.password_length };
  if (confirm !== undefined && confirm !== password) return { action: 'error', code: 'passwords_differ', message: M.passwords_differ };
  const { error } = await deps.supabase.auth.updateUser({ password });
  if (error) return { action: 'error', code: supabaseCode(error), message: supabaseMessage(error, 'password', deps.lang) };
  return exchangeStep(deps, { revokeOthers: true }, session => ({
    action: 'done', message: invite ? M.password_set : M.password_changed, to: landingFor(session)
  }));
}

export const passwordOk = validPassword;
