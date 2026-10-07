/* =========================================================================================
   auth/auth.js: wires the five sign-in pages to auth/auth-lib.js (ADDENDUM §3.3, §6.3).
   Order on every page:
     1. bhAuthHygiene() first (§3.3.4), before anything reads or writes the sign-in state.
     2. confirm.html only: token_hash leaves the address bar (history.replaceState) at once.
     3. The settings for this host (auth/config.js). While the publishable key or the Turnstile
        site key is still a placeholder, the page says "Sign-in is being set up" and makes no
        call to Supabase or Cloudflare at all.
   Text is only ever set with textContent; nothing is parsed as HTML. Turnstile is loaded here
   (explicit rendering) on login, sign-up and reset only, and only once the keys are real.
   ========================================================================================= */
import {
  bhAuthHygiene, safeNext, MESSAGES, exchange, rememberChoice, keepChoice, publicSignupOpen, previewCode, cleanCode,
  loginFlow, resendFlow, resetFlow, signupFlow, confirmFlow, passwordFlow, CONFIRM_TYPES, PASSWORD_MIN, PASSWORD_MAX
} from '/auth/auth-lib.js';
import { pickConfig } from '/auth/config.js';

bhAuthHygiene(window);

const page = document.body.dataset.page;
const params = new URLSearchParams(location.search);

// confirm.html: the one-time token never stays in the address bar, the history or a later Referer
const confirmLink = { tokenHash: params.get('token_hash'), type: params.get('type') };
if (page === 'confirm' && (params.has('token_hash') || /access_token|refresh_token|error/.test(location.hash))) {
  params.delete('token_hash');
  const q = params.toString();
  history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
}

const cfg = pickConfig(location.host);
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const NEEDS_TURNSTILE = new Set(['login', 'signup', 'reset']);

/* ---- small DOM helpers (textContent only) ---------------------------------------------- */
const $ = id => document.getElementById(id);
const show = (el, on = true) => { if (el) el.hidden = !on; };
const setText = (el, text) => { if (el) el.textContent = text; };
const els = { notice: $('notice'), alert: $('alert'), form: $('form'), done: $('done'), retryBox: $('retryBox'), retry: $('retry') };

function note(text) { setText(els.notice, text); show(els.notice, !!text); }
function fail(text) {
  setText(els.alert, text);
  show(els.alert, !!text);
  if (text) els.alert.focus({ preventScroll: false });
}
function finish(text, { focus = true } = {}) {
  show(els.form, false);
  show(els.alert, false);
  setText(els.done, text);
  show(els.done, true);
  if (focus) els.done.focus();
}
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  else { if (btn.dataset.label) btn.textContent = btn.dataset.label; btn.disabled = false; btn.removeAttribute('aria-busy'); }
}

// field messages: aria-invalid plus a message linked with aria-describedby
function fieldError(input, text) {
  const id = input.id + '-err';
  let p = $(id);
  const described = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(x => x && x !== id);
  if (!text) {
    input.removeAttribute('aria-invalid');
    if (p) p.remove();
    if (described.length) input.setAttribute('aria-describedby', described.join(' ')); else input.removeAttribute('aria-describedby');
    return;
  }
  if (!p) {
    p = document.createElement('p');
    p.id = id;
    p.className = 'auth__err';
    const field = input.closest('.auth__field');
    if (field) field.append(p); else (input.closest('.auth__check') || input).after(p);
  }
  p.textContent = text;
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', [id, ...described].join(' '));
}
const LABEL = { email: 'your email address', password: 'your password', name: 'your name' };
// checks the form's own fields; returns true, or puts the messages on the fields and focuses the first
function checkFields(form) {
  let first = null;
  for (const input of form.querySelectorAll('input')) {
    if (input.type === 'hidden' || input.disabled) continue;
    let msg = '';
    const v = input.type === 'checkbox' ? input.checked : input.value.trim();
    if (input.required && !v) msg = input.type === 'checkbox' ? (input.dataset.required || 'Tick this box to continue.') : `Enter ${LABEL[input.name] || 'this'}.`;
    else if (input.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) msg = 'Enter an email address, like name@example.co.nz.';
    else if (input.type !== 'checkbox' && input.dataset.min && [...input.value].length < Number(input.dataset.min)) msg = `Use at least ${input.dataset.min} characters.`;
    else if (input.type !== 'checkbox' && input.maxLength > 0 && [...input.value].length > input.maxLength) msg = `Use at most ${input.maxLength} characters.`;
    fieldError(input, msg);
    if (msg && !first) first = input;
  }
  if (first) first.focus();
  return !first;
}

