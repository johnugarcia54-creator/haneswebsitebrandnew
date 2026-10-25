/* Milli, Hanes's AI guide: the panel (ADDENDUM §8.2, §8.3, §8.6, §11.2). Loaded by milli.js on the
   first click, with milli.css; reads guide-faq.json.
   - Static mode (Friday): the page's chips answer from guide-faq.json. There is NO text box, so
     nothing typed is ever sent anywhere. The notice is the §11.2 static notice.
   - Live mode only when GET /api/guide answers {ok:true, mode:'live'}: the §11.2 live notice is
     shown before the first message, and a labelled text box (500 characters) posts to
     /api/guide. A static answer, 5xx, a network error, a time-out or being offline falls back to
     static mode with the §8.6 line, and the text box goes away.
   - Every string from the server or the JSON goes in as text (textContent / text nodes); links
     and buttons are built here from fixed action ids, never from server URLs.
   - The last 6 turns stay in sessionStorage (bh_milli_history) until the tab closes.
   - Desktop: a non-modal dialog. At 760 px or less, or 500 px tall or less (a phone on its side,
     400% zoom): a full-screen modal sheet (background inert, page scroll locked, focus kept
     inside, sized to the visual viewport). Esc closes and returns focus to the launcher. New
     messages never move focus; the log scrolls so a new answer's first line is in view.
   - The notice, chips and log scroll as one region under a fixed header (reflow, WCAG 1.4.10).
   - The first open waits only for guide-faq.json (and at most WAIT ms for the GET /api/guide
     probe); a slower live answer switches the open panel to live mode when it comes. One open
     at a time: repeated clicks while it loads don't build a second panel.
   window.HanesMilli.panel: { toggle, open, close, choose, send, action, state } (state is for
   tests). */
