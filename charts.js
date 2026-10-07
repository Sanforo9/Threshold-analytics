/* Gráficos mínimos en canvas (sin librerías). */
(function (root) {
'use strict';
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const isNum = v => typeof v === 'number' && isFinite(v);

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, r.width * dpr); canvas.height = Math.max(1, r.height * dpr);
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, r.width, r.height);
  return { g, w: r.width, h: r.height };
}
function niceRange(lo, hi, invert) {
  if (!isFinite(lo) || !isFinite(hi)) return [0, 1];
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08; return [lo - pad, hi + pad];
}
function emptyMsg(g, w, h, msg) { g.fillStyle = css('--muted'); g.font = '13px system-ui'; g.textAlign = 'center'; g.fillText(msg || 'Sin datos', w / 2, h / 2); }

/* cfg: { x:[valores], xFmt(v), series:[{data,color,label,axis:'l'|'r',fmt,width}], yl:{min,max,invert,fmt}, yr:{...}, fill:boolean } */
function line(canvas, cfg) {
  const { g, w, h } = setup(canvas);
  const hasR = cfg.series.some(s => s.axis === 'r');
  const pad = { l: 46, r: hasR ? 50 : 24, t: 22, b: 24 };
  const x = cfg.x, N = x.length;
  const valid = cfg.series.filter(s => s.data.some(isNum));
  if (!N || !valid.length) { emptyMsg(g, w, h, cfg.empty); canvas._chart = null; return; }
  const rng = axis => {
    const vals = []; cfg.series.filter(s => (s.axis || 'l') === axis).forEach(s => s.data.forEach(v => { if (isNum(v)) vals.push(v); }));
    const o = (axis === 'l' ? cfg.yl : cfg.yr) || {};
    let lo = o.min != null ? o.min : Math.min(...vals), hi = o.max != null ? o.max : Math.max(...vals);
    if (o.min == null || o.max == null) { const [a, b] = niceRange(lo, hi); if (o.min == null) lo = a; if (o.max == null) hi = b; }
    return { lo, hi, invert: !!o.invert, fmt: o.fmt || (v => Math.round(v)) };
  };
  const R = { l: rng('l'), r: hasR ? rng('r') : null };
  const X = i => pad.l + (w - pad.l - pad.r) * (N === 1 ? 0.5 : i / (N - 1));
  const Y = (v, ax) => { const a = R[ax]; let f = (v - a.lo) / (a.hi - a.lo); if (a.invert) f = 1 - f; return pad.t + (h - pad.t - pad.b) * (1 - f); };
  // rejilla + eje izq
  g.strokeStyle = css('--grid'); g.fillStyle = css('--muted'); g.font = '11px system-ui'; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (h - pad.t - pad.b) * i / 4; g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke();
    const a = R.l, f = a.invert ? i / 4 : 1 - i / 4; g.textAlign = 'right'; g.fillText(a.fmt(a.lo + (a.hi - a.lo) * f), pad.l - 6, y + 4);
    if (R.r) { const b = R.r, f2 = b.invert ? i / 4 : 1 - i / 4; g.textAlign = 'left'; g.fillText(b.fmt(b.lo + (b.hi - b.lo) * f2), w - pad.r + 6, y + 4); }
  }
  // eje x
  const nt = Math.min(6, N);
  for (let i = 0; i < nt; i++) { const k = Math.round(i * (N - 1) / Math.max(1, nt - 1)); g.textAlign = i === 0 ? 'left' : (i === nt - 1 && nt > 1 ? 'right' : 'center'); g.fillText(cfg.xFmt ? cfg.xFmt(x[k]) : x[k], X(k) + (i === 0 ? -4 : 0), h - 7); }
  // línea cero si se cruza
  if (R.l.lo < 0 && R.l.hi > 0) { g.strokeStyle = css('--muted'); g.setLineDash([4, 4]); const y0 = Y(0, 'l'); g.beginPath(); g.moveTo(pad.l, y0); g.lineTo(w - pad.r, y0); g.stroke(); g.setLineDash([]); }
  if (cfg.bands) for (const b of cfg.bands) { g.fillStyle = b.color; const ya = Y(b.from, 'l'), yb = Y(b.to, 'l'); g.fillRect(pad.l, Math.min(ya, yb), w - pad.l - pad.r, Math.abs(yb - ya)); }
  // series
  for (const s of cfg.series) {
    const ax = s.axis || 'l'; g.strokeStyle = s.color; g.lineWidth = s.width || 1.8; g.beginPath(); let pen = false;
    s.data.forEach((v, i) => { if (!isNum(v)) { pen = false; return; } const px = X(i), py = Y(v, ax); if (!pen) { g.moveTo(px, py); pen = true; } else g.lineTo(px, py); });
    g.stroke();
  }
  // leyenda
  let lx = pad.l; g.font = '11px system-ui'; g.textAlign = 'left';
  for (const s of cfg.series) { g.fillStyle = s.color; g.fillRect(lx, 6, 10, 3); g.fillStyle = css('--muted'); g.fillText(s.label, lx + 14, 11); lx += 22 + g.measureText(s.label).width; }
  canvas._chart = { cfg, X, Y, pad, w, h, N };
  attachHover(canvas);
}
function attachHover(canvas) {
  if (canvas._hov) return; canvas._hov = true;
  const tip = document.createElement('div'); tip.className = 'tip'; canvas.parentNode.style.position = 'relative'; canvas.parentNode.appendChild(tip);
  canvas.addEventListener('pointermove', e => {
    const c = canvas._chart; if (!c) return;
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left;
    const f = (mx - c.pad.l) / (c.w - c.pad.l - c.pad.r); if (f < 0 || f > 1) { tip.style.display = 'none'; return; }
    const i = Math.round(f * (c.N - 1)), cfg = c.cfg;
    const parts = cfg.series.map(s => isNum(s.data[i]) ? s.label + ': ' + ((s.fmt || (v => Math.round(v * 10) / 10))(s.data[i])) : null).filter(Boolean);
    tip.textContent = (cfg.xFmt ? cfg.xFmt(cfg.x[i]) : cfg.x[i]) + '  ·  ' + parts.join('  ·  ');
    tip.style.display = 'block'; tip.style.left = Math.min(Math.max(8, mx - 60), c.w - 220) + 'px';
  });
  canvas.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
}
/* barras: { labels, values, color, fmt, highlight(index)->color } */
function bars(canvas, cfg) {
  const { g, w, h } = setup(canvas), pad = { l: 46, r: 8, t: 14, b: 26 };
  const vals = cfg.values; if (!vals.some(v => isNum(v) && v > 0)) { emptyMsg(g, w, h, cfg.empty); return; }
  const max = Math.max(...vals.filter(isNum)) * 1.12 || 1, fmt = cfg.fmt || (v => Math.round(v));
  g.strokeStyle = css('--grid'); g.fillStyle = css('--muted'); g.font = '11px system-ui'; g.textAlign = 'right';
  for (let i = 0; i <= 4; i++) { const y = pad.t + (h - pad.t - pad.b) * (1 - i / 4); g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke(); g.fillText(fmt(max * i / 4), pad.l - 6, y + 4); }
  const bw = (w - pad.l - pad.r) / vals.length;
  vals.forEach((v, i) => {
    if (!isNum(v)) return; const bh = (h - pad.t - pad.b) * v / max;
    g.fillStyle = cfg.colors ? cfg.colors[i] : cfg.color; g.fillRect(pad.l + i * bw + bw * 0.2, h - pad.b - bh, bw * 0.6, bh);
    g.fillStyle = css('--muted'); g.textAlign = 'center'; g.fillText(cfg.labels[i], pad.l + i * bw + bw / 2, h - 8);
    if (bh > 14) { g.fillStyle = css('--ink'); g.fillText(fmt(v), pad.l + i * bw + bw / 2, h - pad.b - bh - 4); }
  });
}
root.Charts = { line, bars, css };
})(window);
