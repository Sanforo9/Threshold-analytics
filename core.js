/* TrainLog core: lectura de archivos FIT/GPX/TCX y cálculo de métricas.
   Sin dependencias. Funciona en navegador (window.Core) y en Node (module.exports). */
(function (root) {
'use strict';

const SPORTS = { run: 'Carrera', bike: 'Ciclismo', swim: 'Natación', other: 'Otro' };
const ZN = ['Z1 Recuperación', 'Z2 Aeróbica', 'Z3 Tempo', 'Z4 Umbral', 'Z5 VO₂máx'];
// Zonas de FC de la Calculadora de Test de Threshold (% de la FC umbral): Z1 <69, Z2 69-83, Z3 84-94, Z4 95-105, Z5 >105
const ZLIM = [0.69, 0.83, 0.94, 1.05]; // límites superiores Z1..Z4 como fracción de la FC umbral
// Zonas de potencia (% del FTP): Z1 <55, Z2 55-75, Z3 75-90, Z4 90-105, Z5 105-120, Z6 120-150, Z7 >150 (Z1-Z5 como la Calculadora de Test)
const PZN = ['Z1 Recuperación', 'Z2 Resistencia', 'Z3 Tempo', 'Z4 Umbral', 'Z5 VO₂máx', 'Z6 Capacidad anaeróbica', 'Z7 Neuromuscular'];
const PZLIM = [0.55, 0.75, 0.90, 1.05, 1.20, 1.50];
const FIT_EPOCH = 631065600;
const GAP = 10; // segundos máximos que se interpolan

/* ---------- utilidades ---------- */
const isNum = v => typeof v === 'number' && isFinite(v);
function mean(a) { let s = 0, n = 0; for (const v of a) if (isNum(v)) { s += v; n++; } return n ? s / n : NaN; }
function sd(a) { const m = mean(a); let s = 0, n = 0; for (const v of a) if (isNum(v)) { s += (v - m) ** 2; n++; } return n > 1 ? Math.sqrt(s / (n - 1)) : NaN; }
function median(a) { const b = a.filter(isNum).sort((x, y) => x - y); if (!b.length) return NaN; const k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; }
function movAvg(arr, w, minFrac = 0.5) { // media móvil que ignora NaN (ventana hacia atrás)
  const n = arr.length, out = new Float32Array(n);
  const ps = new Float64Array(n + 1), pc = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) { const v = arr[i], ok = isNum(v); ps[i + 1] = ps[i] + (ok ? v : 0); pc[i + 1] = pc[i] + (ok ? 1 : 0); }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w + 1), c = pc[i + 1] - pc[a];
    out[i] = c >= Math.max(1, w * minFrac) ? (ps[i + 1] - ps[a]) / c : NaN;
  }
  return out;
}
function haversine(la1, lo1, la2, lo2) {
  const t = x => x * Math.PI / 180, dLa = t(la2 - la1), dLo = t(lo2 - lo1);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(t(la1)) * Math.cos(t(la2)) * Math.sin(dLo / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}
function dayKey(ms) { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function keyToDate(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function weekStartKey(ms) { const d = new Date(ms); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return dayKey(d.getTime()); }
function addDays(k, n) { const d = keyToDate(k); d.setDate(d.getDate() + n); return dayKey(d.getTime()); }
function daysBetween(a, b) { return Math.round((keyToDate(b) - keyToDate(a)) / 864e5); }

/* ---------- perfil ---------- */
function normProfile(p, observedMax) {
  const o = Object.assign({ hrMax: 0, hrRest: 0, lthr: 0, ftp: 0, sex: 'm' }, p || {});
  o.hrMaxAuto = !(+o.hrMax > 0);
  o.hrMax = +o.hrMax > 0 ? +o.hrMax : (observedMax >= 120 ? Math.round(observedMax) : 190);
  o.hrRestAuto = !(+o.hrRest > 0); o.hrRest = +o.hrRest > 0 ? +o.hrRest : 60;
  o.ftp = +o.ftp || 0;
  o.lthrAuto = !(+o.lthr > 0); o.lthr = +o.lthr > 0 ? +o.lthr : Math.round(o.hrMax * 0.9);
  return o;
}
function observedMaxHr(rs) {
  const h = movAvg(rs.s.hr, 5, 0.6); let m = 0;
  for (const v of h) if (isNum(v) && v > m) m = v;
  return m;
}

/* ---------- lector FIT ---------- */
function parseFit(buf) {
  const dv = new DataView(buf), len = buf.byteLength;
  if (len < 14) throw new Error('Archivo FIT demasiado corto');
  const hsize = dv.getUint8(0);
  const sig = String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11));
  if (sig !== '.FIT') throw new Error('No es un archivo FIT válido');
  const end = Math.min(len, hsize + dv.getUint32(4, true));
  const SIZES = { 0: 1, 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 8: 4, 9: 8, 10: 1, 11: 2, 12: 4, 13: 1 };
  const one = (o, bt, le) => {
    switch (bt) {
      case 0: case 2: case 13: { const v = dv.getUint8(o); return v === 0xFF ? null : v; }
      case 10: { const v = dv.getUint8(o); return v === 0 ? null : v; }
      case 1: { const v = dv.getInt8(o); return v === 0x7F ? null : v; }
      case 3: { const v = dv.getInt16(o, le); return v === 0x7FFF ? null : v; }
      case 4: { const v = dv.getUint16(o, le); return v === 0xFFFF ? null : v; }
      case 11: { const v = dv.getUint16(o, le); return v === 0 ? null : v; }
      case 5: { const v = dv.getInt32(o, le); return v === 0x7FFFFFFF ? null : v; }
      case 6: { const v = dv.getUint32(o, le); return v === 0xFFFFFFFF ? null : v; }
      case 12: { const v = dv.getUint32(o, le); return v === 0 ? null : v; }
      case 8: { const v = dv.getFloat32(o, le); return isFinite(v) ? v : null; }
      case 9: { const v = dv.getFloat64(o, le); return isFinite(v) ? v : null; }
      default: return null;
    }
  };
  const field = (o, bt, size, le) => {
    const ts = SIZES[bt]; if (!ts || size < ts) return null;
    const cnt = Math.floor(size / ts);
    if (cnt === 1) return one(o, bt, le);
    const arr = []; for (let i = 0; i < cnt; i++) { const v = one(o + i * ts, bt, le); if (v != null) arr.push(v); }
    return arr;
  };
  const defs = {}, records = [], sessions = [], rrRaw = [];
  let pos = hsize, lastTs = 0;
  try {
    while (pos < end) {
      const h = dv.getUint8(pos++);
      let local, isDef = false, dev = false, comp = false, cOff = 0;
      if (h & 0x80) { local = (h >> 5) & 3; comp = true; cOff = h & 0x1F; }
      else { local = h & 0x0F; isDef = !!(h & 0x40); dev = !!(h & 0x20); }
      if (isDef) {
        pos++; const le = dv.getUint8(pos++) === 0;
        const gnum = dv.getUint16(pos, le); pos += 2;
        const nf = dv.getUint8(pos++), fields = [];
        for (let i = 0; i < nf; i++) { fields.push({ n: dv.getUint8(pos), s: dv.getUint8(pos + 1), b: dv.getUint8(pos + 2) & 0x1F }); pos += 3; }
        let devSize = 0;
        if (dev) { const nd = dv.getUint8(pos++); for (let i = 0; i < nd; i++) { devSize += dv.getUint8(pos + 1); pos += 3; } }
        defs[local] = { le, gnum, fields, devSize };
      } else {
        const d = defs[local]; if (!d) throw new Error('FIT corrupto');
        const m = {}; let o = pos;
        for (const f of d.fields) { m[f.n] = field(o, f.b, f.s, d.le); o += f.s; }
        pos = o + d.devSize;
        if (m[253] != null) lastTs = m[253];
        else if (comp) { let t = (lastTs & ~0x1F) + cOff; if (t < lastTs) t += 32; m[253] = t; lastTs = t; }
        if (d.gnum === 20) records.push(m);
        else if (d.gnum === 18) sessions.push(m);
        else if (d.gnum === 78) { // intervalos R-R (array en segundos x1000)
          if (Array.isArray(m[0])) { for (const v of m[0]) rrRaw.push(v / 1000); } else if (isNum(m[0])) rrRaw.push(m[0] / 1000);
        }
      }
    }
  } catch (err) {
    if (!(err instanceof RangeError) || (!sessions.length && !records.length)) throw err;
  }
  if (!records.length) throw new Error('El FIT no contiene registros de la actividad (solo resumen)');
  const SPORT = { 1: 'run', 2: 'bike', 5: 'swim' };
  const s0 = sessions[0] || {};
  const sport = SPORT[s0[5]] || null;
  const points = records.filter(r => r[253] != null).map(r => ({
    t: r[253] + FIT_EPOCH, hr: r[3], cad: r[4], dist: r[5] != null ? r[5] / 100 : null,
    sp: r[73] != null ? r[73] / 1000 : (r[6] != null ? r[6] / 1000 : null), pw: r[7],
    alt: r[78] != null ? r[78] / 5 - 500 : (r[2] != null ? r[2] / 5 - 500 : null),
    lat: r[0] != null ? r[0] * 180 / 2147483648 : null, lon: r[1] != null ? r[1] * 180 / 2147483648 : null
  }));
  return { sport, points, rr: rrRaw, name: null };
}

/* ---------- lector GPX / TCX ---------- */
function guessSport(t) {
  t = (t || '').toLowerCase();
  if (/run|carrera|correr|trail|running/.test(t)) return 'run';
  if (/bik|cycl|ride|ciclis|virtualride/.test(t)) return 'bike';
  if (/swim|nata/.test(t)) return 'swim';
  return null;
}
function parseXml(text, fname) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML inválido');
  const all = doc.getElementsByTagName('*');
  const isTcx = !!doc.getElementsByTagName('Trackpoint').length;
  const tps = isTcx ? [...doc.getElementsByTagName('Trackpoint')] : [...doc.getElementsByTagName('trkpt')];
  if (!tps.length) throw new Error('No se encontraron puntos de actividad');
  const points = [];
  for (const tp of tps) {
    const p = { t: null, hr: null, cad: null, dist: null, sp: null, pw: null, alt: null, lat: null, lon: null };
    if (!isTcx) { p.lat = +tp.getAttribute('lat'); p.lon = +tp.getAttribute('lon'); }
    for (const e of tp.getElementsByTagName('*')) {
      const ln = e.localName.toLowerCase(), v = e.textContent.trim();
      if (ln === 'time') p.t = Date.parse(v) / 1000;
      else if (ln === 'ele' || ln === 'altitudemeters') p.alt = +v;
      else if (ln === 'distancemeters') p.dist = +v;
      else if (ln === 'latitudedegrees') p.lat = +v;
      else if (ln === 'longitudedegrees') p.lon = +v;
      else if (ln === 'hr' || ln === 'heartrate' || (ln === 'value' && e.parentNode && e.parentNode.localName.toLowerCase() === 'heartratebpm')) p.hr = +v;
      else if (ln === 'cad' || ln === 'cadence' || ln === 'runcadence') p.cad = +v;
      else if (ln === 'watts' || ln === 'power' || ln === 'powerinwatts') p.pw = +v;
      else if (ln === 'speed') p.sp = +v;
    }
    if (p.t != null && isFinite(p.t)) points.push(p);
  }
  if (!points.length) throw new Error('Los puntos no tienen hora');
  let sport = null;
  const act = doc.getElementsByTagName('Activity')[0];
  if (act) sport = guessSport(act.getAttribute('Sport'));
  if (!sport) { for (const e of all) { const ln = e.localName.toLowerCase(); if (ln === 'type' || ln === 'name') { sport = guessSport(e.textContent); if (sport) break; } } }
  if (!sport) sport = guessSport(fname);
  return { sport, points, rr: [], name: null };
}

