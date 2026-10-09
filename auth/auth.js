/* =========================================================================================
   auth/auth.js: wires the five sign-in pages to auth/auth-lib.js (ADDENDUM §3.3, §6.3).
   Order on every page:
     1. bhAuthHygiene() first (§3.3.4), before anything reads or writes the sign-in state.
     2. confirm.html only: token_hash (or the session hash of Supabase's default link) leaves the
        address bar (history.replaceState) at once.
     3. The settings for this host (auth/config.js). While the publishable key is still a
        placeholder, the page says "Sign-in is being set up" and makes no call to Supabase.
   Text is only ever set with textContent; nothing is parsed as HTML. Turnstile is loaded here
   (explicit rendering) on login, sign-up and reset only, and only once its site key is real.
   Until then (integrator decision) sign-in, resend and reset run without it and send no captcha
   token, nothing is loaded from Cloudflare, and sign-up stays closed ("Accounts open soon").
   ========================================================================================= */
import {
  bhAuthHygiene, safeNext, MESSAGES, exchange, rememberChoice, keepChoice, publicSignupOpen, previewCode, cleanCode,
  loginFlow, resendFlow, resetFlow, signupFlow, confirmFlow, confirmSessionFlow, hashLink, hashLinkError, pastedLinkTarget, passwordFlow, CONFIRM_TYPES, PASSWORD_MIN, PASSWORD_MAX
} from '/auth/auth-lib.js';
import { pickConfig } from '/auth/config.js';

bhAuthHygiene(window);

const page = document.body.dataset.page;
const params = new URLSearchParams(location.search);

// confirm.html: the one-time token never stays in the address bar, the history or a later Referer.
// (a) ?token_hash= (the §3.4 templates) is the primary link; (b) the hash Supabase's default link
// comes back with is read here once, kept only in memory, and used only on the button (auth-lib.js).
const confirmLink = { tokenHash: params.get('token_hash'), type: params.get('type'), hash: page === 'confirm' ? hashLink(location.hash) : null };
if (page === 'confirm' && (params.has('token_hash') || confirmLink.hash || /access_token|refresh_token|error/.test(location.hash))) {
  params.delete('token_hash');
  const q = params.toString();
  history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
}

const cfg = pickConfig(location.host);
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const NEEDS_TURNSTILE = new Set(['login', 'signup', 'reset']); // the pages that show the widget once it is live
const CAPTCHA_ON = cfg.turnstileReady;

/* ---- small DOM helpers (textContent only) ---------------------------------------------- */
const $ = id => document.getElementById(id);
const show = (el, on = true) => { if (el) el.hidden = !on; };
const setText = (el, text) => { if (el) el.textContent = text; };
const els = { notice: $('notice'), alert: $('alert'), form: $('form'), done: $('done'), retryBox: $('retryBox'), retry: $('retry') };

function note(text) { setText(els.notice, text); show(els.notice, !!text); }
// a link opened twice: the second page says expired, the first page's address may still work
const SPENT_SUB = "If the email's link opened more than one page, paste the first page's address below. Otherwise ask for a new link.";
function heading(title, sub) { setText($('title'), title); setText($('sub'), sub); document.title = title + ' — Bargainhub studio'; }
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
// the vendored supabase-js build (213 KiB) loads only when a page will use it (§6.7): never
// while the keys are placeholders, never on the closed sign-up page
const SUPABASE_SRC = '/vendor/supabase-js-2.117.3.min.js';
let supabaseLoading = null;
function loadSupabase() {
  if (window.supabase) return Promise.resolve(window.supabase);
  if (!supabaseLoading) {
    supabaseLoading = new Promise(resolve => {
      const s = document.createElement('script');
      s.src = SUPABASE_SRC;
      s.addEventListener('load', () => resolve(window.supabase || null));
      s.addEventListener('error', () => resolve(null));
      document.head.append(s);
    });
  }
  return supabaseLoading;
}
async function supabaseClient() {
  if (!cfg.supabaseReady) return null;
  await loadSupabase();
  if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
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
const captchaFor = action => (CAPTCHA_ON && NEEDS_TURNSTILE.has(page) ? mountCaptcha($('captcha'), action) : NO_CAPTCHA);
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
      captchaToken: captcha.token(), captcha: CAPTCHA_ON, next: [queryNext, storedNext()]
    }, { supabase: sb, exchange, rememberChoice, w: window });
    captcha.reset();
    busy(btn, false);
    settle(out, { onError: o => show(resendBox, !!o.resend) });
  });
  resend.addEventListener('click', async () => {
    const email = form.email.value.trim();
    if (!checkFields(form.querySelector('.auth__field'))) return;
    busy(resend, true, 'Sending…');
    const out = await resendFlow({ email, captchaToken: captcha.token(), captcha: CAPTCHA_ON, origin: location.origin }, { supabase: sb });
    captcha.reset();
    busy(resend, false);
    if (out.action === 'done') { show(resendBox, false); show(els.alert, false); note(out.message); els.notice.focus(); } else fail(out.message);
  });
  show(form, true); // only once the handlers are in place, so the form never submits by itself
  captcha = await captchaFor('login');
}

