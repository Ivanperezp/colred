// Intercambios internacionales (Ecuador, Venezuela) del último día con datos de los últimos 7 días.
// Uso: node scripts/fetch-intercambios.mjs
import { P, writeJsonAtomic, ymd, addDays, updateMeta } from './lib.mjs';
import { xm, parseHourly, parseDaily } from './fetch-xm.mjs';
import { cargarCatalogo } from './xm-catalogo.mjs';

const nrm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const paisDe = s => { const t = nrm(s); return /ecuador|\btie\b|jamondino|pomasqui|quito|ipiales/.test(t) ? 'Ecuador' : /venez|\bint\b|cuestecitas|cuatricentenario|cucuta|san antonio|zulia/.test(t) ? 'Venezuela' : null; };

// Elige métricas del catálogo. Devuelve [{pais|null, dir:'imp'|'exp', m, via}]
export function elegirMetricas(cat) {
  const out = [];
  const find = (idRe, nameRe, filt = () => true) => cat.filter(filt).find(m => idRe.test(m.id)) || cat.filter(filt).find(m => nameRe.test(nrm(m.name)));
  // 1) físicas por país/enlace/sistema
  const phys = cat.filter(m => /^enlace$/i.test(m.entity) && /^(impo|expo)ener$/i.test(m.id));
  for (const m of phys) out.push({ pais: paisDe(m.id + ' ' + m.name), dir: /^impo/i.test(m.id) || /^importa/.test(nrm(m.name)) ? 'imp' : 'exp', m, via: 'fisica' });
  if (out.length) return out;
  // 2) TIE (Ecuador) e Int (Venezuela) en bolsa
  const defs = [['Ecuador', 'imp', /^CompBolsaTIEEner$/i, /compras? en bolsa.*tie/], ['Ecuador', 'exp', /^VentBolsaTIEEner$/i, /ventas? en bolsa.*tie/], ['Venezuela', 'imp', /^CompBolsaIntEner$/i, /compras? en bolsa.*(internacional|int\b)/], ['Venezuela', 'exp', /^VentBolsaIntEner$/i, /ventas? en bolsa.*(internacional|int\b)/]];
  for (const [pais, dir, idRe, nameRe] of defs) { const m = find(idRe, nameRe, m => /^sistema$/i.test(m.entity)); if (m) out.push({ pais, dir, m, via: 'bolsa' }); }
  return out;
}
// Suma por (fecha, país) en MWh (XM entrega kWh). Devuelve Map 'fecha|pais' -> MWh
export function agregar(items, pais, scale = 1000) {
  const acc = new Map();
  for (const x of items) {
    const p = pais || paisDe(x.id);
    if (!p) continue;
    const k = x.date + '|' + p; acc.set(k, (acc.get(k) || 0) + x.value / scale);
  }
  return acc;
}
const dailyOf = (json, hourly) => hourly
  ? (json?.Items || []).flatMap(it => (it.HourlyEntities || []).flatMap(ent => {
    const values = parseHourly({ Items: [{ Date: it.Date, HourlyEntities: [ent] }] });
    return values.length ? [{ date: String(it.Date || '').slice(0, 10), id: ent.Values?.code ?? ent.Values?.Code ?? ent.Code ?? ent.Id, value: values.reduce((a, b) => a + b.value, 0) }] : [];
  }))
  : parseDaily(json);
export function construir(sel, series, fecha, stamp) {
  const r1 = x => +x.toFixed(1);
  const paises = ['Ecuador', 'Venezuela'].map(pais => {
    const key = fecha + '|' + pais;
    const g = dir => {
      const matches = series.filter(s => s.pais === pais && s.dir === dir && s.acc.has(key));
      return matches.length ? matches.reduce((a, s) => a + s.acc.get(key), 0) : null;
    };
    const imp = g('imp'), exp = g('exp');
    return { pais, importacion_mwh: imp === null ? null : r1(imp), exportacion_mwh: exp === null ? null : r1(exp), saldo_mwh: imp === null || exp === null ? null : r1(exp - imp), metricas: [...new Set(sel.filter(s => s.pais === pais && series.some(t => t.pais === pais && t.m.id === s.m.id && t.acc.has(key))).map(s => s.m.id))] };
  });
  return { source: 'XM', updated_at: stamp, fecha_operacion: fecha, unit: 'MWh', paises };
}

async function main() {
  const now = new Date(), stamp = now.toISOString();
  const today = new Date(ymd(new Date(+now - 5 * 3600000)) + 'T00:00:00Z');
  const file = P('api', 'v1', 'intercambios.json');
  try {
    const sel = elegirMetricas(await cargarCatalogo());
    if (!sel.length) throw new Error('Sin métricas de intercambio en el catálogo');
    console.log('Métricas elegidas:', sel.map(s => `${s.m.id}[${s.m.entity}/${s.m.type}] ${s.dir} ${s.pais || 'por entidad'} (${s.via})`).join('; '));
    const series = [];
    for (const s of sel) {
      const hourly = /hourly/i.test(s.m.type);
      try {
        const j = await xm(hourly ? 'hourly' : 'daily', { MetricId: s.m.id, StartDate: ymd(addDays(today, -7)), EndDate: ymd(addDays(today, -1)), Entity: s.m.entity || 'Sistema', Filter: [] });
        series.push({ ...s, acc: agregar(dailyOf(j, hourly), s.pais) });
      } catch (e) { console.warn(`  aviso: ${s.m.id}: ${e.message}`); }
    }
    // Reexpande métricas sin país fijo (por entidad) en series por país
    const flat = series.flatMap(s => s.pais ? [s] : ['Ecuador', 'Venezuela'].map(pais => ({ ...s, pais })));
    const fechas = new Set(); flat.forEach(s => s.acc.forEach((_, k) => fechas.add(k.split('|')[0])));
    const fecha = [...fechas].sort().pop();
    if (!fecha) throw new Error('Sin datos de intercambios en los últimos 7 días');
    const out = construir(flat.map(s => ({ pais: s.pais, m: s.m })), flat, fecha, stamp);
    writeJsonAtomic(file, out);
    console.log(`OK  intercambios ${fecha}:`, out.paises.map(p => `${p.pais} saldo ${p.saldo_mwh} MWh`).join(', '));
    updateMeta('xm_intercambios', 'ok');
  } catch (e) { console.error('ERR intercambios:', e.message, '(se conserva el archivo anterior)'); try { updateMeta('xm_intercambios', 'error'); } catch {} process.exit(1); }
}
if (process.argv[1]?.endsWith('fetch-intercambios.mjs')) main();