// Show / Hide on every password field
for (const btn of document.querySelectorAll('.auth__show')) {
  const input = $(btn.getAttribute('aria-controls'));
  btn.addEventListener('click', () => {
    const on = input.type === 'password';
    input.type = on ? 'text' : 'password';
    btn.textContent = on ? 'Hide' : 'Show';
    btn.setAttribute('aria-label', on ? 'Hide password' : 'Show password'); // the name always holds the visible word (WCAG 2.5.3)
  });
}

/* ---- the next page ----------------------------------------------------------------------- */
const queryNext = params.get('next');
const storedNext = () => { try { return sessionStorage.getItem('bh_next'); } catch { return null; } };
const rememberNext = () => { try { if (safeNext(queryNext)) sessionStorage.setItem('bh_next', queryNext); } catch { /* storage blocked */ } };
const forgetNext = () => { try { sessionStorage.removeItem('bh_next'); } catch { /* storage blocked */ } };
const go = to => { forgetNext(); location.assign(to); };

/* ---- Supabase and Turnstile, only once the keys are real ------------------------------ */
function supabaseClient() {
  if (!cfg.supabaseReady || !window.supabase || typeof window.supabase.createClient !== 'function') return null;
  return window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey, {
    auth: { flowType: 'implicit', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true }
  });
}

let turnstileLoading = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!turnstileLoading) {
    turnstileLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TURNSTILE_SRC;
      s.async = true;
      s.addEventListener('load', () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile'))));
      s.addEventListener('error', () => reject(new Error('turnstile')));
      document.head.append(s);
    });
  }
  return turnstileLoading;
}
// one widget per page; token() is the current answer or '' while the check is not done
const NO_CAPTCHA = { token: () => '', reset() {} };
async function mountCaptcha(container, action) {
  let token = '';
  try {
    const ts = await loadTurnstile();
    const id = ts.render(container, {
      sitekey: cfg.turnstileSiteKey, action, theme: 'light',
      size: container.clientWidth && container.clientWidth < 300 ? 'compact' : 'flexible',
      callback: t => { token = t; },
      'expired-callback': () => { token = ''; },
      'error-callback': () => { token = ''; }
    });
    return { token: () => token, reset: () => { token = ''; try { ts.reset(id); } catch { /* gone */ } } };
  } catch {
    fail("The security check couldn't load. Reload the page, or check that nothing is blocking challenges.cloudflare.com.");
    return NO_CAPTCHA;
  }
}

/* ---- outcomes ----------------------------------------------------------------------------- */
let retryWith = null;
els.retry && els.retry.addEventListener('click', async () => {
  if (!retryWith) return;
  busy(els.retry, true, 'Trying again…');
  const out = await retryWith();
  busy(els.retry, false);
  settle(out);
});
function settle(out, { onError } = {}) {
  show(els.retryBox, false);
  retryWith = null;
  if (out.action === 'go') return go(out.to);
  if (out.action === 'done') {
    // no timed redirect (WCAG 2.2.1): the message keeps focus and Continue is the next stop
    finish(out.message);
    if (out.to) {
      const a = $('continue');
      if (a) { a.setAttribute('href', out.to); a.addEventListener('click', forgetNext); show(a.parentElement, true); }
    }
    return;
  }
  fail(out.message);
  if (out.retry) { retryWith = out.retry; show(els.retryBox, true); }
  if (onError) onError(out);
}