async function signupPage() {
  rememberNext();
  // sign-up fails closed: never open without Turnstile, whatever the studio's setting says
  const open = CAPTCHA_ON && await publicSignupOpen();
  if (!open) {
    note('');
    show($('closed'), true);
    return;
  }
  const sb = cfg.supabaseReady ? await supabaseClient() : null;
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
  captcha = await captchaFor('signup');
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
    const out = await resetFlow({ email: form.email.value.trim(), captchaToken: captcha.token(), captcha: CAPTCHA_ON, origin: location.origin }, { supabase: sb });
    captcha.reset();
    busy(btn, false);
    settle(out);
  });
  show(form, true);
  pasteBox('recovery'); // there from the start: a reload, Back or a second visit keeps the way in
  captcha = await captchaFor('reset');
}

const CONFIRM_COPY = {
  email: ['Confirm your email', 'Press Confirm to finish setting up your account.', 'Confirm'],
  email_change: ['Confirm your new email', 'Press Confirm to start using your new email address.', 'Confirm'],
  recovery: ['Reset your password', 'Press Confirm, then choose a new password.', 'Confirm'],
  invite: ['Accept your invitation', 'Read the privacy statement, tick the box, then press Confirm and continue to choose your password.', 'Confirm and continue']
};
// the way on after a failed link depends on what the link was for: a new reset link, a new
// invitation (from the consultant or Back Office) or Resend confirmation on the sign-in page
const linkHelpFor = type => $(type === 'invite' ? 'linkHelpInvite' : type === 'email' || type === 'email_change' ? 'linkHelpEmail' : 'linkHelp');
async function confirmPage(sb) {
  const { tokenHash, hash } = confirmLink;
  // opened with no link at all: the place to paste one (the email's button may lead nowhere, see pasteBox)
  if (!tokenHash && !hash && !confirmLink.type) {
    note('');
    heading('Paste the link from your email', 'Paste it below to continue.');
    show($('linkHelp'), true);
    return pasteBox(null);
  }
  // (b): the hash's own type wins; an error hash has none, so the query's, else an invitation (the
  // link this fallback exists for)
  const type = hash ? hash.type || (CONFIRM_TYPES.includes(confirmLink.type) ? confirmLink.type : hash.errorCode ? 'invite' : null) : confirmLink.type;
  const form = els.form, btn = form.querySelector('button[type=submit]');
  if (hash && hash.errorCode) {
    note('');
    heading("This link can't be used", SPENT_SUB);
    fail(hashLinkError(type).message);
    show(linkHelpFor(type), true);
    return pasteBox(CONFIRM_TYPES.includes(type) ? type : null);
  }
  if (hash ? !hash.accessToken || !hash.refreshToken || !CONFIRM_TYPES.includes(type) : !tokenHash || !CONFIRM_TYPES.includes(type)) {
    note('');
    // e.g. confirm.html?type=recovery after a reload: the token left the address bar, unused
    heading('Paste the link from your email', 'Paste it below to continue.');
    fail(MESSAGES.paste_lost);
    show(linkHelpFor(type), true);
    return pasteBox(CONFIRM_TYPES.includes(type) ? type : null);
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
    used = true; // the token (or the session) works once: never send it twice
    busy(btn, true, 'Confirming…');
    const deps = { supabase: sb, exchange, keepChoice, w: window };
    const next = [params.get('next'), storedNext()];
    const out = hash
      ? await confirmSessionFlow({ type, accessToken: hash.accessToken, refreshToken: hash.refreshToken, privacyAck: privacy.checked, next }, deps)
      : await confirmFlow({ type, tokenHash, privacyAck: privacy.checked, next }, deps);
    busy(btn, false);
    if (out.action === 'error') {
      // before Supabase took the token (no tick, or no connection) the button may be pressed again
      if (!out.retry && (out.code === 'privacy_ack_required' || out.code === 'network')) used = false;
      else { show(form, false); show(linkHelpFor(type), !out.retry); if (!out.retry) { heading("This link can't be used", SPENT_SUB); pasteBox(type); } }
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
    show($(invite ? 'linkHelpInvite' : 'linkHelp'), true);
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
    // an open invitation is accepted only within 10 minutes of the email link (the studio's proof); on a
    // reset that is a slow finish, not a spent invitation, and the way on is a new reset link
    if (!invite && out.code === 'invitation_needs_link') { settle({ ...out, message: MESSAGES.reset_too_slow }); show(form, false); show($('linkHelp'), true); return; }
    settle(out);
  });
  show(form, true);
}

