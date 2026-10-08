/* Hanes Distribution: what every page shares, in this order.
   1. bhAuthHygiene(): "keep me signed in" unticked means signed out once the browser closes
      (ADDENDUM §3.3.4). It runs first, before anything reads the sign-in state.
   2. Log in becomes My account (/studio/#/account) while a Supabase session is kept in this
      browser. Only localStorage is read: the Supabase SDK is never loaded on these pages.
   3. BOOKINGS_LIVE: while false, every [data-book] link opens the enquiry dialog with the topic
      "Book a consultant" (assets/enquiry.js); set it to true when bookings ship and they go
      to the studio's booking page instead.
   4. The global bar stays on screen. On a small screen it opens the full list of sections, and
      Get a quote, and closes again once a link is chosen.
   5. Milli, the guide (assets/guide/milli.js): loaded after the page has loaded and the browser
      is idle (at most 4 s later), never on the sign-in pages or in the studio. MILLI_SHIPPED says
      whether the file is deployed (npm run check keeps it honest), so a page without it never
      asks for it and never logs a failed request.
   window.HanesSite exposes these for tests and for the guide. */
(() => {
  'use strict';
  const BOOKINGS_LIVE = false;
  const BOOKING_HREF = 'studio/#/book';
  const ACCOUNT_HREF = '/studio/#/account';
  const MILLI_SRC = '/assets/guide/milli.js', MILLI_SHIPPED = true;
  const SB_TOKEN = /^sb-[a-z0-9]+-auth-token$/;

  /* ---- bhAuthHygiene: the shared contract (ADDENDUM §3.3.4) ----------------------------------
     Copied byte for byte between the BEGIN and END lines into auth/auth-lib.js, the studio's
     portal.js and consultant-portal.js (only the common indentation may differ); the tests
     compare the copies.
     A Supabase token with neither bh_live (session cookie) nor bh_remember='1' means the browser
     was closed: remove every sb-<ref>-auth-token key, then end our server session too. Never
     throws, never waits: the server calls run in the background and only after a key was removed.
     Returns 'none', 'kept', 'cleared' or 'unavailable' (storage blocked). */
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

  // a Supabase session is kept in this browser (read after the hygiene ran)
  const signedIn = (w = globalThis) => {
    try { const s = w.localStorage; for (let i = 0; i < s.length; i++) if (SB_TOKEN.test(s.key(i))) return true; } catch { /* blocked */ }
    return false;
  };
  const swapLogin = (doc, on) => {
    if (!on) return 0;
    const links = doc.querySelectorAll('a.gb__login, a.gf__login');
    links.forEach(a => { a.textContent = 'My account'; a.setAttribute('href', ACCOUNT_HREF); });
    return links.length;
  };
  // bookings live: Book a consultant goes to the studio's booking page instead of the dialog
  const flipBookings = (doc, live) => {
    if (!live) return 0;
    const links = doc.querySelectorAll('a[data-book]');
    links.forEach(a => {
      a.setAttribute('href', BOOKING_HREF);
      for (const k of ['data-quote', 'data-quote-subject', 'data-quote-hint']) a.removeAttribute(k);
    });
    return links.length;
  };
  const loadMilli = (w = globalThis) => {
    if (!MILLI_SHIPPED || w.__bhMilli || /^\/(auth|studio)\//.test(w.location.pathname)) return false;
    w.__bhMilli = true;
    const add = () => {
      try {
        const s = w.document.createElement('script');
        s.src = MILLI_SRC; s.async = true;
        s.onerror = () => s.remove();
        w.document.head.append(s);
      } catch { /* the page works without the guide */ }
    };
    const idle = () => (typeof w.requestIdleCallback === 'function' ? w.requestIdleCallback(add, { timeout: 4000 }) : w.setTimeout(add, 1));
    if (w.document.readyState === 'complete') idle(); else w.addEventListener('load', idle, { once: true });
    return true;
  };
  const site = { BOOKINGS_LIVE, MILLI_SHIPPED, MILLI_SRC, bhAuthHygiene, signedIn, swapLogin, flipBookings, loadMilli };
  window.HanesSite = site;

  bhAuthHygiene(window);
  swapLogin(document, signedIn(window));
  flipBookings(document, BOOKINGS_LIVE);

  const root = document.documentElement, gb = document.getElementById('gb');
  const btn = gb && gb.querySelector('.gb__burger');
  if (btn) {
    const setOpen = v => {
      root.classList.toggle('gb-open', v);
      btn.setAttribute('aria-expanded', String(v));
      btn.setAttribute('aria-label', v ? 'Close the Hanes menu' : 'Open the Hanes menu');
    };
    btn.addEventListener('click', () => setOpen(!root.classList.contains('gb-open')));
    gb.querySelectorAll('.gb__panel a').forEach(a => a.addEventListener('click', () => setOpen(false)));
    addEventListener('keydown', e => { if (e.key === 'Escape' && root.classList.contains('gb-open')) { setOpen(false); btn.focus(); } });
    addEventListener('resize', () => { if (innerWidth > 879) setOpen(false); });
  }

  loadMilli(window);
})();
