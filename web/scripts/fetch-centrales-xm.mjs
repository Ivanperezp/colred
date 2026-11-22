// Enriquece public/data/centrales.geojson con capacidad efectiva neta de XM.
// Uso: node scripts/fetch-centrales-xm.mjs
import { P, readJson, writeJsonAtomic, norm, ymd, addDays, fail, titleCase } from './lib.mjs';
import { xm, parseDaily } from './fetch-xm.mjs';

const STOP = new Set(['central', 'centrales', 'hidroelectrica', 'hidroelectrico', 'termoelectrica', 'termoelectrico', 'termo', 'planta', 'parque', 'solar', 'eolico', 'eolica', 'fotovoltaico', 'fotovoltaica', 'hidro', 'electrica', 'electrico', 'de', 'del', 'la', 'el', 'los', 'las', 'pch', 'mini', 'generadora', 'generacion', 'proyecto', 'power', 'plant', 'hydroelectric', 'hydro']);
export function coreName(s) {
  return norm(s).replace(/\b(unidad|u|g|gen|gas|vapor|ciclo combinado|cc|tg|tv)?\s*\d+\b/g, ' ').replace(/\b(i|ii|iii|iv|v|vi|cc|emg|b)\b/g, ' ').split(' ').map(w => w.replace(/^(termo|hidro)(?=[a-z]{4})/, '')).filter(w => w && !STOP.has(w)).join(' ').trim();
}
const toks = s => new Set(s.split(' ').filter(Boolean));
// Números romanos distinguen plantas distintas (Porce II vs III); los arábigos suelen ser unidades.
export const romans = s => new Set(norm(s).split(' ').filter(w => /^(i|ii|iii|iv|v|vi)$/.test(w)));
const disjoint = (A, B) => A.size && B.size && ![...A].some(x => B.has(x));
const isSmall = n => /^(agpe|gd)\b/.test(norm(n));
export function score(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = toks(a), B = toks(b); let inter = 0; for (const t of A) if (B.has(t)) inter++;
  const jac = inter / (A.size + B.size - inter);
  const contain = (a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 4 ? 0.85 : 0;
  return Math.max(jac, contain);
}
const techKind = t => { const n = norm(t); return /hidr|agua/.test(n) ? 'h' : /termic|gas|carbon|diesel|combust|fuel|acpm/.test(n) ? 't' : /solar|fotov/.test(n) ? 's' : /eolic|viento/.test(n) ? 'e' : /biomas|cogener|bagazo/.test(n) ? 'b' : '?'; };

// Parser de ListadoRecursos: Items[].ListEntities[].Values{ Code/Id, Name, Type, ...}
export function parseListado(json) {
  const out = new Map();
  for (const it of json?.Items || []) for (const e of it.ListEntities || []) {
    const v = e.Values || e;
    const get = (...ks) => { for (const k of Object.keys(v)) if (ks.includes(k.toLowerCase())) return v[k]; return undefined; };
    const code = get('code', 'id', 'codigo') ?? e.Id;
    const name = get('name', 'nombre', 'resourcename');
    if (!code || !name) continue;
    out.set(String(code), { code: String(code), name: String(name), tipo: get('type', 'tipo', 'resourcetype', 'enersource', 'fuente') ?? '' , all: v });
  }
  return out;
}
// Agrupa recursos XM por nombre base (p.ej. "TERMOFLORES 1..4" -> uno) sumando MW.
export function groupPlants(listado, cap /* Map code->MW */) {
  const g = new Map();
  for (const [code, r] of listado) {
    const mw = cap.get(code); if (!(mw > 0)) continue;
    if (isSmall(r.name)) continue;
    const key = [coreName(r.name) || norm(r.name), ...romans(r.name)].join(' ');
    const e = g.get(key) || { key, nombres: [], codigos: [], mw: 0, tipo: r.tipo };
    e.nombres.push(r.name); e.codigos.push(code); e.mw += mw; g.set(key, e);
  }
  return [...g.values()].map(e => ({ ...e, nombre: e.nombres[0], mw: +e.mw.toFixed(2) }));
}
// Alias: nombre base XM -> nombre base esperado en OSM (verificados por nombre comercial de la planta)
export const ALIAS = { ituango: 'ituango', tebsab: 'barranqui', barranquilla: 'barranqui', pagua: 'guaca', guatron: 'guadalupe', alban: 'anchicaya', zipaemg: 'zipa', zipa: 'zipa', paipa: 'paipa', emcali: 'emcali', termoemcali: 'emcali', centro: 'termocentro', flores: 'flores', yopal: 'yopal', miel: 'miel' };
// Cada planta XM se asigna a la central OSM más parecida; varias plantas XM pueden sumar en la misma central (p. ej. Flores 1 + Flores 4).
export function matchPlants(features, plants, thr = 0.6) {
  const fc = features.map(f => coreName(f.properties.nombre) || norm(f.properties.nombre));
  const res = [], unmatched = [];
  for (const [j, p] of plants.entries()) {
    const base = coreName(p.nombre) || norm(p.nombre); const key = ALIAS[base] || ALIAS[base.split(' ')[0]] || base; const pr = romans(p.nombres.join(' '));
    let best = null;
    fc.forEach((c, i) => {
      let s = score(c, key);
      if (s <= 0) return;
      const a = techKind(features[i].properties.tecnologia), b = techKind(p.tipo);
      if (a !== '?' && b !== '?') s += a === b ? 0.02 : -0.5;
      if (disjoint(pr, romans(features[i].properties.nombre))) s -= 0.5;
      if (s >= thr && (!best || s > best.s)) best = { i, j, s };
    });
    if (best) res.push(best); else unmatched.push(p);
  }
  return { matches: res, unmatchedPlants: unmatched };
}


// Busca en OSM, por nombre, las plantas grandes de XM que no están en centrales.geojson
// (p. ej. mapeadas como power=generator o sin etiqueta power=plant).
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const TECH_XM = t => ({ h: 'Hidráulica', t: 'Térmica gas', s: 'Solar', e: 'Eólica', b: 'Biomasa' }[techKind(t)] || 'Otra');
export async function osmLookup(plants) {
  const terms = [...new Set(plants.map(p => { const b = coreName(p.nombre) || norm(p.nombre); return (ALIAS[b] || b).split(' ').sort((x, y) => y.length - x.length)[0]; }).filter(t => t && t.length >= 4))];
  if (!terms.length) return [];
  const re = terms.map(t => t.replace(/[^a-z0-9]/g, '.')).join('|');
  const q = `[out:json][timeout:180];area["ISO3166-1"="CO"][admin_level=2]->.co;(nwr["power"~"^(plant|generator)$"]["name"~"${re}",i](area.co);nwr["landuse"="reservoir"]["name"~"${re}",i](area.co););out center tags;`;
  for (const url of [...OVERPASS, ...OVERPASS]) {
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': 'ColRed/0.1 (https://colred.org)' } });
      if (!r.ok) { console.log(`  Overpass ${url} -> HTTP ${r.status}: ${(await r.text()).replace(/\s+/g, ' ').slice(0, 300)}`); await new Promise(z => setTimeout(z, 8000)); continue; }
      const j = await r.json();
      return (j.elements || []).map(e => ({ name: e.tags?.name || '', power: e.tags?.power || e.tags?.landuse, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon })).filter(e => e.lat && e.lon && e.name);
    } catch (e) { console.log(`  Overpass ${url} -> ${e.message}`); }
  }
  console.log('  aviso: Overpass no respondió; se omite la búsqueda por nombre');
  console.log('  consulta:', q.slice(0, 400));
  return [];
}

// ---- Fuentes oficiales de ubicación (datos.gov.co, Socrata) para plantas XM sin ubicar ----
// EPM "Plantas De Aguas Y Energía" (q6f3-ygre): nombre, ubicaci_n (municipio), tipo, latitud, longitud (coordenadas exactas).
// MinEnergía/UPME "Meta FNCER" (vy9n-w6hc): proyecto, tipo, capacidad, departamento, municipio, codigo_municipio (DIVIPOLA).
export const SOURCES = { epm: 'https://www.datos.gov.co/resource/q6f3-ygre.json?$limit=5000', fncer: 'https://www.datos.gov.co/resource/vy9n-w6hc.json?$limit=5000' };
const inCo = (lat, lon) => lat > -4.5 && lat < 13.6 && lon > -79.5 && lon < -66.5;
// Las coordenadas de EPM vienen a veces sin separador decimal (p. ej. -7475839042): se reubica la coma para caer dentro de Colombia.
export function fixCoord(v, isLon) {
  const raw = String(v ?? '').trim(); if (!raw) return null;
  const n = Number(raw.replace(',', '.')); const lim = isLon ? 180 : 90;
  const ok = x => Number.isFinite(x) && (isLon ? x < -66.5 && x > -79.5 : x > -4.5 && x < 13.6);
  if (ok(n) && Math.abs(n) < lim) return n;
  const digits = raw.replace(/[^0-9]/g, ''); if (digits.length < 3) return null;
  const sign = raw.startsWith('-') ? -1 : 1;
  for (const k of [1, 2]) { const x = sign * Number(digits.slice(0, k) + '.' + digits.slice(k)); if (ok(x)) return x; }
  return null;
}
export function parseEpm(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!/energ/i.test(String(r.tipo ?? r.tipo_de_planta ?? 'energia'))) continue;
    const name = String(r.nombre ?? '').trim(); if (!name || /prueba/i.test(name)) continue;
    const lat = fixCoord(r.latitud, false), lon = fixCoord(r.longitud, true);
    if (lat == null || lon == null || !inCo(lat, lon)) continue;
    out.push({ fuente: 'epm', name, tipo: '', municipio: String(r.ubicaci_n ?? r.ubicacion ?? '').trim(), lat, lon });
  }
  return out;
}
export function parseFncer(rows) {
  const out = [];
  for (const r of rows || []) {
    const name = String(r.proyecto ?? '').trim(); if (!name) continue;
    out.push({ fuente: 'fncer', name, tipo: String(r.tipo ?? ''), municipio: String(r.municipio ?? ''), departamento: String(r.departamento ?? ''), divipola: String(r.codigo_municipio ?? '').padStart(5, '0'), mw: Number(r.capacidad) || null });
  }
  return out;
}
export function buildCentroidIndex(features) {
  const byCode = new Map(), byName = new Map();
  for (const f of features || []) { const p = f.properties || {}; const c = f.geometry?.coordinates; if (!c) continue; byCode.set(p.divipola, { ...p, coords: c }); const k = norm(p.nombre); (byName.get(k) || byName.set(k, []).get(k)).push({ ...p, coords: c }); }
  return { byCode, byName };
}
export function findMunicipio(idx, { divipola, municipio, departamento }) {
  if (divipola && idx.byCode.has(divipola)) return idx.byCode.get(divipola);
  for (const part of String(municipio || '').split(/\s*(?:[-/,;]|\sy\s)\s*/)) {
    const c = idx.byName.get(norm(part.replace(/\(.*\)/, ''))); if (!c) continue;
    const d = norm(departamento || ''); const hit = d ? c.find(x => norm(x.departamento) === d) : c.length === 1 ? c[0] : c.find(x => x.cod_dpto === '05');
    if (hit) return hit;
  }
  return null;
}
// Asigna a cada planta XM (>= minMw) la mejor entrada de las fuentes oficiales por nombre normalizado.
export function placeFromSources(plants, entries, idx, minMw = 1, thr = 0.8) {
  const res = [];
  for (const p of plants) {
    if (!(p.mw >= minMw)) continue;
    const b = coreName(p.nombre) || norm(p.nombre), key = ALIAS[b] || b, pr = romans(p.nombres.join(' '));
    let best = null;
    for (const e of entries) {
      let sc = score(coreName(e.name) || norm(e.name), key);
      if (disjoint(pr, romans(e.name))) sc -= 0.5;
      const a = techKind(e.name + ' ' + (e.tipo || '')), t = techKind(p.tipo); if (a !== '?' && t !== '?' && a !== t) sc -= 0.5;
      if (sc >= thr && (!best || sc > best.sc)) best = { e, sc };
    }
    if (!best) continue;
    const e = best.e; let coords, precision, ubic;
    if (e.lat != null) { coords = [+e.lon.toFixed(5), +e.lat.toFixed(5)]; precision = 'oficial'; ubic = `Coordenadas oficiales EPM (datos.gov.co q6f3-ygre): "${e.name}"${e.municipio ? ', ' + e.municipio : ''}`; }
    else { const m = findMunicipio(idx, e); if (!m) continue; coords = m.coords; precision = 'aproximada'; ubic = `Aproximada al municipio de ${m.nombre} (${m.departamento}): MinEnergía/UPME Meta FNCER (datos.gov.co vy9n-w6hc)`; }
    res.push({ plant: p, coords, precision, ubicacion: ubic });
  }
  return res;
}
async function fetchSource(url) {
  const r = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'ColRed/0.1 (https://colred.org)' } });
  if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
}


