/* =========================================================================================
   Hanes frame sequences: scroll-scrubbed image sequences drawn to a canvas, shared by pages that
   play one (the same engine the home page runs). Frames are fetched and decoded into ImageBitmaps
   in a worker, only a small window around the playhead is kept decoded, and each frame is cropped
   and sized to exactly what is on screen.
   Usage: const s = HanesSequence.create({ canvas, dir: 'frames2/hisense', count: 121 }); s.load(); s.set(frame);
   ========================================================================================= */
window.HanesSequence = (() => {
  'use strict';
  /* ---------- Frame decoder: fetch + decode off the main thread, straight to the size that gets drawn ---------- */
  // Drawing a 2560px <img> into a canvas makes the browser re-decode it synchronously whenever it has evicted the
  // decoded pixels (it can't keep ~1000 of them), which stalled every scroll frame. Frames are decoded into
  // ImageBitmaps in a worker instead, and only a small window around the playhead is kept decoded.
  function decoderCore(post, load) {
    const cache = new Map(), q = []; let busy = 0;
    const get = url => { let p = cache.get(url); if (!p) { cache.set(url, p = load(url)); p.catch(() => cache.delete(url)); } return p; };
    const pump = () => { while (busy < 6 && q.length) { const m = q.shift(); busy++;
      get(m.url).then(() => 1, () => 0).then(ok => { busy--; post({ t: 'got', s: m.s, i: m.i, ok }); pump(); }); } };
    // m.c = the on-screen part of the frame [x, y, w, h]; m.w/m.h = the size it is drawn at
    const full = typeof createImageBitmap === 'undefined';
    const bitmap = (src, m) => full ? src : !m.c ? createImageBitmap(src)
      : createImageBitmap(src, m.c[0], m.c[1], m.c[2], m.c[3], m.w ? { resizeWidth: m.w, resizeHeight: m.h, resizeQuality: 'high' } : {});
    return m => {
      if (m.t === 'prefetch') { q.push(...m.items); pump(); return; }
      get(m.url).then(src => bitmap(src, m)).then(bmp => post({ t: 'bmp', s: m.s, i: m.i, g: m.g, c: full ? null : m.c, bmp }, [bmp])).catch(() => post({ t: 'bmp', s: m.s, i: m.i, g: m.g }));
    };
  }
  const SEQS = [], MAXQ = 6; let inflight = 0, send;
  const route = m => { const s = SEQS[m.s]; if (m.t === 'got') return s.onGot(m.i, m.ok); inflight--; s.onBmp(m.i, m.g, m.bmp, m.c); SEQS.forEach(q => q.pump()); };
  const local = () => decoderCore(route, url => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; }));
  try {
    if (location.protocol === 'file:' || !window.Worker || !window.createImageBitmap) throw 0;
    const code = `const h=(${decoderCore})((m,t)=>postMessage(m,t),u=>fetch(u).then(r=>{if(!r.ok)throw r.status;return r.blob()}));onmessage=e=>h(e.data)`;
    const w = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))), early = []; let alive = false;
    w.onmessage = e => { alive = true; route(e.data); };
    w.onerror = () => { if (alive) return; send = local(); early.forEach(send); };
    send = m => { if (!alive) early.push(m); w.postMessage(m); };
  } catch (e) { send = local(); }
  const close = b => b && b.close && b.close();

  /* ---------- Frame sequence: coarse-to-fine prefetch, windowed decode, cover fit, sub-frame cross-fade ---------- */

  class Sequence {
    constructor(o) {
      Object.assign(this, { minVisX: 0, bg: null, align: .5, alignY: .5, readyFrac: .25 }, o);
      this.id = SEQS.push(this) - 1;
      this.name = this.dir.split('/').pop();
      this.F = window.__FRAMES && window.__FRAMES[this.name];
      if (this.F) this.count = this.F.length; else if (window.__SEQ && __SEQ[this.name]) this.count = __SEQ[this.name];
      const px = (this.canvas.clientWidth || innerWidth) * Math.min(devicePixelRatio || 1, 2);
      this.tier = px > 1400 ? 'lg' : 'sm';
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      this.bmp = new Array(this.count); this.bc = new Array(this.count); this.bgen = new Uint32Array(this.count); this.st = new Uint8Array(this.count);
      this.frame = 0; this.fpos = 0; this.dirn = 1; this.key = ''; this.shown = -1; this.fetched = 0; this.started = false;
      this.near = false; this.first = false; this.gen = 1; this.iw = this.ih = this.tw = this.th = 0; this.crop = null; this.ckey = '';
      this.ready = new Promise(r => this._ready = r);
      this.resize();
      // decode only while the section is within a screen of the viewport; entering from below means we're scrolling back up
      new IntersectionObserver(es => { const e = es[es.length - 1]; this.near = e.isIntersecting; if (this.near) this.dirn = e.boundingClientRect.top < 0 ? -1 : 1; this.pump(); }, { rootMargin: '100% 0px' }).observe(this.canvas.closest('section'));
    }
    url(i) { return this.F ? 'data:image/webp;base64,' + this.F[i] : new URL(`${this.dir}/${this.tier}/${String(i + 1).padStart(3, '0')}.webp`, document.baseURI).href; }
    order() {
      const seen = new Uint8Array(this.count), out = [];
      for (const step of [32, 16, 8, 4, 2, 1]) for (let i = 0; i < this.count; i += step) if (!seen[i]) { seen[i] = 1; out.push(i); }
      if (!seen[this.count - 1]) out.push(this.count - 1);
      return out;
    }
    load(onProgress) {
      if (this.started) return this.done; this.started = true;
      this.onProgress = onProgress; this.need = Math.ceil(this.count * this.readyFrac);
      this.done = new Promise(r => this._done = r);
      send({ t: 'prefetch', items: this.order().map(i => ({ s: this.id, i, url: this.url(i) })) });
      return this.done;
    }
    onGot() {
      this.fetched++; this.onProgress && this.onProgress(Math.min(1, this.fetched / this.need));
      this.checkReady(); if (this.fetched >= this.count) this._done();
    }
    checkReady() { if (this.first && this.fetched >= this.need) this._ready(); }
    fit(W, H) {
      const mv = typeof this.minVisX === 'function' ? this.minVisX() : this.minVisX;
      let s = Math.max(W / this.iw, H / this.ih); if (mv && W / (this.iw * s) < mv) s = W / (this.iw * mv);
      return s;
    }
    resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      let w = this.canvas.clientWidth * dpr, h = this.canvas.clientHeight * dpr;
      // never paint a frame bigger than its source: shrink the backing store and let the compositor scale it up
      if (this.iw) { const s = this.fit(w, h); if (s > 1) { w /= s; h /= s; } }
      this.w = Math.max(1, Math.round(w)); this.h = Math.max(1, Math.round(h));
      if (this.canvas.width !== this.w || this.canvas.height !== this.h) { this.canvas.width = this.w; this.canvas.height = this.h; }
      this.key = '';
      if (!this.iw) return;
      // decode only the part of the frame that is on screen (a portrait phone or tablet sees a narrow slice of a 16:9 frame)
      const s = this.fit(this.w, this.h), o = this.place(s);
      const sx = Math.max(0, Math.floor(-o.dx / s)), sy = Math.max(0, Math.floor(-o.dy / s));
      const crop = [sx, sy, Math.min(this.iw - sx, Math.ceil(this.w / s) + 1), Math.min(this.ih - sy, Math.ceil(this.h / s) + 1)];
      const tw = Math.round(crop[2] * s), th = Math.round(crop[3] * s), key = crop + ':' + tw + 'x' + th;
      if (key !== this.ckey) { this.ckey = key; this.crop = crop; this.tw = tw; this.th = th; this.gen++; }
    }
    place(s) {
      const dw = this.iw * s, dh = this.ih * s;
      return { dw, dh, dx: (this.w - dw) * this.align, dy: (this.h - dh) * (typeof this.alignY === 'function' ? this.alignY() : this.alignY) };
    }
    request(i) {
      this.st[i] = 1; inflight++;
      const c = this.crop; send({ t: 'decode', s: this.id, i, g: this.gen, url: this.url(i), c, w: c && this.tw !== c[2] ? this.tw : 0, h: this.th });
    }
    pump() {
      const n = this.count, f = this.frame, d = this.dirn;
      // keep ~10 frames decoded ahead of the playhead (in the scroll direction) and a few behind; release the rest
      for (let i = 0; i < n; i++) if (this.bmp[i] && (!this.near || (i - f) * d > 12 || (f - i) * d > 4)) { close(this.bmp[i]); this.bmp[i] = null; }
      if (!this.near) return;
      const want = [f, f + 1]; for (let k = 1; k <= 10; k++) want.push(f + d * k); for (let k = 1; k <= 2; k++) want.push(f - d * k);
      if (!this.iw) { if (!this.st.includes(1)) { const i = want.find(k => k >= 0 && k < n && !this.st[k]); if (i !== undefined) this.request(i); } return; }
      for (const i of want) {
        if (inflight >= MAXQ) break;
        if (i >= 0 && i < n && !this.st[i] && !(this.bmp[i] && this.bgen[i] === this.gen)) this.request(i);
      }
    }
    onBmp(i, g, bmp, c) {
      this.st[i] = bmp ? 0 : 2;
      if (bmp && !this.iw) { this.iw = bmp.width; this.ih = bmp.height; this.resize(); if (bmp.width === this.tw && bmp.height === this.th) g = this.gen; }
      if (!this.first) { this.first = true; this.checkReady(); }
      if (!bmp) return;
      const d = this.dirn, keep = this.near && (i - this.frame) * d <= 12 && (this.frame - i) * d <= 4;
      if (!keep || (g !== this.gen && this.bmp[i] && this.bgen[i] === this.gen)) return close(bmp);
      if (this.bmp[i] !== bmp) close(this.bmp[i]);
      this.bmp[i] = bmp; this.bgen[i] = g; this.bc[i] = c || [0, 0, this.iw, this.ih];
      if (Math.abs(i - this.frame) < 2 || this.shown !== this.frame) this.render(true);
    }
    nearest(i) {
      if (this.bmp[i]) return i;
      for (let d = 1; d < this.count; d++) { if (i - d >= 0 && this.bmp[i - d]) return i - d; if (i + d < this.count && this.bmp[i + d]) return i + d; }
      return -1;
    }
    set(f) {
      const p = Math.max(0, Math.min(this.count - 1, f)), fr = Math.floor(p);
      if (p !== this.fpos) this.dirn = p > this.fpos ? 1 : -1;
      this.fpos = p; if (fr !== this.frame) { this.frame = fr; this.pump(); }
      this.render();
    }
    render(force) {
      if (!this.iw) return;
      const i = this.nearest(this.frame); if (i < 0) return;
      const t = this.fpos - this.frame, j = this.frame + 1;
      const blend = i === this.frame && t > .04 && j < this.count && this.bmp[j] ? Math.round(t * 12) / 12 : 0;
      const key = i + ':' + blend; if (!force && key === this.key) return;
      const c = this.ctx, W = this.w, H = this.h, s = this.fit(W, H), { dw, dh, dx, dy } = this.place(s);
      if (this.bg && (dh < H - 1 || dw < W - 1)) { c.fillStyle = this.bg; c.fillRect(0, 0, W, H); }
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      // each bitmap covers its crop of the frame; at the current size this is a 1:1 blit
      const draw = k => { const r = this.bc[k]; c.drawImage(this.bmp[k], Math.round(dx + r[0] * s), Math.round(dy + r[1] * s), Math.round(r[2] * s), Math.round(r[3] * s)); };
      c.globalAlpha = 1; draw(i);
      if (blend) { c.globalAlpha = blend; draw(j); c.globalAlpha = 1; }
      this.key = key; this.shown = i;
    }
  }

  let rzq = 0;
  addEventListener('resize', () => { if (!rzq) rzq = requestAnimationFrame(() => { rzq = 0; SEQS.forEach(s => { s.resize(); s.render(true); s.pump(); }); }); });
  return { create: o => new Sequence(o) };
})();
