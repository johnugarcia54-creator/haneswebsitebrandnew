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
     only `level` is read here (client | consultant | backoffice | admin), to pick the landing.
   - Errors are {error:{code, message}} with the codes of §4.3: invalid_input,
     privacy_ack_required, invalid_token, session_ended, email_unconfirmed, reauth_required,
     cross_origin, origin_required, not_allowed_here, signup_closed, account_disabled,
     invitation_needs_link, link_requires_invitation, rate_limited, auth_unavailable,
     auth_settings_unsafe. Any other answer: a 5xx or no answer at all (network, the 10 s
     timeout) means "signed in, but the studio is unavailable for a moment" with Retry; any
     other 4xx gets a general message.
   - POST /api/codes/preview {code} -> {valid:true, consultantFirstName, percentBp} or
     {valid:false} (ADDENDUM §5.2, stream P1a).
   - GET /api/settings/public -> {settings:{accounts:{publicSignup}}} (S0 §1).
   If A1's contract differs, change it here and in tests/auth.test.mjs, nowhere else.
   ========================================================================================= */

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

export function landingFor(session) {
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
  link_requires_invitation: 'This email belongs to a staff account. Use the invitation we sent, or ask Back Office.',
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

export function messageFor(code) {
  return typeof code === 'string' && Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : MESSAGES.unexpected;
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
export function supabaseMessage(error, flow) {
  const code = supabaseCode(error);
  if (code === 'network') return MESSAGES.supabase_network;
  if (RATE.has(code)) return MESSAGES.rate_limited;
  if (CAPTCHA.has(code)) return MESSAGES.captcha_failed;
  if (code === 'weak_password') return MESSAGES.weak_password;
  if (code === 'same_password') return MESSAGES.same_password;
  if (flow === 'login') return MESSAGES.bad_credentials;
  if (flow === 'password') return code === 'session_missing' || code === 'session_not_found' || code === 'no_authorization' ? MESSAGES.session_missing : MESSAGES.unexpected;
  return MESSAGES.unexpected;
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
  if (!token) return { action: 'error', code: 'session_missing', message: MESSAGES.session_missing };
  const r = await deps.exchange(token, extra);
  if (r.ok) return onOk(r.session);
  if (retryable(r)) return { action: 'error', code: r.code, message: messageFor(r.code), retry: () => exchangeStep(deps, extra, onOk) };
  await signOutLocal(deps.supabase);
  if (r.code === 'reauth_required') return { action: 'go', to: '/auth/login.html?reason=reauth', code: r.code };
  return { action: 'error', code: r.code, message: messageFor(r.code) };
}

export const validEmail = e => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validPassword = p => typeof p === 'string' && [...p].length >= PASSWORD_MIN && [...p].length <= PASSWORD_MAX;

// `captcha` (sign-in, resend, reset): true (the default) while Turnstile is live, so a missing token
// stops the flow; false until its site key exists, when no token is sent at all (Supabase CAPTCHA
// protection stays off until the widget is live). Sign-up always needs a token: it fails closed.
const needsToken = (captcha, captchaToken) => captcha !== false && !captchaToken;

// sign-in (§3.3.3): the remember choice first, then Supabase (with Turnstile when on), then our server
export async function loginFlow({ email, password, remember, captchaToken, captcha = true, next = [] }, deps) {
  if (needsToken(captcha, captchaToken)) return { action: 'error', code: 'captcha_needed', message: MESSAGES.captcha_needed };
  (deps.rememberChoice || rememberChoice)(!!remember, deps.w);
  const { error } = await deps.supabase.auth.signInWithPassword(captcha === false ? { email, password } : { email, password, options: { captchaToken } });
  if (error) {
    const code = supabaseCode(error);
    return { action: 'error', code, message: supabaseMessage(error, 'login'), resend: code !== 'network' && !RATE.has(code) && !CAPTCHA.has(code) };
  }
  return exchangeStep(deps, {}, session => ({ action: 'go', to: destination(session, ...next) }));
}

// Resend confirmation (§3.3.3), with its own Turnstile token when on; the answer never depends on the account
export async function resendFlow({ email, captchaToken, captcha = true, origin }, deps) {
  if (needsToken(captcha, captchaToken)) return { action: 'error', code: 'captcha_needed', message: MESSAGES.captcha_needed };
  const redirect = { emailRedirectTo: origin + '/auth/confirm.html' };
  const { error } = await deps.supabase.auth.resend({ type: 'signup', email, options: captcha === false ? redirect : { captchaToken, ...redirect } });
  const code = supabaseCode(error);
  if (EMAIL_RATE.has(code)) return { action: 'done', message: MESSAGES.resend_sent };
  if (code === 'network' || RATE.has(code) || CAPTCHA.has(code)) return { action: 'error', code, message: supabaseMessage(error, 'resend') };
  return { action: 'done', message: MESSAGES.resend_sent };
}

// Password reset (§3.3.5): always the same answer, unless nothing could be sent at all
export async function resetFlow({ email, captchaToken, captcha = true, origin }, deps) {
  if (needsToken(captcha, captchaToken)) return { action: 'error', code: 'captcha_needed', message: MESSAGES.captcha_needed };
  const redirect = { redirectTo: origin + '/auth/confirm.html' };
  const { error } = await deps.supabase.auth.resetPasswordForEmail(email, captcha === false ? redirect : { ...redirect, captchaToken });
  const code = supabaseCode(error);
  if (EMAIL_RATE.has(code)) return { action: 'done', message: MESSAGES.reset_sent };
  if (code === 'network' || RATE.has(code) || CAPTCHA.has(code)) return { action: 'error', code, message: supabaseMessage(error, 'reset') };
  return { action: 'done', message: MESSAGES.reset_sent };
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
  if (!CONFIRM_TYPES.includes(type) || typeof tokenHash !== 'string' || !/^[A-Za-z0-9_-]{6,512}$/.test(tokenHash)) {
    return { action: 'error', code: 'link_incomplete', message: MESSAGES.link_incomplete };
  }
  if (type === 'invite' && !privacyAck) return { action: 'error', code: 'privacy_ack_required', message: MESSAGES.privacy_ack_required };
  (deps.keepChoice || keepChoice)(deps.w); // the new session survives the next page's hygiene
  const { data, error } = await deps.supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !data || !data.session) {
    if (supabaseCode(error) === 'network') return { action: 'error', code: 'network', message: MESSAGES.supabase_network };
    return { action: 'error', code: 'link_expired', message: type === 'invite' ? MESSAGES.link_expired_invite : MESSAGES.link_expired };
  }
  return afterConfirm({ type, next }, deps);
}

// the part after verifyOtp; also what Retry runs when the studio was unavailable
export function afterConfirm({ type, next = [] }, deps) {
  if (type === 'invite') {
    return exchangeStep(deps, { purpose: 'invite', privacyNoticeVersion: PRIVACY_NOTICE_VERSION }, () => ({ action: 'go', to: '/auth/update-password.html?invite=1' }));
  }
  if (type === 'recovery') return { action: 'go', to: '/auth/update-password.html' };
  return exchangeStep(deps, {}, session => ({ action: 'go', to: destination(session, ...next) }));
}

// Setting a password (§3.3.2a, §3.3.5 step 3): updateUser first, then the exchange with revokeOthers
export async function passwordFlow({ password, confirm, invite }, deps) {
  if (!validPassword(password)) return { action: 'error', code: 'password_length', message: MESSAGES.password_length };
  if (confirm !== undefined && confirm !== password) return { action: 'error', code: 'passwords_differ', message: MESSAGES.passwords_differ };
  const { error } = await deps.supabase.auth.updateUser({ password });
  if (error) return { action: 'error', code: supabaseCode(error), message: supabaseMessage(error, 'password') };
  return exchangeStep(deps, { revokeOthers: true }, session => ({
    action: 'done', message: invite ? MESSAGES.password_set : MESSAGES.password_changed, to: landingFor(session)
  }));
}

export const passwordOk = validPassword;