/* ---------- normalización a 1 Hz ---------- */
function resample(points) {
  const pts = points.filter(p => isNum(p.t)).sort((a, b) => a.t - b.t);
  if (pts.length < 10) throw new Error('Muy pocos datos en el archivo');
  // distancia a partir de GPS si falta
  const hasDist = pts.filter(p => isNum(p.dist)).length > pts.length * 0.3;
  if (!hasDist) {
    let acc = 0, prev = null;
    for (const p of pts) {
      if (isNum(p.lat) && isNum(p.lon) && !(p.lat === 0 && p.lon === 0)) {
        if (prev) { const d = haversine(prev.lat, prev.lon, p.lat, p.lon); if (d < 100) acc += d; }
        prev = p; p.dist = acc;
      }
    }
  }
  const t0 = pts[0].t, n = Math.floor(pts[pts.length - 1].t - t0) + 1;
  if (n > 3 * 86400) throw new Error('Actividad demasiado larga');
  const F = ['hr', 'pw', 'sp', 'alt', 'cad', 'dist'], out = {};
  for (const f of F) {
    const arr = new Float32Array(n).fill(NaN);
    let lastI = -1;
    for (const p of pts) {
      const v = p[f]; if (!isNum(v)) continue;
      const i = Math.round(p.t - t0); if (i < 0 || i >= n) continue;
      arr[i] = v;
      if (lastI >= 0 && i - lastI > 1 && i - lastI <= GAP) { // interpolar huecos cortos
        const a = arr[lastI], b = v;
        for (let k = lastI + 1; k < i; k++) arr[k] = a + (b - a) * (k - lastI) / (i - lastI);
      }
      lastI = i;
    }
    out[f] = arr;
  }
  // limpieza de valores imposibles
  for (let i = 0; i < n; i++) {
    if (out.hr[i] < 30 || out.hr[i] > 230) out.hr[i] = NaN;
    if (out.pw[i] < 0 || out.pw[i] > 2500) out.pw[i] = NaN;
  }
  // velocidad desde distancia si falta
  const spCov = out.sp.reduce((a, v) => a + (isNum(v) ? 1 : 0), 0) / n;
  if (spCov < 0.3) {
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 3), b = Math.min(n - 1, i + 3);
      if (isNum(out.dist[a]) && isNum(out.dist[b]) && b > a) out.sp[i] = Math.max(0, (out.dist[b] - out.dist[a]) / (b - a));
    }
  }
  return { start: t0 * 1000, n, s: out };
}

/* ---------- RR / HRV ---------- */
function cleanRR(rr) {
  const x = rr.filter(v => v > 0.3 && v < 2.0);
  const keep = [];
  for (let i = 0; i < x.length; i++) {
    const w = x.slice(Math.max(0, i - 3), i + 4), m = median(w);
    if (Math.abs(x[i] - m) <= 0.25 * m) keep.push(x[i]);
  }
  return { rr: keep, artifactPct: rr.length ? 100 * (1 - keep.length / rr.length) : 0 };
}
function hrvTime(rr) { // rr en segundos
  if (rr.length < 30) return null;
  const ms = rr.map(v => v * 1000);
  let s = 0, c = 0, nn50 = 0;
  for (let i = 1; i < ms.length; i++) { const d = ms[i] - ms[i - 1]; s += d * d; c++; if (Math.abs(d) > 50) nn50++; }
  return { rmssd: Math.sqrt(s / c), sdnn: sd(ms), pnn50: 100 * nn50 / c, meanHr: 60000 / mean(ms), n: ms.length };
}
function dfaAlpha1(rrSec) {
  const x = rrSec.map(v => v * 1000), N = x.length;
  if (N < 60) return NaN;
  const mu = mean(x), y = new Float64Array(N); let acc = 0;
  for (let i = 0; i < N; i++) { acc += x[i] - mu; y[i] = acc; }
  const lx = [], ly = [];
  for (let n = 4; n <= 16; n++) {
    const nb = Math.floor(N / n); if (nb < 2) continue;
    let ss = 0, cnt = 0;
    for (let b = 0; b < nb; b++) {
      const o = b * n; let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let k = 0; k < n; k++) { sx += k; sy += y[o + k]; sxx += k * k; sxy += k * y[o + k]; }
      const den = n * sxx - sx * sx, sl = (n * sxy - sx * sy) / den, ic = (sy - sl * sx) / n;
      for (let k = 0; k < n; k++) { const r = y[o + k] - (ic + sl * k); ss += r * r; cnt++; }
    }
    lx.push(Math.log(n)); ly.push(Math.log(Math.sqrt(ss / cnt)));
  }
  const mx = mean(lx), my = mean(ly); let num = 0, den = 0;
  for (let i = 0; i < lx.length; i++) { num += (lx[i] - mx) * (ly[i] - my); den += (lx[i] - mx) ** 2; }
  return num / den;
}
function analyzeHrv(rrAll) {
  if (!rrAll || rrAll.length < 120) return null;
  const { rr, artifactPct } = cleanRR(rrAll);
  if (rr.length < 100) return null;
  const third = Math.floor(rr.length / 3);
  const whole = hrvTime(rr), first = hrvTime(rr.slice(0, third)), last = hrvTime(rr.slice(-third));
  // DFA a1 en ventanas de ~2 min (paso 30 s)
  const cum = []; let t = 0; for (const v of rr) { t += v; cum.push(t); }
  const dfa = [];
  for (let ws = 0; ws + 120 <= t; ws += 30) {
    let a = cum.findIndex(c => c >= ws), b = cum.findIndex(c => c >= ws + 120);
    if (b < 0) b = cum.length;
    if (a < 0 || b - a < 90) continue;
    const al = dfaAlpha1(rr.slice(a, b));
    if (isNum(al)) dfa.push({ t: ws + 60, a: al });
  }
  const alphas = dfa.map(d => d.a);
  return {
    artifactPct, n: rr.length, whole, first, last, dfa,
    alphaMedian: alphas.length ? median(alphas) : NaN,
    pctBelow075: alphas.length ? 100 * alphas.filter(a => a < 0.75).length / alphas.length : NaN,
    pctBelow05: alphas.length ? 100 * alphas.filter(a => a < 0.5).length / alphas.length : NaN
  };
}