(() => {
  'use strict';
  const w = window, d = document, M = w.HanesMilli;
  if (!M || M.panel) return;

  const API = '/api/guide', KEY = 'bh_milli_history';
  const TURNS = 6, MAX = 500, WAIT = 600;
  const NOTICE = {
    static: 'Milli is an AI guide answering from quick answers on this page right now. Choose a question below, or ask a person.',
    live: "Milli is an AI guide. Your questions go to our AI provider, SpaceXAI (xAI) in the United States, to write a reply. It deletes them after replying and doesn't train on them. We don't keep what you type, only counts. Please don't share personal details here; use the enquiry or booking form instead."
  };
  const FALLBACK = "Milli couldn't reach its AI service, so here are quick answers instead.";
  const PAGES = { hanesteel: 'Hanesteel windows and doors', hanestone: 'Hanestone plasterboard', hanewood: 'Hanewood plywood, board and LVL',
    hanesulation: 'Hanesulation insulation', bargainhub: 'Bargainhub kitchens and interiors', hisense: 'Hisense appliances', tracking: 'Hanes Track', contact: 'Contact us' };
  const SHOWROOM = 'https://www.google.com/maps/search/?api=1&query=93+Main+South+Road%2C+Sockburn%2C+Christchurch';
  const page = M.page;
  // the pages the studio's /api/guide knows (65-guide.cjs PAGES); any other (404) is sent as index
  const API_PAGES = ['index', 'hanesteel', 'hanestone', 'hanewood', 'hanesulation', 'bargainhub', 'hisense', 'tracking', 'contact', 'privacy', 'login', 'studio', 'consultant'];
  const apiPage = API_PAGES.includes(page) ? page : 'index';

  // action ids → fixed targets (§8.2); anything else is dropped
  const action = id => {
    const go = /^go_([a-z]+)$/.exec(id || '');
    if (go) return Object.hasOwn(PAGES, go[1]) ? { label: PAGES[go[1]], href: '/' + go[1] + '.html' } : null;
    const booking = !!(w.HanesSite && w.HanesSite.BOOKINGS_LIVE);
    const all = {
      open_enquiry: { label: 'Send an enquiry', dialog: 'enquiry' },
      open_studio: { label: 'Open the design studio', href: '/studio/' },
      open_signup: { label: 'Create an account', href: '/auth/signup.html' },
      open_login: { label: 'Log in', href: '/auth/login.html' },
      open_booking: booking ? { label: 'Book a consultant', href: '/studio/#/book' } : { label: 'Book a consultant', dialog: 'booking' },
      open_packages: { label: 'See the packages', href: '/bargainhub.html#packages' },
      open_showroom: { label: 'Showroom directions (opens in a new tab)', href: SHOWROOM, external: true },
      open_privacy: { label: 'Privacy statement', href: '/privacy.html' }
    };
    return Object.hasOwn(all, id) ? all[id] : null;
  };

  const el = (tag, attrs, ...kids) => {
    const e = d.createElement(tag);
    for (const k in attrs || {}) if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : String(attrs[k]));
    for (const k of kids) e.append(k); // strings become text nodes, never markup
    return e;
  };
  const txt = (s, n) => String(s == null ? '' : s).slice(0, n || 600);

  // ---------- history (sessionStorage, 6 turns)
  const load = () => {
    try {
      const h = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (!h || !Array.isArray(h.turns)) return { turns: [] };
      const turns = h.turns.filter(t => t && (t.role === 'user' || t.role === 'assistant') && (typeof t.text === 'string' || typeof t.node === 'string')).slice(-TURNS);
      return { turns, sid: typeof h.sid === 'string' ? h.sid : null, sig: typeof h.sig === 'string' ? h.sig : null };
    } catch { return { turns: [] }; }
  };
  const S = load();
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ v: 1, sid: S.sid || null, sig: S.sig || null, turns: S.turns.slice(-TURNS) })); } catch { /* private mode: history just isn't kept */ } };
  const push = t => { S.turns.push(t); S.turns = S.turns.slice(-TURNS); save(); };

  // ---------- the panel, in reading and Tab order: header, notice (link), chips, log (actions), form, close
  let faq = null, mode = 'static', isOpen = false, sheet = false, busy = false, t0 = 0, inerted = [], vvOn = false, happyT = 0, opening = null;
  const root = el('div', { id: 'milliPanel', class: 'milli-p', role: 'dialog', 'aria-labelledby': 'milliTitle', 'aria-describedby': 'milliNotice', 'data-lenis-prevent': true, hidden: true });
  const face = M.mascot('rest');
  const head = el('div', { class: 'milli-h' }, face, el('h2', { id: 'milliTitle' }, 'Milli · AI guide'));
  const noticeText = d.createTextNode('');
  const notice = el('p', { id: 'milliNotice', class: 'milli-n' }, noticeText, ' ', el('a', { href: '/privacy.html' }, 'Privacy statement'));
  const chips = el('div', { class: 'milli-c', role: 'group', 'aria-label': 'Suggested questions' });
  const log = el('div', { class: 'milli-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation with Milli', tabindex: '0' }); // a Tab stop between the choices and the answers' actions
  const body = el('div', { class: 'milli-b', 'data-lenis-prevent': true }, notice, chips, log); // the one scrolling region
  const status = el('p', { class: 'milli-st', role: 'status' });
  const alert = el('p', { class: 'milli-st milli-st--err', role: 'alert' });
  const input = el('textarea', { id: 'milliQ', name: 'q', rows: '2', maxlength: String(MAX), 'aria-describedby': 'milliNotice milliCount', autocomplete: 'off' });
  const count = el('span', { id: 'milliCount', class: 'milli-count' }, '0 of 500 characters');
  const sendBtn = el('button', { type: 'submit', class: 'milli-send' }, 'Send');
  const form = el('form', { class: 'milli-f' }, el('label', { for: 'milliQ' }, 'Ask Milli a question'), input, el('div', { class: 'milli-fr' }, count, sendBtn));
  const close = el('button', { type: 'button', class: 'milli-x', 'aria-label': 'Close Milli' }, '×');
  root.append(head, body, status, alert, close); // the form joins only in live mode

  const setFace = s => { face.setAttribute('class', 'milli-m is-' + s); };
  const rest = () => setFace(mode === 'live' ? 'idle' : 'rest');
  const happy = () => { clearTimeout(happyT); setFace('happy'); happyT = setTimeout(rest, 1600); };

  const doDialog = (kind, from) => {
    const q = w.HanesEnquiry, topic = kind === 'booking' ? 'Book a consultant' : (faq && faq.topics && faq.topics[page]) || 'General enquiry';
    const subject = kind === 'booking' ? 'Bargainhub consultant booking' : topic;
    const hint = kind === 'booking' ? 'What would you like to design, and when suits you?' : '';
    if (!q || typeof q.open !== 'function') { location.assign('/contact.html#enquiry'); return; }
    if (sheet) { hide(false); from = M.btn; } // the modal sheet gives way to the modal dialog (only from an action the visitor chose)
    q.open(topic, subject, hint, from);
  };
  const actionEl = id => {
    const a = action(id);
    if (!a) return null;
    if (a.href) {
      const link = el('a', { class: 'milli-a', href: a.href, target: a.external ? '_blank' : null, rel: a.external ? 'noopener' : null }, a.label);
      return link;
    }
    const b = el('button', { type: 'button', class: 'milli-a' }, a.label);
    b.addEventListener('click', () => doDialog(a.dialog, b));
    return b;
  };

  // one finished message at a time into the log (§8.3): prefix, text, then its actions
  const message = (role, text, ids, next) => {
    const m = el('div', { class: 'milli-msg milli-msg--' + (role === 'user' ? 'you' : 'milli') },
      el('span', { class: 'milli-sr' }, role === 'user' ? 'You said: ' : 'Milli said: '), el('p', {}, txt(text)));
    const acts = el('div', { class: 'milli-acts' });
    for (const id of ids || []) { const a = actionEl(id); if (a) acts.append(a); }
    for (const n of next || []) {
      const node = faq && faq.nodes[n];
      if (!node) continue;
      const b = el('button', { type: 'button', class: 'milli-a milli-a--q' }, node.label);
      b.addEventListener('click', () => choose(n));
      acts.append(b);
    }
    if (acts.firstChild) m.append(acts);
    log.append(m);
    return m;
  };
  // bring a message's first line into view (whichever region scrolls: the body, or the whole
  // panel when it is very short); never moves focus
  const into = m => {
    const sc = [body, root].find(e => e.scrollHeight > e.clientHeight + 1);
    if (!sc || !m || !m.getBoundingClientRect) return;
    sc.scrollTop = Math.max(0, sc.scrollTop + m.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8);
  };
  const nodeIds = n => (n.actions || []).map(a => a.id);
  const replay = t => {
    if (t.node) { const n = faq && faq.nodes[t.node]; if (n) message('assistant', n.answer, nodeIds(n), n.next); }
    else message(t.role, t.text, t.actions);
  };

  // ---------- static answers
  const choose = id => {
    const n = faq && faq.nodes[id];
    if (!n) return;
    alert.textContent = '';
    const you = message('user', n.label); push({ role: 'user', text: n.label });
    message('assistant', n.answer, nodeIds(n), n.next); push({ role: 'assistant', node: id });
    into(you);
    happy();
    // the dialog opens by itself only beside the desktop card; on the sheet it would hide the
    // answer (and its email address), so there the answer's own button opens it
    if (n.opens && !sheet) { const a = action(n.opens); if (a && a.dialog) doDialog(a.dialog, d.activeElement); }
  };

  const setMode = m => {
    mode = m;
    noticeText.data = NOTICE[m];
    if (m === 'live') root.insertBefore(form, close); else form.remove(); // static mode has no text box at all
    rest();
  };
  const fallback = () => {
    const had = form.contains(d.activeElement);
    setMode('static');
    into(message('assistant', FALLBACK)); push({ role: 'assistant', text: FALLBACK });
    if (had && chips.firstChild) chips.firstChild.focus(); // the text box went away under the focus
  };

  // ---------- live mode (only when the server says so)
  const call = async (method, body, ms) => {
    if (w.navigator && w.navigator.onLine === false) throw new Error('offline');
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), ms);
    try {
      const r = await fetch(API, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined });
      let json = null;
      try { json = await r.json(); } catch { /* not JSON */ }
      return { status: r.status, body: json };
    } finally { clearTimeout(timer); }
  };
  const probe = async () => {
    try { const r = await call('GET', null, 3000); return r.status === 200 && r.body && r.body.ok === true && r.body.mode === 'live' ? 'live' : 'static'; } catch { return 'static'; }
  };
  const history = () => S.turns.filter(t => typeof t.text === 'string').map(t => (t.sig ? { role: t.role, text: t.text, sig: t.sig } : { role: t.role, text: t.text })).slice(-TURNS);
  const send = async raw => {
    const text = String(raw == null ? '' : raw).trim().slice(0, MAX);
    if (mode !== 'live' || busy || !text) return false;
    busy = true; alert.textContent = '';
    const hist = history();
    const you = message('user', text); push({ role: 'user', text });
    into(you);
    input.value = ''; counter();
    status.textContent = 'Milli is writing a reply…'; setFace('think');
    try {
      if (!S.sid) {
        // start carries the honeypot fields too: without them the studio answers static (its bot rule)
        const s = await call('POST', { op: 'start', surface: 'website', page: apiPage, website: '', elapsedMs: Date.now() - t0 }, 10000);
        if (s.status !== 200 || !s.body || typeof s.body.sid !== 'string' || typeof s.body.sig !== 'string') throw new Error('start');
        S.sid = s.body.sid; S.sig = s.body.sig; save();
      }
      const r = await call('POST', { op: 'ask', sid: S.sid, sig: S.sig, surface: 'website', page: apiPage, text, history: hist, website: '', elapsedMs: Date.now() - t0 }, 15000);
      const b = r.body || {};
      status.textContent = '';
      if (r.status === 429) { alert.textContent = 'Milli has had a lot of questions just now. Please try again in a moment, or ask a person.'; rest(); return false; }
      if (r.status === 400) { alert.textContent = "Milli couldn't read that question. Please try rewording it."; rest(); return false; }
      if (r.status !== 200 || b.mode !== 'live' || typeof b.reply !== 'string') { fallback(); return false; }
      const ids = (Array.isArray(b.actions) ? b.actions : []).map(a => (typeof a === 'string' ? a : a && a.id)).filter(a => action(a)).slice(0, 3);
      const hand = { enquiry: 'open_enquiry', human: 'open_enquiry', booking: 'open_booking' }[b.handoff];
      if (hand && !ids.includes(hand)) ids.push(hand);
      const reply = txt(b.reply);
      message('assistant', reply, ids); into(you);
      push(typeof b.sig === 'string' ? { role: 'assistant', text: reply, sig: b.sig, actions: ids } : { role: 'assistant', text: reply, actions: ids });
      if (Array.isArray(b.redacted) && b.redacted.length) alert.textContent = 'Milli left out the personal details in your message.';
      happy();
      return true;
    } catch {
      status.textContent = '';
      fallback();
      return false;
    } finally { busy = false; }
  };
  const counter = () => { count.textContent = input.value.length + ' of 500 characters'; };
  input.addEventListener('input', counter);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); } });
  form.addEventListener('submit', e => { e.preventDefault(); send(input.value); });

  // ---------- open, close, the mobile sheet
  const mq = w.matchMedia ? w.matchMedia('(max-width:760px),(max-height:500px)') : { matches: false };
  const focusables = () => {
    const out = [], walk = n => {
      for (const c of n.children) {
        if (c.hidden) continue;
        const t = c.tagName;
        if ((t === 'A' && c.getAttribute('href')) || ((t === 'BUTTON' || t === 'TEXTAREA') && !c.disabled) || c.getAttribute('tabindex') === '0') out.push(c);
        walk(c);
      }
    };
    walk(root);
    return out;
  };
  const fit = () => {
    const v = w.visualViewport;
    if (!v) return;
    root.style.setProperty('--milli-h', v.height + 'px');
    root.style.setProperty('--milli-top', v.offsetTop + 'px');
  };
  const modal = on => {
    sheet = on;
    root.classList.toggle('is-sheet', on);
    d.documentElement.classList.toggle('milli-lock', on);
    if (on) {
      root.setAttribute('aria-modal', 'true');
      for (const c of d.body.children) if (c !== root && !c.inert && c.tagName !== 'SCRIPT' && c.tagName !== 'DIALOG') { c.inert = true; inerted.push(c); }
      fit();
      if (w.visualViewport && !vvOn) { w.visualViewport.addEventListener('resize', fit); w.visualViewport.addEventListener('scroll', fit); vvOn = true; }
    } else {
      root.removeAttribute('aria-modal');
      for (const c of inerted) c.inert = false;
      inerted = [];
      if (w.visualViewport && vvOn) { w.visualViewport.removeEventListener('resize', fit); w.visualViewport.removeEventListener('scroll', fit); vvOn = false; }
    }
  };
  const hide = refocus => {
    if (!isOpen) return;
    isOpen = false;
    modal(false);
    root.hidden = true;
    M.btn.setAttribute('aria-expanded', 'false');
    M.setState('idle');
    if (refocus) M.btn.focus();
  };
  // the first open: chips and greeting as soon as guide-faq.json is in; live mode only if the probe
  // says so (within WAIT ms, or later, while the panel is already open in static mode)
  const build = async () => {
    const pr = probe();
    const f = await fetch(M.base + 'guide-faq.json', { credentials: 'same-origin' }).then(r => r.json()).catch(() => null);
    faq = f && f.nodes && f.chips ? f : { chips: { index: [] }, nodes: {}, topics: {} };
    for (const id of (faq.chips[page] || faq.chips.index)) {
      const n = faq.nodes[id];
      if (!n) continue;
      const b = el('button', { type: 'button', class: 'milli-chip' }, n.label);
      b.addEventListener('click', () => choose(id));
      chips.append(b);
    }
    log.append(el('div', { class: 'milli-msg milli-msg--milli' }, el('span', { class: 'milli-sr' }, 'Milli said: '),
      el('p', {}, el('span', { lang: 'mi' }, 'Kia ora'), ", I'm Milli, Hanes's AI guide.")));
    for (const t of S.turns) replay(t);
    if (!f) { message('assistant', "Milli couldn't load its quick answers. You can still ask a person.", ['open_enquiry']); setMode('static'); return; }
    let timer;
    const quick = await Promise.race([pr, new Promise(r => { timer = setTimeout(() => r(null), WAIT); })]);
    clearTimeout(timer);
    setMode(quick === 'live' ? 'live' : 'static');
    if (quick === null) pr.then(m => {
      if (m !== 'live' || mode !== 'static') return;
      setMode('live'); // the live notice is above the log and the new text box, before anything is typed
      status.textContent = 'You can now type a question to Milli.';
    });
  };
  const reveal = () => {
    isOpen = true;
    t0 = Date.now();
    root.hidden = false;
    M.btn.setAttribute('aria-expanded', 'true');
    M.setState('rest');
    modal(mq.matches);
    const last = [...log.children].reverse().find(c => c.classList.contains('milli-msg--you'));
    body.scrollTop = 0; root.scrollTop = 0;
    if (last) into(last);
    const first = mode === 'live' ? input : chips.firstChild;
    if (first) first.focus();
  };
  const show = () => {
    if (isOpen) return Promise.resolve();
    if (opening) return opening; // a second click while it loads
    if (faq) { reveal(); return Promise.resolve(); }
    M.btn.setAttribute('aria-busy', 'true');
    opening = build().then(reveal).finally(() => { opening = null; M.btn.removeAttribute('aria-busy'); });
    return opening;
  };
  const toggle = () => (isOpen ? hide(true) : show());

  root.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(true); return; }
    if (e.key === 'Tab' && sheet) {
      const f = focusables();
      if (!f.length) return;
      const i = f.indexOf(d.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });
  close.addEventListener('click', () => hide(true));
  const onMq = () => { if (isOpen) modal(mq.matches); };
  if (mq.addEventListener) mq.addEventListener('change', onMq);
  d.body.append(root);

  M.panel = { toggle, open: show, close: hide, choose, send, action, state: () => ({ mode, open: isOpen, sheet, turns: S.turns.slice() }) };
})();
