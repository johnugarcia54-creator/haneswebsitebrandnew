/* Hanes Distribution: the global bar. It tucks away once you scroll past it (each page's own nav slides up
   into its place), comes back at the top of the page, and opens a full list of the brands on small screens. */
(() => {
  const root = document.documentElement, gb = document.getElementById('gb');
  if (!gb) return;
  let off = false, queued = false;
  const update = () => {
    queued = false;
    const o = scrollY > 44;
    if (o !== off) { off = o; root.classList.toggle('gb-off', o); }
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  update();
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