// The pasted link (confirm.html with no link or an incomplete one; the reset page). While
// Supabase's Site URL is not set, the email's button lands on a page that never loads; the person
// copies that link, or that page's address, and pastes it here. auth-lib.js turns it into the
// confirm.html address it was meant to open; nothing is sent anywhere and the token is used only
// by Confirm on that page. Its own address is never kept: the confirm prologue removes it.
function pasteBox(type) {
  const box = $('pasteBox');
  if (!box || box.dataset.ready) return show(box, !!box);
  box.dataset.ready = '1';
  const input = $('pasted'), btn = $('pasteGo');
  const open = () => {
    if (btn.disabled) return;
    if (!input.value.trim()) { fieldError(input, MESSAGES.paste_empty); input.focus(); return; }
    const target = pastedLinkTarget(input.value, cfg.supabaseUrl, type);
    if (!target) { fieldError(input, MESSAGES.paste_not_link); input.focus(); return; }
    const to = new URL(target, location.origin);
    // a spent link of no known kind (pasted on a bare confirm.html): nothing to open, so say it here,
    // with both ways on, rather than guess an invitation
    const spent = hashLink(to.hash);
    if (spent && spent.errorCode && !spent.type && !to.searchParams.get('type')) {
      fieldError(input, '');
      input.value = '';
      fail(MESSAGES.link_expired);
      show($('linkHelp'), true);
      return;
    }
    fieldError(input, '');
    input.value = '';
    busy(btn, true, 'Opening…');
    // the same page with only a new hash would not load again, so its prologue would never see it
    if (to.pathname === location.pathname && to.search === location.search) { history.replaceState(null, '', to.pathname + to.search + to.hash); location.reload(); }
    else location.assign(to.pathname + to.search + to.hash);
  };
  btn.addEventListener('click', open);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); open(); } });
  // Back from the page it opened may restore this one from the back/forward cache, button still busy
  window.addEventListener('pageshow', e => { if (e.persisted) { busy(btn, false); fieldError(input, ''); } });
  show(box, true);
}

/* ---- start ------------------------------------------------------------------------------ */
(async () => {
  try {
    for (const input of document.querySelectorAll('input[data-min]')) input.dataset.min = String(Math.max(Number(input.dataset.min), PASSWORD_MIN));
    for (const input of document.querySelectorAll('input[type=password]')) input.maxLength = PASSWORD_MAX;
    if (page === 'signup') return await signupPage(); // closed (the Friday state) needs no keys at all
    if (!cfg.supabaseReady) return notReady();
    const sb = await supabaseClient();
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