/* ---------- detección de intervalos ---------- */
// Busca esfuerzos repetidos (potencia o velocidad alta vs. recuperación) separando la señal en dos niveles (Otsu).
function detectIntervals(out, hr, n, sport, hasPw) {
  const w = sport === 'run' ? 20 : 30, half = w >> 1, sm0 = movAvg(out, w, 0.5), sm = new Float32Array(n);
  for (let i = 0; i < n; i++) sm[i] = sm0[Math.min(n - 1, i + half)]; // ventana centrada
  const v = []; for (let i = 0; i < n; i++) if (isNum(sm[i])) v.push(sm[i]);
  if (v.length < 1200) return null;
  let lo = Infinity, hi = -Infinity; for (const x of v) { if (x < lo) lo = x; if (x > hi) hi = x; }
  if (!(hi > lo)) return null;
  const B = 64, hist = new Float64Array(B), tot = v.length;
  for (const x of v) hist[Math.min(B - 1, Math.floor((x - lo) / (hi - lo) * B))]++;
  let sumAll = 0; for (let b = 0; b < B; b++) sumAll += b * hist[b];
  let wB = 0, sumB = 0, best = -1, bt = 0;
  for (let b = 0; b < B - 1; b++) {
    wB += hist[b]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sumB += b * hist[b];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF, bv = wB * wF * (mB - mF) ** 2; if (bv > best) { best = bv; bt = b; }
  }
  const thr = lo + (bt + 1) / B * (hi - lo);
  let sH = 0, nH = 0, sL = 0, nL = 0; for (const x of v) { if (x >= thr) { sH += x; nH++; } else { sL += x; nL++; } }
  if (!nH || !nL) return null;
  const mH = sH / nH, mL = sL / nL, m = (sH + sL) / tot, frac = nH / tot;
  if ((mH - mL) / m < (hasPw ? 0.3 : 0.4) || frac < 0.08 || frac > 0.75) return null;
  const runs = []; let st = -1;
  for (let i = 0; i <= n; i++) {
    const up = i < n && isNum(sm[i]) && sm[i] >= thr;
    if (up && st < 0) st = i; else if (!up && st >= 0) { runs.push([st, i - 1]); st = -1; }
  }
  const merged = []; for (const r of runs) { const l = merged[merged.length - 1]; if (l && r[0] - l[1] < 20) l[1] = r[1]; else merged.push(r.slice()); }
  const minRep = sport === 'run' ? 40 : 60, rr = merged.filter(r => r[1] - r[0] + 1 >= minRep);
  if (rr.length < 3) return null;
  const reps = rr.map(([a, b], k) => {
    const ids = []; for (let i = a; i <= b; i++) if (isNum(out[i])) ids.push(i);
    const mid = a + ((b - a) >> 1), hs = []; for (let i = mid; i <= b; i++) if (isNum(hr[i])) hs.push(hr[i]);
    const he = []; for (let i = Math.max(a, b - 9); i <= b; i++) if (isNum(hr[i])) he.push(hr[i]);
    const o = { start: a, dur: b - a + 1, out: mean(ids.map(i => out[i])), hr: mean(hs), hrEnd: mean(he) };
    const nx = k + 1 < rr.length ? rr[k + 1][0] : null;
    if (nx != null && nx - b - 1 >= 15) {
      const g = []; let mn = Infinity; for (let i = b + 1; i < nx; i++) { if (isNum(out[i])) g.push(out[i]); if (isNum(hr[i]) && hr[i] < mn) mn = hr[i]; }
      o.recDur = nx - b - 1; o.recOut = mean(g); o.recDrop = isFinite(mn) && isNum(o.hrEnd) ? o.hrEnd - mn : NaN;
    }
    return o;
  });
  const k = Math.max(1, Math.min(2, reps.length >> 1)), part = (a) => ({ out: mean(a.map(r => r.out)), hr: mean(a.map(r => r.hr)) });
  const f = part(reps.slice(0, k)), l = part(reps.slice(-k));
  const h2 = reps.length >> 1, p1 = part(reps.slice(0, h2)), p2 = part(reps.slice(h2));
  const efOf = p => p.out / p.hr, workSec = reps.reduce((x, r) => x + r.dur, 0);
  return {
    reps, thr, hiLevel: mH, loLevel: mL, workSec, workPct: workSec / n * 100,
    fade: (l.out - f.out) / f.out * 100, hrDrift: l.hr - f.hr, k,
    efDrift: isNum(efOf(p1)) && isNum(efOf(p2)) ? (efOf(p1) - efOf(p2)) / efOf(p1) * 100 : NaN,
    cvOut: sd(reps.map(r => r.out)) / mean(reps.map(r => r.out)),
    recDrop: mean(reps.map(r => r.recDrop)), medDur: median(reps.map(r => r.dur)), by: hasPw ? 'pw' : 'sp'
  };
}
function fmtOut(v, sport, by) {
  if (!isNum(v)) return '—';
  if (by === 'pw') return f0(v) + ' W';
  if (sport === 'run' && v > 0) { const sec = Math.round(1000 / v); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') + ' /km'; }
  return f1(v * 3.6) + ' km/h';
}
function fmtMin(sec) { const m = Math.floor(sec / 60), s = Math.round(sec % 60); return s === 60 ? (m + 1) + ':00' : m + ':' + String(s).padStart(2, '0'); }

/* ---------- análisis de una actividad ---------- */
function normalizedPower(pw) {
  const r = movAvg(pw, 30, 0.5); let s = 0, c = 0;
  for (const v of r) if (isNum(v)) { s += v ** 4; c++; }
  return c ? Math.pow(s / c, 0.25) : NaN;
}
function analyze(rs, sport, rrAll, profileIn) {
  const P = normProfile(profileIn), { n, s } = rs;
  const A = { sport, profile: { hrMax: P.hrMax, hrRest: P.hrRest, lthr: P.lthr, ftp: P.ftp, hrMaxAuto: P.hrMaxAuto, hrRestAuto: P.hrRestAuto, lthrAuto: P.lthrAuto } };
  const cnt = a => { let c = 0; for (let i = 0; i < a.length; i++) if (isNum(a[i])) c++; return c; };
  const hrN = cnt(s.hr), pwN = cnt(s.pw), spN = cnt(s.sp);
  A.hasHr = hrN > n * 0.5; A.hasPw = pwN > n * 0.5 && mean(s.pw) > 5; A.hasSp = spN > n * 0.3 && mean(s.sp) > 0.3;
  const active = new Uint8Array(n); let activeSec = 0;
  for (let i = 0; i < n; i++) { if (isNum(s.hr[i]) || isNum(s.sp[i]) || isNum(s.pw[i])) { active[i] = 1; activeSec++; } }
  A.dur = activeSec; A.elapsed = n;
  const mov = new Uint8Array(n); let movSec = 0;
  for (let i = 0; i < n; i++) { if (active[i] && (!A.hasSp || (isNum(s.sp[i]) && s.sp[i] > 0.5))) { mov[i] = 1; movSec++; } }
  A.movSec = movSec;
  // distancia
  let dist = NaN;
  if (cnt(s.dist) > n * 0.3) { let first = NaN, last = NaN; for (let i = 0; i < n; i++) if (isNum(s.dist[i])) { if (!isNum(first)) first = s.dist[i]; last = s.dist[i]; } dist = last - first; }
  else if (A.hasSp) { dist = 0; for (let i = 0; i < n; i++) if (isNum(s.sp[i])) dist += s.sp[i]; }
  A.dist = isNum(dist) ? dist : 0;
  A.avgSpeed = A.hasSp && movSec ? A.dist / movSec : NaN;
  // FC
  if (A.hasHr) {
    A.avgHr = mean(s.hr); const h5 = movAvg(s.hr, 5, 0.6); let mx = 0; for (const v of h5) if (isNum(v) && v > mx) mx = v; A.maxHr = mx;
  }
  // potencia
  if (A.hasPw) { A.avgPw = mean(s.pw); A.np = normalizedPower(s.pw); A.vi = A.np / A.avgPw; }
  // desnivel
  if (cnt(s.alt) > n * 0.3) {
    const al = movAvg(s.alt, 9, 0.5); let up = 0, prev = NaN;
    for (let i = 0; i < n; i += 5) { const v = al[i]; if (isNum(v)) { if (isNum(prev) && v - prev > 0) up += v - prev; prev = v; } }
    A.ascent = up;
  }
  // zonas de FC, TRIMP, carga
  if (A.hasHr) {
    const hS = movAvg(s.hr, 10, 0.5), z = [0, 0, 0, 0, 0];
    const b = P.sex === 'f' ? 1.67 : 1.92, rng = P.hrMax - P.hrRest;
    const trimpOf = hr => { const x = Math.min(1, Math.max(0, (hr - P.hrRest) / rng)); return x * 0.64 * Math.exp(b * x); };
    let trimp = 0;
    for (let i = 0; i < n; i++) {
      const v = hS[i]; if (!isNum(v)) continue;
      const r = v / P.lthr; let k = 4; for (let j = 0; j < 4; j++) if (r < ZLIM[j]) { k = j; break; }
      z[k]++; trimp += trimpOf(v) / 60;
    }
    A.zones = z; A.trimp = trimp;
    const trimpHour = trimpOf(P.lthr) * 60; // TRIMP acumulado en 1 h a FC umbral
    A.hrTss = trimp / trimpHour * 100;
  }
  if (sport === 'bike' && A.hasPw && P.ftp > 0) {
    const pz = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) { const v = s.pw[i]; if (!isNum(v)) continue; const r = v / P.ftp; let k = 6; for (let j = 0; j < 6; j++) if (r < PZLIM[j]) { k = j; break; } pz[k]++; }
    A.pzones = pz;
  }
  if (sport === 'bike' && A.hasPw && P.ftp > 0 && isNum(A.np)) {
    A.IF = A.np / P.ftp; A.load = (A.dur / 3600) * A.IF * A.IF * 100; A.loadMethod = 'potencia (TSS)';
  } else if (isNum(A.hrTss)) {
    A.load = A.hrTss; A.IF = Math.sqrt(Math.max(0, A.load) / ((A.dur / 3600) * 100)); A.loadMethod = 'frecuencia cardíaca (hrTSS)';
  }
  // eficiencia y acople aeróbico
  const outArr = A.hasPw ? s.pw : (A.hasSp ? s.sp : null);
  A.outType = A.hasPw ? 'pw' : (A.hasSp ? 'sp' : null);
  if (outArr && A.hasHr) {
    A.ef = A.hasPw ? A.np / A.avgHr : (A.avgSpeed * 60) / A.avgHr; // W/lpm ó m/min por lpm
    const idx = [];
    for (let i = 0; i < n; i++) if (isNum(s.hr[i]) && isNum(outArr[i]) && outArr[i] > 0 && (A.hasPw || mov[i])) idx.push(i);
    const warm = Math.min(600, Math.round(idx.length * 0.15));
    const seg = idx.slice(warm), D = { valid: false };
    if (seg.length < 1200) { D.reason = 'Menos de 20 min útiles tras el calentamiento: el acople no es fiable en sesiones cortas.'; }
    else {
      const h = seg.length >> 1, p1 = seg.slice(0, h), p2 = seg.slice(h);
      const ef = ids => {
        const hr = mean(ids.map(i => s.hr[i]));
        const o = A.hasPw ? normalizedPower(Float32Array.from(ids.map(i => outArr[i]))) : mean(ids.map(i => outArr[i]));
        return { hr, o, ef: (A.hasPw ? o : o * 60) / hr };
      };
      const e1 = ef(p1), e2 = ef(p2);
      D.valid = true; D.e1 = e1; D.e2 = e2; D.pct = (e1.ef - e2.ef) / e1.ef * 100;
      const o60 = movAvg(Float32Array.from(seg.map(i => outArr[i])), 60, 0.5);
      D.cv = sd(Array.from(o60)) / mean(Array.from(o60));
      D.steady = D.cv <= 0.25;
      D.hilly = !A.hasPw && isNum(A.ascent) && A.dist > 0 && (A.ascent / (A.dist / 1000)) > 20;
      D.segMin = seg.length / 60;
    }
    A.decoupling = D;
  }
  // ritmo (mitades) en actividad con velocidad
  if (A.hasSp) {
    const idx = []; for (let i = 0; i < n; i++) if (mov[i]) idx.push(i);
    if (idx.length > 900) {
      const h = idx.length >> 1, v1 = mean(idx.slice(0, h).map(i => s.sp[i])), v2 = mean(idx.slice(h).map(i => s.sp[i]));
      A.split = { v1, v2, pct: (v2 - v1) / v1 * 100 };
    }
  }
  // estructura por intervalos (esfuerzos repetidos): condiciona cómo se leen mitades y acople
  if (sport !== 'swim' && (A.hasPw || A.hasSp)) {
    A.struct = detectIntervals(A.hasPw ? s.pw : s.sp, s.hr, n, sport, A.hasPw);
    if (A.struct && A.decoupling && A.decoupling.valid) A.decoupling.steady = false;
  }
  // recuperación cardíaca intra-sesión (mayor caída en 60 s tras esfuerzo)
  if (A.hasHr && A.maxHr > 0) {
    const h5 = movAvg(s.hr, 5, 0.6), p5 = A.hasPw ? movAvg(s.pw, 5, 0.4) : (A.hasSp ? movAvg(s.sp, 5, 0.4) : null);
    const hb = movAvg(s.hr, 120, 0.7); // media de los 2 min previos
    let best = null;
    for (let t = 120; t + 60 < n; t += 1) {
      if (!isNum(hb[t]) || hb[t] < 0.80 * A.maxHr || !isNum(h5[t]) || !isNum(h5[t + 60])) continue;
      if (p5) { const o1 = p5[t], o2 = p5[t + 60]; if (!isNum(o1) || !isNum(o2) || o2 > 0.5 * o1) continue; }
      const drop = h5[t] - h5[t + 60];
      if (!best || drop > best.drop) best = { drop, t, from: h5[t] };
    }
    if (best) A.hrr = best;
  }
  // HRV
  A.hrv = analyzeHrv(rrAll);
  return A;
}

