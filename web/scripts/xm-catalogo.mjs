// Resolución en tiempo de ejecución de ids de métricas de XM desde ListadoMetricas.
import { xm } from './fetch-xm.mjs';

export function parseCatalogo(json) {
  const out = [];
  for (const it of json?.Items || []) for (const e of it.ListEntities || []) {
    const v = e.Values || e;
    if (v.MetricId) out.push({ id: v.MetricId, name: v.MetricName || '', entity: v.Entity || '', type: v.Type || '', units: v.MetricUnits || '', maxDays: Number(v.MaxDays) || null });
  }
  return out;
}
export async function cargarCatalogo() {
  return parseCatalogo(await xm('lists', { MetricId: 'ListadoMetricas', StartDate: '', EndDate: '', Entity: 'Sistema', Filter: [] }));
}
const nrm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Elige la primera métrica cuyo id coincida con idRe (prioridad) o cuyo nombre coincida con nameRe; filtra por entidad/tipo.
export function pickMetric(cat, { idRe, nameRe, entity, type }) {
  const ok = m => (!entity || m.entity === entity) && (!type || m.type === type);
  const c = cat.filter(ok);
  return (idRe && c.find(m => idRe.test(m.id))) || (nameRe && c.find(m => nameRe.test(nrm(m.name)))) || null;
}
export function parseRecursos(json) {
  const m = new Map();
  for (const it of json?.Items || []) for (const e of it.ListEntities || []) {
    const v = e.Values || e; const code = v.Code || e.Id; if (code) m.set(String(code), { type: v.Type || '', source: v.EnerSource || '' });
  }
  return m;
}
export async function cargarRecursos() {
  return parseRecursos(await xm('lists', { MetricId: 'ListadoRecursos', StartDate: '', EndDate: '', Entity: 'Sistema', Filter: [] }));
}
