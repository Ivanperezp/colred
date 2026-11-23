// Descarga datos reales de OpenStreetMap (Overpass) para Colombia. Ejecutar en tu PC: npm run datos:osm  (Node 18+)
import { writeFileSync, mkdirSync } from 'node:fs';
import { substationFootprints } from './osm-predios.mjs';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const AREA = 'area["ISO3166-1"="CO"][admin_level=2]->.co;';
const q = body => `[out:json][timeout:300];${AREA}(${body});out geom tags;`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function overpass(query) {
  let err;
  for (let i = 0; i < 4; i++) {
    const url = ENDPOINTS[i % ENDPOINTS.length];
    try {
      console.log('Consultando', url, '...');
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'ColRed-datos/1.0' }, body: 'data=' + encodeURIComponent(query) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return (await r.json()).elements || [];
    } catch (e) { err = e; console.warn('Fallo:', e.message, '- reintentando'); await sleep(8000 * (i + 1)); }
  }
  throw err;
}
const r5 = n => Math.round(n * 1e5) / 1e5;
const kvOf = v => { // "230000;115000" -> máximo en kV
  if (!v) return null;
  const n = String(v).split(/[;,]/).map(s => parseInt(s, 10)).filter(x => x > 0);
  if (!n.length) return null;
  const m = Math.max(...n); return Math.round(m >= 1000 ? m / 1000 : m);
};
const center = el => {
  if (el.type === 'node') return [el.lon, el.lat];
  if (el.center) return [el.center.lon, el.center.lat];
  const g = el.geometry || (el.members || []).flatMap(m => m.geometry || []);
  if (!g.length) return null;
  const xs = g.map(p => p.lon), ys = g.map(p => p.lat);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};
const SRC = { hydro: 'Hidráulica', gas: 'Térmica gas', coal: 'Térmica carbón', oil: 'Térmica gas', diesel: 'Térmica gas', wind: 'Eólica', solar: 'Solar', biomass: 'Biomasa', biogas: 'Biomasa', waste: 'Biomasa' };
const mwOf = v => { // "2400 MW", "300 kW", "1.2 GW"
  const m = String(v || '').replace(',', '.').match(/([\d.]+)\s*(GW|MW|kW|W)?/i);
  if (!m) return null; const x = parseFloat(m[1]); if (!isFinite(x)) return null;
  const u = (m[2] || 'W').toLowerCase();
  return Math.round(({ gw: x * 1000, mw: x, kw: x / 1e3, w: x / 1e6 })[u] * 10) / 10;
};
const fc = f => ({ type: 'FeatureCollection', features: f });
const out = (n, o) => { mkdirSync('public/data', { recursive: true }); writeFileSync(`public/data/${n}.geojson`, JSON.stringify(o)); console.log(n, o.features.length); };

const lines = await overpass(q('way["power"="line"](area.co);way["power"="minor_line"](area.co);way["power"="cable"](area.co);'));
out('lineas', fc(lines.filter(e => e.geometry?.length > 1).map(e => ({ type: 'Feature', properties: { tension_kv: kvOf(e.tags?.voltage), name: e.tags?.name || null }, geometry: { type: 'LineString', coordinates: e.geometry.map(p => [r5(p.lon), r5(p.lat)]) } }))));

const subs = await overpass(q('node["power"="substation"](area.co);way["power"="substation"](area.co);relation["power"="substation"](area.co);'));
out('subestaciones', fc(subs.map(e => { const c = center(e); return c && { type: 'Feature', properties: { nombre: e.tags?.name || null, tension_kv: kvOf(e.tags?.voltage) }, geometry: { type: 'Point', coordinates: c.map(r5) } }; }).filter(Boolean)));
const footprints = substationFootprints(subs);
if (footprints.length) out('predios_subestaciones', fc(footprints));

const plants = await overpass(q('way["power"="plant"](area.co);relation["power"="plant"](area.co);node["power"="plant"](area.co);'));
out('centrales', fc(plants.map(e => {
  const c = center(e), t = e.tags || {}; if (!c) return null;
  const src = String(t['plant:source'] || '').split(';')[0].trim();
  return { type: 'Feature', properties: { nombre: t.name || 'Central sin nombre', tecnologia: SRC[src] || 'Otra', mw: mwOf(t['plant:output:electricity']) }, geometry: { type: 'Point', coordinates: c.map(r5) } };
}).filter(Boolean)));
console.log('Listo. Fuente: © OpenStreetMap contributors (ODbL).');
