// Diagnóstico: qué disponibilidad por recurso tiene valores reales y desde qué fecha
const H = { 'Content-Type': 'application/json', 'User-Agent': 'ColRed/0.1 (https://colred.org)' };
const post = async (ep, body) => (await fetch(`https://servapibi.xm.com.co/${ep}`, { method: 'POST', headers: H, body: JSON.stringify(body) })).json();
const { parseHourlyByCode } = await import('./fetch-hoy.mjs');
for (const m of ['DispoDeclarada', 'DispoReal', 'DispoCome']) for (const d of [0, 1, 2, 3, 4]) {
  const day = new Date(Date.now() - 5 * 3600e3 - d * 864e5).toISOString().slice(0, 10);
  const map = parseHourlyByCode(await post('hourly', { MetricId: m, StartDate: day, EndDate: day, Entity: 'Recurso', Filter: [] }), day);
  const con = [...map.values()].filter(a => a.some(x => x !== null));
  const tot = Array(24).fill(0); con.forEach(a => a.forEach((x, h) => { if (x !== null) tot[h] += x / 1000; }));
  console.log(`${m.padEnd(15)} ${day} recursos ${map.size} con valores ${con.length} · total MW h0 ${Math.round(tot[0])} h12 ${Math.round(tot[12])} h19 ${Math.round(tot[19])}`);
  if (con.length) break;
}
