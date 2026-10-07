(() => {
'use strict';
const C = Core, $ = id => document.getElementById(id), isNum = C.isNum;
const state = { acts: [], profile: C.normProfile(loadProfile()), tab: 'actividad', sel: null, wk: null, db: null, persist: true };
const SPORT_ICON = { run: '🏃', bike: '🚴', swim: '🏊', other: '🏋️' };
const ZCOL = ['var(--z1)', 'var(--z2)', 'var(--z3)', 'var(--z4)', 'var(--z5)'];

/* ---------- utilidades ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f0 = v => isNum(v) ? C.f0(v) : '—';
const f1 = v => isNum(v) ? C.f1(v) : '—';
const f2 = v => isNum(v) ? C.f2(v) : '—';
const tick = () => new Promise(r => setTimeout(r, 0));
function fmtDur(s) { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`; }
function fmtClock(sec) { return fmtDur(sec); }
function fmtPaceMin(min) { if (!isNum(min)) return '—'; const m = Math.floor(min), s = Math.round((min - m) * 60); return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`; }
function paceOf(sp, sport) { // devuelve texto de ritmo/velocidad
  if (!isNum(sp) || sp <= 0) return '—';
  if (sport === 'run') return fmtPaceMin(1000 / sp / 60) + ' /km';
  if (sport === 'swim') return fmtPaceMin(100 / sp / 60) + ' /100m';
  return f1(sp * 3.6) + ' km/h';
}
function dateStr(ms) { return new Date(ms).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function rangeStr(wk) { const a = C.keyToDate(wk), b = C.keyToDate(C.addDays(wk, 6)); const o = { day: 'numeric', month: 'short' }; return a.toLocaleDateString('es', o) + ' – ' + b.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }); }
function toast(msg, ms = 4500) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast._t); toast._t = setTimeout(() => t.style.display = 'none', ms); }
function loadProfile() { try { return JSON.parse(localStorage.getItem('tl2.profile') || '{}'); } catch (e) { return {}; } }
function saveProfile(p) { try { localStorage.setItem('tl2.profile', JSON.stringify(p)); } catch (e) { } }

/* ---------- almacenamiento (IndexedDB) ---------- */
const DB = {
  open() { return new Promise((res, rej) => { const r = indexedDB.open('threshold-analytics', 1); r.onupgradeneeded = () => r.result.createObjectStore('acts', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  run(mode, fn) { return new Promise((res, rej) => { const t = state.db.transaction('acts', mode), rq = fn(t.objectStore('acts')); t.oncomplete = () => res(rq ? rq.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); },
  all() { return this.run('readonly', s => s.getAll()); },
  put(rec) { return this.run('readwrite', s => s.put(rec)); },
  del(id) { return this.run('readwrite', s => s.delete(id)); },
  clear() { return this.run('readwrite', s => s.clear()); }
};
async function persist(act) { if (!state.persist) return; try { await DB.put({ id: act.id, name: act.name, sport: act.sport, start: act.start, rs: act.rs, rr: act.rr }); } catch (e) { state.persist = false; toast('No se pudo guardar en este navegador; los datos solo durarán esta sesión.'); } }

/* ---------- modelo ---------- */
function build(rec) {
  const A = C.analyze(rec.rs, rec.sport, rec.rr, state.profile);
  return { id: rec.id, name: rec.name, sport: rec.sport, start: rec.start, day: C.dayKey(rec.start), rs: rec.rs, rr: rec.rr, A };
}
function sortActs() { state.acts.sort((a, b) => a.start - b.start); }
function recompute() { state.acts = state.acts.map(a => build(a)); sortActs(); }
function detectSport(rs) { const sp = Array.from(rs.s.sp).filter(v => isNum(v) && v > 0.5); const m = C.mean(sp); if (!isNum(m)) return 'other'; return m > 5.5 ? 'bike' : m > 1.8 ? 'run' : 'other'; }

async function importFiles(fileList) {
  const files = [...fileList]; if (!files.length) return;
  const added = [], dups = [], errs = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i]; toast(`Analizando ${i + 1}/${files.length}: ${f.name}`, 60000); await tick();
    try {
      let p;
      if (/\.fit$/i.test(f.name)) p = C.parseFit(await f.arrayBuffer());
      else if (/\.(gpx|tcx)$/i.test(f.name)) p = C.parseXml(await f.text(), f.name);
      else throw new Error('Formato no compatible (usa .fit, .gpx o .tcx)');
      const rs = C.resample(p.points), sport = p.sport || detectSport(rs);
      const id = sport + '_' + Math.round(rs.start / 1000) + '_' + rs.n;
      if (state.acts.some(a => a.id === id)) { dups.push(f.name); continue; }
      const act = build({ id, name: f.name, sport, start: rs.start, rs, rr: p.rr || [] });
      state.acts.push(act); added.push(act); await persist(act);
    } catch (e) { errs.push(`${f.name}: ${e.message}`); }
  }
  sortActs();
  let msg = `${added.length} actividad(es) importada(s).`;
  if (dups.length) msg += `\n${dups.length} ya estaba(n) cargada(s).`;
  if (errs.length) msg += '\nNo se pudieron leer:\n' + errs.join('\n');
  toast(msg, errs.length ? 9000 : 4000);
  if (added.length) {
    const last = added.slice().sort((a, b) => b.start - a.start)[0];
    state.sel = last.id; state.wk = C.weekStartKey(last.start);
    state.tab = added.length === 1 ? 'actividad' : 'semana';
  }
  render();
}

/* ---------- vistas ---------- */
function setTab(t) { state.tab = t; render(); window.scrollTo(0, 0); }
function dropzone(extra) {
  return `<div class="drop" id="drop"><b>Arrastra aquí tus archivos o pulsa para elegirlos</b><p>Formatos .fit, .gpx y .tcx. Puedes subir una actividad o todas las de la semana a la vez.${extra || ''}</p></div>`;
}
function insHtml(list) {
  const tag = { ok: 'Bien', warn: 'Atención', bad: 'Alerta', info: 'Dato' };
  return list.map(i => `<div class="ins ${i.level}"><span class="tag">${tag[i.level]}</span><b>${esc(i.title)}</b>${esc(i.text)}</div>`).join('');
}
const GLOSSARY = `<details><summary>¿Qué significa cada métrica?</summary>
<p><b>Carga:</b> estrés total de la sesión. 100 equivale a 1 hora a tu umbral. Se calcula con potencia (ciclismo con FTP) o con frecuencia cardíaca (TRIMP de Banister).</p>
<p><b>Intensidad relativa:</b> qué tan cerca de tu umbral trabajaste (1,0 = umbral).</p>
<p><b>Acople/desacople cardíaco:</b> cuánto sube la FC entre la primera y la segunda mitad con la misma potencia o velocidad. Menos de 5 % indica buena base aeróbica; más de 10 % indica fatiga, calor o exceso de intensidad.</p>
<p><b>Factor de eficiencia:</b> potencia (o velocidad) por latido. Si baja con el tiempo en esfuerzos comparables puede indicar fatiga.</p>
<p><b>Recuperación cardíaca:</b> cuántos latidos baja la FC en 60 s tras un esfuerzo exigente al detenerte o rodar suave.</p>
<p><b>Variabilidad cardíaca (R-R):</b> RMSSD y SDNN miden la variación entre latidos; DFA α1 por debajo de 0,75 se asocia con haber pasado el umbral aeróbico. Solo disponible si el archivo trae intervalos R-R.</p>
<p><b>CTL / ATL / TSB:</b> forma crónica (42 d), fatiga aguda (7 d) y balance entre ambas. Necesitan semanas de histórico para ser fiables.</p>
<p><b>ACWR:</b> carga de la semana frente a la media de las últimas 4 semanas. Entre 0,8 y 1,3 es la zona óptima.</p>
<p class="muted">Todo son estimaciones orientativas a partir de tus archivos; no sustituyen la valoración de un entrenador o médico.</p></details>`;

function viewActividad() {
  if (!state.acts.length) return dropzone() + `<div class="card"><h3>Cómo funciona</h3><p class="muted">Sube un archivo de entrenamiento y obtendrás conclusiones sobre intensidad, fatiga, recuperación, acople cardíaco y variabilidad cardíaca. Si subes varios días, la pestaña <b>Semana</b> resume la carga, la forma y la fatiga de la semana. Antes, ajusta tu <a href="#" data-go="perfil">Perfil</a> (FC máxima, reposo, umbral y FTP) para que las zonas sean exactas.</p></div>`;
  const act = state.acts.find(a => a.id === state.sel) || state.acts[state.acts.length - 1]; state.sel = act.id;
  const A = act.A, opts = state.acts.slice().reverse().map(a => `<option value="${a.id}" ${a.id === act.id ? 'selected' : ''}>${SPORT_ICON[a.sport]} ${esc(new Date(a.start).toLocaleDateString('es', { day: 'numeric', month: 'short' }))} · ${fmtDur(a.A.dur)} · ${esc(a.name)}</option>`).join('');
  const sports = Object.entries(C.SPORTS).map(([k, v]) => `<option value="${k}" ${k === act.sport ? 'selected' : ''}>${v}</option>`).join('');
  const kp = (l, v, s) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s || '&nbsp;'}</div></div>`;
  const kpis = [
    kp('Duración', fmtDur(A.dur), A.elapsed - A.dur > 120 ? 'transcurrido ' + fmtDur(A.elapsed) : ''),
    A.hasSp ? kp('Distancia', f1(A.dist / 1000) + ' km', paceOf(A.avgSpeed, act.sport)) : '',
    A.hasHr ? kp('FC media / máx', f0(A.avgHr) + ' / ' + f0(A.maxHr), 'ppm') : '',
    A.hasPw ? kp('Potencia', f0(A.avgPw) + ' W', 'NP ' + f0(A.np) + ' W') : '',
    isNum(A.load) ? kp('Carga', f0(A.load), A.loadMethod.split(' ')[0]) : '',
    isNum(A.IF) ? kp('Intensidad rel.', f2(A.IF), '1,0 = umbral') : '',
    isNum(A.ef) ? kp('Eficiencia', f1(A.ef), A.outType === 'pw' ? 'W por latido' : 'm/min por latido') : '',
    isNum(A.ascent) ? kp('Desnivel +', f0(A.ascent) + ' m', '') : ''
  ].join('');
  const zones = A.zones ? (() => {
    const tot = A.zones.reduce((x, y) => x + y, 0) || 1;
    return `<div class="zbar">${A.zones.map((v, i) => `<div style="width:${v / tot * 100}%;background:${ZCOL[i]}"></div>`).join('')}</div>` +
      A.zones.map((v, i) => `<div class="zrow"><span>${C.ZN[i]}</span><div><div class="b" style="width:${v / tot * 100}%;background:${ZCOL[i]};min-width:2px"></div></div><span>${fmtDur(v)} · ${f0(v / tot * 100)} %</span></div>`).join('') +
      `<div class="hint">Según FC umbral ${A.profile.lthr} ppm (Z1 &lt;81 %, Z2 81-90 %, Z3 90-94 %, Z4 94-100 %, Z5 ≥100 %).</div>`;
  })() : '<div class="empty">Sin frecuencia cardíaca en este archivo.</div>';
  const D = A.decoupling;
  const dec = D && D.valid ? `<table><tr><th></th><th>1ª mitad</th><th>2ª mitad</th><th>Cambio</th></tr>
    <tr><td>FC media</td><td>${f0(D.e1.hr)} ppm</td><td>${f0(D.e2.hr)} ppm</td><td>${D.e2.hr - D.e1.hr >= 0 ? '+' : ''}${f1(D.e2.hr - D.e1.hr)}</td></tr>
    <tr><td>${A.outType === 'pw' ? 'Potencia (NP)' : 'Velocidad'}</td><td>${A.outType === 'pw' ? f0(D.e1.o) + ' W' : paceOf(D.e1.o, act.sport)}</td><td>${A.outType === 'pw' ? f0(D.e2.o) + ' W' : paceOf(D.e2.o, act.sport)}</td><td>${f1((D.e2.o - D.e1.o) / D.e1.o * 100)} %</td></tr>
    <tr><td><b>Desacople</b></td><td colspan="3"><b>${f1(D.pct)} %</b> ${D.steady ? '' : '<span class="pill">sesión variable: poco fiable</span>'}</td></tr></table>
    <div class="hint">Se omiten los primeros minutos de calentamiento (${f0(D.segMin)} min analizados).</div>` : `<div class="empty">${D && D.reason ? esc(D.reason) : 'No hay datos suficientes (FC y potencia/velocidad).'}</div>`;
  const H = A.hrv;
  const hrvCard = H ? `<div class="card"><h2>Variabilidad cardíaca durante la sesión</h2><div class="kpis" style="margin-bottom:10px">
    ${kp('RMSSD', f0(H.whole.rmssd) + ' ms', 'tercio 1: ' + (H.first ? f0(H.first.rmssd) : '—') + ' → 3: ' + (H.last ? f0(H.last.rmssd) : '—'))}
    ${kp('SDNN', f0(H.whole.sdnn) + ' ms', '')}${kp('pNN50', f1(H.whole.pnn50) + ' %', '')}
    ${kp('DFA α1 mediano', isNum(H.alphaMedian) ? f1(H.alphaMedian) : '—', isNum(H.pctBelow075) ? f0(H.pctBelow075) + ' % del tiempo &lt; 0,75' : '')}</div>
    <canvas id="cHrv" style="height:200px"></canvas><div class="hint">DFA α1 en ventanas de 2 min (versión simplificada). Por debajo de 0,75 ≈ por encima del umbral aeróbico; por debajo de 0,5, esfuerzo muy alto. ${H.artifactPct > 0.5 ? 'Latidos descartados por artefactos: ' + f1(H.artifactPct) + ' %.' : ''}</div></div>`
    : '';
  const hist = state.acts.filter(a => a.start <= act.start);
  return `<div class="row sb"><div><h3>${SPORT_ICON[act.sport]} ${C.SPORTS[act.sport]} · ${esc(dateStr(act.start))}</h3><div class="muted">${esc(act.name)}</div></div>
    <div class="row"><select id="selAct" style="width:auto;max-width:320px">${opts}</select><select id="selSport" style="width:auto" title="Cambiar deporte">${sports}</select><button class="btn danger sm" id="delAct">Eliminar</button></div></div>
    <div class="kpis">${kpis}</div>
    <div class="card"><h2>Conclusiones de la sesión</h2>${insHtml(C.activityInsights(act, hist))}${GLOSSARY}</div>
    <div class="card"><h2>Frecuencia cardíaca y esfuerzo</h2><canvas id="cMain"></canvas></div>
    <div class="grid2"><div class="card"><h2>Tiempo en zonas de FC</h2>${zones}</div><div class="card"><h2>Acople cardíaco por mitades</h2>${dec}</div></div>
    ${hrvCard}
    <div class="card"><h2>Subir más actividades</h2>${dropzone()}</div>`;
}

function viewSemana() {
  if (!state.acts.length) return dropzone();
  if (!state.wk) state.wk = C.weekStartKey(state.acts[state.acts.length - 1].start);
  const W = C.weekSummary(state.acts, state.wk);
  const kp = (l, v, s) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s || '&nbsp;'}</div></div>`;
  const kpis = [
    kp('Sesiones', W.n, ''), kp('Tiempo', f1(W.dur / 3600) + ' h', W.prevDur ? 'sem. anterior ' + f1(W.prevDur / 3600) + ' h' : ''),
    kp('Distancia', f1(W.dist / 1000) + ' km', ''), kp('Carga', f0(W.load), isNum(W.loadChange) ? (W.loadChange >= 0 ? '+' : '') + f0(W.loadChange) + (W.partial ? ' % vs mismos días ant.' : ' % vs anterior') : ''),
    kp('ACWR', isNum(W.acwr) ? f2(W.acwr) : '—', W.pmc ? (W.acwrReliable ? 'óptimo 0,8-1,3' : 'provisional') : ''),
    kp('Forma (TSB)', isNum(W.tsb) ? f0(W.tsb) : '—', isNum(W.ctl) ? 'CTL ' + f0(W.ctl) + ' · ATL ' + f0(W.atl) : ''),
    kp('Monotonía', isFinite(W.monotony) ? f2(W.monotony) : '—', W.restDays + ' descanso(s)' + (W.partial ? ' · ' + W.elapsed + '/7 días' : ''))
  ].join('');
  const z = W.zones, zt = W.zoneTotal || 1;
  const zoneHtml = W.zoneTotal ? `<div class="zbar">${z.map((v, i) => `<div style="width:${v / zt * 100}%;background:${ZCOL[i]}"></div>`).join('')}</div>` +
    z.map((v, i) => `<div class="zrow"><span>${C.ZN[i]}</span><div><div class="b" style="width:${v / zt * 100}%;background:${ZCOL[i]};min-width:2px"></div></div><span>${fmtDur(v)} · ${f0(v / zt * 100)} %</span></div>`).join('') : '<div class="empty">Sin FC en esta semana.</div>';
  const rows = W.acts.slice().reverse().map(a => `<tr class="click" data-open="${a.id}"><td>${esc(new Date(a.start).toLocaleDateString('es', { weekday: 'short', day: 'numeric' }))}</td><td>${SPORT_ICON[a.sport]} ${C.SPORTS[a.sport]}</td><td>${fmtDur(a.A.dur)}</td><td>${a.A.hasSp ? f1(a.A.dist / 1000) + ' km' : '—'}</td><td>${f0(a.A.avgHr)}</td><td>${f0(a.A.load)}</td><td>${f2(a.A.IF)}</td><td>${a.A.decoupling && a.A.decoupling.valid ? f1(a.A.decoupling.pct) + ' %' : '—'}</td></tr>`).join('');
  return `<div class="row sb"><div class="row"><button class="btn sm" id="wkPrev">◀</button><h3 style="margin:0">Semana ${esc(rangeStr(state.wk))}</h3><button class="btn sm" id="wkNext">▶</button></div>
    <div class="row"><button class="btn sm" id="wkNow">Última semana con datos</button></div></div>
    <div class="kpis">${kpis}</div>
    <div class="card"><h2>Conclusiones de la semana</h2>${insHtml(C.weekInsights(W, state.profile))}${GLOSSARY}</div>
    <div class="grid2"><div class="card"><h2>Carga por día</h2><canvas id="cDaily"></canvas></div>
    <div class="card"><h2>Forma, fatiga y balance (CTL · ATL · TSB)</h2><canvas id="cPmc"></canvas><div class="hint">${W.pmc && W.historyDays < 42 ? 'Con menos de ~6 semanas de histórico el modelo es provisional. ' : ''}Sube más semanas anteriores para afinarlo.</div></div></div>
    <div class="grid2"><div class="card"><h2>Distribución de intensidad (tiempo)</h2>${zoneHtml}</div>
    <div class="card"><h2>Sesiones de la semana</h2><div class="tw"><table><tr><th>Día</th><th>Deporte</th><th>Tiempo</th><th>Dist.</th><th>FC</th><th>Carga</th><th>Int.</th><th>Acople</th></tr>${rows || '<tr><td colspan="8" class="empty">Sin sesiones</td></tr>'}</table></div></div></div>
    <div class="card"><h2>Subir más actividades</h2>${dropzone(' Para un análisis fiable de forma y fatiga sube también las 4-6 semanas anteriores.')}</div>`;
}

function viewHistorial() {
  if (!state.acts.length) return dropzone();
  const rows = state.acts.slice().reverse().map(a => `<tr class="click" data-open="${a.id}"><td>${esc(new Date(a.start).toLocaleDateString('es'))}</td><td>${SPORT_ICON[a.sport]} ${C.SPORTS[a.sport]}</td><td>${fmtDur(a.A.dur)}</td><td>${a.A.hasSp ? f1(a.A.dist / 1000) : '—'}</td><td>${f0(a.A.avgHr)}</td><td>${f0(a.A.load)}</td><td>${f2(a.A.IF)}</td><td>${a.A.decoupling && a.A.decoupling.valid ? f1(a.A.decoupling.pct) + ' %' : '—'}</td><td>${a.A.hrv ? 'sí' : '—'}</td><td class="muted">${esc(a.name)}</td></tr>`).join('');
  return `<div class="card"><div class="row sb" style="margin-bottom:10px"><h2 style="margin:0">Historial (${state.acts.length} actividades)</h2><div class="row"><button class="btn sm" id="expCsv">Exportar CSV</button><button class="btn sm danger" id="clearAll">Borrar todo</button></div></div>
    <div class="tw"><table><tr><th>Fecha</th><th>Deporte</th><th>Tiempo</th><th>Km</th><th>FC</th><th>Carga</th><th>Int.</th><th>Acople</th><th>R-R</th><th>Archivo</th></tr>${rows}</table></div>
    <div class="hint">Tus actividades se guardan solo en este navegador/dispositivo. Exporta el CSV para conservar un resumen.</div></div>${dropzone()}`;
}

function viewPerfil() {
  const p = state.profile;
  return `<div class="card"><h2>Tu perfil fisiológico</h2><p class="muted" style="margin-top:0">Estos valores definen tus zonas y la carga. Al guardar se recalculan todas las actividades.</p>
    <div class="form"><div><label>FC máxima (ppm)</label><input type="number" id="p_hrMax" value="${p.hrMax}" min="120" max="230"></div>
    <div><label>FC en reposo (ppm)</label><input type="number" id="p_hrRest" value="${p.hrRest}" min="30" max="100"></div>
    <div><label>FC umbral / LTHR (ppm, opcional)</label><input type="number" id="p_lthr" value="${p.lthrAuto ? '' : p.lthr}" placeholder="auto: ${Math.round(p.hrMax * 0.9)}" min="100" max="220"></div>
    <div><label>FTP ciclismo (W, opcional)</label><input type="number" id="p_ftp" value="${p.ftp || ''}" placeholder="sin FTP: carga por FC" min="50" max="600"></div>
    <div><label>Sexo (para el cálculo TRIMP)</label><select id="p_sex"><option value="m" ${p.sex !== 'f' ? 'selected' : ''}>Hombre</option><option value="f" ${p.sex === 'f' ? 'selected' : ''}>Mujer</option></select></div></div>
    <div class="row" style="margin-top:14px"><button class="btn primary" id="saveProf">Guardar y recalcular</button></div>
    <p class="hint">Consejo: tu FC umbral es aproximadamente la FC media de un esfuerzo máximo sostenido de 30 min (últimos 20 min de un test de 30 min). Sin ella, se usa el 90 % de tu FC máxima.</p></div>`;
}

/* ---------- gráficos ---------- */
function drawCharts() {
  if (state.tab === 'actividad') {
    const act = state.acts.find(a => a.id === state.sel); if (!act) return;
    const A = act.A, s = act.rs.s;
    const hr = C.downsample(s.hr, 500), step = hr.step, N = hr.v.length, x = Array.from({ length: N }, (_, i) => i * step);
    const series = [{ data: hr.v, color: '#ef4444', label: 'FC (ppm)', axis: 'l', fmt: v => Math.round(v) }];
    let yr;
    if (A.hasPw) { series.push({ data: C.downsample(s.pw, 500).v, color: '#2563eb', label: 'Potencia (W)', axis: 'r', fmt: v => Math.round(v) }); yr = { min: 0, fmt: v => Math.round(v) }; }
    else if (A.hasSp) {
      const sp = C.downsample(s.sp, 500).v;
      if (act.sport === 'run') { series.push({ data: sp.map(v => isNum(v) && v > 0.9 ? Math.min(12, 1000 / v / 60) : NaN), color: '#2563eb', label: 'Ritmo (min/km)', axis: 'r', fmt: fmtPaceMin }); yr = { invert: true, fmt: fmtPaceMin, max: 9, min: 2.5 }; }
      else if (act.sport === 'swim') { series.push({ data: sp.map(v => isNum(v) && v > 0.2 ? Math.min(5, 100 / v / 60) : NaN), color: '#2563eb', label: 'Ritmo (min/100 m)', axis: 'r', fmt: fmtPaceMin }); yr = { invert: true, fmt: fmtPaceMin }; }
      else { series.push({ data: sp.map(v => isNum(v) ? v * 3.6 : NaN), color: '#2563eb', label: 'Velocidad (km/h)', axis: 'r', fmt: v => f1(v) }); yr = { min: 0, fmt: v => Math.round(v) }; }
    }
    const el = $('cMain'); if (el) Charts.line(el, { x, xFmt: fmtClock, series, yl: { min: A.hasHr ? Math.max(40, Math.floor(C.mean(hr.v.filter(isNum)) - 60)) : undefined }, yr, empty: 'Este archivo no trae FC ni potencia/velocidad' });
    const H = A.hrv, hv = $('cHrv');
    if (H && hv) Charts.line(hv, { x: H.dfa.map(d => d.t), xFmt: fmtClock, series: [{ data: H.dfa.map(d => d.a), color: '#7c3aed', label: 'DFA α1', axis: 'l', fmt: v => (Math.round(v * 100) / 100).toLocaleString('es') }], yl: { min: 0, max: 1.5, fmt: v => (Math.round(v * 10) / 10).toLocaleString('es') }, bands: [{ from: 0.5, to: 0.75, color: 'rgba(124,58,237,.12)' }], empty: 'Muy pocos datos R-R' });
  } else if (state.tab === 'semana' && state.acts.length) {
    const W = C.weekSummary(state.acts, state.wk), lab = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    const el = $('cDaily'); if (el) Charts.bars(el, { labels: lab, values: W.daily, color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), fmt: v => Math.round(v), empty: 'Sin carga registrada esta semana' });
    const pe = $('cPmc');
    if (pe && W.pmc) {
      const end = C.addDays(state.wk, 6), ser = W.pmc.series.filter(r => r.day <= end).slice(-90);
      Charts.line(pe, { x: ser.map(r => r.day), xFmt: d => C.keyToDate(d).toLocaleDateString('es', { day: 'numeric', month: 'short' }),
        series: [{ data: ser.map(r => r.ctl), color: '#2563eb', label: 'CTL forma', fmt: v => Math.round(v) }, { data: ser.map(r => r.atl), color: '#ef4444', label: 'ATL fatiga', fmt: v => Math.round(v) }, { data: ser.map(r => r.tsb), color: '#16a34a', label: 'TSB balance', fmt: v => Math.round(v) }], empty: 'Sin datos de carga' });
    } else if (pe) Charts.line(pe, { x: [], series: [], empty: 'Sin datos de carga' });
  }
}

/* ---------- render y eventos ---------- */
function render() {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.t === state.tab));
  const v = { actividad: viewActividad, semana: viewSemana, historial: viewHistorial, perfil: viewPerfil }[state.tab];
  $('main').innerHTML = v();
  bind(); requestAnimationFrame(drawCharts);
}
function bind() {
  document.querySelectorAll('[data-go]').forEach(a => a.onclick = e => { e.preventDefault(); setTab(a.dataset.go); });
  const drop = $('drop'); if (drop) drop.onclick = () => $('files').click();
  document.querySelectorAll('[data-open]').forEach(r => r.onclick = () => { state.sel = r.dataset.open; setTab('actividad'); });
  const sa = $('selAct'); if (sa) sa.onchange = () => { state.sel = sa.value; render(); };
  const ss = $('selSport'); if (ss) ss.onchange = async () => { const a = state.acts.find(x => x.id === state.sel); a.sport = ss.value; Object.assign(a, build(a)); await persist(a); render(); };
  const da = $('delAct'); if (da) da.onclick = async () => { if (!confirm('¿Eliminar esta actividad?')) return; const id = state.sel; state.acts = state.acts.filter(a => a.id !== id); try { if (state.persist) await DB.del(id); } catch (e) { } state.sel = null; render(); };
  const wp = $('wkPrev'); if (wp) wp.onclick = () => { state.wk = C.addDays(state.wk, -7); render(); };
  const wn = $('wkNext'); if (wn) wn.onclick = () => { state.wk = C.addDays(state.wk, 7); render(); };
  const wo = $('wkNow'); if (wo) wo.onclick = () => { state.wk = C.weekStartKey(state.acts[state.acts.length - 1].start); render(); };
  const sp = $('saveProf'); if (sp) sp.onclick = () => {
    const g = id => +$(id).value;
    const p = { hrMax: g('p_hrMax'), hrRest: g('p_hrRest'), lthr: g('p_lthr') || 0, ftp: g('p_ftp') || 0, sex: $('p_sex').value };
    if (!(p.hrMax > p.hrRest + 20)) { toast('La FC máxima debe ser bastante mayor que la de reposo.'); return; }
    state.profile = C.normProfile(p); saveProfile(p); recompute(); toast('Perfil guardado. Actividades recalculadas.'); render();
  };
  const ex = $('expCsv'); if (ex) ex.onclick = () => {
    const q = v => '"' + String(v).replace(/"/g, '""') + '"';
    const head = 'fecha,deporte,duracion_min,distancia_km,fc_media,fc_max,potencia_np,carga,intensidad_rel,desacople_pct,archivo';
    const n1 = v => isNum(v) ? (Math.round(v * 10) / 10).toString() : '', n0 = v => isNum(v) ? Math.round(v).toString() : '';
    const rows = state.acts.map(a => [C.dayKey(a.start), C.SPORTS[a.sport], n1(a.A.dur / 60), n1(a.A.dist / 1000), n0(a.A.avgHr), n0(a.A.maxHr), n0(a.A.np), n1(a.A.load), isNum(a.A.IF) ? a.A.IF.toFixed(2) : '', a.A.decoupling && a.A.decoupling.valid ? n1(a.A.decoupling.pct) : '', q(a.name)].join(','));
    const url = URL.createObjectURL(new Blob([head + '\n' + rows.join('\n')], { type: 'text/csv' })); const l = document.createElement('a'); l.href = url; l.download = 'actividades.csv'; l.click(); URL.revokeObjectURL(url);
  };
  const ca = $('clearAll'); if (ca) ca.onclick = async () => { if (!confirm('¿Borrar todas las actividades? No se puede deshacer.')) return; state.acts = []; state.sel = null; try { if (state.persist) await DB.clear(); } catch (e) { } render(); };
}

document.querySelectorAll('#nav button').forEach(b => b.onclick = () => setTab(b.dataset.t));
$('upload').onclick = () => $('files').click();
$('files').onchange = e => { importFiles(e.target.files); e.target.value = ''; };
let dragN = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragN++; $('over').style.display = 'flex'; } });
window.addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('over').style.display = 'none'; });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('over').style.display = 'none'; if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });
window.addEventListener('resize', () => { clearTimeout(window._rt); window._rt = setTimeout(drawCharts, 120); });
matchMedia('(prefers-color-scheme:dark)').addEventListener('change', () => render());

let deferred;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('install').style.display = 'inline-block'; });
$('install').onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('install').style.display = 'none'; };
window.addEventListener('appinstalled', () => $('install').style.display = 'none');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });

(async function init() {
  try {
    if (!window.indexedDB) throw new Error('sin IndexedDB');
    state.db = await DB.open();
    const recs = await DB.all(), bad = [];
    for (const r of recs) { try { state.acts.push(build(r)); } catch (e) { bad.push(r.id); } }
    sortActs();
    if (state.acts.length) { const l = state.acts[state.acts.length - 1]; state.sel = l.id; state.wk = C.weekStartKey(l.start); }
  } catch (e) { state.persist = false; }
  window.__state = state; // para depuración
  render();
})();
})();
