// Calidad del servicio (continuidad) por operador de red: Superservicios, datos.gov.co.
// Dataset verificado: as4w-pgry "Superservicios-Información de Calidad - itad" (Formato 9).
// Campos: id_empresa, empresa, anio, periodo (trimestre), nivel_1, nivel_2_3  (ITAD = índice trimestral
// agrupado de discontinuidad, por nivel de tensión). NO hay SAIDI/SAIFI por municipio publicado ahí.
// Uso: node scripts/fetch-calidad.mjs
import { P, writeJsonAtomic, fetchJson, qs, fail } from './lib.mjs';

const URL = 'https://www.datos.gov.co/resource/as4w-pgry.json';
export function buildItems(rows) {
  const last = new Map();
  for (const r of rows) {
    const anio = +r.anio, per = +r.periodo, n1 = Number(r.nivel_1), n23 = Number(r.nivel_2_3);
    if (!r.id_empresa || !Number.isFinite(anio) || !Number.isFinite(per)) continue;
    const k = r.id_empresa, cur = last.get(k);
    if (!cur || anio * 10 + per > cur.anio * 10 + cur.per) last.set(k, { anio, per, r, n1, n23 });
  }
  return [...last.values()].map(({ anio, per, r, n1, n23 }) => ({
    operador: String(r.empresa).replace(/\s+/g, ' ').trim(), id_empresa: String(r.id_empresa), anio, trimestre: per,
    itad_nivel_1: Number.isFinite(n1) ? n1 : null, itad_nivel_2_3: Number.isFinite(n23) ? n23 : null,
  })).sort((a, b) => a.operador.localeCompare(b.operador));
}
async function main() {
  const rows = [];
  for (let off = 0; off < 200000; off += 5000) {
    const page = await fetchJson(`${URL}?${qs({ $limit: 5000, $offset: off, $order: 'id_empresa,anio,periodo' })}`).catch(e => fail('datos.gov.co as4w-pgry', e));
    rows.push(...page); if (page.length < 5000) break;
  }
  const items = buildItems(rows);
  if (!items.length) fail('sin items de calidad');
  const per = items.reduce((m, x) => Math.max(m, x.anio * 10 + x.trimestre), 0);
  writeJsonAtomic(P('api', 'v1', 'calidad_municipios.json'), { source: 'Superservicios (datos.gov.co as4w-pgry, ITAD Formato 9)', nota: 'Por operador y último trimestre reportado; no es por municipio.', periodo: `${Math.floor(per / 10)}-T${per % 10}`, items });
  console.log(`Calidad: ${rows.length} filas -> ${items.length} operadores (fuente Superservicios/datos.gov.co as4w-pgry)`);
}
if (process.argv[1]?.endsWith('fetch-calidad.mjs')) main().catch(e => fail('fetch-calidad', e));
