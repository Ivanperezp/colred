// Diagnóstico: qué métricas de XM tienen datos más recientes
const post = async (ep, body) => { const r = await fetch(`https://servapibi.xm.com.co/${ep}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'ColRed/0.1 (https://colred.org)' }, body: JSON.stringify(body) }); return r.json(); };
const ymd = d => d.toISOString().slice(0, 10);
const hoy = new Date(Date.now() - 5 * 3600e3), ini = new Date(hoy - 5 * 864e5);
const lst = await post('lists', { MetricId: 'ListadoMetricas', Entity: 'Sistema' });
const items = (lst.Items || []).flatMap(i => i.ListEntities || []).map(e => e.Values || e);
const pick = items.filter(v => v.Entity === 'Sistema' && /prec|dema|gene|ofer|despa|mpo|tx1|tx2|real|ideal|program/i.test(v.MetricId + ' ' + v.MetricName));
console.log('Métricas candidatas:', pick.length, '· hoy (Bogotá):', ymd(hoy));
for (const m of pick) {
  const ep = m.Type === 'HourlyEntities' ? 'hourly' : m.Type === 'DailyEntities' ? 'daily' : null; if (!ep) continue;
  try {
    const j = await post(ep, { MetricId: m.MetricId, StartDate: ymd(ini), EndDate: ymd(new Date(+hoy + 864e5)), Entity: 'Sistema', Filter: [] });
    const its = (j.Items || []).filter(i => (i.HourlyEntities || i.DailyEntities || []).length);
    const last = its.at(-1); let horas = '';
    if (last?.HourlyEntities) { const v = last.HourlyEntities[0].Values; horas = Object.keys(v).filter(k => /^Hour/.test(k) && v[k] !== null && v[k] !== '').length + ' h'; }
    console.log(`${(last?.Date || 'SIN DATOS').padEnd(10)} ${horas.padEnd(5)} ${m.MetricId.padEnd(22)} ${m.MetricName} [${m.MetricUnits}]`);
  } catch (e) { console.log('ERROR', m.MetricId, e.message); }
}