/* ---------- series para gráficos (reducción por promedio) ---------- */
function downsample(arr, pts) {
  const n = arr.length, out = [], k = Math.max(1, Math.ceil(n / pts));
  for (let i = 0; i < n; i += k) { let s = 0, c = 0; for (let j = i; j < Math.min(n, i + k); j++) if (isNum(arr[j])) { s += arr[j]; c++; } out.push(c ? s / c : NaN); }
  return { v: out, step: k };
}

/* ---------- carga diaria, CTL/ATL/TSB, semana ---------- */
function dailyLoads(acts) {
  const m = {};
  for (const a of acts) if (a.A && isNum(a.A.load)) m[a.day] = (m[a.day] || 0) + a.A.load;
  return m;
}
function pmc(acts, endKey) {
  const dl = dailyLoads(acts), keys = Object.keys(dl).sort();
  if (!keys.length) return null;
  const first = keys[0], last = endKey && endKey > keys[keys.length - 1] ? endKey : keys[keys.length - 1];
  let ctl = 0, atl = 0, out = [];
  for (let k = first; k <= last; k = addDays(k, 1)) {
    const L = dl[k] || 0, tsb = ctl - atl; // TSB al empezar el día
    ctl += (L - ctl) / 42; atl += (L - atl) / 7;
    out.push({ day: k, load: L, ctl, atl, tsb });
  }
  return { series: out, first, last, spanDays: daysBetween(first, last) + 1 };
}
function weekSummary(acts, wk) {
  const days = []; for (let i = 0; i < 7; i++) days.push(addDays(wk, i));
  const inWeek = acts.filter(a => a.day >= wk && a.day <= days[6]);
  const W = { wk, days, acts: inWeek, n: inWeek.length };
  const lastDay = acts.reduce((m, a) => (a.day > m ? a.day : m), '0000-00-00');
  const endKey = lastDay < days[6] ? (lastDay < wk ? wk : lastDay) : days[6]; // fin del periodo con datos
  W.endKey = endKey; W.elapsed = daysBetween(wk, endKey) + 1; W.partial = W.elapsed < 7;
  W.dur = inWeek.reduce((x, a) => x + a.A.dur, 0); W.dist = inWeek.reduce((x, a) => x + a.A.dist, 0);
  const dl = dailyLoads(acts), daily = days.map(d => dl[d] || 0), dE = daily.slice(0, W.elapsed);
  W.daily = daily; W.load = daily.reduce((x, y) => x + y, 0);
  W.restDays = dE.filter(v => v === 0).length;
  const m = mean(dE), s = sd(dE);
  W.monotony = W.elapsed >= 4 ? (s > 0 ? m / s : (m > 0 ? Infinity : NaN)) : NaN; W.strain = isFinite(W.monotony) ? W.load * W.monotony : NaN;
  W.hardDays = dE.filter(v => v >= 100).length;
  const z = [0, 0, 0, 0, 0]; let zt = 0;
  for (const a of inWeek) if (a.A.zones) a.A.zones.forEach((v, i) => { z[i] += v; zt += v; });
  W.zones = z; W.zoneTotal = zt;
  W.low = zt ? (z[0] + z[1]) / zt : NaN; W.mid = zt ? z[2] / zt : NaN; W.high = zt ? (z[3] + z[4]) / zt : NaN;
  const prevKey = addDays(wk, -7);
  W.prevLoad = 0; for (let i = 0; i < W.elapsed; i++) W.prevLoad += dl[addDays(prevKey, i)] || 0; // mismos días de la semana anterior
  W.loadChange = W.prevLoad > 0 ? (W.load - W.prevLoad) / W.prevLoad * 100 : NaN;
  W.prevDur = acts.filter(a => a.day >= prevKey && a.day < wk).reduce((x, a) => x + a.A.dur, 0);
  const P = pmc(acts, endKey);
  W.pmc = P;
  if (P) {
    let ctl = 0, atl = 0; // valores al terminar el último día analizado
    for (const r of P.series) { if (r.day > endKey) break; ctl += (r.load - ctl) / 42; atl += (r.load - atl) / 7; }
    W.ctl = ctl; W.atl = atl; W.tsb = ctl - atl; W.historyDays = daysBetween(P.first, endKey) + 1;
    // ACWR con ventana móvil: últimos 7 días vs media de 4 bloques de 7 días que terminan en endKey
    const block = i => { let t = 0; for (let k = 0; k < 7; k++) t += dl[addDays(endKey, -7 * i - k)] || 0; return t; };
    W.acuteLoad = block(0); W.chronicWeekly = mean([0, 1, 2, 3].map(block));
    W.acwr = W.chronicWeekly > 0 ? W.acuteLoad / W.chronicWeekly : NaN;
    W.acwrReliable = W.historyDays >= 28;
    if (W.historyDays < 14) W.acwr = NaN; // con tan poco histórico no tiene sentido
  }
  W.bySport = {};
  for (const sp of Object.keys(SPORTS)) {
    const cur = inWeek.filter(a => a.sport === sp);
    if (!cur.length) continue;
    const prevAs = acts.filter(a => a.sport === sp && a.day < wk && a.day >= addDays(wk, -21));
    const efOf = arr => mean(arr.filter(a => isNum(a.A.ef)).map(a => a.A.ef));
    W.bySport[sp] = {
      n: cur.length, dur: cur.reduce((x, a) => x + a.A.dur, 0), dist: cur.reduce((x, a) => x + a.A.dist, 0),
      load: cur.reduce((x, a) => x + (a.A.load || 0), 0), ef: efOf(cur), efPrev: efOf(prevAs),
      dec: mean(cur.filter(a => a.A.decoupling && a.A.decoupling.valid && a.A.decoupling.steady).map(a => a.A.decoupling.pct))
    };
  }
  const hrvActs = inWeek.filter(a => a.A.hrv && a.A.hrv.whole);
  if (hrvActs.length) W.hrvN = hrvActs.length;
  return W;
}
function weekSumLoad(dl, wk) { let s = 0; for (let i = 0; i < 7; i++) s += dl[addDays(wk, i)] || 0; return s; }

