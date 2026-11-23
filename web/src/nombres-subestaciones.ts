type Point = number[];
type Feature = {
  geometry: { type: string; coordinates: any };
  properties: Record<string, any>;
};

const normalized = (name: string) => name.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/\bsubestaci[oó]n\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const label = (f: Feature) => String(f.properties.nombre || f.properties.name || '').trim();
const voltage = (f: Feature) => Number(f.properties.tension_kv) || 0;
const compatible = (a: number, b: number) => !a || !b || a === b || (Math.min(a, b) === 220 && Math.max(a, b) === 230) || (Math.min(a, b) === 110 && Math.max(a, b) === 115);
const meters = (a: Point, b: Point) => Math.hypot(
  (a[0] - b[0]) * Math.cos((a[1] + b[1]) * Math.PI / 360), a[1] - b[1],
) * 111195;

function uniqueNearby(point: Point, stations: Feature[]) {
  const nearby = stations.filter(f => meters(point, f.geometry.coordinates) <= 200);
  if (nearby.length === 1 && meters(point, nearby[0].geometry.coordinates) <= 100) return nearby[0];
}

function endpoints(line: Feature): Point[] {
  const { type, coordinates } = line.geometry;
  const paths: Point[][] = type === 'LineString' ? [coordinates] : type === 'MultiLineString' ? coordinates : [];
  const ends = new Map<string, Point[]>();
  for (const path of paths) {
    if (path.length < 2) continue;
    for (const point of [path[0], path[path.length - 1]]) {
      const key = point.slice(0, 2).join(',');
      const hits = ends.get(key) || [];
      hits.push(point);
      ends.set(key, hits);
    }
  }
  return [...ends.values()].filter(hits => hits.length === 1).map(hits => hits[0]);
}

export function completeStationNames(stations: Feature[], official: Feature[], lines: Feature[]) {
  const candidates = new Map<Feature, Map<string, string>>();
  const suggest = (station: Feature, name: string) => {
    const key = normalized(name);
    if (!key || label(station)) return;
    const names = candidates.get(station) || new Map<string, string>();
    names.set(key, name);
    candidates.set(station, names);
  };

  for (const point of official) {
    const nearby = uniqueNearby(point.geometry.coordinates, stations);
    if (nearby && compatible(voltage(nearby), voltage(point))) suggest(nearby, label(point));
  }

  for (const line of lines) {
    const { subestacion_inicio: start, subestacion_fin: end } = line.properties;
    if (!start || !end || normalized(start) === normalized(end)) continue;
    const ends = endpoints(line);
    if (ends.length !== 2) continue;
    const a = uniqueNearby(ends[0], stations);
    const b = uniqueNearby(ends[1], stations);
    if (!a || !b || a === b || !compatible(voltage(a), voltage(line)) || !compatible(voltage(b), voltage(line))) continue;
    // Un extremo identificado permite asignar el otro sin asumir el sentido de la geometría.
    for (const [anchor, target] of [[a, b], [b, a]]) {
      const name = normalized(label(anchor));
      if (name === normalized(start)) suggest(target, end);
      if (name === normalized(end)) suggest(target, start);
    }
  }

  return stations.map(station => {
    const names = candidates.get(station);
    if (names?.size !== 1) return station;
    const [nombre] = names.values();
    return { ...station, properties: { ...station.properties, nombre, fuente_nombre: 'UPME' } };
  });
}