function notReady() {
  note(MESSAGES.not_configured);
  show(els.form, false);
  const help = $('setupHelp');
  show(help, true);
}

/* ---- the pages ------------------------------------------------------------------------- */
async function loginPage(sb) {
  const form = els.form, btn = form.querySelector('button[type=submit]');
  note(params.get('reason') === 'reauth' ? 'Your new password is saved. Sign in with it to continue.' : '');
  rememberNext();
  let captcha = NO_CAPTCHA;
  const resendBox = $('resendBox'), resend = $('resend');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (btn.disabled) return;
    show(els.alert, false); show(resendBox, false); show(els.retryBox, false);
    if (!checkFields(form)) return;
    busy(btn, true, 'Signing in…');
    const out = await loginFlow({
      email: form.email.value.trim(), password: form.password.value, remember: form.remember.checked,
      captchaToken: captcha.token(), next: [queryNext, storedNext()]
    }, { supabase: sb, exchange, rememberChoice, w: window });
    captcha.reset();
    busy(btn, false);
    settle(out, { onError: o => show(resendBox, !!o.resend) });
  });
  resend.addEventListener('click', async () => {
    const email = form.email.value.trim();
    if (!checkFields(form.querySelector('.auth__field'))) return;
    busy(resend, true, 'Sending…');
    const out = await resendFlow({ email, captchaToken: captcha.token(), origin: location.origin }, { supabase: sb });
    captcha.reset();
    busy(resend, false);
    if (out.action === 'done') { show(resendBox, false); show(els.alert, false); note(out.message); els.notice.focus(); } else fail(out.message);
  });
  show(form, true); // only once the handlers are in place, so the form never submits by itself
  captcha = await mountCaptcha($('captcha'), 'login');
}

async function signupPage() {
  rememberNext();
  const open = await publicSignupOpen();
  if (!open) {
    note('');
    show($('closed'), true);
    return;
  }
  const sb = cfg.supabaseReady && cfg.turnstileReady ? supabaseClient() : null;
  if (!sb) return notReady();
  note('');
  const form = els.form, btn = form.querySelector('button[type=submit]');
  const code = form.code, codeNote = $('codeNote');
  code.value = cleanCode(params.get('code') || '');
  let timer = 0, seq = 0;
  const preview = async () => {
    const mine = ++seq;
    const v = code.value.trim();
    if (!v) { setText(codeNote, ''); return; }
    const r = await previewCode(v);
    if (mine !== seq) return; // a newer keystroke won
    setText(codeNote, !r ? 'Codes use letters, numbers and dashes.' : r.state === 'unknown' ? "We couldn't check the code just now. It's still saved with your sign-up." : r.message);
  };
  code.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(preview, 600); });
  if (code.value) timer = setTimeout(preview, 600);
  let captcha = NO_CAPTCHA;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (btn.disabled) return;
    show(els.alert, false);
    if (!checkFields(form)) return;
    busy(btn, true, 'Creating your account…');
    const out = await signupFlow({
      name: form.name.value, email: form.email.value.trim(), password: form.password.value, code: code.value,
      privacyAck: form.privacy.checked, marketing: form.marketing.checked, captchaToken: captcha.token(), origin: location.origin
    }, { supabase: sb });
    captcha.reset();
    busy(btn, false);
    if (out.closed) { show(form, false); show($('closed'), true); return; }
    settle(out);
  });
  show(form, true);
  captcha = await mountCaptcha($('captcha'), 'signup');
}

async function resetPage(sb) {
  const form = els.form, btn = form.querySelector('button[type=submit]');
  note('');
  let captcha = NO_CAPTCHA;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (btn.disabled) return;
    show(els.alert, false);
    if (!checkFields(form)) return;
    busy(btn, true, 'Sending…');
    const out = await resetFlow({ email: form.email.value.trim(), captchaToken: captcha.token(), origin: location.origin }, { supabase: sb });
    captcha.reset();
    busy(btn, false);
    settle(out);
  });
  show(form, true);
  captcha = await mountCaptcha($('captcha'), 'reset');
}