/* ---------- conclusiones ---------- */
const nz = r => (r === 0 ? 0 : r);
const f0 = v => nz(Math.round(v)).toLocaleString('es');
const f1 = v => nz(Math.round(v * 10) / 10).toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = v => nz(Math.round(v * 100) / 100).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function loadBand(l) {
  if (l < 150) return ['baja', 'Suele dejar poca fatiga residual; recuperas con normalidad al día siguiente.'];
  if (l < 300) return ['media', 'Puede dejar algo de fatiga al día siguiente; una sesión suave o descanso la absorbe.'];
  if (l < 450) return ['alta', 'Suele dejar fatiga residual 1-2 días; conviene planificar sesiones fáciles a continuación.'];
  return ['muy alta', 'Es una carga muy elevada: es habitual necesitar varios días para recuperar del todo.'];
}
function activityInsights(act, history) {
  const A = act.A, out = [], add = (level, title, text) => out.push({ level, title, text });
  const sportName = SPORTS[act.sport] || 'Actividad';
  // Intensidad
  if (isNum(A.load)) {
    const [band, note] = loadBand(A.load);
    let ifTxt;
    const I = A.IF;
    if (I < 0.75) ifTxt = 'sesión de base/recuperación (intensidad relativa ' + f2(I) + ')'; else if (I < 0.85) ifTxt = 'ritmo de resistencia sostenida/tempo (intensidad relativa ' + f2(I) + ')';
    else if (I < 0.95) ifTxt = 'trabajo cerca del umbral (intensidad relativa ' + f2(I) + ')'; else ifTxt = 'sesión muy intensa (intensidad relativa ' + f2(I) + ')';
    add(A.load >= 450 ? 'warn' : 'info', 'Intensidad y carga', 'Carga ' + f0(A.load) + ' (' + band + ', calculada por ' + A.loadMethod + '): ' + ifTxt + '. ' + note);
  } else add('info', 'Intensidad y carga', 'No hay frecuencia cardíaca ni potencia suficientes para estimar la carga de esta sesión.');
  if (A.zones) {
    const tot = A.zones.reduce((x, y) => x + y, 0), pct = A.zones.map(v => tot ? v / tot * 100 : 0);
    const dom = pct.indexOf(Math.max(...pct));
    const hi = pct[3] + pct[4];
    let t = 'Mayor parte del tiempo en ' + ZN[dom] + ' (' + f0(pct[dom]) + ' %). ';
    if (hi >= 20) t += 'Pasó ' + f0(hi) + ' % en Z4-Z5 (' + f0((A.zones[3] + A.zones[4]) / 60) + ' min): estímulo de calidad que pide recuperación.'; else if (pct[0] + pct[1] >= 80) t += 'Más del 80 % en Z1-Z2: sesión aeróbica de bajo estrés.'; else t += 'Mezcla de zonas con un bloque relevante de Z3 (zona "gris").';
    if (A.pzones) { const pt = A.pzones.reduce((x, y) => x + y, 0) || 1, pp = A.pzones.map(v => v / pt * 100), pd = pp.indexOf(Math.max(...pp)); t += ' Por potencia (FTP ' + A.profile.ftp + ' W): ' + f0(pp[pd]) + ' % en ' + PZN[pd] + '.'; }
    add(hi >= 35 ? 'warn' : 'ok', 'Distribución de zonas', t + ' Zonas de FC (Calculadora de Test) con la FC umbral de ' + A.profile.lthr + ' ppm' + (A.profile.lthrAuto ? ' (estimada como 90 % de la FC máx; introduce la real del deportista para más precisión).' : '.'));
  }
  // Acople
  const D = A.decoupling;
  if (D) {
    if (!D.valid) add('info', 'Acople cardíaco', D.reason);
    else {
      const p = D.pct, base = (A.outType === 'pw' ? 'potencia:FC' : 'velocidad:FC');
      let lvl, t;
      if (p < 3) { lvl = 'ok'; t = 'Desacople de ' + f1(p) + ' % (' + base + '): muy buen acople; la FC se mantuvo estable para la misma salida de trabajo.'; }
      else if (p < 5) { lvl = 'ok'; t = 'Desacople de ' + f1(p) + ' % (' + base + '): dentro del rango aeróbico sólido (<5 %).'; }
      else if (p < 10) { lvl = 'warn'; t = 'Desacople de ' + f1(p) + ' % (' + base + '): deriva cardíaca moderada. Puede deberse a calor, deshidratación, fatiga acumulada o a que el esfuerzo superó la base aeróbica.'; }
      else { lvl = 'bad'; t = 'Desacople de ' + f1(p) + ' % (' + base + '): deriva alta. Indica fatiga marcada, calor/deshidratación o intensidad por encima de la capacidad aeróbica actual.'; }
      if (!D.steady) { lvl = 'info'; t += ' Atención: la sesión fue muy variable (intervalos o cambios de ritmo), por lo que este valor es poco fiable; el acople se interpreta bien en esfuerzos continuos de 40+ min.'; }
      if (D.hilly) t += ' El terreno fue con desnivel: la velocidad subestima el esfuerzo en subidas y puede distorsionar el resultado.';
      add(lvl, 'Acople cardíaco', t + ' (FC ' + f0(D.e1.hr) + ' → ' + f0(D.e2.hr) + ' ppm entre mitades.)');
    }
  } else if (A.hasHr && !A.outType) add('info', 'Acople cardíaco', 'Falta potencia o velocidad en el archivo, así que no se puede comparar la FC con el trabajo realizado.');
  // Eficiencia vs historial
  if (isNum(A.ef) && history) {
    const prev = history.filter(h => h.sport === act.sport && h.id !== act.id && h.start < act.start && isNum(h.A.ef)).slice(-5);
    if (prev.length >= 2) {
      const pm = mean(prev.map(h => h.A.ef)), d = (A.ef - pm) / pm * 100;
      add(d < -5 ? 'warn' : (d > 3 ? 'ok' : 'info'), 'Eficiencia aeróbica',
        'Factor de eficiencia ' + f1(A.ef) + ' (' + (d >= 0 ? '+' : '') + f1(d) + ' % frente a las últimas ' + prev.length + ' sesiones de ' + sportName.toLowerCase() + '). ' +
        (d < -5 ? 'Una caída sostenida puede reflejar fatiga acumulada, calor o falta de recuperación; compara con las próximas sesiones.' : d > 3 ? 'Mejor rendimiento por latido que su media reciente.' : 'Sin cambios relevantes.'));
    }
  }
  // Recuperación intra-sesión
  if (A.hrr) {
    const d = A.hrr.drop;
    const lvl = d >= 25 ? 'ok' : d >= 15 ? 'info' : 'warn';
    add(lvl, 'Recuperación cardíaca', 'Tras un esfuerzo a ' + f0(A.hrr.from) + ' ppm, la FC bajó ' + f0(d) + ' ppm en 60 s. ' + (d >= 25 ? 'Recuperación rápida (buena señal parasimpática).' : d >= 15 ? 'Recuperación normal.' : 'Recuperación lenta: puede asociarse a fatiga, estrés acumulado o a un esfuerzo todavía muy exigente (también influye la postura y si se siguió moviendo).'));
  } else if (A.hasHr) add('info', 'Recuperación cardíaca', 'No se detectó un esfuerzo seguido de parada o bajada clara de ritmo, así que no se puede medir la caída de FC en 60 s.');
  // Ritmo
  if (A.struct) {
    const S = A.struct, u = x => fmtOut(x, act.sport, S.by), n = S.reps.length;
    let t = 'Se detectaron ' + n + ' esfuerzos de unos ' + fmtMin(S.medDur) + ' min (' + f0(S.workSec / 60) + ' min en total, ' + f0(S.workPct) + ' % de la sesión) a ' + u(S.hiLevel) + ' de media, frente a ' + u(S.loLevel) + ' en el resto. ';
    t += 'Por eso no se comparan las dos mitades de la sesión: la diferencia dependería de dónde cayeron los intervalos y no de un mal reparto. ';
    t += 'Entre las primeras y las últimas repeticiones la ' + (S.by === 'pw' ? 'potencia' : 'velocidad') + ' cambió ' + (S.fade >= 0 ? '+' : '') + f1(S.fade) + ' %' + (isNum(S.hrDrift) ? ' y la FC ' + (S.hrDrift >= 0 ? '+' : '') + f0(S.hrDrift) + ' ppm' : '') + ': ';
    t += S.fade < -5 ? 'hubo caída de rendimiento en las últimas repeticiones (fatiga o salida demasiado fuerte).' : (isNum(S.efDrift) && S.efDrift > 5 ? 'se mantuvo el nivel pero con más coste cardíaco (fatiga acumulada).' : 'rendimiento consistente entre repeticiones.');
    if (isNum(S.recDrop)) t += ' Entre repeticiones la FC bajó de media ' + f0(S.recDrop) + ' ppm.';
    add(S.fade < -5 ? 'warn' : 'info', 'Sesión por intervalos', t);
  } else if (A.split && act.sport !== 'swim') {
    const p = A.split.pct;
    add(Math.abs(p) > 8 ? 'warn' : 'info', 'Reparto del esfuerzo', 'Velocidad de la 2ª mitad ' + (p >= 0 ? '+' : '') + f1(p) + ' % respecto a la 1ª. ' + (p < -8 ? 'Caída marcada: salida demasiado fuerte o fatiga en la segunda parte.' : p > 8 ? 'Acelerada notable (split negativo).' : 'Reparto parejo.'));
  }
  // VI potencia
  if (isNum(A.vi) && act.sport === 'bike') add(A.vi > 1.15 ? 'info' : 'ok', 'Variabilidad de potencia', 'Índice de variabilidad ' + f2(A.vi) + ' (NP ' + f0(A.np) + ' W, media ' + f0(A.avgPw) + ' W). ' + (A.vi > 1.15 ? 'Esfuerzo muy irregular (cambios de ritmo/terreno).' : 'Esfuerzo bastante constante.'));
  // HRV
  if (A.hrv) {
    const H = A.hrv, w = H.whole;
    let t = 'RMSSD ' + f0(w.rmssd) + ' ms, SDNN ' + f0(w.sdnn) + ' ms (' + H.n + ' latidos). ';
    if (H.first && H.last) t += 'RMSSD primer tercio ' + f0(H.first.rmssd) + ' ms → último tercio ' + f0(H.last.rmssd) + ' ms. ';
    if (isNum(H.alphaMedian)) t += 'DFA α1 mediano ' + f1(H.alphaMedian) + ' (' + f0(H.pctBelow075) + ' % del tiempo por debajo de 0,75, zona aproximada de umbral aeróbico). ';
    t += 'Estos valores durante el ejercicio dependen sobre todo de la intensidad; no son comparables con la VFC en reposo.';
    if (H.artifactPct > 5) t += ' Se descartó un ' + f1(H.artifactPct) + ' % de latidos por artefactos: calidad de señal limitada.';
    add(H.artifactPct > 10 ? 'warn' : 'info', 'Variabilidad cardíaca (R-R)', t);
  } else add('info', 'Variabilidad cardíaca (R-R)', 'Este archivo no incluye intervalos R-R, por eso no se puede calcular la VFC. Suele aparecer en FIT grabados con banda pectoral compatible o en relojes que guardan datos de VFC. En GPX/TCX nunca están.');
  const pr = A.profile, est = [];
  if (A.hasHr) {
    if (pr.hrMaxAuto) est.push('FC máxima (' + pr.hrMax + ' ppm, tomada del máximo observado en sus archivos)');
    if (pr.hrRestAuto) est.push('FC en reposo (' + pr.hrRest + ' ppm por defecto)');
    if (pr.lthrAuto) est.push('FC umbral (' + pr.lthr + ' ppm, el 90 % de la FC máxima)');
  }
  if (act.sport === 'bike' && A.hasPw && !pr.ftp) est.push('FTP (sin él la carga se calcula por frecuencia cardíaca y no por potencia)');
  if (est.length) out.unshift({ level: 'warn', title: 'Datos del deportista por completar', text: 'Este análisis usa valores estimados: ' + est.join('; ') + '. Para que zonas, carga e intensidad reflejen la realidad del deportista, introdúcelos en su perfil.' });
  return out;
}
function weekInsights(W, profile) {
  const out = [], add = (level, title, text) => out.push({ level, title, text });
  if (!W.n) { add('info', 'Semana sin actividades', 'No hay actividades cargadas en esta semana.'); return out; }
  const estAct = W.acts.find(a => a.A.profile && ((a.A.hasHr && (a.A.profile.hrMaxAuto || a.A.profile.lthrAuto || a.A.profile.hrRestAuto)) || (a.sport === 'bike' && a.A.hasPw && !a.A.profile.ftp)));
  if (estAct) add('warn', 'Datos del deportista por completar', 'Parte del análisis usa valores estimados (FC máxima, reposo, umbral o FTP no indicados). Con los datos reales del deportista las zonas y la carga serán más exactas.');
  const hrs = W.dur / 3600;
  let t = (W.partial ? 'Semana en curso (' + W.elapsed + ' de 7 días). ' : '') + W.n + (W.n === 1 ? ' sesión, ' : ' sesiones, ') + f1(hrs) + ' h, ' + f1(W.dist / 1000) + ' km y carga total ' + f0(W.load) + '.';
  if (isNum(W.loadChange) && W.prevLoad > 0) t += ' Frente a ' + (W.partial ? 'los mismos días de la semana anterior' : 'la semana anterior') + ': ' + (W.loadChange >= 0 ? '+' : '') + f0(W.loadChange) + ' % de carga.';
  const jump = isNum(W.loadChange) && W.loadChange > 30 && W.prevLoad > 50;
  add(jump ? 'warn' : 'info', 'Resumen de la semana', t + (jump ? ' Un salto de más del 30 % en una semana aumenta el riesgo de sobrecarga; una subida prudente ronda el 5-10 %.' : ''));
  if (W.pmc && !isNum(W.acwr)) add('info', 'Carga aguda vs. crónica', 'Histórico insuficiente (' + W.historyDays + ' días): se necesitan al menos 14 días, e idealmente 4 semanas, para estimar el ACWR. Sube sesiones de semanas anteriores.');
  if (isNum(W.acwr)) {
    let lvl, txt;
    if (!W.acwrReliable) { lvl = 'info'; txt = 'ACWR provisional ' + f2(W.acwr) + ', pero solo hay ' + W.historyDays + ' días de histórico; hacen falta unas 4 semanas de datos para que sea fiable.'; }
    else if (W.acwr > 1.5) { lvl = 'bad'; txt = 'ACWR ' + f2(W.acwr) + ': carga aguda muy por encima de su base de las últimas semanas (zona de mayor riesgo de lesión/sobrecarga).'; }
    else if (W.acwr > 1.3) { lvl = 'warn'; txt = 'ACWR ' + f2(W.acwr) + ': por encima del rango óptimo (0,8-1,3). Vigila la fatiga.'; }
    else if (W.acwr < 0.8) { lvl = 'info'; txt = 'ACWR ' + f2(W.acwr) + ': carga menor que su base reciente (semana de descarga o pérdida de forma si se prolonga).'; }
    else { lvl = 'ok'; txt = 'ACWR ' + f2(W.acwr) + ': dentro del rango óptimo (0,8-1,3).'; }
    add(lvl, 'Carga aguda vs. crónica', txt);
  }
  if (isNum(W.tsb)) {
    const b = W.tsb, prov = W.historyDays < 42 ? ' (provisional: el modelo necesita ~6 semanas de datos para estabilizarse)' : '';
    let lvl, tx;
    if (b < -30) { lvl = 'bad'; tx = 'Balance de forma (TSB) ' + f0(b) + ': fatiga muy alta, riesgo de sobreentrenamiento si se mantiene.'; }
    else if (b < -10) { lvl = 'info'; tx = 'TSB ' + f0(b) + ': zona típica de entrenamiento productivo, con fatiga acumulada.'; }
    else if (b <= 5) { lvl = 'info'; tx = 'TSB ' + f0(b) + ': zona neutra; ni muy fatigado ni descansado.'; }
    else if (b <= 25) { lvl = 'ok'; tx = 'TSB ' + f0(b) + ': estás fresco; buen momento para competir o hacer sesiones clave.'; }
    else { lvl = 'info'; tx = 'TSB ' + f0(b) + ': muy descansado; si dura semanas puede significar pérdida de forma.'; }
    add(lvl, 'Fatiga y forma', tx + ' (CTL ' + f0(W.ctl) + ', ATL ' + f0(W.atl) + ')' + prov + '.');
  }
  if (W.zoneTotal > 0) {
    const l = W.low * 100, m = W.mid * 100, h = W.high * 100;
    let tx = 'Tiempo en Z1-Z2: ' + f0(l) + ' %, Z3: ' + f0(m) + ' %, Z4-Z5: ' + f0(h) + ' %. ';
    let lvl = 'ok';
    if (l >= 75 && h >= 10) tx += 'Distribución polarizada (muchas horas fáciles + algo de calidad): modelo muy recomendado.';
    else if (l >= 75) tx += 'Mayoría de trabajo fácil; para mejorar el rendimiento se puede añadir algo de calidad (Z4-Z5).';
    else if (m >= 30) { lvl = 'warn'; tx += 'Mucho tiempo en Z3 ("zona gris"): ni suficientemente fácil para recuperar ni duro para mejorar.'; }
    else if (h >= 25) { lvl = 'warn'; tx += 'Mucho trabajo intenso para la semana: asegúrate de intercalar días fáciles.'; }
    else tx += 'Distribución mixta.';
    add(lvl, 'Distribución de intensidades', tx);
  }
  if (isFinite(W.monotony) && W.n >= 3 && W.elapsed >= 4) {
    const lvl = W.monotony > 2 ? 'warn' : 'ok';
    add(lvl, 'Monotonía y descanso', 'Monotonía ' + f2(W.monotony) + ' (más de 2 indica poca variación entre días fáciles y duros), ' + W.restDays + ' día(s) sin entrenar y ' + W.hardDays + ' día(s) exigente(s)' + (W.partial ? ' en los ' + W.elapsed + ' días transcurridos' : '') + '. ' + (W.restDays === 0 ? 'No hubo ningún día completo de descanso: conviene programar al menos uno.' : (W.monotony > 2 ? 'Alterna mejor días duros con días muy suaves.' : 'Buena alternancia.')));
  } else if (W.restDays === 0 && W.elapsed >= 6 && W.n >= 5) add('warn', 'Descanso', 'Entrenó ' + W.elapsed + ' días seguidos: programa al menos un día de descanso o muy suave.');
  for (const [sp, d] of Object.entries(W.bySport)) {
    const bits = [];
    if (isNum(d.ef) && isNum(d.efPrev)) { const c = (d.ef - d.efPrev) / d.efPrev * 100; bits.push('Eficiencia ' + (c >= 0 ? '+' : '') + f1(c) + ' % frente a las 3 semanas previas' + (c < -5 ? ' (posible fatiga acumulada o calor)' : c > 3 ? ' (buena evolución)' : '')); }
    if (isNum(d.dec)) bits.push('acople medio en sesiones continuas ' + f1(d.dec) + ' %' + (d.dec > 5 ? ' (por encima del 5 %: base aeróbica por mejorar o fatiga)' : ' (aceptable)'));
    if (bits.length) add(bits.some(b => /fatiga|mejorar/.test(b)) ? 'warn' : 'info', SPORTS[sp] + ': tendencias', bits.join('; ') + '.');
  }
  // recomendación breve
  const rec = [];
  if (isNum(W.tsb) && W.tsb < -20) rec.push('programa 1-2 días fáciles o de descanso');
  if (isNum(W.acwr) && W.acwrReliable && W.acwr > 1.3) rec.push('reduce el volumen o la intensidad la próxima semana');
  if (W.zoneTotal > 0 && W.mid > 0.3) rec.push('polariza: haz más fácil lo fácil y más duro lo duro');
  if (!rec.length) rec.push('mantén la progresión actual y revisa cómo evolucionan la eficiencia y el acople en las próximas sesiones');
  add('info', 'Sugerencia', 'Para la próxima semana: ' + rec.join('; ') + '. Son indicadores orientativos basados en los datos, no un diagnóstico médico.');
  return out;
}


