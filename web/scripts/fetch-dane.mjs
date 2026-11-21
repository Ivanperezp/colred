// Municipios (centroides) y departamentos con códigos DIVIPOLA (basados en el MGN del DANE).
// Fuente verificada: Superservicios geoportal (MUNICIPIOS_FASE2, derivado del MGN). Se prueba antes
// el servicio del DANE si defines DANE_MUN_URL / DANE_DPTO_URL (URL de capa .../MapServer/N).
// Uso: node scripts/fetch-dane.mjs
import { P, writeJsonAtomic, fetchJson, qs, titleCase, geomCentroid, roundCoords, fail } from './lib.mjs';

const SS = 'https://geoportal.superservicios.gov.co/server/rest/services/MUNICIPIOS_FASE2/MapServer';
const MUN = [process.env.DANE_MUN_URL, `${SS}/0`].filter(Boolean);
const DPT = [process.env.DANE_DPTO_URL, `${SS}/1`].filter(Boolean);

const pick = (a, ...names) => { for (const k of Object.keys(a)) if (names.includes(k.toUpperCase())) return a[k]; };
export function mapMunicipio(f) {
  const a = f.properties || {};
  let code = pick(a, 'MPIO_CDPMP', 'ID_ESPACIA', 'COD_MPIO', 'MPIO_CCDGO', 'DIVIPOLA');
  if (code == null) return null;
  code = String(code).trim(); if (/^\d+$/.test(code)) code = code.padStart(5, '0');
  if (!/^\d{5}$/.test(code)) return null;
  const c = geomCentroid(f.geometry); if (!c) return null;
  const nombre = titleCase(pick(a, 'MPIO_CNMBR', 'NOM_MUNICI', 'NOM_MPIO') ?? code);
  const dep = titleCase(pick(a, 'DPTO_CNMBR', 'NOM_DEPART', 'NOM_DPTO') ?? '');
  return { type: 'Feature', properties: { divipola: code, nombre, departamento: dep }, geometry: { type: 'Point', coordinates: c } };
}
export function mapDepto(f) {
  const a = f.properties || {};
  let code = pick(a, 'DPTO_CCDGO', 'ID_ESPACIA', 'COD_DPTO', 'COD_DEPTO'); if (code == null) return null;
  code = String(code).trim().padStart(2, '0').slice(0, 2);
  return { type: 'Feature', properties: { cod_dpto: code, nombre: titleCase(pick(a, 'DPTO_CNMBR', 'NOMBRE_DPT', 'NOM_DEPART', 'NOM_DPTO') ?? code), source: 'DANE MGN (vía Superservicios)' }, geometry: f.geometry && { ...f.geometry, coordinates: roundCoords(f.geometry.coordinates, 3) } };
}
async function query(layer, extra) {
  // MapServer de Superservicios NO soporta paginación (error 400); maxRecordCount=2000 cubre ~1.122 municipios.
  const j = await fetchJson(`${layer}/query?${qs({ where: '1=1', outFields: '*', outSR: 4326, f: 'geojson', returnGeometry: 'true', ...extra })}`, {}, { timeoutMs: 180000 });
  return j.features || [];
}
async function firstOk(layers, extra, min, mapper) {
  let err;
  for (const l of layers) {
    try { const r = (await query(l, extra)).map(mapper).filter(Boolean); if (r.length >= min) return { layer: l, feats: r }; err = new Error(`${l}: solo ${r.length} válidos`); } catch (e) { err = e; }
  }
  throw err || new Error('sin capas');
}

async function main() {
  const m = await firstOk(MUN, { maxAllowableOffset: 0.002, geometryPrecision: 4 }, 1000, mapMunicipio).catch(e => fail('municipios', e));
  const seen = new Set(); const feats = m.feats.filter(f => !seen.has(f.properties.divipola) && seen.add(f.properties.divipola));
  feats.sort((a, b) => a.properties.divipola.localeCompare(b.properties.divipola));
  writeJsonAtomic(P('data', 'municipios_centroides.geojson'), { type: 'FeatureCollection', properties: { source: 'DANE MGN (DIVIPOLA) vía ' + m.layer }, features: feats });
  console.log(`Municipios: ${feats.length} centroides (fuente ${m.layer})`);

  try {
    let off = 0.01, d;
    for (; off <= 0.08; off *= 2) {
      d = await firstOk(DPT, { maxAllowableOffset: off, geometryPrecision: 3 }, 30, mapDepto);
      const body = JSON.stringify({ type: 'FeatureCollection', properties: { source: 'DANE MGN (DIVIPOLA) vía ' + d.layer }, features: d.feats });
      if (body.length < 500000) { writeJsonAtomic(P('data', 'departamentos.geojson'), JSON.parse(body)); console.log(`Departamentos: ${d.feats.length} (${(body.length / 1024).toFixed(0)} KB, offset ${off})`); return; }
    }
    console.warn('  aviso: departamentos > 500 KB incluso simplificados; no se reemplaza departamentos.geojson');
  } catch (e) { console.warn('  aviso: departamentos no actualizados:', e.message); }
}
if (process.argv[1]?.endsWith('fetch-dane.mjs')) main().catch(e => fail('fetch-dane', e));