const CONFIRM_COPY = {
  email: ['Confirm your email', 'Press Confirm to finish setting up your account.', 'Confirm'],
  email_change: ['Confirm your new email', 'Press Confirm to start using your new email address.', 'Confirm'],
  recovery: ['Reset your password', 'Press Confirm, then choose a new password.', 'Confirm'],
  invite: ['Accept your invitation', 'Read the privacy statement, tick the box, then press Confirm and continue to choose your password.', 'Confirm and continue']
};
async function confirmPage(sb) {
  const { tokenHash, type } = confirmLink;
  const form = els.form, btn = form.querySelector('button[type=submit]');
  if (!tokenHash || !CONFIRM_TYPES.includes(type)) {
    note('');
    fail(MESSAGES.link_incomplete);
    show($('linkHelp'), true);
    return;
  }
  const [title, sub, label] = CONFIRM_COPY[type];
  setText($('title'), title); setText($('sub'), sub); setText(btn, label);
  document.title = title + ' — Bargainhub studio';
  const privacy = form.privacy;
  show($('inviteAck'), type === 'invite');
  privacy.required = type === 'invite';
  privacy.disabled = type !== 'invite';
  note('');
  let used = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (btn.disabled || used) return;
    show(els.alert, false);
    if (!checkFields(form)) return;
    used = true; // the token works once: never send it twice
    busy(btn, true, 'Confirming…');
    const deps = { supabase: sb, exchange, keepChoice, w: window };
    const next = [params.get('next'), storedNext()];
    const out = await confirmFlow({ type, tokenHash, privacyAck: privacy.checked, next }, deps);
    busy(btn, false);
    if (out.action === 'error') {
      // before Supabase took the token (no tick, or no connection) the button may be pressed again
      if (!out.retry && (out.code === 'privacy_ack_required' || out.code === 'network')) used = false;
      else { show(form, false); show($('linkHelp'), !out.retry); }
    }
    // after a verified link, Retry runs only the exchange again (the outcome's retry)
    settle(out);
  });
  show(form, true);
}

async function passwordPage(sb) {
  const invite = params.get('invite') === '1';
  if (invite) { setText($('title'), 'Choose your password'); document.title = 'Choose your password — Bargainhub studio'; }
  const { data } = await sb.auth.getSession().catch(() => ({ data: null }));
  if (!data || !data.session) {
    note('');
    fail(MESSAGES.session_missing);
    show($('linkHelp'), true);
    return;
  }
  note('');
  const form = els.form, btn = form.querySelector('button[type=submit]');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (btn.disabled) return;
    show(els.alert, false);
    if (!checkFields(form)) return;
    busy(btn, true, 'Saving…');
    const out = await passwordFlow({ password: form.password.value, invite }, { supabase: sb, exchange });
    busy(btn, false);
    settle(out);
  });
  show(form, true);
}

/* ---- start ------------------------------------------------------------------------------ */
(async () => {
  try {
    for (const input of document.querySelectorAll('input[data-min]')) input.dataset.min = String(Math.max(Number(input.dataset.min), PASSWORD_MIN));
    for (const input of document.querySelectorAll('input[type=password]')) input.maxLength = PASSWORD_MAX;
    if (page === 'signup') return await signupPage(); // closed (the Friday state) needs no keys at all
    if (!cfg.supabaseReady || (NEEDS_TURNSTILE.has(page) && !cfg.turnstileReady)) return notReady();
    const sb = supabaseClient();
    if (!sb) { note(''); return fail(MESSAGES.supabase_network); }
    if (page === 'login') return await loginPage(sb);
    if (page === 'reset') return await resetPage(sb);
    if (page === 'confirm') return await confirmPage(sb);
    if (page === 'update-password') return await passwordPage(sb);
  } catch {
    note('');
    fail(MESSAGES.unexpected);
  }
})();
