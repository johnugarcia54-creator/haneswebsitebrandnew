/* =========================================================================================
   Hanes globe: a dotted Earth drawn to a canvas, shared by the Contact page and the home page.
   About 18,000 land dots on an orthographic sphere, redrawn every frame; finer dot grids for
   New Zealand and the south China coast take over as the camera closes in. The planet's body
   and atmosphere are a CSS layer (.hg-planet) that the GPU moves and scales, so the canvas only
   draws dots, routes and markers. Needs assets/globe-dots.js.
   ========================================================================================= */
window.HanesGlobe = (() => {
  'use strict';
  const D2R = Math.PI / 180;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  const decode = gr => {
    const s = atob(gr.b64), out = [];
    let i = 0;
    for (let r = 0; r < gr.rows.length; r++) {
      const lat = gr.lat0 + gr.D / 2 + r * gr.D, cnt = gr.rows[r];
      for (let k = 0; k < cnt; k++, i++) if (s.charCodeAt(i >> 3) >> (i & 7) & 1) out.push(lat, gr.lon0 + (k + .5) * (gr.lon1 - gr.lon0) / cnt);
    }
    return out;
  };
  // each dot keeps sin/cos of its latitude and longitude, so turning the globe is a few multiplies
  const pack = (ll, boxes) => {
    const n = ll.length / 2, a = new Float32Array(n * 4), inBox = boxes ? new Uint8Array(n) : null;
    for (let j = 0; j < n; j++) {
      const la = ll[2 * j] * D2R, lo = ll[2 * j + 1] * D2R;
      a[4 * j] = Math.sin(la); a[4 * j + 1] = Math.cos(la); a[4 * j + 2] = Math.sin(lo); a[4 * j + 3] = Math.cos(lo);
      if (boxes) inBox[j] = boxes.some(b => ll[2 * j] >= b[0] && ll[2 * j] <= b[1] && ll[2 * j + 1] >= b[2] && ll[2 * j + 1] <= b[3]) ? 1 : 0;
    }
    return { n, a, inBox };
  };
  let SETS = null;
  const sets = () => {
    if (SETS) return SETS;
    const D = window.HANES_DOTS, box = g => [g.lat0, g.lat0 + g.D * g.rows.length, g.lon0, g.lon1];
    SETS = { world: pack(decode(D.world), [box(D.nz), box(D.cn)]), nz: pack(decode(D.nz)), cn: pack(decode(D.cn)), D };
    return SETS;
  };

  const vec = (lat, lon) => { const la = lat * D2R, lo = lon * D2R; return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]; };
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const toLL = v => [Math.asin(clamp(v[2] / Math.hypot(v[0], v[1], v[2]), -1, 1)) / D2R, Math.atan2(v[1], v[0]) / D2R];
  const angle = (a, b) => Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
  // a great-circle arc from a to b, lifted off the surface in the middle like a flight path
  const arc = (a, b, n = 64, lift = .16) => {
    const om = angle(a, b), so = Math.sin(om) || 1, out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, k1 = Math.sin((1 - t) * om) / so, k2 = Math.sin(t * om) / so, h = 1 + lift * om * Math.sin(Math.PI * t);
      out.push([(a[0] * k1 + b[0] * k2) * h, (a[1] * k1 + b[1] * k2) * h, (a[2] * k1 + b[2] * k2) * h]);
    }
    return out;
  };
  // the camera between two views: longitude, latitude and radius (on a log scale) blended, with an
  // optional pull-back mid-flight so long hops read as travel rather than a smear
  const mixCam = (a, b, k, hop = 0) => {
    const R = Math.exp(lerp(Math.log(a.R), Math.log(b.R), k)) * (1 - hop * Math.sin(Math.PI * k));
    return { lon: lerp(a.lon, b.lon, k), lat: lerp(a.lat, b.lat, k), R, cx: lerp(a.cx ?? .5, b.cx ?? .5, k), cy: lerp(a.cy ?? .5, b.cy ?? .5, k) };
  };

  class Globe {
    constructor({ canvas, planet, maxPixels = 4.2e6, dot = '232,237,245' }) {
      this.cvs = canvas; this.ctx = canvas.getContext('2d'); this.planet = planet; this.maxPixels = maxPixels; this.dot = dot;
      this.W = this.H = this.MIN = 1; this.DPR = 1; this.tf = '';
      this.resize();
    }
    resize() {
      const w = this.cvs.clientWidth || innerWidth, h = this.cvs.clientHeight || innerHeight;
      this.DPR = Math.min(devicePixelRatio || 1, 2, Math.sqrt(this.maxPixels / (w * h)));
      this.W = Math.round(w * this.DPR); this.H = Math.round(h * this.DPR); this.MIN = Math.min(this.W, this.H);
      this.cvs.width = this.W; this.cvs.height = this.H; this.tf = '';
    }
    // cam: { lon, lat, R (share of the shorter side), cx, cy (shares of width and height) }
    render(cam) {
      const S = sets(), c = this.ctx, W = this.W, H = this.H, DPR = this.DPR;
      const R = cam.R * this.MIN, cx = (cam.cx ?? .5) * W, cy = (cam.cy ?? .5) * H;
      Object.assign(this, { cam, R, cx, cy });
      c.clearRect(0, 0, W, H);
      if (this.planet) {
        const tf = `translate(${(cx / DPR).toFixed(1)}px,${(cy / DPR).toFixed(1)}px) scale(${(R / DPR / 500).toFixed(4)})`;
        if (tf !== this.tf) { this.planet.style.transform = tf; this.tf = tf; }
      }
      const k = R / (this.MIN * .44), fine = clamp((k - 3.2) / 1.6);
      const sz = clamp(S.D.world.D * D2R * R * .3, 1.3 * DPR, 3.6 * DPR), fz = D => clamp(D * D2R * R * .42, 1.2 * DPR, 4.2 * DPR);
      if (fine > 0) {
        this.dots(S.world, sz, 1, 1);
        if (fine < 1) this.dots(S.world, sz, 1 - fine, 2);
        this.dots(S.nz, fz(S.D.nz.D), fine);
        this.dots(S.cn, fz(S.D.cn.D), fine);
      } else this.dots(S.world, sz, 1);
      const C0 = Math.cos(cam.lon * D2R), S0 = Math.sin(cam.lon * D2R), Cl = Math.cos(cam.lat * D2R), Sl = Math.sin(cam.lat * D2R);
      // project a point on (or above) the unit sphere to [x, y, facing, height]
      this.P = v => {
        const r = Math.hypot(v[0], v[1], v[2]), h = Math.hypot(v[0], v[1]) || 1;
        const sinLat = v[2] / r, cosLat = h / r, cosLon = v[0] / h, sinLon = v[1] / h;
        const cl = cosLon * C0 + sinLon * S0, sl = sinLon * C0 - cosLon * S0;
        return [cx + R * r * cosLat * sl, cy - R * r * (Cl * sinLat - Sl * cosLat * cl), Sl * sinLat + Cl * cosLat * cl, r];
      };
      return this.P;
    }
    dots(set, size, alpha, only) { // only: undefined = every dot, 1 = outside the fine grids, 2 = inside them
      const { cam, R, cx, cy, W, H } = this, c = this.ctx;
      const C0 = Math.cos(cam.lon * D2R), S0 = Math.sin(cam.lon * D2R), Cl = Math.cos(cam.lat * D2R), Sl = Math.sin(cam.lat * D2R);
      const a = set.a, n = set.n, m = size * 2, round = size >= 3.2, half = size / 2;
      const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
      for (let j = 0; j < n; j++) {
        if (only && (set.inBox[j] ? 2 : 1) !== only) continue;
        const o = j * 4, sLa = a[o], cLa = a[o + 1], sLo = a[o + 2], cLo = a[o + 3];
        const cl = cLo * C0 + sLo * S0, z = Sl * sLa + Cl * cLa * cl; if (z <= 0) continue;
        const sl = sLo * C0 - cLo * S0, X = cx + R * cLa * sl, Y = cy - R * (Cl * sLa - Sl * cLa * cl);
        if (X < -m || Y < -m || X > W + m || Y > H + m) continue;
        const b = z < .22 ? 0 : z < .45 ? 1 : z < .7 ? 2 : 3;
        if (round) { paths[b].moveTo(X + half, Y); paths[b].arc(X, Y, half, 0, 6.2832); } else paths[b].rect(X - half, Y - half, size, size);
      }
      const A = [.26, .46, .66, .9];
      for (let b = 0; b < 4; b++) { c.fillStyle = `rgba(${this.dot},${(A[b] * alpha).toFixed(3)})`; c.fill(paths[b]); }
    }
    line(pts, from, to, style, width) {
      const c = this.ctx, P = this.P; c.beginPath(); let pen = false;
      const i0 = Math.max(0, Math.floor(from)), i1 = Math.min(pts.length - 1, Math.ceil(to));
      for (let i = i0; i <= i1; i++) {
        const q = P(pts[i]);
        // hidden only when behind the planet: a lifted point past the horizon can still clear the rim
        if (q[2] < -.01 && q[2] * q[2] > 1 - 1 / (q[3] * q[3])) { pen = false; continue; }
        pen ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); pen = true;
      }
      c.strokeStyle = style; c.lineWidth = width; c.stroke();
    }
    halo(x, y, r, rgb, a) { const c = this.ctx, g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill(); }
    marker(q, a, time, rgb = '41,151,255', pulse = true) {
      if (a <= .01 || q[2] < 0) return;
      const c = this.ctx, D = this.DPR, [x, y] = q;
      c.globalAlpha = a;
      this.halo(x, y, 18 * D, rgb, .55);
      if (pulse) { const ph = (time % 1.8) / 1.8; c.strokeStyle = `rgba(${rgb},${(.8 * (1 - ph)).toFixed(3)})`; c.lineWidth = 1.5 * D; c.beginPath(); c.arc(x, y, (5 + 22 * easeOut(ph)) * D, 0, 6.2832); c.stroke(); }
      c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, 3.6 * D, 0, 6.2832); c.fill();
      c.globalAlpha = 1;
    }
    label(text, x, y, a, align = 'left', sub) {
      if (a <= .01) return;
      const c = this.ctx, D = this.DPR;
      c.globalAlpha = a; c.textAlign = align; c.textBaseline = 'middle';
      c.font = `600 ${13 * D}px -apple-system,BlinkMacSystemFont,"SF Pro Text","Inter",sans-serif`;
      c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = 8 * D;
      c.fillStyle = '#f5f5f7'; c.fillText(text, x, y);
      if (sub) { c.font = `500 ${11 * D}px -apple-system,BlinkMacSystemFont,"SF Pro Text","Inter",sans-serif`; c.fillStyle = '#a1a1a6'; c.fillText(sub, x, y + 16 * D); }
      c.shadowBlur = 0; c.globalAlpha = 1;
    }
  }
  return { Globe, vec, norm, toLL, arc, angle, mixCam, clamp, lerp, ease, easeOut, D2R };
})();
