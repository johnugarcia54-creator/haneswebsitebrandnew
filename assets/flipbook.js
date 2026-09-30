/* =========================================================================================
   Hanes flipbook: a catalogue reader with real page turns (styles in assets/flipbook.css).
   The turning page is a chain of thin strips, each hinged to the one before, so the free edge
   leads and the page curls as it lifts. Drag a page, click it, or use the arrow keys.
   Two-page spreads on wide screens, one page at a time on narrow ones.

   HanesFlipbook.init({ books: [{ key, title, sub, label, dir, n }], cta: { href, text }, onCta, onOpen, onClose })
   HanesFlipbook.open(key, fromElement)
   Pages are dir/001.webp … dir/NNN.webp: 001 is the front cover and NNN the back cover.
   ========================================================================================= */
window.HanesFlipbook = (() => {
  'use strict';
  const RATIO = 900 / 1324, S = 14, CURL = 38;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  let cfg = null, B = null, built = false;
  let el, stage, fly, book, pgL, pgR, castL, castR, edgeL, edgeR, leaf, prevB, nextB, countEl, scrub, tabs, titleEl, subEl, xBtn, lastFocus = null;
  let strips = [], facesA = [], facesB = [];
  let spread = true, pw = 0, ph = 0, v = 0, busy = false, raf = 0, peeking = false;
  const cache = new Map();

  const url = i => `${B.dir}/${String(i + 1).padStart(3, '0')}.webp`;
  const pre = i => { if (!B || i < 0 || i >= B.n) return; const u = url(i); if (!cache.has(u)) { const im = new Image(); im.decoding = 'async'; im.src = u; cache.set(u, im); } };
  const max = () => spread ? B.n / 2 : B.n - 1;
  // the pages showing at a view: [left, right] (-1 for none)
  const LR = w => spread ? [w === 0 ? -1 : 2 * w - 1, 2 * w <= B.n - 1 ? 2 * w : -1] : [-1, w];

  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
  const build = () => {
    el = h('div', 'fb'); el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <div class="fb__bg"></div>
      <header class="fb__bar">
        <div class="fb__title"><b></b><span></span></div>
        <div class="fb__tabs" role="group" aria-label="Catalogues"></div>
        <a class="fb__cta"></a>
        <button class="fb__x" type="button" aria-label="Close the catalogue"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 2l10 10M12 2 2 12"/></svg></button>
      </header>
      <div class="fb__stage">
        <button class="fb__nav fb__nav--prev" type="button" aria-label="Previous page"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 3 5 9l6 6"/></svg></button>
        <div class="fb__fly"><div class="fb__book">
          <div class="fb__drop"></div>
          <div class="fb__pg fb__pg--l"><i class="fb__cast"></i><i class="fb__edge fb__edge--l"></i></div>
          <div class="fb__pg fb__pg--r"><i class="fb__cast"></i><i class="fb__edge fb__edge--r"></i></div>
          <div class="fb__leaf"></div>
        </div></div>
        <button class="fb__nav fb__nav--next" type="button" aria-label="Next page"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 3 6 6-6 6"/></svg></button>
      </div>
      <footer class="fb__foot">
        <span class="fb__count" aria-live="polite"></span>
        <input class="fb__scrub" type="range" min="0" value="0" aria-label="Go to page">
        <span class="fb__hint">Drag a page, tap it, or use the arrow keys</span>
      </footer>`;
    document.body.append(el);
    const q = s => el.querySelector(s);
    stage = q('.fb__stage'); fly = q('.fb__fly'); book = q('.fb__book'); pgL = q('.fb__pg--l'); pgR = q('.fb__pg--r');
    castL = pgL.querySelector('.fb__cast'); castR = pgR.querySelector('.fb__cast'); edgeL = q('.fb__edge--l'); edgeR = q('.fb__edge--r');
    leaf = q('.fb__leaf'); prevB = q('.fb__nav--prev'); nextB = q('.fb__nav--next'); countEl = q('.fb__count'); scrub = q('.fb__scrub');
    tabs = q('.fb__tabs'); titleEl = q('.fb__title b'); subEl = q('.fb__title span'); xBtn = q('.fb__x');
    // the leaf: a chain of strips, each a child of the one before it and hinged at its left edge
    let parent = leaf;
    for (let i = 0; i < S; i++) {
      const s = h('div', 'fb__s'), a = h('div', 'fb__f fb__f--a'), b = h('div', 'fb__f fb__f--b');
      s.append(a, b); parent.append(s); parent = s;
      strips.push(s); facesA.push(a); facesB.push(b);
    }
    const cta = q('.fb__cta'); cta.href = cfg.cta.href; cta.textContent = cfg.cta.text;
    cta.addEventListener('click', e => { if (cfg.onCta) { e.preventDefault(); close(); cfg.onCta(); } else close(); });
    cfg.books.forEach(bk => {
      const t = h('button'); t.type = 'button'; t.textContent = bk.label; t.dataset.key = bk.key;
      t.addEventListener('click', () => { if (B.key !== bk.key) { setBook(bk.key); v = 0; layout(); show(); setTimeout(() => next(), 380); } });
      tabs.append(t);
    });
    xBtn.addEventListener('click', close);
    prevB.addEventListener('click', prev); nextB.addEventListener('click', next);
    scrub.addEventListener('input', () => go(+scrub.value));
    addEventListener('keydown', e => {
      if (!el.classList.contains('is-open')) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
      else if (e.key === 'Home') go(0); else if (e.key === 'End') go(max());
      else if (e.key === 'Tab') { // keep focus inside the reader
        const f = [...el.querySelectorAll('button:not(:disabled),a,input')]; const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
    addEventListener('resize', () => { if (el.classList.contains('is-open') && !busy) { const p = pageOf(v), was = spread; layout(); if (was !== spread) v = viewOf(p); show(); } });
    stage.addEventListener('wheel', e => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 24 && !busy) { e.preventDefault(); e.deltaX > 0 ? next() : prev(); } }, { passive: false });
    drag();
    built = true;
  };
  const pageOf = w => spread ? (w === 0 ? 0 : 2 * w - 1) : w;
  const viewOf = p => spread ? Math.floor((p + 1) / 2) : p;

  const setBook = key => {
    B = cfg.books.find(b => b.key === key);
    titleEl.textContent = B.title; subEl.textContent = B.sub; el.setAttribute('aria-label', B.title);
    [...tabs.children].forEach(t => t.setAttribute('aria-pressed', String(t.dataset.key === key)));
  };

  /* ---------- Layout: the biggest book that fits, as a spread when there's room ---------- */
  const layout = () => {
    const r = stage.getBoundingClientRect();
    spread = r.width >= 760 && r.width > r.height * 1.05;
    const aw = r.width - (spread ? 200 : 28), ah = r.height - 60;
    ph = spread ? Math.min(ah, aw / 2 / RATIO) : Math.min(ah, aw / RATIO);
    pw = Math.floor(ph * RATIO); ph = Math.floor(pw / RATIO);
    book.style.width = (spread ? 2 * pw : pw) + 'px'; book.style.height = ph + 'px';
    pgL.style.width = pgR.style.width = pw + 'px'; pgL.style.display = spread ? '' : 'none';
    pgR.style.left = (spread ? pw : 0) + 'px';
    leaf.style.left = (spread ? pw : 0) + 'px'; leaf.style.width = pw + 'px';
    const sw = pw / S;
    strips.forEach((s, i) => { s.style.width = sw + 'px'; s.style.left = (i ? sw : 0) + 'px'; });
    facesA.forEach((f, i) => { f.style.backgroundSize = `${pw}px ${ph}px`; f.style.backgroundPosition = `${-i * sw}px 0`; f.style.width = `calc(100% + 1px)`; });
    facesB.forEach((f, i) => { f.style.backgroundSize = `${pw}px ${ph}px`; f.style.backgroundPosition = `${-(pw - (i + 1) * sw)}px 0`; f.style.width = `calc(100% + 1px)`; });
    scrub.max = max();
    edgeL.style.display = edgeR.style.display = spread ? '' : 'none';
  };
  // a spread on its cover (or back cover) sits centred on its one page
  const shiftFor = w => !spread ? 0 : w === 0 ? -pw / 2 : w === max() ? pw / 2 : 0;
  const shift = (w, anim = true) => { book.classList.toggle('no-anim', !anim); book.style.transform = `translateX(${shiftFor(w)}px)`; };

  const setPg = (pg, i) => {
    if (i < 0) { pg.classList.add('is-empty'); pg.style.backgroundImage = ''; return; }
    pg.classList.remove('is-empty'); pg.style.backgroundImage = `url(${url(i)})`; pre(i);
  };
  const show = (anim = false) => {
    const [L, R] = LR(v);
    if (spread) setPg(pgL, L);
    setPg(pgR, R);
    shift(v, anim);
    if (spread) {
      const left = L < 0 ? 0 : L + 1, right = R < 0 ? 0 : B.n - R;
      edgeL.style.setProperty('--e', Math.min(10, left * .14) + 'px'); edgeR.style.setProperty('--e', Math.min(10, right * .14) + 'px');
      edgeL.style.opacity = L < 0 ? 0 : 1; edgeR.style.opacity = R < 0 ? 0 : 1;
    }
    castL.style.opacity = castR.style.opacity = 0;
    const m = max();
    prevB.disabled = v <= 0; nextB.disabled = v >= m; scrub.value = v;
    countEl.textContent = spread
      ? (v === 0 ? 'Cover' : v === m ? 'Back cover' : `Pages ${L + 1}–${R + 1} of ${B.n}`)
      : (v === 0 ? 'Cover' : v === m ? 'Back cover' : `Page ${v + 1} of ${B.n}`);
    for (let k = -3; k <= 5; k++) { const p = pageOf(v) + k; pre(p); }
  };

  /* ---------- The turning leaf ---------- */
  const setFaces = (a, b) => {
    facesA.forEach(f => { f.style.backgroundImage = a < 0 ? 'none' : `url(${url(a)})`; });
    facesB.forEach(f => { f.style.backgroundImage = b < 0 ? 'none' : `url(${url(b)})`; });
  };
  // th: the page's angle, 0 (flat on the right) to 180 (flat on the left); dir: +1 turning forward, -1 back
  const angle = (th, dir) => {
    const bend = reduce ? 0 : CURL * Math.sin(th * Math.PI / 180);
    let prevPhi = 0;
    for (let i = 0; i < S; i++) {
      const phi = clamp(th + dir * bend * Math.pow((i + 1) / S, 1.8), 0, 180);
      strips[i].style.transform = `rotateY(${(prevPhi - phi).toFixed(2)}deg)`;
      prevPhi = phi;
      facesA[i].style.setProperty('--sh', (.5 * Math.pow(Math.min(phi, 90) / 90, 2)).toFixed(3));
      facesB[i].style.setProperty('--sh', (.5 * Math.pow(Math.min(180 - phi, 90) / 90, 2)).toFixed(3));
      facesB[i].style.setProperty('--hl', (.12 * Math.sin(phi * Math.PI / 180)).toFixed(3));
    }
    // the lifted page throws a shadow across the page underneath it
    const c = Math.cos(th * Math.PI / 180), s = Math.sin(th * Math.PI / 180);
    castR.style.width = Math.max(0, pw * c) + 40 + 'px'; castR.style.opacity = c > 0 ? (.8 * s).toFixed(3) : 0;
    castL.style.width = Math.max(0, -pw * c) + 40 + 'px'; castL.style.opacity = c < 0 ? (.8 * s).toFixed(3) : 0;
  };
  // set the static pages and the leaf for a turn from the current view
  const begin = (dir, move = true) => {
    const [L, R] = LR(v);
    if (spread) {
      if (dir > 0) { const [L2, R2] = LR(v + 1); setPg(pgL, L); setPg(pgR, R2); setFaces(R, L2); }
      else { const [L0, R0] = LR(v - 1); setPg(pgL, L0); setPg(pgR, R); setFaces(R0, L); }
      if (move) shift(v + dir);
    } else {
      if (dir > 0) { setPg(pgR, v + 1); setFaces(v, -1); } else { setPg(pgR, v); setFaces(v - 1, -1); }
    }
    leaf.classList.add('is-on'); angle(dir > 0 ? 0 : 180, dir);
  };
  const run = (from, to, dir, dur, done) => {
    cancelAnimationFrame(raf); busy = true;
    const t0 = performance.now();
    const step = now => {
      const k = reduce ? 1 : Math.min(1, (now - t0) / dur), th = from + (to - from) * ease(k);
      angle(th, dir);
      if (k < 1) raf = requestAnimationFrame(step); else { busy = false; done && done(); }
    };
    raf = requestAnimationFrame(step);
  };
  const finish = () => { leaf.classList.remove('is-on'); show(); };
  const next = () => { if (busy || !B || v >= max()) return; peeking = false; begin(1); run(0, 180, 1, 950, () => { v++; finish(); }); };
  const prev = () => { if (busy || !B || v <= 0) return; peeking = false; begin(-1); run(180, 0, -1, 950, () => { v--; finish(); }); };
  const go = w => { if (busy) return; v = clamp(w, 0, max()); leaf.classList.remove('is-on'); show(true); };

  /* ---------- Dragging, tapping and a corner that lifts under the pointer ---------- */
  const drag = () => {
    let d = null;
    const thAt = (x, r) => spread ? clamp((r.left + 2 * pw - x) / (2 * pw), 0, 1) * 180 : clamp((r.left + pw - x) / pw, 0, 1) * 180;
    stage.addEventListener('pointerdown', e => {
      if (busy || e.button > 0 || e.target.closest('.fb__nav')) return;
      const r = book.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      const mid = spread ? r.left + pw : r.left + pw / 2, dir = e.clientX >= mid ? 1 : -1;
      if ((dir > 0 && v >= max()) || (dir < 0 && v <= 0)) return;
      if (peeking) { peeking = false; leaf.classList.remove('is-on'); show(); }
      d = { dir, x0: e.clientX, r, started: false, th: dir > 0 ? 0 : 180, lx: e.clientX, lt: performance.now(), vx: 0 };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => {
      if (!d) { peek(e); return; }
      if (!d.started && Math.abs(e.clientX - d.x0) < 6) return;
      if (!d.started) { d.started = true; begin(d.dir, false); }
      const now = performance.now(); d.vx = (e.clientX - d.lx) / Math.max(1, now - d.lt); d.lx = e.clientX; d.lt = now;
      d.th = thAt(e.clientX, d.r); angle(d.th, d.dir);
    });
    const up = () => {
      if (!d) return; const g = d; d = null;
      if (!g.started) { g.dir > 0 ? next() : prev(); return; }
      const done = g.dir > 0 ? (g.th > 70 || g.vx < -.35) : (g.th < 110 || g.vx > .35);
      if (done) { shift(v + g.dir); run(g.th, g.dir > 0 ? 180 : 0, g.dir, 520, () => { v += g.dir; finish(); }); }
      else run(g.th, g.dir > 0 ? 0 : 180, g.dir, 380, finish);
    };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('pointerleave', () => { if (peeking && !busy) { peeking = false; finish(); } });
  };
  // near the outer corner of the right-hand page, the page lifts a little, inviting a turn
  const peek = e => {
    if (busy || reduce || e.pointerType !== 'mouse' || !B || v >= max()) return;
    const r = book.getBoundingClientRect(), cx = r.right, cy = r.bottom;
    const dist = Math.hypot(cx - e.clientX, cy - e.clientY), zone = 130;
    if (dist < zone && e.clientX <= r.right && e.clientY <= r.bottom) {
      if (!peeking) { peeking = true; begin(1, false); }
      angle(26 * (1 - dist / zone), 1);
    } else if (peeking) { peeking = false; finish(); }
  };

  /* ---------- Open and close ---------- */
  const open = (key, from) => {
    if (!built) build();
    lastFocus = document.activeElement;
    setBook(key); v = 0;
    el.classList.add('is-open'); document.documentElement.style.overflow = 'hidden';
    cfg.onOpen && cfg.onOpen();
    layout(); show();
    // the book flies in from where it was on the page, then its cover opens
    if (from && !reduce && fly.animate) {
      const a = from.getBoundingClientRect(), b = pgR.getBoundingClientRect();
      const s = a.height / b.height, dx = (a.left + a.width / 2) - (b.left + b.width / 2), dy = (a.top + a.height / 2) - (b.top + b.height / 2);
      fly.animate([{ transform: `translate(${dx}px,${dy}px) scale(${s}) rotateY(24deg)`, opacity: .4 }, { transform: 'none', opacity: 1 }],
        { duration: 800, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    setTimeout(() => xBtn.focus({ preventScroll: true }), 50);
    setTimeout(() => { if (v === 0) next(); }, reduce ? 0 : 820);
  };
  const close = () => {
    if (!el || !el.classList.contains('is-open')) return;
    cancelAnimationFrame(raf); busy = false; peeking = false; leaf.classList.remove('is-on');
    el.classList.remove('is-open'); document.documentElement.style.overflow = '';
    cfg.onClose && cfg.onClose();
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  };

  return { init: c => { cfg = c; }, open, close, preload: (key, count = 3) => { const b = cfg.books.find(x => x.key === key); if (!b) return; const keep = B; B = b; for (let i = 0; i < count; i++) pre(i); B = keep; } };
})();