// OSM a veces tiene la misma central dos veces (punto y polígono). Quita la copia sin potencia
// si hay otra central con nombre equivalente y potencia de XM a menos de 15 km.
export function quitarDuplicados(gj) {
  const kmd = (a, b) => { const r = Math.PI / 180, dy = (b[1] - a[1]) * r, dx = (b[0] - a[0]) * r * Math.cos(a[1] * r); return 6371 * Math.hypot(dx, dy); };
  const xm = gj.features.filter(f => String(f.properties.mw_fuente || '').startsWith('XM'));
  const before = gj.features.length;
  gj.features = gj.features.filter(f => {
    const p = f.properties; if (Number(p.mw) || String(p.mw_fuente || '').startsWith('XM')) return true;
    const c = coreName(p.nombre) || norm(p.nombre || ''); if (!c || /sin nombre/.test(c)) return true;
    return !xm.some(x => kmd(f.geometry.coordinates, x.geometry.coordinates) < 15 && score(c, coreName(x.properties.nombre) || norm(x.properties.nombre)) >= 0.8);
  });
  return before - gj.features.length;
}

async function main() {
  const today = new Date(ymd(new Date()) + 'T00:00:00Z');
  const win = { StartDate: ymd(addDays(today, -4)), EndDate: ymd(addDays(today, -1)) };
  let listado = new Map(), lastErr;
  for (const entity of ['Sistema', 'Recurso']) {
    try { listado = parseListado(await xm('lists', { MetricId: 'ListadoRecursos', ...win, Entity: entity, Filter: [] })); if (listado.size) break; } catch (e) { lastErr = e; }
  }
  if (!listado.size) fail('ListadoRecursos (XM /lists) sin datos', lastErr);
  console.log(`XM ListadoRecursos: ${listado.size} recursos`);

  const capRows = parseDaily(await xm('daily', { MetricId: 'CapEfecNeta', ...win, Entity: 'Recurso', Filter: [] }).catch(e => fail('CapEfecNeta (XM /daily)', e)));
  if (!capRows.length) fail('CapEfecNeta sin datos');
  const cap = new Map(); // último valor por recurso
  for (const r of capRows.sort((a, b) => a.date.localeCompare(b.date))) if (r.id) cap.set(String(r.id), r.value);
  // XM publica CapEfecNeta en kW; si el máximo es < 10000 asumimos que ya viene en MW.
  const max = Math.max(...cap.values());
  const div = max > 10000 ? 1000 : 1;
  for (const [k, v] of cap) cap.set(k, v / div);
  console.log(`XM CapEfecNeta: ${cap.size} recursos (divisor ${div}; mayor = ${(max / div).toFixed(0)} MW)`);

  const plants = groupPlants(listado, cap);
  const first = listado.values().next().value; if (first) console.log('Campos de ListadoRecursos:', Object.keys(first.all).join(', '));
  const file = P('data', 'centrales.geojson');
  const gj = readJson(file);
  if (!gj?.features) fail('no se pudo leer ' + file);
  gj.features = gj.features.filter(f => f.properties.origen !== 'busqueda_nombre');
  const { matches, unmatchedPlants } = matchPlants(gj.features, plants);

  const matched = new Set(matches.map(m => m.i));
  // Limpia un enriquecimiento anterior para que re-ejecutar sea idempotente
  gj.features.forEach(f => { const p = f.properties; if (String(p.mw_fuente || '').startsWith('XM')) { p.mw = p.mw_osm ?? null; delete p.mw_fuente; delete p.xm_codigos; delete p.xm_nombres; } });
  const agg = new Map();
  matches.forEach(m => { const a = agg.get(m.i) || []; a.push(plants[m.j]); agg.set(m.i, a); });
  for (const [i, list] of agg) {
    const p = gj.features[i].properties;
    p.mw_osm = p.mw ?? null;
    p.mw = +list.reduce((t, x) => t + x.mw, 0).toFixed(1); p.mw_fuente = 'XM (capacidad efectiva neta)';
    p.xm_codigos = list.flatMap(x => x.codigos).join(','); p.xm_nombres = list.flatMap(x => x.nombres).join(', ');
    if (p.precision === 'aproximada') p.precision = 'oficial';
  }
  gj.features.forEach((f, i) => { if (!matched.has(i) && !f.properties.mw_fuente) f.properties.mw_fuente = 'OpenStreetMap'; });
  // Plantas grandes sin ubicar: búsqueda por nombre en OSM (generadores, embalses)
  const big = unmatchedPlants.filter(p => p.mw > 20);
  const found = await osmLookup(big);
  const placed = new Set();
  for (const p of big) {
    const b = coreName(p.nombre) || norm(p.nombre), key = ALIAS[b] || b, pr = romans(p.nombres.join(' '));
    const prefer = e => (e.power === 'plant' ? 0.03 : e.power === 'generator' ? 0.02 : 0);
    let best = null;
    for (const e of found) { let sc = score(coreName(e.name) || norm(e.name), key) + prefer(e); if (disjoint(pr, romans(e.name))) sc -= 0.5; { const a = techKind(e.name), b = techKind(p.tipo); if (a !== '?' && b !== '?' && a !== b) sc -= 0.5; } if (sc >= 0.8 && (!best || sc > best.sc)) best = { e, sc }; }
    if (!best) continue;
    placed.add(p);
    gj.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [+best.e.lon.toFixed(5), +best.e.lat.toFixed(5)] },
      properties: { nombre: titleCase(p.nombre), tecnologia: TECH_XM(p.tipo), mw: +p.mw.toFixed(1), mw_fuente: 'XM (capacidad efectiva neta)', xm_codigos: p.codigos.join(','), xm_nombres: p.nombres.join(', '),
        origen: 'busqueda_nombre', ubicacion: `OpenStreetMap: "${best.e.name}" (${best.e.power})` } });
  }
  // Tabla de ubicaciones verificadas a mano (data/ubicaciones_manual.json), con fuente por planta
  const manual = readJson(P('data', 'ubicaciones_manual.json'))?.items || [];
  let nManual = 0;
  for (const p of big) {
    if (placed.has(p)) continue;
    const m = manual.find(x => x.precision !== 'no_encontrada' && norm(p.nombre).startsWith(norm(x.xm_nombre)));
    if (!m) continue;
    const same = gj.features.find(f => f.properties.origen === 'busqueda_nombre' && f.properties.manual === m.xm_nombre);
    if (same) { same.properties.mw = +(same.properties.mw + p.mw).toFixed(1); same.properties.xm_codigos += ',' + p.codigos.join(','); same.properties.xm_nombres += ', ' + p.nombres.join(', '); placed.add(p); continue; }
    placed.add(p); nManual++;
    gj.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
      properties: { nombre: m.nombre || titleCase(p.nombre), tecnologia: TECH_XM(p.tipo), mw: +p.mw.toFixed(1), mw_fuente: 'XM (capacidad efectiva neta)', xm_codigos: p.codigos.join(','), xm_nombres: p.nombres.join(', '),
        origen: 'busqueda_nombre', manual: m.xm_nombre, precision: m.precision === 'sitio' ? 'oficial' : 'aproximada',
        ubicacion: m.precision === 'sitio' ? `Verificada: ${m.fuente}` : m.precision === 'municipio' ? `Aproximada al municipio de ${m.municipio} (${m.departamento}): ${m.fuente}` : `Aproximada, fuente secundaria: ${m.fuente}` } });
  }
  if (manual.length) console.log(`Ubicaciones verificadas a mano: ${nManual} plantas agregadas desde data/ubicaciones_manual.json`);
  if (found.length) console.log(`Búsqueda por nombre en OSM: ${placed.size} de ${big.length} plantas grandes ubicadas`);
  // Plantas XM >= 1 MW aún sin ubicar: fuentes oficiales (datos.gov.co) con coordenadas o municipio
  let nOficial = 0;
  try {
    const pend = unmatchedPlants.filter(p => !placed.has(p) && p.mw >= 1);
    if (pend.length) {
      const entries = [];
      for (const [k, parse] of [['epm', parseEpm], ['fncer', parseFncer]]) {
        try { const e = parse(await fetchSource(SOURCES[k])); entries.push(...e); console.log(`Fuente oficial ${k}: ${e.length} registros`); } catch (e) { console.log(`  aviso: fuente ${k} no disponible (${e.message}); se omite`); }
      }
      const idx = buildCentroidIndex(readJson(P('data', 'municipios_centroides.geojson'))?.features);
      for (const r of placeFromSources(pend, entries, idx)) {
        const p = r.plant; placed.add(p); nOficial++;
        gj.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: r.coords },
          properties: { nombre: titleCase(p.nombre), tecnologia: TECH_XM(p.tipo), mw: +p.mw.toFixed(1), mw_fuente: 'XM (capacidad efectiva neta)', xm_codigos: p.codigos.join(','), xm_nombres: p.nombres.join(', '),
            origen: 'busqueda_nombre', precision: r.precision, ubicacion: r.ubicacion } });
      }
      console.log(`Fuentes oficiales: ${nOficial} de ${pend.length} plantas XM >= 1 MW ubicadas`);
    }
  } catch (e) { console.log('  aviso: ubicación por fuentes oficiales omitida:', e.message); }
  const stillUnmatched = unmatchedPlants.filter(p => !placed.has(p));
  const dup = quitarDuplicados(gj); if (dup) console.log(`Duplicados de OSM sin potencia eliminados: ${dup}`);
  gj.nota = 'Ubicación OpenStreetMap; potencia de XM (capacidad efectiva neta) cuando hay coincidencia de nombre.';
  writeJsonAtomic(file, gj);

  const sin = stillUnmatched.filter(p => p.mw > 20).sort((a, b) => b.mw - a.mw)
    .map(p => ({ nombre: p.nombre, codigos: p.codigos, tipo: String(p.tipo), mw: p.mw }));
  writeJsonAtomic(P('data', 'centrales_xm_sin_ubicar.json'), { source: 'XM', updated_at: new Date().toISOString(), umbral_mw: 20, items: sin });

  const sumXm = plants.reduce((s, p) => s + p.mw, 0);
  console.log(`Centrales en geojson: ${gj.features.length}; con MW de XM: ${matches.length}; solo OSM: ${gj.features.length - matches.length}`);
  console.log(`Plantas XM agrupadas: ${plants.length} (${sumXm.toFixed(0)} MW); sin ubicar >20 MW: ${sin.length} (${sin.reduce((s, p) => s + p.mw, 0).toFixed(0)} MW) -> data/centrales_xm_sin_ubicar.json`);
  console.log('Fuente: XM servapibi (ListadoRecursos, CapEfecNeta)');
}
if (process.argv[1]?.endsWith('fetch-centrales-xm.mjs')) main().catch(e => fail('fetch-centrales-xm', e));
