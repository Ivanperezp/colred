// Indicador propio de riesgo de racionamiento con datos de XM. Uso: node scripts/fetch-riesgo.mjs
import { P, readJson, writeJsonAtomic, ymd, addDays, updateMeta } from './lib.mjs';
import { xm, parseHourly, parseDaily, pctSeries } from './fetch-xm.mjs';
import { cargarCatalogo, pickMetric } from './xm-catalogo.mjs';

export const REGLAS = 'Alto: volumen útil de embalses < 40 % o precio de bolsa promedio diario ≥ precio de escasez. Medio: embalses < 55 %, aportes hídricos < 80 % de la media histórica (últimos 7 días) o tendencia de embalses a 30 días < −5 puntos porcentuales. Bajo: ninguna de las anteriores. Es una estimación propia, no un pronóstico oficial.';

// Evalúa señales -> nivel. Entradas nulas no activan reglas.
export function evaluar({ embalse, tendencia, aportes, precio, escasez }) {
  const has = x => typeof x === 'number' && Number.isFinite(x);
  const alto = (has(embalse) && embalse < 40) || (has(precio) && has(escasez) && precio >= escasez);
  const medio = (has(embalse) && embalse < 55) || (has(aportes) && aportes < 80) || (has(tendencia) && tendencia < -5);
  return alto ? 'alto' : medio ? 'medio' : 'bajo';
}
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
// Aportes como % de la media histórica: suma de los últimos n días comunes.
export function ratioAportes(real, hist, n = 7) {
  const h = new Map(hist.map(x => [x.date, x.value]));
  const c = real.filter(x => h.get(x.date) > 0).sort((a, b) => a.date.localeCompare(b.date)).slice(-n);
  if (!c.length) return null;
  return +(100 * c.reduce((s, x) => s + x.value, 0) / c.reduce((s, x) => s + h.get(x.date), 0)).toFixed(1);
}
async function daily(metric, start, end, entity = 'Sistema') {
  const out = [];
  for (let s = new Date(start); s <= end; s = addDays(s, 30)) {
    const e = new Date(Math.min(addDays(s, 29).getTime(), end.getTime()));
    out.push(...parseDaily(await xm('daily', { MetricId: metric, StartDate: ymd(s), EndDate: ymd(e), Entity: entity, Filter: [] })));
  }
  return out;
}
const safe = async (nombre, fn) => { try { return await fn(); } catch (e) { console.warn(`  aviso: ${nombre}: ${e.message}`); return null; } };

