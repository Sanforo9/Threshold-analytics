/* Detección y cálculo de los tests de campo de Threshold (según la "Calculadora de Test"). */
(function (root) {
'use strict';
const C = typeof require !== 'undefined' && typeof module !== 'undefined' ? require('./core.js') : root.Core;
const isNum = v => typeof v === 'number' && isFinite(v);
const mean = a => { let s = 0, n = 0; for (const v of a) if (isNum(v)) { s += v; n++; } return n ? s / n : NaN; };
const sdev = a => { const m = mean(a); let s = 0, n = 0; for (const v of a) if (isNum(v)) { s += (v - m) ** 2; n++; } return n > 1 ? Math.sqrt(s / (n - 1)) : NaN; };
const nf = (v, d = 0) => (isNum(v) ? v : NaN).toLocaleString('es', { minimumFractionDigits: d, maximumFractionDigits: d });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const TESTS = {
  bike_20: { sport: 'bike', name: 'Ciclismo · test de 20 min (FTP y FTHR)' },
  bike_2x8: { sport: 'bike', name: 'Ciclismo · test 2×8 min (FTP)' },
  bike_step: { sport: 'bike', name: 'Ciclismo · test de potencia escalonado' },
  run_20: { sport: 'run', name: 'Running · test de 20 min' },
  run_12: { sport: 'run', name: 'Running · test de 12 min' },
  swim_1000: { sport: 'swim', name: 'Natación · test de 1000 m' },
  swim_400_200: { sport: 'swim', name: 'Natación · test 400 m + 200 m' },
  swim_200_100: { sport: 'swim', name: 'Natación · test 200 m + 100 m (novatos)' }
};

/* ---------- utilidades de ventanas ---------- */
function prefix(arr) {
  const n = arr.length, ps = new Float64Array(n + 1), pc = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) { const v = arr[i], ok = isNum(v); ps[i + 1] = ps[i] + (ok ? v : 0); pc[i + 1] = pc[i] + (ok ? 1 : 0); }
  return { ps, pc, n };
}
// mejor ventana de L segundos (promedio máx.), exigiendo cobertura mínima; [from,to) limita dónde buscar
function bestWindow(arr, L, minCov = 0.95, from = 0, to = arr.length, P) {
  P = P || prefix(arr); let best = null;
  for (let s = Math.max(0, from); s + L <= Math.min(to, P.n); s++) {
    const c = P.pc[s + L] - P.pc[s]; if (c < L * minCov) continue;
    const avg = (P.ps[s + L] - P.ps[s]) / c;
    if (!best || avg > best.avg) best = { s, e: s + L, avg };
  }
  return best;
}
const winMean = (arr, s, e) => mean(Array.prototype.slice.call(arr, Math.max(0, s), Math.max(0, e)));
function cvOf(arr, s, e, w = 60) { // variación de la señal suavizada dentro de la ventana
  const seg = Array.prototype.slice.call(arr, s, e), out = [];
  for (let i = 0; i + w <= seg.length; i += 10) out.push(mean(seg.slice(i, i + w)));
  const m = mean(out); return m > 0 ? sdev(out) / m : NaN;
}
function outsideMean(arr, s, e, minV) {
  let sum = 0, c = 0; for (let i = 0; i < arr.length; i++) { if (i >= s && i < e) continue; const v = arr[i]; if (isNum(v) && v > minV) { sum += v; c++; } }
  return c ? sum / c : NaN;
}
function speedWindow(rs, L) { // mejor ventana por velocidad (usa distancia si existe)
  const { n, s } = rs, d = s.dist; let cnt = 0; for (let i = 0; i < n; i++) if (isNum(d[i])) cnt++;
  if (cnt > n * 0.5) {
    let best = null;
    for (let a = 0; a + L < n; a++) {
      const d0 = d[a], d1 = d[a + L]; if (!isNum(d0) || !isNum(d1)) continue;
      const v = (d1 - d0) / L; if (!best || v > best.avg) best = { s: a, e: a + L, avg: v };
    }
    if (best) return best;
  }
  return bestWindow(s.sp, L, 0.95);
}

/* ---------- formato ---------- */
function fmtPace(sec) { if (!isNum(sec) || sec <= 0) return '—'; let m = Math.floor(sec / 60), r = Math.round(sec - m * 60); if (r === 60) { m++; r = 0; } return m + ':' + String(r).padStart(2, '0'); }
function fmtT(sec) { sec = Math.round(sec); const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + String(s).padStart(2, '0'); }

/* ---------- zonas (según el Excel) ---------- */
function zonesHr(fthr, hrRest, hrMax) {
  const lim = [fthr * 0.69, fthr * 0.83, fthr * 0.94, fthr * 1.05], rows = []; let from = hrRest - 5;
  lim.forEach((to, i) => { rows.push(['Z' + (i + 1), nf(from), nf(to)]); from = to + 1; });
  rows.push(['Z5', nf(from), nf(hrMax + 5)]);
  return { title: 'Zonas de FC (FTHR ' + nf(fthr) + ' ppm)', head: ['Zona', 'Desde (ppm)', 'Hasta (ppm)'], rows };
}
function zonesBike(ftp) {
  const lim = [0.55, 0.75, 0.90, 1.05, 1.20, 1.50], rows = []; let from = 0;
  lim.forEach((m, i) => { const to = ftp * m; rows.push(['Z' + (i + 1), nf(from), nf(to)]); from = to + 1; });
  rows.push(['Z7', nf(from), 'MAX']);
  return { title: 'Zonas de potencia (FTP ' + nf(ftp) + ' W)', head: ['Zona', 'Desde (W)', 'Hasta (W)'], rows };
}
function zonesRunPower(ftp) {
  const lim = [0.81, 0.88, 0.95, 1.05, 1.15, 1.28], rows = []; let from = 0;
  lim.forEach((m, i) => { const to = ftp * m; rows.push(['Z' + (i + 1), nf(from), nf(to)]); from = to + 1; });
  rows.push(['Z7', nf(from), 'MAX']);
  return { title: 'Zonas de potencia en carrera (FTP ' + nf(ftp) + ' W)', head: ['Zona', 'Desde (W)', 'Hasta (W)'], rows };
}
function zonesRunPace(thr) { // thr: s/km
  const names = ['1', '2', '3', '4', '5a', '5b', '5c'], mult = [1.6, 1.29, 1.14, 1.06, 0.99, 0.97, 0.90], rows = [];
  const spm = [0.4, 0.71, 0.86, 0.94, 1.01, 1.03, 1.10], v = 3600 / thr;
  for (let i = 0; i < 7; i++) {
    const hi = i < 6 ? mult[i + 1] : null, sh = i < 6 ? spm[i + 1] : null;
    rows.push(['Z' + names[i], fmtPace(thr * mult[i]), hi ? fmtPace(thr * hi) : 'MAX', nf(v * spm[i], 1), sh ? nf(v * sh, 1) : 'MAX']);
  }
  return { title: 'Zonas de ritmo (umbral ' + fmtPace(thr) + ' /km)', head: ['Zona', 'Ritmo desde (/km)', 'Ritmo hasta (/km)', 'Vel. desde (km/h)', 'Vel. hasta (km/h)'], rows };
}
function zonesSwim(thr) { // thr: s/100 m
  const names = ['1', '2', '3', '4', '5a', '5b', '5c'], mult = [1.5, 1.24, 1.10, 1.02, 0.96, 0.93, 0.86], rows = [];
  for (let i = 0; i < 7; i++) rows.push(['Z' + names[i], fmtPace(thr * mult[i]), i < 6 ? fmtPace(thr * mult[i + 1]) : 'MAX']);
  return { title: 'Zonas de ritmo en natación (umbral ' + fmtPace(thr) + ' /100 m)', head: ['Zona', 'Ritmo desde (/100 m)', 'Ritmo hasta (/100 m)'], rows };
}

/* ---------- bloques de natación a partir de distancia ---------- */
function swimBlocks(rs) {
  const pts = []; for (let i = 0; i < rs.n; i++) if (isNum(rs.s.dist[i])) pts.push([i, rs.s.dist[i]]);
  if (pts.length < 6) return [];
  const dts = []; for (let k = 1; k < pts.length; k++) { const dt = pts[k][0] - pts[k - 1][0], dd = pts[k][1] - pts[k - 1][1]; if (dt > 0 && dd / dt >= 0.5) dts.push(dt); }
  dts.sort((x, y) => x - y); const med = dts.length ? dts[dts.length >> 1] : 1, gapLim = Math.max(12, 1.8 * med);
  const blocks = []; let cur = null;
  for (let k = 1; k < pts.length; k++) {
    const dt = pts[k][0] - pts[k - 1][0], dd = pts[k][1] - pts[k - 1][1];
    if (dd < 1) { if (cur) { blocks.push(cur); cur = null; } continue; }
    if (dt > gapLim) { // pausa/descanso: solo el último tramo del intervalo se nadó
      if (cur) { blocks.push(cur); cur = null; }
      const nd = k + 1 < pts.length ? pts[k + 1][0] - pts[k][0] : med, first = nd > 0 && nd <= gapLim ? nd : med;
      cur = { t0: pts[k][0] - first, d0: pts[k - 1][1], t1: pts[k][0], d1: pts[k][1] }; continue;
    }
    if (dd / dt >= 0.3) { if (!cur) cur = { t0: pts[k - 1][0], d0: pts[k - 1][1], t1: pts[k][0], d1: pts[k][1] }; else { cur.t1 = pts[k][0]; cur.d1 = pts[k][1]; } }
    else if (cur) { blocks.push(cur); cur = null; }
  }
  if (cur) blocks.push(cur);
  return blocks.map(b => ({ t0: b.t0, t1: b.t1, dist: b.d1 - b.d0, time: b.t1 - b.t0 })).filter(b => b.dist > 50 && b.time > 20).map(b => Object.assign(b, { pace: b.time / b.dist * 100 }));
}
function medianOf(a) { const b = a.filter(isNum).sort((x, y) => x - y); if (!b.length) return NaN; const k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; }
// pareja de bloques ≈d1 y ≈d2 (en ese orden): los dos esfuerzos más rápidos de la sesión
function findBlocks(blocks, d1, tol1, d2, tol2) {
  const ok = (b, d, tol) => Math.abs(b.dist - d) <= d * tol;
  let best = null;
  for (let i = 0; i < blocks.length; i++) {
    if (!ok(blocks[i], d1, tol1)) continue;
    for (let j = i + 1; j < blocks.length; j++) {
      if (!ok(blocks[j], d2, tol2)) continue;
      if (blocks[j].t0 - blocks[i].t1 < 20) continue;
      const others = blocks.filter((_, k) => k !== i && k !== j).map(b => b.pace), med = medianOf(others);
      if (isNum(med) && (blocks[i].pace > 0.95 * med || blocks[j].pace > 0.95 * med)) continue; // los tests se nadan más fuerte que el resto
      const score = 1 - (Math.abs(blocks[i].dist - d1) / d1 + Math.abs(blocks[j].dist - d2) / d2), speed = -(blocks[i].pace + blocks[j].pace);
      if (!best || speed > best.speed) best = { a: blocks[i], b: blocks[j], score, speed };
    }
  }
  return best;
}

/* ---------- segmentación en escalones (test escalonado) ---------- */
function detectSteps(pw) {
  const n = pw.length, B = 20, m = [];
  for (let i = 0; i + B <= n; i += B) m.push(mean(Array.prototype.slice.call(pw, i, i + B)));
  const segs = []; let cur = { a: 0, b: 0 };
  const segMean = sg => mean(m.slice(Math.max(sg.a, sg.b - 2), sg.b + 1));
  for (let k = 1; k < m.length; k++) {
    const mc = segMean(cur), thr = Math.max(12, 0.06 * mc), up = m[k] - mc;
    const dev = Math.abs(up) > thr, dev2 = k + 1 < m.length ? Math.abs(m[k + 1] - mc) > thr && Math.sign(m[k + 1] - mc) === Math.sign(up) : dev;
    if (dev && dev2) { segs.push(cur); cur = { a: k, b: k }; } else cur.b = k;
  }
  segs.push(cur);
  const plateaus = segs.map(sg => ({ s: sg.a * B, e: (sg.b + 1) * B, pw: mean(m.slice(sg.a, sg.b + 1)) })).filter(p => p.e - p.s >= 90 && p.pw > 40);
  // cadena más larga de escalones crecientes consecutivos
  let best = [], cur2 = [];
  for (const p of plateaus) {
    if (cur2.length && p.pw >= cur2[cur2.length - 1].pw * 1.03 && p.s - cur2[cur2.length - 1].e <= 90) cur2.push(p);
    else { if (cur2.length > best.length) best = cur2; cur2 = [p]; }
  }
  if (cur2.length > best.length) best = cur2;
  return best;
}

/* ---------- cálculo de cada test ---------- */
function compute(id, rs, P, opts) {
  opts = opts || {};
  const s = rs.s, T = TESTS[id]; if (!T) return null;
  const R = { id, name: T.name, sport: T.sport, calc: [], zones: [], apply: {}, headline: '', notes: [] };
  const hrAvg = (a, b) => { const v = mean(Array.prototype.slice.call(s.hr, a, b)); return isNum(v) ? v : NaN; };
  const pwN = mean(Array.from(s.pw).filter(isNum));
  if (id === 'bike_20') {
    const w = bestWindow(s.pw, 1200, 0.9); if (!w) return Object.assign(R, { error: 'No hay 20 minutos continuos con potencia.' });
    const ftp = w.avg * 0.95, hr = hrAvg(w.s, w.e), fthr = isNum(hr) ? hr * 0.97 : NaN;
    R.win = { s: w.s, e: w.e };
    R.calc.push(['Potencia media de los mejores 20 min', nf(w.avg) + ' W'], ['FTP = potencia 20 min × 0,95', nf(ftp) + ' W']);
    if (isNum(hr)) R.calc.push(['FC media de esos 20 min', nf(hr) + ' ppm'], ['FTHR = FC 20 min × 0,97', nf(fthr) + ' ppm']);
    R.out = { ftp, fthr }; R.apply = { ftp: Math.round(ftp), lthr: isNum(fthr) ? Math.round(fthr) : undefined };
    R.headline = 'FTP ' + nf(ftp) + ' W' + (isNum(fthr) ? ' · FTHR ' + nf(fthr) + ' ppm' : '');
    R.zones.push(zonesBike(ftp)); if (isNum(fthr)) R.zones.push(zonesHr(fthr, P.hrRest, P.hrMax));
  } else if (id === 'bike_2x8') {
    const L = 480, Pf = prefix(s.pw), w1 = bestWindow(s.pw, L, 0.9, 0, s.pw.length, Pf); if (!w1) return Object.assign(R, { error: 'No hay 8 minutos continuos con potencia.' });
    const A = bestWindow(s.pw, L, 0.9, 0, w1.s - 120, Pf), Bw = bestWindow(s.pw, L, 0.9, w1.e + 120, s.pw.length, Pf);
    const w2 = !A ? Bw : !Bw ? A : (A.avg >= Bw.avg ? A : Bw);
    if (!w2) return Object.assign(R, { error: 'No se encontró una segunda repetición de 8 minutos separada de la primera.' });
    const r = w1.s < w2.s ? [w1, w2] : [w2, w1], avg = (r[0].avg + r[1].avg) / 2, ftp = avg * 0.9;
    R.win = { s: r[0].s, e: r[1].e, reps: r.map(x => ({ s: x.s, e: x.e })) };
    R.calc.push(['Repetición 1 (8 min)', nf(r[0].avg) + ' W'], ['Repetición 2 (8 min)', nf(r[1].avg) + ' W'], ['Promedio de las dos', nf(avg) + ' W'], ['FTP = promedio × 0,90', nf(ftp) + ' W']);
    const h = [hrAvg(r[0].s, r[0].e), hrAvg(r[1].s, r[1].e)]; if (isNum(h[0])) R.notes.push('FC media por repetición: ' + nf(h[0]) + ' y ' + nf(h[1]) + ' ppm (el Excel de este test no calcula FTHR).');
    R.out = { ftp }; R.apply = { ftp: Math.round(ftp) }; R.headline = 'FTP ' + nf(ftp) + ' W'; R.zones.push(zonesBike(ftp));
  } else if (id === 'bike_step') {
    const steps = detectSteps(s.pw), w3 = bestWindow(s.pw, 180, 0.9); if (!w3) return Object.assign(R, { error: 'No hay 3 minutos continuos con potencia.' });
    const ftp = w3.avg * 0.85; R.win = { s: w3.s, e: w3.e };
    R.steps = steps.map((p, i) => ({ n: i + 1, s: p.s, dur: p.e - p.s, pw: p.pw, hr: hrAvg(p.s + ((p.e - p.s) >> 1), p.e) }));
    R.calc.push(['Mejores 3 min de potencia', nf(w3.avg) + ' W'], ['FTP = mejores 3 min × 0,85', nf(ftp) + ' W']);
    R.out = { ftp }; R.apply = { ftp: Math.round(ftp) }; R.headline = 'FTP ' + nf(ftp) + ' W';
    const k = opts.stepIdx;
    if (R.steps.length && isNum(k) && R.steps[k] && isNum(R.steps[k].hr)) {
      const fthr = R.steps[k].hr; R.out.fthr = fthr; R.apply.lthr = Math.round(fthr);
      R.calc.push(['FTHR = FC media del escalón ' + R.steps[k].n + ' (umbral)', nf(fthr) + ' ppm']); R.headline += ' · FTHR ' + nf(fthr) + ' ppm'; R.zones.push(zonesBike(ftp), zonesHr(fthr, P.hrRest, P.hrMax));
    } else { R.needsStep = true; R.notes.push('Elige el escalón que corresponde al umbral para obtener la FTHR (en el Excel es un dato que se introduce a mano).'); R.zones.push(zonesBike(ftp)); }
  } else if (id === 'run_20' || id === 'run_12') {
    const L = id === 'run_20' ? 1200 : 720, w = speedWindow(rs, L); if (!w || !(w.avg > 0.5)) return Object.assign(R, { error: 'No hay ' + (L / 60) + ' minutos continuos con velocidad.' });
    const pace = 1000 / w.avg, thr = id === 'run_20' ? pace * 1.05 : pace * 1.03 * 1.05;
    R.win = { s: w.s, e: w.e };
    R.calc.push(['Ritmo medio de los mejores ' + (L / 60) + ' min', fmtPace(pace) + ' /km']);
    R.calc.push([id === 'run_20' ? 'Umbral = ritmo × 1,05' : 'Umbral = ritmo × 1,03 × 1,05', fmtPace(thr) + ' /km']);
    R.out = { thr }; R.apply = { runThr: Math.round(thr) }; R.headline = 'Umbral ' + fmtPace(thr) + ' /km';
    const hr = hrAvg(w.s, w.e); if (isNum(hr)) R.notes.push('FC media durante el test: ' + nf(hr) + ' ppm.');
    const pw = id === 'run_20' ? bestWindow(s.pw, 1200, 0.9) : null;
    if (pw && pwN > 30) { const ftp = pw.avg * 0.95; R.calc.push(['Potencia media 20 min (carrera)', nf(pw.avg) + ' W'], ['FTP carrera = potencia × 0,95', nf(ftp) + ' W']); R.out.ftp = ftp; R.apply.runFtp = Math.round(ftp); R.headline += ' · FTP carrera ' + nf(ftp) + ' W'; R.zones.push(zonesRunPower(ftp)); }
    R.zones.unshift(zonesRunPace(thr));
  } else if (id.startsWith('swim_')) {
    const blocks = swimBlocks(rs); let thr, from;
    if (id === 'swim_1000') {
      const b = blocks.filter(x => x.dist >= 950 && x.dist <= 1100).sort((x, y) => x.pace - y.pace)[0];
      if (!b) return Object.assign(R, { error: 'No se encontró un bloque continuo de unos 1000 m.' });
      thr = b.pace * 1.03; R.win = { s: b.t0, e: b.t1 };
      R.calc.push(['Ritmo medio de los 1000 m', fmtPace(b.pace) + ' /100 m'], ['Umbral = ritmo × 1,03', fmtPace(thr) + ' /100 m']);
    } else {
      const big = id === 'swim_400_200' ? 400 : 200, small = id === 'swim_400_200' ? 200 : 100;
      const f = findBlocks(blocks, big, 0.08, small, 0.1);
      if (!f) return Object.assign(R, { error: 'No se encontraron dos bloques continuos de ' + big + ' m y ' + small + ' m.' });
      // tiempos normalizados a la distancia nominal de cada tramo
      const tBig = f.a.pace * big / 100, tSmall = f.b.pace * small / 100;
      R.win = { s: f.a.t0, e: f.b.t1, reps: [{ s: f.a.t0, e: f.a.t1 }, { s: f.b.t0, e: f.b.t1 }] };
      R.calc.push(['Ritmo medio ' + big + ' m', fmtPace(f.a.pace) + ' /100 m (' + fmtT(tBig) + ')'], ['Ritmo medio ' + small + ' m', fmtPace(f.b.pace) + ' /100 m (' + fmtT(tSmall) + ')']);
      if (id === 'swim_400_200') { const diff = tBig - tSmall; thr = diff / 2; R.calc.push(['Algoritmo = t(400) − t(200)', fmtT(diff)], ['Umbral (CSS) = algoritmo ÷ 2', fmtPace(thr) + ' /100 m']); }
      else { const diff = (tBig - tSmall) * 1.05; thr = diff; R.calc.push(['Algoritmo = (t(200) − t(100)) × 1,05', fmtT(diff)], ['Umbral (CSS)', fmtPace(thr) + ' /100 m']); }
      if (f.b.pace > f.a.pace) R.notes.push('Ojo: el tramo corto salió más lento que el largo; revisa que sean los bloques correctos.');
    }
    R.out = { swimThr: thr }; R.apply = { swimThr: Math.round(thr) }; R.headline = 'Umbral ' + fmtPace(thr) + ' /100 m'; R.zones.push(zonesSwim(thr));
  }
  return R;
}

/* ---------- detección: ¿qué test es esta sesión? ---------- */
function detect(rs, sport, A) {
  const s = rs.s, n = rs.n, out = [];
  const tot = A ? (A.elapsed || A.dur) : 0; if (!A || tot > 150 * 60 || tot < 15 * 60) return out;
  const push = (id, score, why) => { if (score >= 0.5) out.push({ id, score: Math.min(1, score), why }); };
  if (sport === 'bike' && A.hasPw) {
    const Pf = prefix(s.pw), w20 = bestWindow(s.pw, 1200, 0.9, 0, n, Pf), w8 = bestWindow(s.pw, 480, 0.9, 0, n, Pf);
    if (w20) {
      const rest = outsideMean(s.pw, w20.s, w20.e, 30), ratio = w20.avg / rest, cv = cvOf(s.pw, w20.s, w20.e), r8 = w8 ? w8.avg / w20.avg : 9;
      const score = clamp((ratio - 1.05) / 0.25, 0, 1) * 0.4 + (cv <= 0.1 ? 0.3 : cv <= 0.16 ? 0.15 : 0) + (r8 <= 1.07 ? 0.3 : 0);
      push('bike_20', (ratio >= 1.1 && cv <= 0.16) ? score : score * 0.4, 'Un esfuerzo continuo y parejo de 20 min (' + nf(w20.avg) + ' W, ' + nf(ratio, 2) + '× el resto de la sesión).');
    }
    if (w8) {
      const A1 = bestWindow(s.pw, 480, 0.9, 0, w8.s - 150, Pf), B1 = bestWindow(s.pw, 480, 0.9, w8.e + 150, n, Pf);
      const w2 = !A1 ? B1 : !B1 ? A1 : (A1.avg >= B1.avg ? A1 : B1);
      if (w2) {
        const r = w8.s < w2.s ? [w8, w2] : [w2, w8], gapMean = winMean(s.pw, r[0].e, r[1].s), mn = Math.min(r[0].avg, r[1].avg), mx = Math.max(r[0].avg, r[1].avg);
        const rest = (() => { let sum = 0, c = 0; for (let i = 0; i < n; i++) { const v = s.pw[i]; if (isNum(v) && v > 30 && !(i >= r[0].s && i < r[0].e) && !(i >= r[1].s && i < r[1].e)) { sum += v; c++; } } return c ? sum / c : NaN; })();
        const similar = mx / mn <= 1.12, recov = gapMean <= 0.85 * mn, ratio = mn / rest;
        const cvOk = cvOf(s.pw, r[0].s, r[0].e) <= 0.12 && cvOf(s.pw, r[1].s, r[1].e) <= 0.12;
        const score = (similar ? 0.25 : 0) + (recov ? 0.3 : 0) + clamp((ratio - 1.05) / 0.25, 0, 1) * 0.25 + (cvOk ? 0.2 : 0);
        // si hay un esfuerzo de 20 min que lo explica mejor, no es 2×8
        push('bike_2x8', (recov && similar && cvOk && ratio >= 1.12) ? score : score * 0.4, 'Dos esfuerzos de 8 min (' + nf(r[0].avg) + ' y ' + nf(r[1].avg) + ' W) separados por una recuperación.');
      }
    }
    const steps = detectSteps(s.pw);
    if (steps.length >= 4) {
      const durs = steps.map(p => p.e - p.s), cvd = sdev(durs) / mean(durs);
      push('bike_step', 0.5 + Math.min(0.3, (steps.length - 4) * 0.1) + (cvd <= 0.35 ? 0.2 : 0), steps.length + ' escalones de potencia creciente (de ' + nf(steps[0].pw) + ' a ' + nf(steps[steps.length - 1].pw) + ' W).');
    }
  } else if (sport === 'run' && A.hasSp) {
    const w12 = speedWindow(rs, 720), w20 = speedWindow(rs, 1200);
    if (w12 && w20) {
      const r = w12.avg / w20.avg, restOf = (w) => outsideMean(s.sp, w.s, w.e, 1.0);
      const q = (w, L) => {
        const ratio = w.avg / restOf(w), cv = cvOf(s.sp, w.s, w.e), before = winMean(s.sp, w.s - 90, w.s - 10), after = winMean(s.sp, w.e + 10, w.e + 90);
        const cliff = (isNum(before) && before < 0.92 * w.avg ? 0.5 : 0) + (!isNum(after) || after < 0.92 * w.avg ? 0.5 : 0);
        return clamp((ratio - 1.05) / 0.25, 0, 1) * 0.4 + (cv <= 0.12 ? 0.2 : 0) + cliff * 0.2;
      };
      const q12 = q(w12, 720), q20 = q(w20, 1200);
      push('run_12', q12 + (r >= 1.06 ? 0.2 : r >= 1.045 ? 0.08 : 0), 'Esfuerzo continuo de 12 min a ' + fmtPace(1000 / w12.avg) + ' /km; los 20 min no se sostienen a ese ritmo.');
      push('run_20', q20 + (r <= 1.045 ? 0.2 : r <= 1.06 ? 0.08 : 0), 'Esfuerzo continuo de 20 min a ' + fmtPace(1000 / w20.avg) + ' /km.');
    }
  } else if (sport === 'swim') {
    const blocks = swimBlocks(rs);
    if (blocks.some(b => b.dist >= 950 && b.dist <= 1100)) push('swim_1000', 0.75, 'Un bloque continuo de ~1000 m.');
    const f1 = findBlocks(blocks, 400, 0.08, 200, 0.1); if (f1) push('swim_400_200', 0.6 + clamp(f1.score, 0, 1) * 0.3, 'Bloques continuos de ~400 m y ~200 m.');
    const f2 = findBlocks(blocks, 200, 0.08, 100, 0.1); if (f2 && !f1) push('swim_200_100', 0.6 + clamp(f2.score, 0, 1) * 0.3, 'Bloques continuos de ~200 m y ~100 m.');
  }
  return out.sort((a, b) => b.score - a.score);
}

const TestLab = { TESTS, detect, compute, fmtPace, fmtT, detectSteps, bestWindow, swimBlocks };
if (typeof module !== 'undefined' && module.exports) module.exports = TestLab; else root.TestLab = TestLab;
})(typeof window !== 'undefined' ? window : globalThis);
