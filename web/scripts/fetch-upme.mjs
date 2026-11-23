// Líneas STN y subestaciones STN de UPME (ArcGIS Online, servicio "Lineamientos").
// Uso: node scripts/fetch-upme.mjs
import { P, writeJsonAtomic, arcgisPaged, parseKv, roundCoords, fail } from './lib.mjs';

const SVC = 'https://services.arcgis.com/deQSb0Gn7gDPf3uV/ArcGIS/rest/services/Lineamientos/FeatureServer';
const clean = s => (s == null || String(s).trim() === '' || String(s).trim().toUpperCase() === 'NA') ? null : String(s).replace(/\s+/g, ' ').trim();

export function mapLine(f) {
  const a = f.properties || {};
  const kv = parseKv(a.NOMB_CIRCUITO, a.NOMB_TRAZADO);
  if (!kv || !f.geometry) return null;
  const inicio = clean(a.NOMBRE_SUBES_INICIO), fin = clean(a.NOMBRE_SUBES_FIN);
  const nombre = clean(a.NOMB_CIRCUITO) || [inicio, fin].filter(Boolean).join(' - ') || 'Línea STN';
  return { type: 'Feature', properties: { tension_kv: kv, nombre, name: nombre, subestacion_inicio: inicio, subestacion_fin: fin, propietario: clean(a.NOMBRE_PROPIETARIO), fuente: 'UPME' }, geometry: { ...f.geometry, coordinates: roundCoords(f.geometry.coordinates, 4) } };
}
export function mapSub(f) {
  const a = f.properties || {};
  const kv = parseKv(a.NOMBRE_SUBESTACION);
  if (!kv || !f.geometry) return null;
  const nombre = clean(a.NOMBRE_SUBESTACION).replace(/\s*\d+\s*kV\s*$/i, '').trim();
  return { type: 'Feature', properties: { tension_kv: kv, nombre, propietario: clean(a.NOMBRE_PROPIETARIO), fuente: 'UPME' }, geometry: { ...f.geometry, coordinates: roundCoords(f.geometry.coordinates, 5) } };
}

async function main() {
  const lines = (await arcgisPaged(`${SVC}/0`, { outFields: 'NOMB_CIRCUITO,NOMB_TRAZADO,NOMBRE_SUBES_INICIO,NOMBRE_SUBES_FIN,NOMBRE_PROPIETARIO,ID_TENSION', maxAllowableOffset: 0.0005, geometryPrecision: 5 }, { pageSize: 1000 }).catch(e => fail('UPME capa 0 (STN)', e)));
  const subs = (await arcgisPaged(`${SVC}/22`, { outFields: 'NOMBRE_SUBESTACION,NOMBRE_PROPIETARIO,ID_TENSION' }, { pageSize: 1000 }).catch(e => fail('UPME capa 22 (Subestaciones STN)', e)));
  const L = lines.map(mapLine).filter(Boolean), S = subs.map(mapSub).filter(Boolean);
  console.log(`UPME STN líneas: ${lines.length} recibidas, ${L.length} con tensión; subestaciones: ${subs.length} recibidas, ${S.length} con tensión`);
  if (L.length < 20) fail(`demasiadas pocas líneas (${L.length}); no se escribe nada`);
  const prop = { source: 'UPME - ArcGIS Lineamientos (STN)', generated_at: new Date().toISOString() };
  writeJsonAtomic(P('data', 'lineas_upme.geojson'), { type: 'FeatureCollection', properties: prop, features: L });
  if (S.length) writeJsonAtomic(P('data', 'subestaciones_upme.geojson'), { type: 'FeatureCollection', properties: prop, features: S });
  else console.warn('  aviso: sin subestaciones; no se escribe subestaciones_upme.geojson');
  if (S.length < 50) console.warn('  aviso: la capa 22 parece cubrir solo parte del país (campo TERRITORIO = Sabana de Bogotá); revisar cobertura.');
  console.log('Solo STN (>=220 kV); las líneas STR (<220 kV) no se encontraron en un servicio UPME público. Fuente: UPME');
}
if (process.argv[1]?.endsWith('fetch-upme.mjs')) main().catch(e => fail('fetch-upme', e));
