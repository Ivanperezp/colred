// Diagnóstico manual: forma de la respuesta de DispoReal y cruce con CapEfecNeta
const H = { 'Content-Type': 'application/json', 'User-Agent': 'ColRed/0.1 (https://colred.org)' };
const post = async (ep, body) => (await fetch(`https://servapibi.xm.com.co/${ep}`, { method: 'POST', headers: H, body: JSON.stringify(body) })).json();
const hoy = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
const j = await post('hourly', { MetricId: 'DispoReal', StartDate: hoy, EndDate: hoy, Entity: 'Recurso', Filter: [] });
console.log('Items', j.Items?.length, 'primer item:', JSON.stringify(j.Items?.[0]).slice(0, 700));
const { parseHourlyByCode } = await import('./fetch-hoy.mjs');
const m = parseHourlyByCode(j, hoy);
console.log('parse con fecha', hoy, '->', m.size, '| sin fecha ->', parseHourlyByCode(j).size);
const ej = [...parseHourlyByCode(j)].slice(0, 3); console.log('ejemplos', JSON.stringify(ej));
