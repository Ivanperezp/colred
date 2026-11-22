// Generación por tecnología del último día disponible (XM: Gene por recurso + ListadoRecursos).
// Uso: node scripts/fetch-mix.mjs
import { P, writeJsonAtomic, ymd, addDays, updateMeta } from './lib.mjs';
import { xm } from './fetch-xm.mjs';
import { cargarCatalogo, cargarRecursos, pickMetric } from './xm-catalogo.mjs';

const nrm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
// Clasifica un recurso: devuelve {fine, coarse}
export function clasificar(rec) {
  const t = nrm(rec?.type), s = nrm(rec?.source);
  if (/HIDR/.test(t) || /AGUA/.test(s)) return { fine: 'Hidráulica', coarse: 'Hidráulica' };
  if (/SOLAR|RAD/.test(t + ' ' + s)) return { fine: 'Solar', coarse: 'Solar' };
  if (/EOLIC|VIENTO/.test(t + ' ' + s)) return { fine: 'Eólica', coarse: 'Eólica' };
  if (/BIOMASA|BAGAZO|BIOGAS|RESIDUO/.test(s)) return { fine: 'Biomasa y otras', coarse: 'Otras' };
  if (/GAS/.test(s)) return { fine: 'Térmica gas', coarse: 'Térmica' };
  if (/CARBON/.test(s)) return { fine: 'Térmica carbón', coarse: 'Térmica' };
  if (/ACPM|COMBUSTOLEO|FUEL|DIESEL|JET|QUEROSENO|LIQUID|GASOLINA/.test(s)) return { fine: 'Térmica líquidos', coarse: 'Térmica' };
  if (/TERM/.test(t)) return { fine: 'Térmica gas', coarse: 'Térmica' };
  return { fine: 'Biomasa y otras', coarse: 'Otras' };
}
// json de Gene/Recurso (horario) + mapa de recursos -> agregados en MWh por día. Devuelve {fecha: {fine:{}, hora:[{coarse:{}}...]}}
export function agregarGeneracion(json, recursos) {
  const days = {};
  for (const it of json?.Items || []) {
    const date = String(it.Date || '').slice(0, 10);
    for (const ent of it.HourlyEntities || []) {
      const v = ent.Values || ent, code = String(v.code ?? v.Code ?? ent.Code ?? ent.Id ?? '');
      const c = clasificar(recursos.get(code));
      const d = days[date] ||= { fine: {}, horas: Array.from({ length: 24 }, () => ({})), n: 0 };
      for (let h = 1; h <= 24; h++) {
        const raw = v['Hour' + String(h).padStart(2, '0')]; if (raw === undefined || raw === null || String(raw).trim() === '') continue;
        const n = Number(String(raw).replace(',', '.')); if (!Number.isFinite(n)) continue;
        const mwh = n / 1000; d.n++;
        d.fine[c.fine] = (d.fine[c.fine] || 0) + mwh; d.horas[h - 1][c.coarse] = (d.horas[h - 1][c.coarse] || 0) + mwh;
      }
    }
  }
  return days;
}
export function construirMix(day, fecha, stamp) {
  const total = Object.values(day.fine).reduce((a, b) => a + b, 0);
  const orden = ['Hidráulica', 'Térmica gas', 'Térmica carbón', 'Térmica líquidos', 'Solar', 'Eólica', 'Biomasa y otras'];
  const r1 = x => +x.toFixed(1);
  return {
    source: 'XM', updated_at: stamp, fecha_operacion: fecha, unit: 'MWh', total_mwh: r1(total),
    por_tecnologia: orden.filter(k => day.fine[k] > 0).map(k => ({ tecnologia: k, mwh: r1(day.fine[k]), pct: +(100 * day.fine[k] / total).toFixed(1) })),
    horario: day.horas.map((o, i) => ({ hora: i + 1, Hidráulica: r1(o['Hidráulica'] || 0), Térmica: r1(o['Térmica'] || 0), Solar: r1(o['Solar'] || 0), Eólica: r1(o['Eólica'] || 0), Otras: r1(o['Otras'] || 0) })),
  };
}

async function main() {
  const stamp = new Date().toISOString(), today = new Date(ymd(new Date()) + 'T00:00:00Z');
  const file = P('api', 'v1', 'generacion.json');
  try {
    let id = 'Gene';
    try {
      const m = pickMetric(await cargarCatalogo(), { idRe: /^Gene$/, nameRe: /^generacion real/, entity: 'Recurso', type: 'HourlyEntities' });
      if (m) id = m.id; else console.warn('  aviso: Gene no hallada en catálogo, se usa "Gene"');
    } catch (e) { console.warn('  aviso: catálogo no disponible:', e.message); }
    console.log('Métrica de generación:', id);
    const recursos = await cargarRecursos();
    if (!recursos.size) throw new Error('ListadoRecursos vacío');
    let done = null;
    for (let k = 1; k <= 4 && !done; k++) { // del día más reciente hacia atrás
      const f = ymd(addDays(today, -k));
      const j = await xm('hourly', { MetricId: id, StartDate: f, EndDate: f, Entity: 'Recurso', Filter: [] });
      const day = agregarGeneracion(j, recursos)[f];
      if (day && day.n > 0) done = { f, day };
    }
    if (!done) throw new Error('Sin datos de generación en los últimos 4 días');
    const out = construirMix(done.day, done.f, stamp);
    writeJsonAtomic(file, out);
    console.log(`OK  generacion ${done.f}: ${out.total_mwh} MWh, ${out.por_tecnologia.length} tecnologías`);
    updateMeta('xm_mix', 'ok');
  } catch (e) { console.error('ERR generacion:', e.message, '(se conserva el archivo anterior)'); try { updateMeta('xm_mix', 'error'); } catch {} process.exit(1); }
}
if (process.argv[1]?.endsWith('fetch-mix.mjs')) main();
