/* Milli, Hanes's AI guide: the launcher (ADDENDUM §8.1-8.3), added by assets/site.js after load
   and idle. Kept at 3 KB gzipped or less (tests/milli.test.mjs); the panel (milli-panel.js,
   milli.css, guide-faq.json) loads on the first click. A real 56 px button, bottom-left, under
   the bar (z-index 9980), hidden while html.gb-open or body.is-loading; never opens by itself.
   One hello on bargainhub.html, desktop only, once (localStorage bh_milli_nudged). The mascot is
   built node by node; states: is-idle (blink), is-think (antenna pulse), is-happy, is-rest. */
(() => {
  'use strict';
  const w = window, d = document;
  if (w.HanesMilli || !d.body) return;
  const base = new URL('.', (d.currentScript && d.currentScript.src) || location.origin + '/assets/guide/milli.js').href;
  const page = (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '') || 'index';
  const NS = 'http://www.w3.org/2000/svg';
  const store = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch { return null; } };
  const el = (t, a, ns) => { const e = ns ? d.createElementNS(NS, t) : d.createElement(t); for (const k in a) e.setAttribute(k, a[k]); return e; };

  // charcoal body, light face, brass antenna light and tape (§8.1)
  const SHAPES = [['path', { class: 'mk', d: 'M24 13V8' }], ['circle', { class: 'ma', cx: 24, cy: 6, r: 2.6 }],
    ['rect', { class: 'mb', x: 8, y: 13, width: 32, height: 27, rx: 10 }], ['rect', { class: 'mf', x: 13, y: 18, width: 22, height: 12, rx: 6 }],
    ['circle', { class: 'me mo', cx: 19.5, cy: 24, r: 2 }], ['circle', { class: 'me mo', cx: 28.5, cy: 24, r: 2 }],
    ['path', { class: 'me mh', d: 'M17.5 25.5q2-3.5 4 0M26.5 25.5q2-3.5 4 0' }], ['path', { class: 'me mr', d: 'M17.5 24.5h4M26.5 24.5h4' }],
    ['circle', { class: 'md', cx: 15, cy: 35, r: 2.2 }], ['rect', { class: 'mt', x: 29, y: 34, width: 14, height: 5, rx: 1 }],
    ['path', { class: 'mk', d: 'M32 34v2.4M35 34v1.4M38 34v2.4M41 34v1.4' }], ['rect', { class: 'mt', x: 42.4, y: 32, width: 1.8, height: 9, rx: .9 }]];
  const mascot = state => {
    const s = el('svg', { viewBox: '0 0 48 48', class: 'milli-m is-' + (state || 'idle'), 'aria-hidden': 'true', focusable: 'false' }, 1);
    for (const [t, a] of SHAPES) s.append(el(t, a, 1));
    return s;
  };

  const css = el('style', { id: 'milli-launcher-css' });
  css.textContent = '.milli-l{position:fixed;left:max(16px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom));z-index:9980;display:flex;align-items:center;min-width:56px;height:56px;margin:0;padding:0;border:2px solid #7a5a2f;border-radius:28px;background:#f5f1ea;color:#1d1d1f;font:600 1rem/1 Inter,-apple-system,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.28);cursor:pointer}'
    + '.milli-l .milli-m{width:52px;height:52px;flex:none}.milli-l__t{padding:0 18px 0 2px;white-space:nowrap}.milli-l:focus-visible{outline:3px solid #1d1d1f;outline-offset:3px;box-shadow:0 0 0 7px #fff}'
    + 'html.gb-open .milli-l,body.is-loading .milli-l,html.gb-open .milli-nudge,body.is-loading .milli-nudge,.milli-l[hidden],.milli-nudge[hidden]{display:none}'
    + '.milli-m .mb,.milli-m .mo,.milli-m .md{fill:#1d1d1f}.milli-m .mf{fill:#f5f1ea}.milli-m .ma,.milli-m .mt{fill:#9c7440}.milli-m .mk,.milli-m .mh,.milli-m .mr{fill:none;stroke:#1d1d1f;stroke-width:1.6;stroke-linecap:round}.milli-m .md{stroke:#9c7440;stroke-width:1.2}'
    + '.milli-m .mh,.milli-m .mr,.milli-m.is-happy .mo,.milli-m.is-rest .mo{display:none}.milli-m.is-happy .mh,.milli-m.is-rest .mr{display:inline}'
    + '.milli-m .mo{transform-box:fill-box;transform-origin:center}.milli-m.is-idle .mo{animation:milli-blink 6s infinite}.milli-m.is-think .ma{animation:milli-pulse 1s ease-in-out infinite alternate}'
    + '@keyframes milli-blink{0%,95%,100%{transform:none}97%{transform:scaleY(.1)}}@keyframes milli-pulse{to{opacity:.25}}'
    + '.milli-nudge{position:fixed;left:max(16px,env(safe-area-inset-left));bottom:calc(max(16px,env(safe-area-inset-bottom)) + 68px);z-index:9980;max-width:17rem;margin:0;padding:12px 48px 12px 14px;border:1px solid #1d1d1f;border-radius:14px;background:#fff;color:#1d1d1f;font:400 .9375rem/1.4 Inter,-apple-system,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.2)}'
    + '.milli-nudge button{position:absolute;top:0;right:0;width:44px;height:44px;border:0;background:none;color:inherit;font:inherit;font-size:1.25rem;cursor:pointer}.milli-nudge button:focus-visible{outline:2px solid #1d1d1f;outline-offset:-4px}'
    + '@media (max-width:760px){.milli-l__t{display:none}.milli-l{width:56px}}'
    + '@media (prefers-reduced-motion:reduce){.milli-m *{animation:none!important}}'
    + '@media (forced-colors:active){.milli-l,.milli-nudge{border-color:ButtonText}.milli-m .mb,.milli-m .mo,.milli-m .md{fill:CanvasText}.milli-m .mf{fill:Canvas}.milli-m .ma,.milli-m .mt{fill:CanvasText}.milli-m .mk,.milli-m .mh,.milli-m .mr,.milli-m .md{stroke:CanvasText}}';
  d.head.append(css);

  const btn = el('button', { type: 'button', class: 'milli-l', 'aria-label': 'Ask Milli, our AI guide', 'aria-expanded': 'false', 'aria-controls': 'milliPanel' });
  const face = mascot('idle'), label = el('span', { class: 'milli-l__t' });
  label.textContent = 'Ask Milli';
  btn.append(face, label);
  d.body.append(btn);

  let loading = null, nudge = null;
  const load = (tag, a) => new Promise((ok, no) => { const e = el(tag, a); e.onload = ok; e.onerror = () => { e.remove(); no(); }; d.head.append(e); });
  const M = w.HanesMilli = {
    page, base, btn, mascot,
    setState: s => face.setAttribute('class', 'milli-m is-' + s),
    open() {
      if (nudge) nudge.remove();
      if (M.panel) return M.panel.toggle();
      loading = loading || Promise.all([load('link', { rel: 'stylesheet', href: base + 'milli.css' }), load('script', { src: base + 'milli-panel.js' })])
        .then(() => M.panel && M.panel.toggle(), () => {
          loading = null; // try again on the next click; meanwhile a person can still be reached
          const q = w.HanesEnquiry;
          if (q && q.open) q.open('General enquiry', '', '', btn); else location.assign('/contact.html#enquiry');
        });
    }
  };
  btn.addEventListener('click', () => M.open());

  // one hello on Bargainhub, desktop only, never again once shown (§8.2)
  if (page === 'bargainhub' && !store('bh_milli_nudged') && w.matchMedia && w.matchMedia('(min-width:761px) and (hover:hover) and (pointer:fine)').matches) {
    setTimeout(() => {
      if (M.panel || loading || store('bh_milli_nudged')) return;
      store('bh_milli_nudged', '1');
      nudge = el('p', { class: 'milli-nudge', role: 'status' });
      const hi = el('span', { lang: 'mi' }), x = el('button', { type: 'button', 'aria-label': "Dismiss Milli's hello" });
      hi.textContent = 'Kia ora';
      x.textContent = '×';
      x.addEventListener('click', () => { nudge.remove(); btn.focus(); });
      nudge.append(hi, ", I'm Milli, Hanes's AI guide. Ask me how the design studio works.", x);
      d.body.append(nudge);
    }, 20000);
  }
})();
