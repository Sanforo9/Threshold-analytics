(() => {
'use strict';
const C = Core, $ = id => document.getElementById(id), isNum = C.isNum;
const state = { acts: [], athletes: [], cur: null, tab: 'actividad', sel: null, wk: null, db: null, persist: true, pending: null, tAct: null, tTest: 'auto', tStep: null };
const SPORT_ICON = { run: '🏃', bike: '🚴', swim: '🏊', other: '🏋️' };
const ZCOL = ['var(--z1)', 'var(--z2)', 'var(--z3)', 'var(--z4)', 'var(--z5)'];
const PZCOL = ['var(--z1)', 'var(--z2)', 'var(--z3)', 'var(--z4)', 'var(--z5)', '#c026d3', '#7c3aed'];

/* ---------- utilidades ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f0 = v => isNum(v) ? C.f0(v) : '—';
const f1 = v => isNum(v) ? C.f1(v) : '—';
const f2 = v => isNum(v) ? C.f2(v) : '—';
const tick = () => new Promise(r => setTimeout(r, 0));
function fmtDur(s) { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`; }
function fmtPaceMin(min) { if (!isNum(min)) return '—'; const m = Math.floor(min), s = Math.round((min - m) * 60); return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`; }
function paceOf(sp, sport) {
  if (!isNum(sp) || sp <= 0) return '—';
  if (sport === 'run') return fmtPaceMin(1000 / sp / 60) + ' /km';
  if (sport === 'swim') return fmtPaceMin(100 / sp / 60) + ' /100m';
  return f1(sp * 3.6) + ' km/h';
}
function dateStr(ms) { return new Date(ms).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function rangeStr(wk) { const a = C.keyToDate(wk), b = C.keyToDate(C.addDays(wk, 6)); return a.toLocaleDateString('es', { day: 'numeric', month: 'short' }) + ' – ' + b.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }); }
function toast(msg, ms = 4500) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast._t); toast._t = setTimeout(() => t.style.display = 'none', ms); }
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
const saveAthletes = () => { LS.set('tl3.athletes', state.athletes); LS.set('tl3.cur', state.cur); };

/* ---------- almacenamiento (IndexedDB) ---------- */
const DB = {
  open() { return new Promise((res, rej) => { const r = indexedDB.open('threshold-analytics', 1); r.onupgradeneeded = () => r.result.createObjectStore('acts', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  run(mode, fn) { return new Promise((res, rej) => { const t = state.db.transaction('acts', mode), rq = fn(t.objectStore('acts')); t.oncomplete = () => res(rq ? rq.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); },
  all() { return this.run('readonly', s => s.getAll()); },
  put(rec) { return this.run('readwrite', s => s.put(rec)); },
  delMany(ids) { return this.run('readwrite', s => { ids.forEach(i => s.delete(i)); }); },
  clear() { return this.run('readwrite', s => s.clear()); }
};
async function persist(a) { if (!state.persist) return; try { await DB.put({ id: a.id, name: a.name, sport: a.sport, start: a.start, rs: a.rs, rr: a.rr, ath: a.ath, obs: a.obs }); } catch (e) { state.persist = false; toast('No se pudo guardar en este navegador; los datos solo durarán esta sesión.'); } }
async function removeActs(ids) { state.acts = state.acts.filter(a => !ids.includes(a.id)); if (state.persist && ids.length) { try { await DB.delMany(ids); } catch (e) { } } }

/* ---------- modelo ---------- */
const curAth = () => state.athletes.find(a => a.id === state.cur) || null;
const mine = () => state.acts.filter(a => a.ath === state.cur).sort((a, b) => a.start - b.start);
function observedOf(athId) { return Math.max(0, ...state.acts.filter(a => a.ath === athId).map(a => a.obs || 0)); }
function profileOf(athId) { const at = state.athletes.find(a => a.id === athId); return C.normProfile(at ? at.profile : {}, observedOf(athId)); }
function analyzeAthlete(athId) { const P = profileOf(athId); for (const a of state.acts) if (a.ath === athId) a.A = C.analyze(a.rs, a.sport, a.rr, P); }
function detectSport(rs) { const sp = Array.from(rs.s.sp).filter(v => isNum(v) && v > 0.5); const m = C.mean(sp); if (!isNum(m)) return 'other'; return m > 5.5 ? 'bike' : m > 1.8 ? 'run' : 'other'; }
function selectLatest() { const l = mine(); if (l.length) { state.sel = l[l.length - 1].id; state.wk = C.weekStartKey(l[l.length - 1].start); } else { state.sel = null; state.wk = null; } }
function hasEstimates(list) { return list.some(a => a.A && a.A.profile && ((a.A.hasHr && (a.A.profile.hrMaxAuto || a.A.profile.lthrAuto || a.A.profile.hrRestAuto)) || (a.sport === 'bike' && a.A.hasPw && !a.A.profile.ftp))); }

/* ---------- lectura de archivos y cuadro de datos ---------- */
async function openFiles(fileList) {
  const files = [...fileList]; if (!files.length) return;
  const items = [], errs = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i]; toast(`Leyendo ${i + 1}/${files.length}: ${f.name}`, 60000); await tick();
    try {
      let p;
      if (/\.fit$/i.test(f.name)) p = C.parseFit(await f.arrayBuffer());
      else if (/\.(gpx|tcx)$/i.test(f.name)) p = C.parseXml(await f.text(), f.name);
      else throw new Error('Formato no compatible (usa .fit, .gpx o .tcx)');
      const rs = C.resample(p.points), s = rs.s;
      const cov = a => { let c = 0; for (let k = 0; k < a.length; k++) if (isNum(a[k])) c++; return c / a.length; };
      items.push({ name: f.name, sport: p.sport || detectSport(rs), auto: !!p.sport, rs, rr: p.rr || [], obs: C.observedMaxHr(rs), hasHr: cov(s.hr) > 0.5, hasPw: cov(s.pw) > 0.5 && C.mean(s.pw) > 5, hasRr: (p.rr || []).length > 120 });
    } catch (e) { errs.push(`${f.name}: ${e.message}`); }
  }
  $('toast').style.display = 'none';
  if (!items.length) { toast('No se pudo leer ningún archivo.\n' + errs.join('\n'), 9000); return; }
  state.pending = { items, errs };
  showImportModal();
}
const num = id => { const v = parseFloat(($(id) || {}).value); return isFinite(v) ? v : 0; };
function fieldHtml(id, label, val, ph, min, max, hint, needed) {
  return `<div><label>${label} ${needed ? '<span class="need" id="n_' + id + '"></span>' : ''}</label><input type="number" id="${id}" value="${val || ''}" placeholder="${ph}" min="${min}" max="${max}"><div class="hint">${hint}</div></div>`;
}
function athleteFields(prof, ctx) { // ctx: {hr:boolean, ftp:boolean, obs:number}
  const p = prof || {};
  return `<div class="form">
    ${ctx.hr ? fieldHtml('m_hrMax', 'FC máxima (ppm)', p.hrMax, 'se estimará', 120, 230, 'La más alta en un esfuerzo máximo o test.' + (ctx.obs ? ' Si se deja vacía se usará el máximo observado en los archivos (' + Math.round(ctx.obs) + ').' : ' Vacía: se usará 190.'), true) : ''}
    ${ctx.hr ? fieldHtml('m_hrRest', 'FC en reposo (ppm)', p.hrRest, 'se estimará', 30, 100, 'Al despertar, tumbado y tranquilo. Vacía: se usará 60.', true) : ''}
    ${ctx.hr ? fieldHtml('m_lthr', 'FC umbral / LTHR (ppm)', p.lthr, 'se estimará', 100, 220, 'Media de los últimos 20 min de un test de 30 min a tope. Vacía: 90 % de la FC máx.', true) : ''}
    ${ctx.ftp ? fieldHtml('m_ftp', 'FTP ciclismo (W)', p.ftp, 'sin FTP', 50, 600, 'Aprox. 95 % de la potencia media de un test de 20 min. Vacía: la carga se calcula por FC.', true) : ''}
    <div><label>Sexo (cálculo TRIMP)</label><select id="m_sex"><option value="m" ${p.sex !== 'f' ? 'selected' : ''}>Hombre</option><option value="f" ${p.sex === 'f' ? 'selected' : ''}>Mujer</option></select><div class="hint">Solo ajusta el peso de la carga por FC.</div></div></div>`;
}
function showImportModal() {
  const P = state.pending, items = P.items;
  const needHr = items.some(i => i.hasHr), needFtp = items.some(i => i.sport === 'bike' && i.hasPw);
  const sel = state.cur || (state.athletes[0] && state.athletes[0].id) || '__new';
  const opts = state.athletes.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('') + `<option value="__new" ${sel === '__new' ? 'selected' : ''}>＋ Nuevo deportista…</option>`;
  const sports = k => Object.entries(C.SPORTS).map(([v, l]) => `<option value="${v}" ${v === k ? 'selected' : ''}>${l}</option>`).join('');
  const rows = items.map((i, n) => `<tr><td>${esc(i.name)}</td><td><select class="m_sport" data-i="${n}" style="width:auto;padding:4px 6px">${sports(i.sport)}</select></td><td>${fmtDur(i.rs.n)}</td><td><div class="fl">${i.hasHr ? '<span class="chip">FC</span>' : ''}${i.hasPw ? '<span class="chip">Potencia</span>' : ''}${i.hasRr ? '<span class="chip">R-R</span>' : ''}${isNum(i.rs.s.sp[Math.floor(i.rs.n / 2)]) ? '<span class="chip">Velocidad</span>' : ''}</div></td></tr>`).join('');
  $('modal').innerHTML = `<div class="mbg"><div class="modal">
    <h3>Sesiones a analizar (${items.length})</h3>
    <div class="muted">Indica de quién son y completa sus datos para que el análisis se ajuste a la realidad del deportista.</div>
    <div class="sec"><div class="tw"><table><tr><th>Archivo</th><th>Deporte</th><th>Duración</th><th>Datos</th></tr>${rows}</table></div>
    ${P.errs.length ? `<div class="ins bad"><b>No se pudieron leer</b>${P.errs.map(esc).join('<br>')}</div>` : ''}</div>
    <div class="sec"><b>Deportista</b><div class="form"><div><label>¿De quién son estas sesiones?</label><select id="m_ath">${opts}</select></div>
    <div id="m_newwrap" style="display:none"><label>Nombre del nuevo deportista</label><input id="m_name" placeholder="Ej. Laura Gómez"></div></div></div>
    <div class="sec"><b>Datos fisiológicos</b><div id="m_fields"></div>
    <div class="hint">Los campos vacíos se estimarán y el análisis lo indicará. Con los datos reales las zonas, la carga y las conclusiones serán más exactas.</div></div>
    <div class="row sb" style="margin-top:18px"><button class="btn" id="m_cancel">Cancelar</button><button class="btn primary" id="m_ok">Analizar sesiones</button></div></div></div>`;
  const obsPend = Math.max(...items.map(i => i.obs || 0));
  const fill = () => {
    const id = $('m_ath').value, at = state.athletes.find(a => a.id === id);
    $('m_newwrap').style.display = id === '__new' ? 'block' : 'none';
    const obs = Math.max(obsPend, id === '__new' ? 0 : observedOf(id));
    $('m_fields').innerHTML = athleteFields(at ? at.profile : {}, { hr: needHr, ftp: needFtp, obs });
    const upd = () => ['m_hrMax', 'm_hrRest', 'm_lthr', 'm_ftp'].forEach(f => { const el = $(f), n = $('n_' + f); if (el && n) n.textContent = el.value ? '' : '· falta, se estimará'; });
    ['m_hrMax', 'm_hrRest', 'm_lthr', 'm_ftp'].forEach(f => { const el = $(f); if (el) el.oninput = upd; }); upd();
  };
  $('m_ath').onchange = fill; fill();
  $('m_cancel').onclick = () => { state.pending = null; $('modal').innerHTML = ''; };
  $('m_ok').onclick = confirmImport;
}
async function confirmImport() {
  const P = state.pending; if (!P) return;
  let athId = $('m_ath').value, ath;
  const prof = { hrMax: num('m_hrMax'), hrRest: num('m_hrRest'), lthr: num('m_lthr'), ftp: num('m_ftp'), sex: $('m_sex').value };
  if (athId === '__new') { const name = $('m_name').value.trim(); if (!name) { toast('Escribe el nombre del nuevo deportista.'); return; } ath = { id: 'a' + Date.now(), name, profile: {} }; }
  else ath = state.athletes.find(a => a.id === athId);
  const err = checkProfile(prof); if (err) { toast(err); return; }
  const old = ath.profile || {};
  ath.profile = Object.assign({}, old, { sex: prof.sex });
  for (const k of ['hrMax', 'hrRest', 'lthr', 'ftp']) if ($('m_' + k)) ath.profile[k] = prof[k];
  if (athId === '__new') state.athletes.push(ath);
  state.cur = ath.id; saveAthletes();
  const items = P.items; document.querySelectorAll('.m_sport').forEach(s => { items[+s.dataset.i].sport = s.value; });
  $('modal').innerHTML = ''; state.pending = null;
  let added = 0, dups = 0; const fresh = [];
  for (const it of items) {
    const id = ath.id + '_' + it.sport + '_' + Math.round(it.rs.start / 1000) + '_' + it.rs.n;
    if (state.acts.some(a => a.id === id)) { dups++; continue; }
    const a = { id, name: it.name, sport: it.sport, start: it.rs.start, day: C.dayKey(it.rs.start), rs: it.rs, rr: it.rr, ath: ath.id, obs: it.obs, A: null };
    state.acts.push(a); fresh.push(a); added++;
  }
  toast('Analizando…', 60000); await tick();
  analyzeAthlete(ath.id);
  for (const a of fresh) await persist(a);
  let msg = `${added} sesión(es) analizada(s) para ${ath.name}.`; if (dups) msg += `\n${dups} ya estaba(n) cargada(s).`;
  toast(msg, 4000);
  if (fresh.length) {
    const last = fresh.slice().sort((a, b) => b.start - a.start)[0];
    state.sel = last.id; state.wk = C.weekStartKey(last.start); state.tab = fresh.length === 1 ? 'actividad' : 'semana';
    if (fresh.length === 1) { const td = testsOf(last); if (td.length && td[0].score >= 0.7) { state.tAct = last.id; state.tTest = 'auto'; state.tStep = null; state.tab = 'tests'; } }
  } else selectLatest();
  render();
}
function checkProfile(p) {
  if (p.hrMax && p.hrRest && p.hrMax < p.hrRest + 20) return 'La FC máxima debe ser bastante mayor que la de reposo.';
  if (p.hrMax && p.lthr && p.lthr > p.hrMax) return 'La FC umbral no puede superar la FC máxima.';
  if (p.lthr && p.hrRest && p.lthr < p.hrRest + 20) return 'La FC umbral parece demasiado baja respecto a la de reposo.';
  return '';
}

/* ---------- limpiar ---------- */
function openClear() {
  const at = curAth(), n = mine().length, total = state.acts.length;
  if (!state.acts.length && !state.athletes.length) { toast('No hay nada que limpiar.'); return; }
  $('modal').innerHTML = `<div class="mbg"><div class="modal" style="max-width:520px"><h3>Limpiar y empezar de nuevo</h3><div class="muted">Elige qué quieres quitar. Esta acción no se puede deshacer.</div>
    ${at ? `<button class="btn big" id="c_ses"><b>Limpiar las sesiones de ${esc(at.name)}</b><small>${n} sesión(es). Se conservan sus datos fisiológicos para subir nuevas sesiones.</small></button>
    <button class="btn big" id="c_ath"><b>Eliminar a ${esc(at.name)}</b><small>Borra al deportista, sus datos y sus sesiones.</small></button>` : ''}
    <button class="btn big danger" id="c_all"><b>Borrar todo</b><small>${total} sesión(es) y ${state.athletes.length} deportista(s). La app queda como nueva.</small></button>
    <div class="row" style="margin-top:10px"><button class="btn" id="c_no">Cancelar</button></div></div></div>`;
  const close = () => { $('modal').innerHTML = ''; };
  $('c_no').onclick = close;
  if (at) {
    $('c_ses').onclick = async () => { await removeActs(state.acts.filter(a => a.ath === at.id).map(a => a.id)); close(); state.sel = null; state.wk = null; state.tab = 'actividad'; toast('Sesiones de ' + at.name + ' eliminadas. Ya puedes subir nuevas.'); render(); };
    $('c_ath').onclick = async () => { await removeActs(state.acts.filter(a => a.ath === at.id).map(a => a.id)); state.athletes = state.athletes.filter(a => a.id !== at.id); state.cur = state.athletes[0] ? state.athletes[0].id : null; saveAthletes(); close(); selectLatest(); state.tab = 'actividad'; toast(at.name + ' eliminado.'); render(); };
  }
  $('c_all').onclick = async () => { try { if (state.persist) await DB.clear(); } catch (e) { } state.acts = []; state.athletes = []; state.cur = null; state.sel = null; state.wk = null; saveAthletes(); close(); state.tab = 'actividad'; toast('Todo borrado.'); render(); };
}

/* ---------- vistas ---------- */
function setTab(t) { state.tab = t; render(); window.scrollTo(0, 0); }
function dropzone(extra) { return `<div class="drop" id="drop"><b>Arrastra aquí tus archivos o pulsa para elegirlos</b><p>Formatos .fit, .gpx y .tcx. Puedes subir una sesión o las de varios días y semanas a la vez. Después te pediremos de quién son y sus datos (umbral, FTP…).${extra || ''}</p></div>`; }
function insHtml(list) {
  const tag = { ok: 'Bien', warn: 'Atención', bad: 'Alerta', info: 'Dato' };
  return list.map(i => `<div class="ins ${i.level}"><span class="tag">${tag[i.level]}</span><b>${esc(i.title)}</b>${esc(i.text)}</div>`).join('');
}
const GLOSSARY = `<details><summary>¿Qué significa cada métrica?</summary>
<p><b>Carga:</b> estrés total de la sesión. 100 equivale a 1 hora al umbral. Se calcula con potencia (ciclismo con FTP) o con frecuencia cardíaca (TRIMP de Banister).</p>
<p><b>Intensidad relativa:</b> qué tan cerca del umbral se trabajó (1,00 = umbral).</p>
<p><b>Acople/desacople cardíaco:</b> cuánto sube la FC entre la primera y la segunda mitad con la misma potencia o velocidad. Menos de 5 % indica buena base aeróbica; más de 10 % indica fatiga, calor o exceso de intensidad.</p>
<p><b>Factor de eficiencia:</b> potencia (o velocidad) por latido. Si baja con el tiempo en esfuerzos comparables puede indicar fatiga.</p>
<p><b>Recuperación cardíaca:</b> cuántos latidos baja la FC en 60 s tras un esfuerzo exigente al detenerse o rodar suave.</p>
<p><b>Variabilidad cardíaca (R-R):</b> RMSSD y SDNN miden la variación entre latidos; DFA α1 por debajo de 0,75 se asocia con haber pasado el umbral aeróbico. Solo disponible si el archivo trae intervalos R-R.</p>
<p><b>CTL / ATL / TSB:</b> forma crónica (42 d), fatiga aguda (7 d) y balance entre ambas. Necesitan semanas de histórico para ser fiables.</p>
<p><b>ACWR:</b> carga de la semana frente a la media de las últimas 4 semanas. Entre 0,8 y 1,3 es la zona óptima.</p>
<p class="muted">Todo son estimaciones orientativas a partir de los archivos; no sustituyen la valoración de un entrenador o médico.</p></details>`;
function summaryHtml(S) {
  const icon = { ok: '✅', warn: '⚠️', bad: '🔴', info: 'ℹ️' }[S.level] || 'ℹ️';
  return `<div class="sum ${S.level}"><div class="lab">Conclusión general</div><div class="sh">${icon} ${esc(S.headline)}</div>
    ${S.points.length ? `<ul>${S.points.map(p => `<li><i class="${p.level}"></i><span><b>${esc(p.label)}</b>${esc(p.text)}</span></li>`).join('')}</ul>` : ''}
    <div class="adv"><b>Qué hacer ahora:</b> ${esc(S.advice)}</div>
    ${S.caveat ? `<div class="hint">${esc(S.caveat)}</div>` : ''}
    <div class="row" style="margin-top:8px"><button class="btn sm" id="copySum">Copiar conclusión</button></div></div>`;
}
function summaryText(S, title) { return title + '\n' + S.headline + '\n' + S.points.map(p => '- ' + p.label + ': ' + p.text).join('\n') + '\nQué hacer ahora: ' + S.advice + (S.caveat ? '\n(' + S.caveat + ')' : ''); }
let lastSummary = '';
const completeBtn = list => hasEstimates(list) ? `<div class="row" style="margin-top:8px"><button class="btn sm primary" data-go="perfil">Completar datos del deportista</button></div>` : '';
function noAthlete() {
  return `<div class="card"><h3>Empieza subiendo sesiones</h3><p class="muted">Sube los archivos de uno o varios deportistas. La app te pedirá sus datos (FC máxima, reposo, umbral y FTP) para ajustar el análisis a cada uno. Puedes cambiar de deportista con el selector de arriba y usar <b>Limpiar</b> para empezar de nuevo.</p></div>` + dropzone();
}

function viewActividad() {
  const at = curAth(), list = mine();
  if (!at) return noAthlete();
  if (!list.length) return `<div class="card"><h3>${esc(at.name)}</h3><p class="muted">Este deportista no tiene sesiones. Sube sus archivos para analizarlos.</p></div>` + dropzone();
  const act = list.find(a => a.id === state.sel) || list[list.length - 1]; state.sel = act.id;
  const A = act.A, opts = list.slice().reverse().map(a => `<option value="${a.id}" ${a.id === act.id ? 'selected' : ''}>${SPORT_ICON[a.sport]} ${esc(new Date(a.start).toLocaleDateString('es', { day: 'numeric', month: 'short' }))} · ${fmtDur(a.A.dur)} · ${esc(a.name)}</option>`).join('');
  const sports = Object.entries(C.SPORTS).map(([k, v]) => `<option value="${k}" ${k === act.sport ? 'selected' : ''}>${v}</option>`).join('');
  const kp = (l, v, s) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s || '&nbsp;'}</div></div>`;
  const kpis = [
    kp('Duración', fmtDur(A.dur), A.elapsed - A.dur > 120 ? 'transcurrido ' + fmtDur(A.elapsed) : ''),
    A.hasSp ? kp('Distancia', f1(A.dist / 1000) + ' km', paceOf(A.avgSpeed, act.sport)) : '',
    A.hasHr ? kp('FC media / máx', f0(A.avgHr) + ' / ' + f0(A.maxHr), 'ppm') : '',
    A.hasPw ? kp('Potencia', f0(A.avgPw) + ' W', 'NP ' + f0(A.np) + ' W') : '',
    isNum(A.load) ? kp('Carga', f0(A.load), A.loadMethod.split(' ')[0]) : '',
    isNum(A.IF) ? kp('Intensidad rel.', f2(A.IF), '1,00 = umbral') : '',
    isNum(A.ef) ? kp('Eficiencia', f1(A.ef), A.outType === 'pw' ? 'W por latido' : 'm/min por latido') : '',
    isNum(A.ascent) ? kp('Desnivel +', f0(A.ascent) + ' m', '') : ''
  ].join('');
  const zoneRows = (arr, names, cols, ranges) => {
    const tot = arr.reduce((x, y) => x + y, 0) || 1;
    return `<div class="zbar">${arr.map((v, i) => `<div style="width:${v / tot * 100}%;background:${cols[i]}"></div>`).join('')}</div>` +
      arr.map((v, i) => `<div class="zrow"><span title="${ranges[i]}">${names[i]}</span><div><div class="b" style="width:${v / tot * 100}%;background:${cols[i]};min-width:2px"></div></div><span>${fmtDur(v)} · ${f0(v / tot * 100)} %</span></div>`).join('');
  };
  const hrB = C.ZLIM.map(x => Math.round(x * A.profile.lthr));
  const hrRanges = [`&lt;${hrB[0]} ppm`, `${hrB[0]}-${hrB[1] - 1} ppm`, `${hrB[1]}-${hrB[2] - 1} ppm`, `${hrB[2]}-${hrB[3] - 1} ppm`, `≥${hrB[3]} ppm`];
  const zones = A.zones ? zoneRows(A.zones, C.ZN.map((n, i) => `${n} <small class="muted">${hrRanges[i]}</small>`), ZCOL, hrRanges) +
      `<div class="hint">Zonas de la Calculadora de Test según FC umbral ${A.profile.lthr} ppm${A.profile.lthrAuto ? ' (estimada)' : ''}: Z1 &lt;69 %, Z2 69-83 %, Z3 84-94 %, Z4 95-105 %, Z5 &gt;105 %. Si usas otros límites en tu plataforma, cambia la FC umbral en Perfil para que coincidan.</div>`
    : '<div class="empty">Sin frecuencia cardíaca en este archivo.</div>';
  const pB = C.PZLIM.map(x => Math.round(x * (A.profile.ftp || 0)));
  const pRanges = [`&lt;${pB[0]} W`, `${pB[0]}-${pB[1] - 1} W`, `${pB[1]}-${pB[2] - 1} W`, `${pB[2]}-${pB[3] - 1} W`, `${pB[3]}-${pB[4] - 1} W`, `${pB[4]}-${pB[5] - 1} W`, `≥${pB[5]} W`];
  const pzCard = A.pzones ? `<div class="card"><h2>Tiempo en zonas de potencia</h2>${zoneRows(A.pzones, C.PZN.map((n, i) => `${n} <small class="muted">${pRanges[i]}</small>`), PZCOL, pRanges)}
    <div class="hint">Zonas de la Calculadora de Test según FTP ${A.profile.ftp} W: Z1 &lt;55 %, Z2 55-75 %, Z3 75-90 %, Z4 90-105 %, Z5 105-120 %, Z6 120-150 %, Z7 &gt;150 %. Incluye los ceros (paradas) en Z1.</div></div>` : '';
  const D = A.decoupling;
  const dec = D && D.valid ? `<table><tr><th></th><th>1ª mitad</th><th>2ª mitad</th><th>Cambio</th></tr>
    <tr><td>FC media</td><td>${f0(D.e1.hr)} ppm</td><td>${f0(D.e2.hr)} ppm</td><td>${D.e2.hr - D.e1.hr >= 0 ? '+' : ''}${f1(D.e2.hr - D.e1.hr)}</td></tr>
    <tr><td>${A.outType === 'pw' ? 'Potencia (NP)' : 'Velocidad'}</td><td>${A.outType === 'pw' ? f0(D.e1.o) + ' W' : paceOf(D.e1.o, act.sport)}</td><td>${A.outType === 'pw' ? f0(D.e2.o) + ' W' : paceOf(D.e2.o, act.sport)}</td><td>${f1((D.e2.o - D.e1.o) / D.e1.o * 100)} %</td></tr>
    <tr><td><b>Desacople</b></td><td colspan="3"><b>${f1(D.pct)} %</b> ${D.steady ? '' : '<span class="chip">sesión variable: poco fiable</span>'}</td></tr></table>
    <div class="hint">Se omiten los primeros minutos de calentamiento (${f0(D.segMin)} min analizados).</div>` : `<div class="empty">${D && D.reason ? esc(D.reason) : 'No hay datos suficientes (FC y potencia/velocidad).'}</div>`;
  const H = A.hrv;
  const hrvCard = H ? `<div class="card"><h2>Variabilidad cardíaca durante la sesión</h2><div class="kpis" style="margin-bottom:10px">
    ${kp('RMSSD', f0(H.whole.rmssd) + ' ms', 'tercio 1: ' + (H.first ? f0(H.first.rmssd) : '—') + ' → 3: ' + (H.last ? f0(H.last.rmssd) : '—'))}
    ${kp('SDNN', f0(H.whole.sdnn) + ' ms', '')}${kp('pNN50', f1(H.whole.pnn50) + ' %', '')}
    ${kp('DFA α1 mediano', isNum(H.alphaMedian) ? f2(H.alphaMedian) : '—', isNum(H.pctBelow075) ? f0(H.pctBelow075) + ' % del tiempo &lt; 0,75' : '')}</div>
    <canvas id="cHrv" style="height:200px"></canvas><div class="hint">DFA α1 en ventanas de 2 min (versión simplificada). Por debajo de 0,75 ≈ por encima del umbral aeróbico; por debajo de 0,5, esfuerzo muy alto. ${H.artifactPct > 0.5 ? 'Latidos descartados por artefactos: ' + f1(H.artifactPct) + ' %.' : ''}</div></div>` : '';
  const tdet = testsOf(act), tBanner = tdet.length && tdet[0].score >= 0.7 ? (() => { const r = TestLab.compute(tdet[0].id, act.rs, profileOf(at.id), {}); return `<div class="ins ok"><span class="tag">Test</span><b>Esta sesión parece un ${esc(TestLab.TESTS[tdet[0].id].name.toLowerCase())}</b>${r && !r.error ? esc(r.headline) + '. ' : ''}<a href="#" data-gotest="${act.id}">Ver el análisis del test y las zonas →</a></div>`; })() : '';
  const S = A.struct;
  const ivCard = S ? `<div class="card"><h2>Intervalos detectados</h2>
    <div class="hint" style="margin:0 0 8px">${S.reps.length} esfuerzos · ${f0(S.workSec / 60)} min de trabajo (${f0(S.workPct)} % de la sesión) · nivel de esfuerzo ${C.fmtOut(S.hiLevel, act.sport, S.by)} vs ${C.fmtOut(S.loLevel, act.sport, S.by)} en recuperación. Las dos mitades de la sesión no se comparan porque dependen de dónde cayeron los intervalos.</div>
    <div class="tw"><table><tr><th>#</th><th>Inicio</th><th>Duración</th><th>${S.by === 'pw' ? 'Potencia' : 'Ritmo/velocidad'}</th><th>FC media</th><th>FC final</th><th>Recuperación</th><th>Bajada FC</th></tr>
    ${S.reps.map((r, i) => `<tr><td>${i + 1}</td><td>${C.fmtMin(r.start)}</td><td>${C.fmtMin(r.dur)}</td><td>${C.fmtOut(r.out, act.sport, S.by)}</td><td>${isNum(r.hr) ? f0(r.hr) : '—'}</td><td>${isNum(r.hrEnd) ? f0(r.hrEnd) : '—'}</td><td>${r.recDur ? C.fmtMin(r.recDur) + ' a ' + C.fmtOut(r.recOut, act.sport, S.by) : '—'}</td><td>${isNum(r.recDrop) ? f0(r.recDrop) + ' ppm' : '—'}</td></tr>`).join('')}</table></div>
    <div class="hint">Primeras vs últimas repeticiones: ${S.by === 'pw' ? 'potencia' : 'velocidad'} ${S.fade >= 0 ? '+' : ''}${f1(S.fade)} %${isNum(S.hrDrift) ? ', FC ' + (S.hrDrift >= 0 ? '+' : '') + f0(S.hrDrift) + ' ppm' : ''}${isNum(S.efDrift) ? ', eficiencia ' + (S.efDrift > 0 ? '−' : '+') + f1(Math.abs(S.efDrift)) + ' % entre mitades de los esfuerzos' : ''}. La detección es automática: si tu entreno no era por intervalos, ignora esta tarjeta.</div></div>` : '';
  const hist = list.filter(a => a.start <= act.start);
  return `<div class="row sb"><div><h3>${SPORT_ICON[act.sport]} ${C.SPORTS[act.sport]} · ${esc(dateStr(act.start))}</h3><div class="muted">Deportista: <b>${esc(at.name)}</b> · ${esc(act.name)}</div></div>
    <div class="row"><select id="selAct" style="width:auto;max-width:320px">${opts}</select><select id="selSport" style="width:auto" title="Cambiar deporte">${sports}</select><button class="btn danger sm" id="delAct">Eliminar</button></div></div>
    ${tBanner}
    ${(() => { const S = C.activityOverview(act, hist); lastSummary = summaryText(S, at.name + ' · ' + C.SPORTS[act.sport] + ' ' + new Date(act.start).toLocaleDateString('es')); return summaryHtml(S); })()}
    <div class="kpis">${kpis}</div>
    <div class="card"><h2>Conclusiones de la sesión</h2>${insHtml(C.activityInsights(act, hist))}${completeBtn([act])}${GLOSSARY}</div>
    <div class="card"><h2>Frecuencia cardíaca y esfuerzo</h2><canvas id="cMain"></canvas></div>
    <div class="grid2"><div class="card"><h2>Tiempo en zonas de FC</h2>${zones}</div>${pzCard || `<div class="card"><h2>Acople cardíaco por mitades</h2>${dec}</div>`}</div>
    ${pzCard ? `<div class="card"><h2>Acople cardíaco por mitades</h2>${dec}</div>` : ''}
    ${ivCard}
    ${hrvCard}
    <div class="card"><h2>Subir más sesiones</h2>${dropzone()}</div>`;
}

function viewSemana() {
  const at = curAth(), list = mine();
  if (!at) return noAthlete();
  if (!list.length) return `<div class="card"><h3>${esc(at.name)}</h3><p class="muted">Este deportista no tiene sesiones.</p></div>` + dropzone();
  if (!state.wk) state.wk = C.weekStartKey(list[list.length - 1].start);
  const W = C.weekSummary(list, state.wk);
  const kp = (l, v, s) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s || '&nbsp;'}</div></div>`;
  const kpis = [
    kp('Sesiones', W.n, ''), kp('Tiempo', f1(W.dur / 3600) + ' h', W.prevDur ? 'sem. anterior ' + f1(W.prevDur / 3600) + ' h' : ''),
    kp('Distancia', f1(W.dist / 1000) + ' km', ''), kp('Carga', f0(W.load), isNum(W.loadChange) ? (W.loadChange >= 0 ? '+' : '') + f0(W.loadChange) + (W.partial ? ' % vs mismos días ant.' : ' % vs anterior') : ''),
    kp('ACWR', isNum(W.acwr) ? f2(W.acwr) : '—', W.pmc ? (!isNum(W.acwr) ? 'faltan 14+ días' : W.acwrReliable ? 'óptimo 0,8-1,3' : 'provisional') : ''),
    kp('Forma (TSB)', isNum(W.tsb) ? f0(W.tsb) : '—', isNum(W.ctl) ? 'CTL ' + f0(W.ctl) + ' · ATL ' + f0(W.atl) : ''),
    kp('Monotonía', isFinite(W.monotony) ? f2(W.monotony) : '—', W.restDays + ' descanso(s)' + (W.partial ? ' · ' + W.elapsed + '/7 días' : ''))
  ].join('');
  const z = W.zones, zt = W.zoneTotal || 1;
  const zoneHtml = W.zoneTotal ? `<div class="zbar">${z.map((v, i) => `<div style="width:${v / zt * 100}%;background:${ZCOL[i]}"></div>`).join('')}</div>` +
    z.map((v, i) => `<div class="zrow"><span>${C.ZN[i]}</span><div><div class="b" style="width:${v / zt * 100}%;background:${ZCOL[i]};min-width:2px"></div></div><span>${fmtDur(v)} · ${f0(v / zt * 100)} %</span></div>`).join('') : '<div class="empty">Sin FC en esta semana.</div>';
  const rows = W.acts.slice().reverse().map(a => `<tr class="click" data-open="${a.id}"><td>${esc(new Date(a.start).toLocaleDateString('es', { weekday: 'short', day: 'numeric' }))}</td><td>${SPORT_ICON[a.sport]} ${C.SPORTS[a.sport]}</td><td>${fmtDur(a.A.dur)}</td><td>${a.A.hasSp ? f1(a.A.dist / 1000) + ' km' : '—'}</td><td>${f0(a.A.avgHr)}</td><td>${f0(a.A.load)}</td><td>${f2(a.A.IF)}</td><td>${a.A.decoupling && a.A.decoupling.valid ? f1(a.A.decoupling.pct) + ' %' : '—'}</td></tr>`).join('');
  return `<div class="row sb"><div class="row"><button class="btn sm" id="wkPrev">◀</button><h3 style="margin:0">${esc(at.name)} · semana ${esc(rangeStr(state.wk))}</h3><button class="btn sm" id="wkNext">▶</button></div>
    <div class="row"><button class="btn sm" id="wkNow">Última semana con datos</button></div></div>
    ${(() => { const S = C.weekOverview(W); lastSummary = summaryText(S, at.name + ' · semana ' + rangeStr(state.wk)); return summaryHtml(S); })()}
    <div class="kpis">${kpis}</div>
    <div class="card"><h2>Conclusiones de la semana</h2>${insHtml(C.weekInsights(W, profileOf(at.id)))}${completeBtn(W.acts)}${GLOSSARY}</div>
    <div class="grid2"><div class="card"><h2>Carga por día</h2><canvas id="cDaily"></canvas></div>
    <div class="card"><h2>Forma, fatiga y balance (CTL · ATL · TSB)</h2><canvas id="cPmc"></canvas><div class="hint">${W.pmc && W.historyDays < 42 ? 'Con menos de ~6 semanas de histórico el modelo es provisional. ' : ''}Sube más semanas anteriores para afinarlo.</div></div></div>
    <div class="grid2"><div class="card"><h2>Distribución de intensidad (tiempo)</h2>${zoneHtml}</div>
    <div class="card"><h2>Sesiones de la semana</h2><div class="tw"><table><tr><th>Día</th><th>Deporte</th><th>Tiempo</th><th>Dist.</th><th>FC</th><th>Carga</th><th>Int.</th><th>Acople</th></tr>${rows || '<tr><td colspan="8" class="empty">Sin sesiones</td></tr>'}</table></div></div></div>
    <div class="card"><h2>Subir más sesiones</h2>${dropzone(' Para un análisis fiable de forma y fatiga sube también las 4-6 semanas anteriores.')}</div>`;
}

function viewHistorial() {
  const at = curAth(), list = mine();
  if (!at) return noAthlete();
  if (!list.length) return `<div class="card"><h3>${esc(at.name)}</h3><p class="muted">Este deportista no tiene sesiones.</p></div>` + dropzone();
  const rows = list.slice().reverse().map(a => `<tr class="click" data-open="${a.id}"><td>${esc(new Date(a.start).toLocaleDateString('es'))}</td><td>${SPORT_ICON[a.sport]} ${C.SPORTS[a.sport]}</td><td>${fmtDur(a.A.dur)}</td><td>${a.A.hasSp ? f1(a.A.dist / 1000) : '—'}</td><td>${f0(a.A.avgHr)}</td><td>${f0(a.A.load)}</td><td>${f2(a.A.IF)}</td><td>${a.A.decoupling && a.A.decoupling.valid ? f1(a.A.decoupling.pct) + ' %' : '—'}</td><td>${a.A.hrv ? 'sí' : '—'}</td><td class="muted">${esc(a.name)}</td></tr>`).join('');
  return `<div class="card"><div class="row sb" style="margin-bottom:10px"><h2 style="margin:0">Historial de ${esc(at.name)} (${list.length})</h2><div class="row"><button class="btn sm" id="expCsv">Exportar CSV</button></div></div>
    <div class="tw"><table><tr><th>Fecha</th><th>Deporte</th><th>Tiempo</th><th>Km</th><th>FC</th><th>Carga</th><th>Int.</th><th>Acople</th><th>R-R</th><th>Archivo</th></tr>${rows}</table></div>
    <div class="hint">Las sesiones se guardan solo en este navegador/dispositivo. Usa <b>Limpiar</b> para empezar de nuevo.</div></div>${dropzone()}`;
}

/* ---------- tests de campo ---------- */
let lastTest = null;
function testsOf(act) {
  if (!act.A) return [];
  if (!act._tc || act._tc.A !== act.A) { let list = []; try { list = TestLab.detect(act.rs, act.sport, act.A); } catch (e) { } act._tc = { A: act.A, list }; }
  return act._tc.list;
}
function testRows(R) { return R.calc.map(r => `<tr><td>${esc(r[0])}</td><td><b>${esc(r[1])}</b></td></tr>`).join(''); }
function zoneTable(z) { return `<div class="card"><h2>${esc(z.title)}</h2><div class="tw"><table><tr>${z.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${z.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div></div>`; }
function viewTests() {
  const at = curAth(), list = mine();
  if (!at) return noAthlete();
  if (!list.length) return `<div class="card"><h3>Tests de campo</h3><p class="muted">Sube el archivo de la sesión de un test (20 min, 2×8, escalonado, running 12 o 20 min, natación…) y la app te dirá de qué test se trata, calculará el umbral y las zonas.</p></div>` + dropzone();
  const found = list.filter(a => { const t = testsOf(a); return t.length && t[0].score >= 0.6; });
  let act = list.find(a => a.id === state.tAct);
  if (!act) act = found.length ? found[found.length - 1] : (list.find(a => a.id === state.sel) || list[list.length - 1]);
  state.tAct = act.id;
  const det = testsOf(act), TL = TestLab.TESTS;
  const ids = Object.keys(TL).filter(k => act.sport === 'other' || TL[k].sport === act.sport);
  let testId = state.tTest !== 'auto' && TL[state.tTest] ? state.tTest : (det[0] ? det[0].id : null);
  const R = testId ? TestLab.compute(testId, act.rs, profileOf(at.id), { stepIdx: state.tStep }) : null;
  lastTest = R && !R.error ? { R, ath: at.id } : null;
  const actOpts = list.slice().reverse().map(a => { const t = testsOf(a), isT = t.length && t[0].score >= 0.6; return `<option value="${a.id}" ${a.id === act.id ? 'selected' : ''}>${isT ? '🎯 ' : ''}${SPORT_ICON[a.sport]} ${esc(new Date(a.start).toLocaleDateString('es', { day: 'numeric', month: 'short' }))} · ${fmtDur(a.A.dur)} · ${esc(a.name)}</option>`; }).join('');
  const testOpts = `<option value="auto" ${state.tTest === 'auto' ? 'selected' : ''}>Detectar automáticamente</option>` + ids.map(k => `<option value="${k}" ${state.tTest === k ? 'selected' : ''}>${esc(TL[k].name)}</option>`).join('');
  let detTxt;
  if (state.tTest !== 'auto' && TL[state.tTest]) detTxt = `<div class="ins info"><span class="tag">Manual</span><b>Analizando como: ${esc(TL[state.tTest].name)}</b>Elegiste el tipo de test a mano. El cálculo busca el mejor tramo de esa duración en la sesión.</div>`;
  else if (det.length) {
    const d = det[0], alt = det.slice(1).map(x => `${esc(TL[x.id].name)} (${f0(x.score * 100)} %)`).join(' · ');
    detTxt = `<div class="ins ${d.score >= 0.7 ? 'ok' : 'warn'}"><span class="tag">${d.score >= 0.7 ? 'Detectado' : 'Posible'}</span><b>${esc(TL[d.id].name)} · confianza ${f0(d.score * 100)} %</b>${esc(d.why)}${alt ? `<div class="hint">Otras opciones: ${alt}. Puedes cambiarlo arriba.</div>` : ''}${d.score < 0.7 ? '<div class="hint">La coincidencia no es clara: confirma que el tipo de test sea el correcto.</div>' : ''}</div>`;
  } else detTxt = `<div class="ins warn"><span class="tag">Sin test</span><b>Esta sesión no parece un test</b>No se encontró un esfuerzo con la forma de ninguno de los tests (por ejemplo, un bloque continuo y parejo de 12 o 20 min bien por encima del resto de la sesión). Si sí era un test, elige el tipo manualmente.</div>`;
  let res = '';
  if (R && R.error) res = `<div class="card"><h2>Resultado</h2><div class="empty">${esc(R.error)}</div></div>`;
  else if (R) {
    const w = R.win ? `Tramo usado: ${fmtDur(R.win.s)} – ${fmtDur(R.win.e)} de la sesión.` : '';
    const steps = R.steps && R.steps.length ? `<h3 style="margin:14px 0 6px;font-size:14px">Escalones detectados</h3><div class="tw"><table><tr><th>Umbral</th><th>#</th><th>Duración</th><th>Potencia</th><th>Cadencia</th><th>FC (2ª mitad)</th></tr>${R.steps.map((p, i) => `<tr><td><input type="radio" name="tstep" value="${i}" ${state.tStep === i ? 'checked' : ''} style="width:auto"></td><td>${p.n}</td><td>${fmtDur(p.dur)}</td><td>${f0(p.pw)} W</td><td>${isNum(p.cad) ? f0(p.cad) + ' rpm' : '—'}</td><td>${isNum(p.hr) ? f0(p.hr) + ' ppm' : '—'}</td></tr>`).join('')}</table></div>` : '';
    const ap = R.apply, bits = [ap.ftp ? 'FTP ' + ap.ftp + ' W' : '', ap.lthr ? 'FC umbral ' + ap.lthr + ' ppm' : '', ap.runThr ? 'umbral de carrera ' + TestLab.fmtPace(ap.runThr) + ' /km' : '', ap.runFtp ? 'FTP de carrera ' + ap.runFtp + ' W' : '', ap.swimThr ? 'umbral de natación ' + TestLab.fmtPace(ap.swimThr) + ' /100 m' : ''].filter(Boolean);
    res = `<div class="card"><div class="row sb"><h2 style="margin:0">Resultado del test</h2><button class="btn primary" id="applyTest" ${R.invalid ? 'disabled title="Test no válido: no se puede aplicar"' : ''}>Aplicar al perfil de ${esc(at.name)}</button></div>
      <div class="kpis" style="margin:12px 0"><div class="kpi" style="grid-column:1/-1"><div class="l">${esc(R.name)}</div><div class="v">${esc(R.headline)}</div><div class="s">${w}</div></div></div>
      <div class="tw"><table>${testRows(R)}</table></div>${steps}
      ${R.notes.map(n => `<div class="hint">${esc(n)}</div>`).join('')}
      <div class="hint">«Aplicar» guarda en el perfil: ${esc(bits.join(' · ') || '—')}, y recalcula las zonas y la carga de sus sesiones.</div></div>
      <div class="grid2">${R.zones.map(zoneTable).join('')}</div>`;
  }
  // historial de tests detectados
  const hist = found.slice().reverse().map(a => { const d = testsOf(a)[0], r = TestLab.compute(d.id, a.rs, profileOf(at.id), {}); return `<tr class="click" data-tact="${a.id}"><td>${esc(new Date(a.start).toLocaleDateString('es'))}</td><td>${esc(TL[d.id].name)}</td><td>${r && !r.error ? esc(r.headline) : '—'}</td><td class="muted">${esc(a.name)}</td></tr>`; }).join('');
  return `<div class="card"><h2>Analizar un test</h2><div class="row"><div style="flex:1;min-width:220px"><label>Sesión</label><select id="tAct">${actOpts}</select></div><div style="flex:1;min-width:220px"><label>Tipo de test</label><select id="tTest">${testOpts}</select></div></div>
    <div style="margin-top:10px">${detTxt}</div></div>${res}
    ${hist ? `<div class="card"><h2>Tests detectados de ${esc(at.name)}</h2><div class="tw"><table><tr><th>Fecha</th><th>Test</th><th>Resultado</th><th>Archivo</th></tr>${hist}</table></div></div>` : ''}
    <div class="card"><h2>Subir más sesiones</h2>${dropzone()}</div>`;
}

function viewPerfil() {
  const at = curAth();
  const roster = state.athletes.map(a => `<tr class="click" data-ath="${a.id}"><td>${a.id === state.cur ? '● ' : ''}${esc(a.name)}</td><td>${state.acts.filter(x => x.ath === a.id).length} sesión(es)</td></tr>`).join('');
  const head = `<div class="card"><div class="row sb"><h2 style="margin:0">Deportistas</h2><button class="btn sm" id="newAth">＋ Nuevo deportista</button></div>${state.athletes.length ? `<table style="margin-top:8px">${roster}</table>` : '<p class="muted">Aún no hay deportistas. Se crean al subir sesiones o con el botón de arriba.</p>'}</div>`;
  if (!at) return head;
  const p = at.profile || {}, obs = observedOf(at.id);
  return head + `<div class="card"><h2>Datos de ${esc(at.name)}</h2><p class="muted" style="margin-top:0">Estos valores definen las zonas y la carga de este deportista. Los campos vacíos se estiman. Al guardar se recalculan sus sesiones.</p>
    <div class="form"><div><label>Nombre</label><input id="p_name" value="${esc(at.name)}"></div></div><div style="height:12px"></div>
    ${athleteFields(p, { hr: true, ftp: true, obs })}
    <div class="row" style="margin-top:14px"><button class="btn primary" id="saveProf">Guardar y recalcular</button></div></div>`;
}

/* ---------- gráficos ---------- */
function drawCharts() {
  const list = mine();
  if (state.tab === 'actividad') {
    const act = list.find(a => a.id === state.sel); if (!act) return;
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
    const el = $('cMain'); if (el) Charts.line(el, { x, xFmt: fmtDur, series, yl: { min: A.hasHr ? Math.max(40, Math.floor(C.mean(hr.v.filter(isNum)) - 60)) : undefined }, yr, empty: 'Este archivo no trae FC ni potencia/velocidad' });
    const H = A.hrv, hv = $('cHrv');
    if (H && hv) Charts.line(hv, { x: H.dfa.map(d => d.t), xFmt: fmtDur, series: [{ data: H.dfa.map(d => d.a), color: '#7c3aed', label: 'DFA α1', axis: 'l', fmt: v => (Math.round(v * 100) / 100).toLocaleString('es') }], yl: { min: 0, max: 1.5, fmt: v => (Math.round(v * 10) / 10).toLocaleString('es') }, bands: [{ from: 0.5, to: 0.75, color: 'rgba(124,58,237,.12)' }], empty: 'Muy pocos datos R-R' });
  } else if (state.tab === 'semana' && list.length && state.wk) {
    const W = C.weekSummary(list, state.wk), lab = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    const el = $('cDaily'); if (el) Charts.bars(el, { labels: lab, values: W.daily, color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), fmt: v => Math.round(v), empty: 'Sin carga registrada esta semana' });
    const pe = $('cPmc');
    if (pe && W.pmc) {
      const ser = W.pmc.series.filter(r => r.day <= W.endKey).slice(-90);
      Charts.line(pe, { x: ser.map(r => r.day), xFmt: d => C.keyToDate(d).toLocaleDateString('es', { day: 'numeric', month: 'short' }),
        series: [{ data: ser.map(r => r.ctl), color: '#2563eb', label: 'CTL forma', fmt: v => Math.round(v) }, { data: ser.map(r => r.atl), color: '#ef4444', label: 'ATL fatiga', fmt: v => Math.round(v) }, { data: ser.map(r => r.tsb), color: '#16a34a', label: 'TSB balance', fmt: v => Math.round(v) }], empty: 'Sin datos de carga' });
    } else if (pe) Charts.line(pe, { x: [], series: [], empty: 'Sin datos de carga' });
  }
}

/* ---------- render y eventos ---------- */
function renderHeader() {
  const sel = $('athSel');
  sel.style.display = state.athletes.length ? 'block' : 'none';
  sel.innerHTML = state.athletes.map(a => `<option value="${a.id}" ${a.id === state.cur ? 'selected' : ''}>👤 ${esc(a.name)}</option>`).join('');
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.t === state.tab));
}
function render() {
  renderHeader();
  const v = { actividad: viewActividad, semana: viewSemana, historial: viewHistorial, tests: viewTests, perfil: viewPerfil }[state.tab];
  $('main').innerHTML = v();
  bind(); requestAnimationFrame(drawCharts);
}
function bind() {
  document.querySelectorAll('[data-go]').forEach(a => a.onclick = e => { e.preventDefault(); setTab(a.dataset.go); });
  const drop = $('drop'); if (drop) drop.onclick = () => $('files').click();
  document.querySelectorAll('[data-open]').forEach(r => r.onclick = () => { state.sel = r.dataset.open; setTab('actividad'); });
  document.querySelectorAll('[data-ath]').forEach(r => r.onclick = () => { state.cur = r.dataset.ath; saveAthletes(); selectLatest(); render(); });
  const cs = $('copySum'); if (cs) cs.onclick = async () => { try { await navigator.clipboard.writeText(lastSummary); toast('Conclusión copiada.'); } catch (e) { toast('No se pudo copiar automáticamente.'); } };
  const ta = $('tAct'); if (ta) ta.onchange = () => { state.tAct = ta.value; state.tTest = 'auto'; state.tStep = null; render(); };
  const tt = $('tTest'); if (tt) tt.onchange = () => { state.tTest = tt.value; state.tStep = null; render(); };
  document.querySelectorAll('input[name=tstep]').forEach(r => r.onchange = () => { state.tStep = +r.value; render(); });
  document.querySelectorAll('[data-tact]').forEach(r => r.onclick = () => { state.tAct = r.dataset.tact; state.tTest = 'auto'; state.tStep = null; render(); window.scrollTo(0, 0); });
  document.querySelectorAll('[data-gotest]').forEach(l => l.onclick = e => { e.preventDefault(); state.tAct = l.dataset.gotest; state.tTest = 'auto'; state.tStep = null; setTab('tests'); });
  const ap = $('applyTest'); if (ap) ap.onclick = () => {
    if (!lastTest || lastTest.R.invalid) return; const at = state.athletes.find(x => x.id === lastTest.ath), v = lastTest.R.apply, clean = {}; for (const k in v) if (v[k] != null && isFinite(v[k])) clean[k] = v[k];
    at.profile = Object.assign({}, at.profile, clean); saveAthletes(); analyzeAthlete(at.id); toast('Perfil de ' + at.name + ' actualizado con el resultado del test. Sesiones recalculadas.'); render();
  };
  const sa = $('selAct'); if (sa) sa.onchange = () => { state.sel = sa.value; render(); };
  const ss = $('selSport'); if (ss) ss.onchange = async () => { const a = state.acts.find(x => x.id === state.sel); a.sport = ss.value; analyzeAthlete(a.ath); await persist(a); render(); };
  const da = $('delAct'); if (da) da.onclick = async () => { if (!confirm('¿Eliminar esta sesión?')) return; await removeActs([state.sel]); selectLatest(); render(); };
  const wp = $('wkPrev'); if (wp) wp.onclick = () => { state.wk = C.addDays(state.wk, -7); render(); };
  const wn = $('wkNext'); if (wn) wn.onclick = () => { state.wk = C.addDays(state.wk, 7); render(); };
  const wo = $('wkNow'); if (wo) wo.onclick = () => { const l = mine(); state.wk = C.weekStartKey(l[l.length - 1].start); render(); };
  const na = $('newAth'); if (na) na.onclick = () => { const a = { id: 'a' + Date.now(), name: 'Deportista ' + (state.athletes.length + 1), profile: {} }; state.athletes.push(a); state.cur = a.id; saveAthletes(); selectLatest(); render(); };
  const sp = $('saveProf'); if (sp) sp.onclick = () => {
    const at = curAth(), p = { hrMax: num('m_hrMax'), hrRest: num('m_hrRest'), lthr: num('m_lthr'), ftp: num('m_ftp'), sex: $('m_sex').value };
    const name = $('p_name').value.trim(); if (!name) { toast('El deportista necesita un nombre.'); return; }
    const err = checkProfile(p); if (err) { toast(err); return; }
    at.name = name; at.profile = Object.assign({}, at.profile, p); saveAthletes(); analyzeAthlete(at.id); toast('Datos guardados. Sesiones recalculadas.'); render();
  };
  const ex = $('expCsv'); if (ex) ex.onclick = () => {
    const q = v => '"' + String(v).replace(/"/g, '""') + '"', at = curAth();
    const n1 = v => isNum(v) ? (Math.round(v * 10) / 10).toString() : '', n0 = v => isNum(v) ? Math.round(v).toString() : '';
    const head = 'deportista,fecha,deporte,duracion_min,distancia_km,fc_media,fc_max,potencia_np,carga,intensidad_rel,desacople_pct,archivo';
    const rows = mine().map(a => [q(at.name), C.dayKey(a.start), C.SPORTS[a.sport], n1(a.A.dur / 60), n1(a.A.dist / 1000), n0(a.A.avgHr), n0(a.A.maxHr), n0(a.A.np), n1(a.A.load), isNum(a.A.IF) ? a.A.IF.toFixed(2) : '', a.A.decoupling && a.A.decoupling.valid ? n1(a.A.decoupling.pct) : '', q(a.name)].join(','));
    const url = URL.createObjectURL(new Blob([head + '\n' + rows.join('\n')], { type: 'text/csv' })); const l = document.createElement('a'); l.href = url; l.download = 'sesiones-' + at.name.replace(/\W+/g, '_') + '.csv'; l.click(); URL.revokeObjectURL(url);
  };
}

document.querySelectorAll('#nav button').forEach(b => b.onclick = () => setTab(b.dataset.t));
$('upload').onclick = () => $('files').click();
$('clear').onclick = openClear;
$('files').onchange = e => { const f = [...e.target.files]; e.target.value = ''; openFiles(f); };
$('athSel').onchange = e => { state.cur = e.target.value; saveAthletes(); selectLatest(); render(); };
let dragN = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragN++; $('over').style.display = 'flex'; } });
window.addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('over').style.display = 'none'; });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('over').style.display = 'none'; if (e.dataTransfer.files.length) openFiles([...e.dataTransfer.files]); });
window.addEventListener('resize', () => { clearTimeout(window._rt); window._rt = setTimeout(drawCharts, 120); });
matchMedia('(prefers-color-scheme:dark)').addEventListener('change', () => render());

