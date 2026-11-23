// Líneas construidas STN/STR y subestaciones STN de UPME.
// Uso: node scripts/fetch-upme.mjs
import { P, writeJsonAtomic, arcgisPaged, parseKv, roundCoords, fail } from './lib.mjs';

const SVC = 'https://services.arcgis.com/deQSb0Gn7gDPf3uV/ArcGIS/rest/services/Lineamientos/FeatureServer';
const BUILT = 'https://geo.upme.gov.co/server/rest/services/Capas_EnergiaElectrica/Sistema_transmision_lineas_construidas/FeatureServer/17';
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

export function mapBuiltLine(f) {
  const a = f.properties || {};
  if (!['LineString', 'MultiLineString'].includes(f.geometry?.type) || !f.geometry.coordinates?.length) return null;
  const sistema = clean(a.sistema)?.match(/^(STN|STR)\b/)?.[1];
  if (!sistema) return null;
  const tension_kv = Number(a.tension) > 0 ? Number(a.tension) : parseKv(a.nombre_circuito, a.nombre_trazado);
  const inicio = clean(a.nombre_subestacion_inicio);
  const fin = clean(a.nombre_subestacion_fin);
  const nombre = clean(a.nombre_circuito) || clean(a.nombre_trazado) || [inicio, fin].filter(Boolean).join(' - ') || `Línea ${sistema}`;
  return {
    type: 'Feature',
    properties: { tension_kv, nombre, name: nombre, sistema, subestacion_inicio: inicio, subestacion_fin: fin, propietario: clean(a.nombre_propietario), vigencia: clean(a.vigencia), fuente: 'UPME' },
    geometry: f.geometry,
  };
}

async function main() {
  const generated_at = new Date().toISOString();
  const [lines, subs] = await Promise.allSettled([
    arcgisPaged(BUILT, { outFields: 'sistema,tension,nombre_circuito,nombre_trazado,nombre_subestacion_inicio,nombre_subestacion_fin,nombre_propietario,vigencia', geometryPrecision: 5 }),
    arcgisPaged(`${SVC}/22`, { outFields: 'NOMBRE_SUBESTACION,NOMBRE_PROPIETARIO,ID_TENSION' }),
  ]);
  const L = lines.status === 'fulfilled' ? lines.value.map(mapBuiltLine).filter(Boolean) : [];
  if (L.length >= 20 && L.some(f => f.properties.sistema === 'STN') && L.some(f => f.properties.sistema === 'STR')) {
    writeJsonAtomic(P('data', 'lineas_upme.geojson'), { type: 'FeatureCollection', properties: { source: 'UPME · Líneas construidas STN y STR', generated_at }, features: L });
    console.log(`UPME: ${L.length} trazados construidos STN y STR`);
  } else {
    console.warn('UPME líneas: respuesta insuficiente; se conserva el archivo anterior.', lines.reason?.message || '');
  }
  const S = subs.status === 'fulfilled' ? subs.value.map(mapSub).filter(Boolean) : [];
  if (S.length) {
    writeJsonAtomic(P('data', 'subestaciones_upme.geojson'), { type: 'FeatureCollection', properties: { source: 'UPME · ArcGIS Lineamientos (STN)', generated_at }, features: S });
  } else {
    console.warn('UPME subestaciones: se conserva el archivo anterior.', subs.reason?.message || '');
  }
}
if (process.argv[1]?.endsWith('fetch-upme.mjs')) main().catch(e => fail('fetch-upme', e));