async function main() {
  const stamp = new Date().toISOString(), today = new Date(ymd(new Date()) + 'T00:00:00Z');
  const file = P('api', 'v1', 'riesgo.json');
  const usadas = {};
  try {
    const cat = await cargarCatalogo();
    const mA = pickMetric(cat, { idRe: /^AporEner$/, nameRe: /aportes? hidricos? energia$|aportes? energia$/, entity: 'Sistema', type: 'DailyEntities' });
    const mH = pickMetric(cat, { idRe: /^AporEnerMediHist$/, nameRe: /aportes? .*media hist/, entity: 'Sistema', type: 'DailyEntities' });
    const mP = pickMetric(cat, { idRe: /^PorcApor/, nameRe: /porcentaje.*aportes|aportes.*porcentaje/, entity: 'Sistema', type: 'DailyEntities' });
    const mE = pickMetric(cat, { idRe: /^PrecEsca/, nameRe: /precio de escasez/, entity: 'Sistema' });
    Object.assign(usadas, { embalse: 'VoluUtilDiarEner/CapaUtilDiarEner', aportes: mP?.id || (mA && mH ? `${mA.id}/${mH.id}` : null), escasez: mE?.id || null, precio_bolsa: 'PrecBolsNaci' });
    console.log('Métricas elegidas:', JSON.stringify(usadas));

    const start = addDays(today, -45);
    const [vol, cap] = await Promise.all([daily('VoluUtilDiarEner', start, today), daily('CapaUtilDiarEner', start, today)]);
    const emb = pctSeries(vol, cap);
    if (!emb.length) throw new Error('Embalses sin datos');
    const last = emb[emb.length - 1];
    const ref = emb.filter(x => x.date <= ymd(addDays(new Date(last.date + 'T00:00:00Z'), -30))).pop();
    const tendencia = ref ? +(last.pct - ref.pct).toFixed(1) : null;

    const aportes = await safe('aportes', async () => {
      if (mP) { const s = (await daily(mP.id, addDays(today, -12), today)).sort((a, b) => a.date.localeCompare(b.date)).slice(-7); return s.length ? +mean(s.map(x => x.value)).toFixed(1) : null; }
      if (mA && mH) { const [r, h] = await Promise.all([daily(mA.id, addDays(today, -12), today), daily(mH.id, addDays(today, -12), today)]); return ratioAportes(r, h); }
      return null;
    });
    const escasez = mE ? await safe('escasez', async () => { const s = await daily(mE.id, addDays(today, -10), today, mE.entity); return s.length ? s.sort((a, b) => a.date.localeCompare(b.date)).pop().value : null; }) : null;
    const pb = await safe('precio bolsa', async () => {
      const p = parseHourly(await xm('hourly', { MetricId: 'PrecBolsNaci', StartDate: ymd(addDays(today, -7)), EndDate: ymd(today), Entity: 'Sistema', Filter: [] }));
      if (!p.length) return null;
      const day = t => new Date(new Date(t).getTime() - 5 * 3600000).toISOString().slice(0, 10), ld = day(p[p.length - 1].ts);
      const v = p.filter(x => day(x.ts) === ld).map(x => x.value); return { fecha: ld, prom: +mean(v).toFixed(1) };
    });

    const nivel = evaluar({ embalse: last.pct, tendencia, aportes, precio: pb?.prom, escasez });
    const f1 = x => x.toLocaleString('es-CO', { maximumFractionDigits: 1 });
    const senales = [
      { nombre: 'Embalses (volumen útil)', valor: last.pct, unidad: '%', estado: last.pct < 55 ? 'alerta' : 'ok', detalle: `Umbral: 55 % (crítico 40 %). Dato del ${last.date}.` },
      { nombre: 'Tendencia de embalses a 30 días', valor: tendencia, unidad: 'pp', estado: tendencia !== null && tendencia < -5 ? 'alerta' : 'ok', detalle: tendencia === null ? 'Sin datos suficientes.' : 'Alerta si cae más de 5 pp en 30 días.' },
      { nombre: 'Aportes hídricos vs. media histórica', valor: aportes, unidad: '%', estado: aportes !== null && aportes < 80 ? 'alerta' : 'ok', detalle: aportes === null ? 'Métrica no disponible.' : 'Promedio de los últimos 7 días. Alerta si < 80 %.' },
      { nombre: 'Precio de bolsa vs. precio de escasez', valor: pb?.prom ?? null, unidad: 'COP/kWh', estado: pb && escasez && pb.prom >= escasez ? 'alerta' : 'ok', detalle: pb ? (escasez ? `Escasez: ${f1(escasez)} COP/kWh. Promedio diario del ${pb.fecha}.` : `Precio de escasez no disponible. Promedio diario del ${pb.fecha}.`) : 'Sin datos de precio.' },
    ];
    writeJsonAtomic(file, { source: 'XM', updated_at: stamp, status: 'ok', nivel, senales, reglas: REGLAS, metricas_usadas: usadas });
    console.log('OK  riesgo:', nivel);
    updateMeta('xm_riesgo', 'ok');
  } catch (e) {
    console.error('ERR riesgo:', e.message, '(se conserva el dato anterior)');
    const prev = readJson(file);
    if (prev) writeJsonAtomic(file, { ...prev, status: 'error', error: e.message });
    try { updateMeta('xm_riesgo', 'error'); } catch {}
    process.exit(1);
  }
}
if (process.argv[1]?.endsWith('fetch-riesgo.mjs')) main();
