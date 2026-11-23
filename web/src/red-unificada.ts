type Coordinate = [number, number];
type Feature = { geometry: { type: string; coordinates: any }; properties: Record<string, any> };
type Segment = { a: Coordinate; b: Coordinate; circuit: number; kv: number };

const project = ([lon, lat]: Coordinate): Coordinate => [lon * 110000, lat * 111195];
const paths = (f: Feature): Coordinate[][] => f.geometry.type === 'LineString' ? [f.geometry.coordinates]
  : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
const kv = (f: Feature) => Number(f.properties.tension_kv) || 0;
const distance = (a: Coordinate, b: Coordinate) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cellSize = 1000;
const tolerance = 90;

function segmentDistance([x, y]: Coordinate, { a, b }: Segment) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}

export function complementaryLines(osm: Feature[], upme: Feature[]) {
  const grid = new Map<string, Segment[]>();
  upme.forEach((line, circuit) => {
    const voltage = kv(line);
    if (!voltage) return;
    for (const path of paths(line)) {
      for (let i = 1; i < path.length; i++) {
        const a = project(path[i - 1]), b = project(path[i]);
        const segment = { a, b, circuit, kv: voltage };
        for (let x = Math.floor((Math.min(a[0], b[0]) - tolerance) / cellSize); x <= Math.floor((Math.max(a[0], b[0]) + tolerance) / cellSize); x++) {
          for (let y = Math.floor((Math.min(a[1], b[1]) - tolerance) / cellSize); y <= Math.floor((Math.max(a[1], b[1]) + tolerance) / cellSize); y++) {
            const key = `${x},${y}`;
            const bucket = grid.get(key) || [];
            bucket.push(segment);
            grid.set(key, bucket);
          }
        }
      }
    }
  });
  return osm.filter(line => {
    const voltage = kv(line);
    if (!voltage) return true;
    let candidates: Set<number> | undefined;
    let length = 0;
    for (const path of paths(line)) {
      for (let i = 1; i < path.length; i++) {
        const a = project(path[i - 1]), b = project(path[i]);
        const segmentLength = distance(a, b);
        length += segmentLength;
        const steps = Math.max(1, Math.ceil(segmentLength / 120));
        for (let j = 0; j <= steps; j++) {
          const point: Coordinate = [a[0] + (b[0] - a[0]) * j / steps, a[1] + (b[1] - a[1]) * j / steps];
          const bucket = grid.get(`${Math.floor(point[0] / cellSize)},${Math.floor(point[1] / cellSize)}`) || [];
          const hits = new Set(bucket.filter(s => s.kv === voltage && segmentDistance(point, s) <= tolerance).map(s => s.circuit));
          candidates = candidates ? new Set([...candidates].filter(id => hits.has(id))) : hits;
          if (!candidates.size) return true;
        }
      }
    }
    return length < 200 || !candidates?.size;
  });
}

const stationName = (f: Feature) => String(f.properties.nombre || f.properties.name || '')
  .normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  .replace(/\bsubestacion\b|\b\d+(?:[.,]\d+)?\s*kv\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function complementaryStations(osm: Feature[], upme: Feature[]) {
  const official = upme.map(f => ({ name: stationName(f), point: project(f.geometry.coordinates), kv: kv(f) }));
  return osm.filter(f => {
    const name = stationName(f), point = project(f.geometry.coordinates);
    const matches = official.filter(o => (!name || name === o.name) && (!kv(f) || !o.kv || kv(f) === o.kv) && distance(point, o.point) <= (name ? 200 : 100));
    return new Set(matches.map(o => o.name)).size !== 1;
  });
}
