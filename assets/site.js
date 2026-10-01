/* Hanes Distribution: the global bar stays on screen. On a small screen it opens the full
   list of sections, and Get a quote, and closes again once a link is chosen. */
(() => {
  const root = document.documentElement, gb = document.getElementById('gb');
  if (!gb) return;
  const btn = gb.querySelector('.gb__burger');
  if (!btn) return;
  const setOpen = v => {
    root.classList.toggle('gb-open', v);
    btn.setAttribute('aria-expanded', String(v));
    btn.setAttribute('aria-label', v ? 'Close the Hanes menu' : 'Open the Hanes menu');
  };
  btn.addEventListener('click', () => setOpen(!root.classList.contains('gb-open')));
  gb.querySelectorAll('.gb__panel a').forEach(a => a.addEventListener('click', () => setOpen(false)));
  addEventListener('keydown', e => { if (e.key === 'Escape' && root.classList.contains('gb-open')) { setOpen(false); btn.focus(); } });
  addEventListener('resize', () => { if (innerWidth > 833) setOpen(false); });
})();
