// Utilidades compartidas por los scripts datos:* (Node 18+, sin dependencias).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUB = path.join(ROOT, 'public');
export const P = (...a) => path.join(PUB, ...a);

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
// Escritura atómica: escribe .tmp y renombra, nunca deja archivos a medias.
export function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

export async function fetchJson(url, opts = {}, { retries = 3, timeoutMs = 60000 } = {}) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': 'ColRed/0.1 (https://colred.org)', Accept: 'application/json', ...(opts.headers || {}) } });
      clearTimeout(t);
      if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
      const j = await r.json();
      if (j && j.error && typeof j.error === 'object') throw new Error(`API error ${j.error.code} ${j.error.message}`);
      return j;
    } catch (e) { last = e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
  throw new Error(`${url.slice(0, 140)} -> ${last && last.message}`);
}

export const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function titleCase(s) {
  return String(s ?? '').toLowerCase().replace(/(^|[\s\-(\/])([a-záéíóúñü])/g, (_, a, b) => a + b.toUpperCase())
    .replace(/\b(De|Del|La|Las|Los|Y|El)\b/g, w => w.toLowerCase()).replace(/^./, c => c.toUpperCase());
}

export const ymd = d => d.toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
export const HISTORIAL_DIAS = 14;
export const fechaColombia = d => ymd(new Date(+new Date(d) - 5 * 3600000));

export function combinarHistorial(cached, days, since, size) {
  const previous = cached?.sample ? [] : cached?.historico || (cached?.fecha_operacion ? [cached] : []);
  const byDate = new Map();
  for (const { historico: _history, ...day } of [...previous, ...days]) {
    if (!day.fecha_operacion || day.fecha_operacion < since || !size(day)) continue;
    const existing = byDate.get(day.fecha_operacion);
    if (!existing || size(day) >= size(existing)) byDate.set(day.fecha_operacion, day);
  }
  return [...byDate.values()].sort((a, b) => a.fecha_operacion.localeCompare(b.fecha_operacion));
}

export function updateMeta(key, status, extra = {}) {
  const f = P('api', 'v1', 'meta.json');
  const m = readJson(f, {}) || {};
  m.generated_at = new Date().toISOString();
  m.sources = m.sources || {};
  const prev = m.sources[key] || {};
  m.sources[key] = { ...prev, status, last_ok: status === 'ok' ? m.generated_at : (prev.last_ok || null), ...extra };
  delete m.sample;
  writeJsonAtomic(f, m);
}

// ---------- ArcGIS ----------
export function qs(o) { return Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'); }

export async function arcgisPaged(layerUrl, params, { pageSize = 1000, paginate = true } = {}) {
  const feats = [];
  let offset = 0;
  for (let guard = 0; guard < 200; guard++) {
    const p = { where: '1=1', f: 'geojson', outSR: 4326, ...params };
    if (paginate) { p.resultOffset = offset; p.resultRecordCount = pageSize; p.orderByFields = 'OBJECTID'; }
    const j = await fetchJson(`${layerUrl}/query?${qs(p)}`);
    const fs_ = j.features || [];
    feats.push(...fs_);
    const more = j.exceededTransferLimit ?? j.properties?.exceededTransferLimit;
    if (!paginate || fs_.length === 0 || (!more && fs_.length < pageSize)) break;
    offset += fs_.length;
  }
  return feats;
}

// ---------- geometría ----------
export function roundCoords(c, n = 4) {
  if (typeof c[0] === 'number') return [+c[0].toFixed(n), +c[1].toFixed(n)];
  return c.map(x => roundCoords(x, n));
}
function ringCentroid(r) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < r.length - 1; i++) {
    const [x0, y0] = r[i], [x1, y1] = r[i + 1], f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  a /= 2;
  return Math.abs(a) < 1e-12 ? { c: r[0], a: 0 } : { c: [cx / (6 * a), cy / (6 * a)], a: Math.abs(a) };
}
// Centroide del anillo exterior de mayor área (suficiente para etiquetar municipios).
export function geomCentroid(g) {
  if (!g) return null;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
  if (!polys) return null;
  let best = null;
  for (const p of polys) { const r = ringCentroid(p[0]); if (!best || r.a > best.a) best = r; }
  return best ? [+best.c[0].toFixed(5), +best.c[1].toFixed(5)] : null;
}

export function parseKv(...texts) {
  for (const t of texts) {
    const m = String(t ?? '').match(/(\d{2,3}(?:[.,]\d+)?)\s*kV/i);
    if (m) return Math.round(parseFloat(m[1].replace(',', '.')));
  }
  return null;
}

export function fail(msg, e) {
  console.error(`ERROR: ${msg}${e ? ' -> ' + (e.message || e) : ''}`);
  process.exit(1);
}