/* ---------- conclusión general (síntesis de todas las métricas) ---------- */
function efTrend(act, history) {
  if (!isNum(act.A.ef) || !history) return null;
  const prev = history.filter(h => h.sport === act.sport && h.id !== act.id && h.start < act.start && isNum(h.A.ef)).slice(-5);
  if (prev.length < 2) return null;
  const pm = mean(prev.map(h => h.A.ef));
  return { d: (act.A.ef - pm) / pm * 100, n: prev.length };
}
function activityOverview(act, history) {
  const A = act.A, pts = [], clauses = [];
  let warn = 0, bad = 0;
  const mark = l => { if (l === 'warn') warn++; if (l === 'bad') bad++; };
  const D = A.decoupling, decOk = !!(D && D.valid && D.steady);
  const variable = !!((D && D.valid && !D.steady) || (act.sport === 'bike' && isNum(A.vi) && A.vi > 1.15));
  let kind = 'sesión';
  if (isNum(A.IF)) kind = A.struct ? 'sesión por intervalos (' + A.struct.reps.length + ' esfuerzos)' : variable ? 'sesión variable o interválica' : A.IF < 0.75 ? 'sesión aeróbica suave' : A.IF < 0.85 ? 'sesión de resistencia sostenida' : A.IF < 0.95 ? 'sesión cercana al umbral' : 'sesión muy intensa';
  let band = null;
  if (isNum(A.load)) {
    band = loadBand(A.load)[0];
    const hi = A.zones ? (A.zones[3] + A.zones[4]) / (A.zones.reduce((x, y) => x + y, 0) || 1) * 100 : NaN;
    const l = A.load >= 450 ? 'warn' : 'info'; mark(l);
    pts.push({ label: 'Intensidad', level: l, text: 'Carga ' + f0(A.load) + ' (' + band + '), intensidad relativa ' + f2(A.IF) + (isNum(hi) ? ', ' + f0(hi) + ' % del tiempo en Z4-Z5' : '') + '.' });
  } else pts.push({ label: 'Intensidad', level: 'info', text: 'No evaluable: faltan frecuencia cardíaca y potencia.' });
  if (D) {
    if (decOk) {
      const p = D.pct, l = p < 5 ? 'ok' : p < 10 ? 'warn' : 'bad'; mark(l);
      pts.push({ label: 'Acople cardíaco', level: l, text: 'Desacople ' + f1(p) + ' %: ' + (p < 5 ? 'la FC se mantuvo estable para el mismo trabajo (buena base aeróbica).' : p < 10 ? 'deriva cardíaca moderada (calor, fatiga o intensidad algo alta).' : 'deriva alta (fatiga marcada, calor o intensidad superior a la capacidad aeróbica).') });
      clauses.push(p < 5 ? 'buen acople cardíaco' : p < 10 ? 'deriva cardíaca moderada' : 'deriva cardíaca alta');
    } else pts.push({ label: 'Acople cardíaco', level: 'info', text: D.valid ? 'No evaluable con fiabilidad: la sesión fue muy variable (intervalos).' : 'No evaluable: ' + (D.reason || 'datos insuficientes').replace(/:.*$/, '.').toLowerCase() });
  }
  if (A.hrr) {
    const d = A.hrr.drop, l = d >= 25 ? 'ok' : d >= 15 ? 'info' : 'warn'; mark(l);
    pts.push({ label: 'Recuperación cardíaca', level: l, text: 'Bajó ' + f0(d) + ' ppm en 60 s tras el esfuerzo: ' + (d >= 25 ? 'rápida.' : d >= 15 ? 'normal.' : 'lenta (posible fatiga).') });
    if (d < 15) clauses.push('recuperación cardíaca lenta');
  }
  const et = efTrend(act, history);
  if (et) {
    const l = et.d < -5 ? 'warn' : et.d > 3 ? 'ok' : 'info'; mark(l);
    pts.push({ label: 'Eficiencia', level: l, text: (et.d >= 0 ? '+' : '') + f1(et.d) + ' % frente a las últimas ' + et.n + ' sesiones de ' + (SPORTS[act.sport] || '').toLowerCase() + (et.d < -5 ? ' (por debajo de lo habitual).' : et.d > 3 ? ' (mejor que lo habitual).' : ' (sin cambios).') });
    if (et.d < -5) clauses.push('eficiencia por debajo de la media reciente');
  }
  if (A.struct) {
    const S = A.struct, l = S.fade < -5 ? 'warn' : 'info'; mark(l);
    pts.push({ label: 'Intervalos', level: l, text: S.reps.length + ' esfuerzos (' + f0(S.workSec / 60) + ' min): ' + (S.fade < -5 ? 'cayó el rendimiento ' + f1(-S.fade) + ' % hacia el final.' : 'rendimiento consistente entre repeticiones.') + ' Las mitades no se comparan.' });
    if (S.fade < -5) clauses.push('caída de rendimiento en las últimas repeticiones');
  } else if (A.split && act.sport !== 'swim' && Math.abs(A.split.pct) > 8) {
    mark('warn'); pts.push({ label: 'Reparto', level: 'warn', text: 'La 2ª mitad fue ' + (A.split.pct >= 0 ? '+' : '') + f1(A.split.pct) + ' % en velocidad respecto a la 1ª: ' + (A.split.pct < 0 ? 'salida demasiado fuerte o fatiga.' : 'acelerada notable.') });
  }
  if (A.hrv) pts.push({ label: 'Variabilidad cardíaca', level: 'info', text: 'RMSSD ' + f0(A.hrv.whole.rmssd) + ' ms' + (isNum(A.hrv.alphaMedian) ? ', DFA α1 mediano ' + f2(A.hrv.alphaMedian) : '') + ' (dependen de la intensidad; no equivalen a la VFC en reposo).' });
  else pts.push({ label: 'Variabilidad cardíaca', level: 'info', text: 'Sin intervalos R-R en el archivo.' });
  const level = bad ? 'bad' : warn ? 'warn' : 'ok';
  let headline = (kind.charAt(0).toUpperCase() + kind.slice(1)) + (band ? ' de carga ' + band : '');
  headline += clauses.length ? ', con ' + clauses.join(' y ') : (level === 'ok' && band ? ', bien tolerada' : '');
  headline += '.';
  let advice;
  if (level === 'bad') advice = 'Priorizar la recuperación: sesión muy suave o descanso en las próximas 24-48 h y revisar sueño, hidratación y calor.';
  else if (level === 'warn') advice = isNum(A.load) && A.load >= 300 ? 'Planificar una sesión suave o descanso a continuación para absorber la carga.' : 'Vigilar la respuesta en las próximas sesiones; si las señales se repiten, bajar la intensidad unos días.';
  else advice = isNum(A.load) && A.load < 150 ? 'Carga baja y bien tolerada: se puede encadenar otra sesión, incluso de calidad si el plan lo pide.' : 'Buena respuesta: continuar con el plan y dejar una sesión fácil antes de la siguiente de calidad.';
  const pr = A.profile, est = (A.hasHr && (pr.hrMaxAuto || pr.lthrAuto || pr.hrRestAuto)) || (act.sport === 'bike' && A.hasPw && !pr.ftp);
  const caveat = !A.hasHr && !A.hasPw ? 'Sin FC ni potencia las conclusiones son muy limitadas.' : est ? 'Parte del cálculo usa valores estimados del deportista (FC máx., reposo, umbral o FTP); con los reales la conclusión será más precisa.' : '';
  return { level, headline, points: pts, advice, caveat };
}
function weekOverview(W) {
  const pts = [], flags = [];
  let warn = 0, bad = 0;
  const add = (label, level, text) => { pts.push({ label, level, text }); if (level === 'warn') { warn++; flags.push(label.toLowerCase()); } if (level === 'bad') { bad++; flags.unshift(label.toLowerCase()); } };
  if (!W.n) return { level: 'info', headline: 'No hay sesiones en esta semana.', points: [], advice: 'Sube las sesiones de la semana para obtener el análisis.', caveat: '' };
  const jump = isNum(W.loadChange) && W.loadChange > 30 && W.prevLoad > 50;
  add('Volumen y carga', jump ? 'warn' : 'info', W.n + (W.n === 1 ? ' sesión, ' : ' sesiones, ') + f1(W.dur / 3600) + ' h, carga ' + f0(W.load) + (isNum(W.loadChange) ? ' (' + (W.loadChange >= 0 ? '+' : '') + f0(W.loadChange) + ' % ' + (W.partial ? 'vs mismos días de la semana anterior' : 'vs semana anterior') + ')' : '') + (jump ? ': subida brusca.' : '.'));
  if (isNum(W.acwr)) { const l = W.acwr > 1.5 ? 'bad' : W.acwr > 1.3 ? 'warn' : W.acwr < 0.8 ? 'info' : 'ok'; add('Carga aguda/crónica', l, 'ACWR ' + f2(W.acwr) + (W.acwr > 1.3 ? ': por encima del rango óptimo (0,8-1,3).' : W.acwr < 0.8 ? ': carga inferior a la base reciente.' : ': dentro del rango óptimo.') + (W.acwrReliable ? '' : ' (provisional)')); }
  if (isNum(W.tsb)) { const b = W.tsb, l = b < -30 ? 'bad' : b > 5 ? 'ok' : 'info'; add('Forma y fatiga', l, 'TSB ' + f0(b) + ' (CTL ' + f0(W.ctl) + ', ATL ' + f0(W.atl) + '): ' + (b < -30 ? 'fatiga muy alta.' : b < -10 ? 'fatiga acumulada productiva.' : b <= 5 ? 'zona neutra.' : b <= 25 ? 'fresco.' : 'muy descansado.')); }
  if (W.zoneTotal > 0) { const lo = W.low * 100, mi = W.mid * 100, hi = W.high * 100, l = (mi >= 30 || hi >= 25) ? 'warn' : 'ok'; add('Intensidades', l, 'Z1-Z2 ' + f0(lo) + ' %, Z3 ' + f0(mi) + ' %, Z4-Z5 ' + f0(hi) + ' %: ' + (mi >= 30 ? 'demasiado tiempo en la zona gris (Z3).' : hi >= 25 ? 'mucho trabajo intenso.' : lo >= 75 ? 'reparto mayoritariamente fácil.' : 'reparto mixto.')); }
  const aero = [];
  for (const [sp, d] of Object.entries(W.bySport)) {
    if (isNum(d.ef) && isNum(d.efPrev)) { const c = (d.ef - d.efPrev) / d.efPrev * 100; aero.push({ l: c < -5 ? 'warn' : c > 3 ? 'ok' : 'info', t: SPORTS[sp] + ' eficiencia ' + (c >= 0 ? '+' : '') + f1(c) + ' %' }); }
    if (isNum(d.dec)) aero.push({ l: d.dec > 5 ? 'warn' : 'ok', t: SPORTS[sp] + ' acople ' + f1(d.dec) + ' %' });
  }
  if (aero.length) add('Respuesta aeróbica', aero.some(a => a.l === 'warn') ? 'warn' : aero.some(a => a.l === 'ok') ? 'ok' : 'info', aero.map(a => a.t).join('; ') + '.');
  const noRest = W.restDays === 0 && W.elapsed >= 6 && W.n >= 5, mono = isFinite(W.monotony) && W.monotony > 2;
  add('Descanso', noRest || mono ? 'warn' : 'ok', W.restDays + ' día(s) sin entrenar' + (W.partial ? ' de ' + W.elapsed + ' transcurrido(s)' : '') + (isFinite(W.monotony) ? ', monotonía ' + f2(W.monotony) : '') + (noRest ? ': falta un día de descanso.' : mono ? ': poca variación entre días fáciles y duros.' : '.'));
  const level = bad ? 'bad' : warn ? 'warn' : 'ok';
  const lead = (W.partial ? 'Semana en curso (' + W.elapsed + ' de 7 días): ' : '');
  let headline;
  if (level === 'ok') headline = lead + 'carga bien dosificada y buena respuesta; semana equilibrada.';
  else headline = lead + (level === 'bad' ? 'riesgo de sobrecarga' : 'señales de atención') + ' en ' + flags.slice(0, 3).join(', ') + '.';
  headline = headline.charAt(0).toUpperCase() + headline.slice(1);
  const rec = [];
  if (isNum(W.tsb) && W.tsb < -20) rec.push('programar 1-2 días fáciles o de descanso');
  if (isNum(W.acwr) && W.acwr > 1.3) rec.push('reducir volumen o intensidad la próxima semana');
  if (W.zoneTotal > 0 && W.mid >= 0.3) rec.push('polarizar: más fácil lo fácil y más duro lo duro');
  if (noRest) rec.push('incluir un día de descanso');
  if (jump && !rec.length) rec.push('subir la carga de forma más gradual (5-10 % por semana)');
  const advice = rec.length ? (W.partial ? 'Para los próximos días: ' : 'Para la próxima semana: ') + rec.join('; ') + '.' : 'Mantener la progresión (subidas de carga de 5-10 % como máximo) y seguir de cerca la eficiencia y el acople.';
  const pr = W.acts.find(a => a.A.profile && ((a.A.hasHr && (a.A.profile.hrMaxAuto || a.A.profile.lthrAuto || a.A.profile.hrRestAuto)) || (a.sport === 'bike' && a.A.hasPw && !a.A.profile.ftp)));
  const cav = [];
  if (pr) cav.push('Hay valores estimados del deportista (FC máx., reposo, umbral o FTP).');
  if (W.pmc && W.historyDays < 28) cav.push('Con menos de 4 semanas de histórico, la forma y la carga aguda/crónica son provisionales.');
  return { level, headline, points: pts, advice, caveat: cav.join(' ') };
}

const Core = { mean, isNum, detectIntervals, fmtOut, fmtMin, activityOverview, weekOverview, observedMaxHr, SPORTS, ZN, ZLIM, PZN, PZLIM, FIT_EPOCH, normProfile, parseFit, parseXml, resample, analyze, analyzeHrv, dfaAlpha1, cleanRR, hrvTime, downsample,
  pmc, weekSummary, f0, f1, f2, activityInsights, weekInsights, dailyLoads, dayKey, keyToDate, weekStartKey, addDays, daysBetween, isNum, mean, sd, median, movAvg, normalizedPower, guessSport };
if (typeof module !== 'undefined' && module.exports) module.exports = Core; else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