let deferred;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('install').style.display = 'inline-block'; });
$('install').onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('install').style.display = 'none'; };
window.addEventListener('appinstalled', () => $('install').style.display = 'none');
if ('serviceWorker' in navigator) {
  // limpia registros del service worker antiguo (sw.js) y registra el nuevo
  navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => { const u = (r.active || r.waiting || r.installing || {}).scriptURL || ''; if (/\/sw\.js$/.test(u)) r.unregister(); })).catch(() => { });
  navigator.serviceWorker.register('service-worker.js').catch(() => { });
}

(async function init() {
  state.athletes = LS.get('tl3.athletes', []); state.cur = LS.get('tl3.cur', null);
  try {
    if (!window.indexedDB) throw new Error('sin IndexedDB');
    state.db = await DB.open();
    const recs = await DB.all();
    // migración: sesiones de la versión anterior (sin deportista) se asignan a "Deportista 1" con su perfil
    if (recs.some(r => !r.ath) && !state.athletes.length) { const old = LS.get('tl2.profile', {}); state.athletes.push({ id: 'a_legacy', name: 'Deportista 1', profile: { hrMax: old.hrMax || 0, hrRest: old.hrRest || 0, lthr: old.lthr || 0, ftp: old.ftp || 0, sex: old.sex || 'm' } }); state.cur = 'a_legacy'; }
    for (const r of recs) { if (!r.ath) r.ath = state.athletes[0].id; if (r.obs == null) r.obs = C.observedMaxHr(r.rs); state.acts.push({ id: r.id, name: r.name, sport: r.sport, start: r.start, day: C.dayKey(r.start), rs: r.rs, rr: r.rr, ath: r.ath, obs: r.obs, A: null }); }
  } catch (e) { state.persist = false; }
  if (!state.athletes.find(a => a.id === state.cur)) state.cur = state.athletes[0] ? state.athletes[0].id : null;
  for (const at of state.athletes) { try { analyzeAthlete(at.id); } catch (e) { } }
  state.acts = state.acts.filter(a => a.A);
  saveAthletes(); selectLatest();
  window.__state = state;
  render();
})();
})();
