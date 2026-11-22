// Une huecos cortos entre tramos de línea de OpenStreetMap que quedaron sin dibujar.
// Solo une extremos "sueltos" (sin otra línea de igual tensión a menos de 150 m), con la misma
// tensión y a menos de 8 km (hasta 25 km en 220-230 kV y 60 km en 500 kV si ambos tramos
// apuntan uno hacia el otro), empezando por los pares más cercanos. Los tramos agregados
// llevan inferido: true y la web los dibuja punteados.
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'public/data/lineas.geojson';
const MAX_KM = 8, TOUCH_KM = 0.15;
// Hueco máximo por tensión cuando los dos tramos están alineados (líneas largas y rectas de alta tensión)
export const maxKm = kv => (kv >= 500 ? 60 : kv >= 220 ? 25 : MAX_KM);
const bearing = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI;
const diff = (x, y) => { const d = Math.abs(x - y) % 360; return d > 180 ? 360 - d : d; };
// e sale en dirección (from → c); debe apuntar hacia o.c, y o debe apuntar hacia e.c
export const alineados = (e, o) => diff(bearing(e.from, e.c), bearing(e.c, o.c)) <= 20 && diff(bearing(o.from, o.c), bearing(o.c, e.c)) <= 20;
const R = 6371, rad = d => d * Math.PI / 180;
export const km = (a, b) => { const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

export function unir(gj) {
  const feats = gj.features.filter(f => !f.properties?.inferido && f.geometry?.type === 'LineString');
  const others = gj.features.filter(f => !f.properties?.inferido && f.geometry?.type !== 'LineString');
  // Rejilla de vértices para saber si un extremo toca otra línea
  const cell = c => `${Math.floor(c[0] * 50)},${Math.floor(c[1] * 50)}`;
  const grid = new Map();
  feats.forEach((f, i) => f.geometry.coordinates.forEach(c => { const k = cell(c); (grid.get(k) || grid.set(k, []).get(k)).push([i, c]); }));
  const touches = (i, c) => {
    const [x, y] = [Math.floor(c[0] * 50), Math.floor(c[1] * 50)];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      for (const [j, d] of grid.get(`${x + dx},${y + dy}`) || []) if (j !== i && feats[j].properties?.tension_kv === feats[i].properties?.tension_kv && km(c, d) < TOUCH_KM) return true;
    return false;
  };
  const ends = [];
  feats.forEach((f, i) => {
    const kv = f.properties?.tension_kv; if (!kv) return;
    const cs = f.geometry.coordinates;
    // Dirección de salida de cada extremo (desde un vértice ~2 km atrás) para exigir alineación en huecos largos
    const back = (arr) => { let p = arr[0]; for (const q of arr) { p = q; if (km(arr[0], q) > 2) break; } return p; };
    const e0 = cs[0], e1 = cs.at(-1);
    if (!touches(i, e0)) ends.push({ i, c: e0, kv, from: back(cs) });
    if (!touches(i, e1)) ends.push({ i, c: e1, kv, from: back([...cs].reverse()) });
  });
  // Pares candidatos ordenados por distancia; cada extremo se usa una sola vez
  const pairs = [];
  ends.forEach((e, x) => ends.forEach((o, y) => {
    if (y <= x || o.i === e.i || o.kv !== e.kv) return;
    const d = km(e.c, o.c);
    if (d <= MAX_KM) return pairs.push({ e, o, d });
    // Huecos largos solo en alta tensión, y solo si ambos tramos apuntan uno hacia el otro (±20°)
    if (d > maxKm(e.kv) || !alineados(e, o)) return;
    pairs.push({ e, o, d });
  }));
  pairs.sort((p, q) => p.d - q.d);
  const added = [], used = new Set();
  for (const { e, o } of pairs) {
    if (used.has(e) || used.has(o)) continue;
    used.add(e); used.add(o);
    added.push({ type: 'Feature', properties: { tension_kv: e.kv, name: null, inferido: true }, geometry: { type: 'LineString', coordinates: [e.c, o.c] } });
  }
  gj.features = [...feats, ...others, ...added];
  return added.length;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('unir-tramos.mjs')) {
  const gj = JSON.parse(readFileSync(FILE, 'utf8'));
  const n = unir(gj);
  writeFileSync(FILE, JSON.stringify(gj));
  console.log(`Tramos inferidos (huecos entre extremos sueltos de igual tensión; largos solo en alta tensión y alineados): ${n}`);
}
