// Diagnóstico manual: CORS de la API de XM y métricas por recurso con datos recientes
const H = { 'Content-Type': 'application/json', 'User-Agent': 'ColRed/0.1 (https://colred.org)' };
const post = async (ep, body) => (await fetch(`https://servapibi.xm.com.co/${ep}`, { method: 'POST', headers: H, body: JSON.stringify(body) })).json();
const ymd = d => d.toISOString().slice(0, 10);
const hoy = new Date(Date.now() - 5 * 3600e3);
// 1) CORS
for (const m of ['OPTIONS']) {
  const r = await fetch('https://servapibi.xm.com.co/hourly', { method: m, headers: { Origin: 'https://colred.org', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  console.log('CORS preflight', r.status, [...r.headers].filter(([k]) => /access-control|vary/i.test(k)));
}
const r2 = await fetch('https://servapibi.xm.com.co/hourly', { method: 'POST', headers: { ...H, Origin: 'https://colred.org' }, body: JSON.stringify({ MetricId: 'CostMargDesp', StartDate: ymd(hoy), EndDate: ymd(hoy), Entity: 'Sistema', Filter: [] }) });
console.log('CORS POST', r2.status, [...r2.headers].filter(([k]) => /access-control|cache|age|date/i.test(k)));
// 2) Métricas por recurso
const lst = await post('lists', { MetricId: 'ListadoMetricas', Entity: 'Sistema' });
const items = (lst.Items || []).flatMap(i => i.ListEntities || []).map(e => e.Values || e);
const pick = items.filter(v => /Recurso|Planta|Embalse/i.test(v.Entity) && /gene|desp|prog|dispo|ofer|apor|real|ideal/i.test(v.MetricId + ' ' + v.MetricName));
console.log('Métricas por recurso:', pick.length);
for (const m of pick) {
  const ep = m.Type === 'HourlyEntities' ? 'hourly' : m.Type === 'DailyEntities' ? 'daily' : null; if (!ep) { console.log('   (tipo', m.Type, ')', m.MetricId, m.Entity, m.MetricName); continue; }
  for (const d of [0, 1, 2, 3, 4]) {
    const day = ymd(new Date(+hoy - d * 864e5));
    try {
      const j = await post(ep, { MetricId: m.MetricId, StartDate: day, EndDate: day, Entity: m.Entity, Filter: [] });
      const n = (j.Items || []).reduce((t, i) => t + (i.HourlyEntities || i.DailyEntities || []).length, 0);
      if (n) { console.log(`${day} ${String(n).padStart(4)} ent ${m.MetricId.padEnd(24)} ${m.Entity.padEnd(8)} ${m.MetricName} [${m.MetricUnits}]`); break; }
      if (d === 4) console.log(`SIN DATOS 5 días  ${m.MetricId} ${m.Entity} ${m.MetricName}`);
    } catch (e) { console.log('ERROR', m.MetricId, e.message); break; }
  }
}
