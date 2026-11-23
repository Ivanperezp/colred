// Demanda, precio de bolsa y embalses desde la API pública de XM (servapibi.xm.com.co).
// Uso: node scripts/fetch-xm.mjs
import { P, readJson, writeJsonAtomic, fetchJson, ymd, addDays, updateMeta, HISTORIAL_DIAS, fechaColombia, combinarHistorial } from './lib.mjs';

const BASE = 'https://servapibi.xm.com.co';
export async function xm(endpoint, body) {
  return fetchJson(`${BASE}/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
const num = v => { if (v === null || v === undefined || String(v).trim() === '') return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

// Parser horario: Items[].HourlyEntities[].Values.Hour01..Hour24 (strings). scale: divisor.
export function parseHourly(json, scale = 1) {
  const out = [];
  for (const it of json?.Items || []) {
    const date = String(it.Date || '').slice(0, 10);
    for (const ent of it.HourlyEntities || []) {
      const v = ent.Values || ent;
      for (let h = 1; h <= 24; h++) {
        const raw = v['Hour' + String(h).padStart(2, '0')];
        const n = num(raw);
        if (n === null || raw === '' ) continue;
        // Hora Colombia = UTC-5 fijo; HourNN cubre (NN-1):00-NN:00
        const ts = new Date(`${date}T${String(h - 1).padStart(2, '0')}:00:00-05:00`).toISOString();
        out.push({ ts, value: +(n / scale).toFixed(3) });
      }
    }
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}
// Parser diario: Items[].DailyEntities[].Values.Value (o primer numérico de Values). Devuelve [{date, id, value}].
export function parseDaily(json) {
  const out = [];
  for (const it of json?.Items || []) {
    const date = String(it.Date || '').slice(0, 10);
    for (const ent of it.DailyEntities || []) {
      const v = ent.Values || ent;
      let n = num(v.Value ?? v.value);
      if (n === null) for (const [k, x] of Object.entries(v)) if (!/code|id|name/i.test(k) && num(x) !== null) { n = num(x); break; }
      if (n !== null) out.push({ date, id: ent.Code ?? v.code ?? v.Code ?? ent.Id ?? null, value: n });
    }
  }
  return out;
}
async function dailyChunks(metric, entity, start, end) {
  const out = [];
  for (let s = new Date(start); s <= end; s = addDays(s, 30)) {
    const e = new Date(Math.min(addDays(s, 29).getTime(), end.getTime()));
    out.push(...parseDaily(await xm('daily', { MetricId: metric, StartDate: ymd(s), EndDate: ymd(e), Entity: entity, Filter: [] })));
  }
  return out;
}
export function pctSeries(vol, cap) {
  const capBy = new Map(cap.map(x => [x.date, x.value]));
  return vol.filter(x => capBy.get(x.date) > 0).map(x => ({ date: x.date, pct: +(100 * x.value / capBy.get(x.date)).toFixed(2) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function main() {
  const now = new Date(), today = new Date(fechaColombia(now) + 'T00:00:00Z');
  const stamp = now.toISOString();
  const jobs = {};

  jobs.demanda = async () => {
    const j = await xm('hourly', { MetricId: 'DemaReal', StartDate: ymd(addDays(today, -7)), EndDate: ymd(today), Entity: 'Sistema', Filter: [] });
    const series = parseHourly(j, 1000); // kWh -> MWh
    if (!series.length) throw new Error('DemaReal sin datos');
    return { source: 'XM', updated_at: stamp, unit: 'MWh', series };
  };
  jobs.precio_bolsa = async () => {
    const since = ymd(addDays(today, 1 - HISTORIAL_DIAS));
    const j = await xm('hourly', { MetricId: 'PrecBolsNaci', StartDate: since, EndDate: ymd(today), Entity: 'Sistema', Filter: [] });
    const all = parseHourly(j, 1); // ya en COP/kWh
    if (!all.length) throw new Error('PrecBolsNaci sin datos');
    const byDay = new Map();
    for (const point of all) {
      const date = fechaColombia(point.ts);
      if (!byDay.has(date)) byDay.set(date, new Map());
      byDay.get(date).set(point.ts, point);
    }
    const cached = readJson(P('api', 'v1', 'precio_bolsa.json'));
    const days = [...byDay].map(([fecha_operacion, hours]) => ({
      source: 'XM', updated_at: stamp, unit: 'COP/kWh', fecha_operacion, series: [...hours.values()],
    }));
    const historico = combinarHistorial(cached, days, since, day => day.series?.length || 0);
    return { ...historico.at(-1), historico };
  };
  // Precio previsto de hoy: costo marginal del despacho programado (XM lo publica para el día en curso)
  jobs.precio_hoy = async () => {
    const j = await xm('hourly', { MetricId: 'CostMargDesp', StartDate: ymd(addDays(today, -1)), EndDate: ymd(addDays(today, 1)), Entity: 'Sistema', Filter: [] });
    const all = parseHourly(j, 1);
    const hoy = fechaColombia(now);
    const delDia = d => all.filter(p => fechaColombia(p.ts) === d);
    let fecha = hoy, series = delDia(hoy);
    if (!series.length) { fecha = fechaColombia(addDays(today, -1)); series = delDia(fecha); }
    if (!series.length) throw new Error('CostMargDesp sin datos');
    const manana = delDia(fechaColombia(addDays(today, 1)));
    return { source: 'XM', metrica: 'CostMargDesp', updated_at: stamp, unit: 'COP/kWh', fecha_operacion: fecha, series, ...(manana.length ? { manana } : {}) };
  };
  // Demanda total diaria del SIN (sale con un día de retraso, antes que la horaria)
  jobs.demanda_diaria = async () => {
    const raw = await dailyChunks('DemaSIN', 'Sistema', addDays(today, -45), today);
    const series = raw.filter(x => Number.isFinite(x.value)).map(x => ({ date: x.date, gwh: +(x.value / 1e6).toFixed(2) }));
    if (!series.length) throw new Error('DemaSIN sin datos');
    return { source: 'XM', metrica: 'DemaSIN', updated_at: stamp, unit: 'GWh', series };
  };
  jobs.embalses = async () => {
    const start = addDays(today, -60);
    const [vol, cap] = await Promise.all([dailyChunks('VoluUtilDiarEner', 'Sistema', start, today), dailyChunks('CapaUtilDiarEner', 'Sistema', start, today)]);
    const series = pctSeries(vol, cap);
    if (!series.length) throw new Error('Embalses sin datos');
    const last = series[series.length - 1];
    const ly = addDays(new Date(last.date + 'T00:00:00Z'), -365);
    let prev = null;
    try {
      const [v2, c2] = await Promise.all([dailyChunks('VoluUtilDiarEner', 'Sistema', addDays(ly, -3), ly), dailyChunks('CapaUtilDiarEner', 'Sistema', addDays(ly, -3), ly)]);
      const s2 = pctSeries(v2, c2); prev = s2.length ? s2[s2.length - 1].pct : null;
    } catch (e) { console.warn('  aviso: año anterior no disponible:', e.message); }
    return { source: 'XM', updated_at: stamp, unit: '%', nacional: { volumen_util_pct: last.pct, anio_anterior_pct: prev }, series };
  };

  let ok = 0, bad = 0;
  for (const [name, fn] of Object.entries(jobs)) {
    try {
      const data = await fn();
      writeJsonAtomic(P('api', 'v1', name + '.json'), data);
      ok++; console.log(`OK  ${name}: ${data.series.length} puntos (fuente XM, ${data.unit})`);
    } catch (e) { bad++; console.error(`ERR ${name}: ${e.message} (se conserva el archivo anterior)`); }
  }
  updateMeta('xm', bad === 0 ? 'ok' : (ok === 0 ? 'error' : 'stale'));
  if (ok === 0) process.exit(1);
}
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('fetch-xm.mjs')) main().catch(e => { console.error(e); try { updateMeta('xm', 'error'); } catch {} process.exit(1); });
