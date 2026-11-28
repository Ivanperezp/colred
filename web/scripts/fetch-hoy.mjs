// "Colombia hoy, hora a hora": generación programada, disponibilidad, precio previsto y plantas fuera de servicio.
// Uso: node scripts/fetch-hoy.mjs  ->  public/api/v1/hoy.json
import { P, readJson, writeJsonAtomic, ymd, addDays, fechaColombia, norm } from './lib.mjs';
import { xm, parseDaily } from './fetch-xm.mjs';
import { parseListado, coreName, romans } from './fetch-centrales-xm.mjs';
import { clasificar } from './fetch-mix.mjs';

const num = v => { if (v === null || v === undefined || String(v).trim() === '') return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const r1 = x => +x.toFixed(1);
const TECHS = ['Hidráulica', 'Térmica', 'Solar', 'Eólica', 'Otras'];

// Respuesta horaria -> Map(código -> 24 valores o null). Solo el día `fecha` si se indica.
export function parseHourlyByCode(json, fecha) {
  const out = new Map();
  for (const it of json?.Items || []) {
    if (fecha && String(it.Date || '').slice(0, 10) !== fecha) continue;
    for (const ent of it.HourlyEntities || []) {
      const v = ent.Values || ent;
      const code = String(v.code ?? v.Code ?? ent.Code ?? ent.Id ?? '');
      if (!code) continue;
      const arr = out.get(code) || Array(24).fill(null);
      for (let h = 1; h <= 24; h++) {
        const n = num(v['Hour' + String(h).padStart(2, '0')]);
        if (n !== null) arr[h - 1] = n;
      }
      out.set(code, arr);
    }
  }
  return out;
}
// Último valor de capacidad por recurso, en MW (XM publica kW; si el mayor es < 10000 se asume MW).
export function capacidadMw(json) {
  const cap = new Map();
  for (const r of parseDaily(json).sort((a, b) => a.date.localeCompare(b.date))) if (r.id) cap.set(String(r.id), r.value);
  const max = Math.max(0, ...cap.values()), div = max > 10000 ? 1000 : 1;
  for (const [k, v] of cap) cap.set(k, v / div);
  return cap;
}
export const codigosDeCentrales = gj => new Set((gj?.features || []).flatMap(f => String(f.properties?.xm_codigos || '').split(',').map(s => s.trim()).filter(Boolean)));

// Construcción pura del contrato (probada en test-parsers).
export function construirHoy({ fecha, stamp, metricaGen, gen, disp, precio, listado, cap, codigos, minMw = 20 }) {
  const info = code => { const r = listado.get(code); return { name: r?.name || code, coarse: clasificar(r ? { type: r.all?.Type ?? r.all?.type ?? '', source: r.all?.EnerSource ?? r.all?.enersource ?? '' } : undefined).coarse }; };
  const total = Array(24).fill(0), rep = Array(24).fill(false), dispo = Array(24).fill(0);
  const tech = Object.fromEntries(TECHS.map(t => [t, Array(24).fill(0)]));
  const porRecurso = {};
  for (const [code, arr] of gen) {
    const t = info(code).coarse;
    for (let h = 0; h < 24; h++) {
      if (arr[h] === null) continue;
      const mw = arr[h] / 1000; rep[h] = true; total[h] += mw; tech[TECHS.includes(t) ? t : 'Otras'][h] += mw;
    }
    if (codigos.has(code)) porRecurso[code] = arr.map(x => (x === null ? 0 : r1(x / 1000)));
  }
  for (const arr of disp.values()) arr.forEach((x, h) => { if (x !== null) dispo[h] += x / 1000; });
  const hasD = h => [...disp.values()].some(a => a[h] !== null);
  // Fuera de servicio: capacidad >= minMw y DispoReal == 0 en todas las horas reportadas (al menos una)
  const grupos = new Map();
  for (const [code, arr] of disp) {
    const c = cap.get(code) ?? 0; if (!(c / 1 >= minMw)) continue;
    const vals = arr.filter(x => x !== null);
    if (!vals.length || vals.some(x => x !== 0)) continue;
    const { name, coarse } = info(code);
    const key = [coreName(name) || norm(name), ...romans(name)].join(' ');
    const g = grupos.get(key) || { codigo: code, nombre: name, tecnologia: coarse, cap_mw: 0, codigos: [] };
    g.cap_mw += c; g.codigos.push(code); grupos.set(key, g);
  }
  const plantas = [...grupos.values()].map(g => ({ codigo: g.codigos.join(','), nombre: g.codigos.length > 1 ? (coreName(g.nombre) || g.nombre).toUpperCase() : g.nombre, tecnologia: g.tecnologia, cap_mw: r1(g.cap_mw) })).sort((a, b) => b.cap_mw - a.cap_mw);
  const porTec = {};
  for (const p of plantas) porTec[p.tecnologia] = r1((porTec[p.tecnologia] || 0) + p.cap_mw);
  const capTotal = [...cap.entries()].reduce((s, [code, v]) => (gen.has(code) || disp.has(code) ? s + v : s), 0); // capacidad efectiva de los recursos con datos hoy
  const pArr = precio ? precio : Array(24).fill(null);
  return {
    source: 'XM', updated_at: stamp, fecha,
    metricas: { generacion: metricaGen, disponibilidad: 'DispoReal', precio: 'CostMargDesp' },
    precio: pArr.map(x => (x === null ? null : r1(x))),
    generacion_total_mw: total.map((x, h) => (rep[h] ? r1(x) : null)),
    por_tecnologia: Object.fromEntries(TECHS.map(t => [t, tech[t].map((x, h) => (rep[h] ? r1(x) : null))])),
    por_recurso: porRecurso,
    fuera_de_servicio: { total_mw: r1(plantas.reduce((s, p) => s + p.cap_mw, 0)), capacidad_total_mw: capTotal > 0 ? r1(capTotal) : null, por_tecnologia: porTec, plantas },
    disponibilidad_total_mw: dispo.map((x, h) => (hasD(h) ? r1(x) : null)),
  };
}

const hourly = async (metric, entity, fecha) => parseHourlyByCode(await xm('hourly', { MetricId: metric, StartDate: fecha, EndDate: fecha, Entity: entity, Filter: [] }), fecha);

async function main() {
  const file = P('api', 'v1', 'hoy.json');
  try {
    const now = new Date(), stamp = now.toISOString();
    const hoy = fechaColombia(now), ayer = fechaColombia(addDays(new Date(hoy + 'T00:00:00Z'), -1));
    let fecha = hoy, metricaGen = 'GeneProgRedesp', gen = new Map();
    for (const f of [hoy, ayer]) {
      for (const m of ['GeneProgRedesp', 'GeneProgDesp']) {
        try { gen = await hourly(m, 'Recurso', f); } catch (e) { console.warn(`  aviso: ${m} ${f}: ${e.message}`); gen = new Map(); }
        if (gen.size) { metricaGen = m; break; }
      }
      if (gen.size) { fecha = f; break; }
    }
    if (!gen.size) throw new Error('sin generación programada para hoy ni ayer');
    const [disp, precioMap, listJson, capJson] = await Promise.all([
      hourly('DispoReal', 'Recurso', fecha).catch(e => { console.warn('  aviso: DispoReal:', e.message); return new Map(); }),
      hourly('CostMargDesp', 'Sistema', fecha).catch(e => { console.warn('  aviso: CostMargDesp:', e.message); return new Map(); }),
      xm('lists', { MetricId: 'ListadoRecursos', StartDate: '', EndDate: '', Entity: 'Sistema', Filter: [] }),
      xm('daily', { MetricId: 'CapEfecNeta', StartDate: ymd(addDays(new Date(hoy + 'T00:00:00Z'), -10)), EndDate: hoy, Entity: 'Recurso', Filter: [] }).catch(e => { console.warn('  aviso: CapEfecNeta:', e.message); return null; }),
    ]);
    const listado = parseListado(listJson);
    const cap = capJson ? capacidadMw(capJson) : new Map();
    const codigos = codigosDeCentrales(readJson(P('data', 'centrales.geojson')));
    const precio = precioMap.get('Sistema') || [...precioMap.values()][0] || null;
    const out = construirHoy({ fecha, stamp, metricaGen, gen, disp, precio, listado, cap, codigos });
    writeJsonAtomic(file, out);
    console.log(`OK hoy ${fecha}: ${gen.size} recursos, fuera de servicio ${out.fuera_de_servicio.total_mw} MW`);
  } catch (e) { console.error(`ERR hoy: ${e.message} (se conserva el archivo anterior)`); }
}
if (process.argv[1]?.endsWith('fetch-hoy.mjs')) main();
