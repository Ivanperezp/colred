type Coordinate = [number, number];
type Feature = { geometry: { type: string; coordinates: any }; properties: Record<string, any> };
type Circuit = { key: string; name: string; kv: number; bounds: [Coordinate, Coordinate] };
export type StationSite = {
  id: string;
  name: string;
  representative: Feature;
  points: Coordinate[];
  voltages: number[];
  circuits: Circuit[];
};

const baseName = (name: unknown) => String(name ?? '').trim().replace(/\s+\d+(?:[.,]\d+)?\s*kV$/i, '').trim();
const normalize = (name: unknown) => baseName(name).normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/\bsubestacion\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const meters = (a: Coordinate, b: Coordinate) => Math.hypot(
  (a[0] - b[0]) * Math.cos((a[1] + b[1]) * Math.PI / 360), a[1] - b[1],
) * 111195;
const near = (site: StationSite, p: Coordinate) => Math.min(...site.points.map(c => meters(c, p)));

export function stationSites(stations: Feature[], lines: Feature[]) {
  const byName = new Map<string, StationSite[]>();
  const sites = new Map<string, StationSite>();
  for (const station of [...stations].sort((a, b) => (Number(b.properties.tension_kv) || 0) - (Number(a.properties.tension_kv) || 0))) {
    const { nombre, municipio, departamento, tension_kv } = station.properties;
    const coordinate = station.geometry.coordinates as Coordinate;
    const key = normalize(nombre);
    const sameName = key ? byName.get(key) || [] : [];
    const nearby = sameName.filter(site => {
      const p = site.representative.properties;
      return (!municipio || !p.municipio || normalize(municipio) === normalize(p.municipio))
        && (!departamento || !p.departamento || normalize(departamento) === normalize(p.departamento))
        && meters(site.representative.geometry.coordinates, coordinate) <= 200;
    });
    let site = nearby.length === 1 ? nearby[0] : undefined;
    if (!site) {
      site = { id: String(sites.size), name: baseName(nombre) || 'Subestación', representative: station, points: [], voltages: [], circuits: [] };
      sameName.push(site);
      sites.set(site.id, site);
      if (key) byName.set(key, sameName);
    }
    site.points.push(coordinate);
    if (Number(tension_kv) > 0 && !site.voltages.includes(Number(tension_kv))) site.voltages.push(Number(tension_kv));
  }

  const circuits = new Map<string, { circuit: Circuit; names: Set<string>; ends: Map<string, { point: Coordinate; count: number }> }>();
  for (const f of lines) {
    const p = f.properties;
    if (!p.circuito_mapa || !p.nombre || (!p.subestacion_inicio && !p.subestacion_fin)) continue;
    const paths: Coordinate[][] = f.geometry.type === 'LineString' ? [f.geometry.coordinates]
      : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    if (!paths.some(path => path.length >= 2)) continue;
    let item = circuits.get(p.circuito_mapa);
    if (!item) {
      item = { circuit: { key: p.circuito_mapa, name: p.nombre, kv: Number(p.tension_kv) || 0, bounds: [[Infinity, Infinity], [-Infinity, -Infinity]] }, names: new Set(), ends: new Map() };
      circuits.set(p.circuito_mapa, item);
    }
    for (const name of [p.subestacion_inicio, p.subestacion_fin]) if (normalize(name)) item.names.add(normalize(name));
    const [min, max] = item.circuit.bounds;
    for (const path of paths) {
      if (path.length < 2) continue;
      for (const point of [path[0], path[path.length - 1]]) {
        const key = point.join(',');
        const entry = item.ends.get(key) || { point, count: 0 };
        entry.count++;
        item.ends.set(key, entry);
      }
      for (const [lon, lat] of path) {
        min[0] = Math.min(min[0], lon); min[1] = Math.min(min[1], lat);
        max[0] = Math.max(max[0], lon); max[1] = Math.max(max[1], lat);
      }
    }
  }
  for (const { circuit, names, ends } of circuits.values()) {
    const terminals = [...ends.values()].filter(item => item.count === 1).map(item => item.point);
    if (!terminals.length) continue;
    for (const name of names) {
      const candidates = (byName.get(name) || []).map(site => ({
        site, distance: Math.min(...terminals.map(point => near(site, point))),
      })).filter(item => item.distance <= 1000).sort((a, b) => a.distance - b.distance);
      if (candidates.length === 1 || (candidates.length > 1 && candidates[1].distance - candidates[0].distance > 200)) {
        candidates[0].site.circuits.push(circuit);
      }
    }
  }
  for (const site of sites.values()) {
    site.voltages.sort((a, b) => a - b);
    site.circuits.sort((a, b) => b.kv - a.kv || a.name.localeCompare(b.name, 'es'));
  }
  const nearbySite = (f: Feature) => {
    const name = normalize(f.properties.nombre || f.properties.name);
    const matches = (byName.get(name) || []).filter(site => near(site, f.geometry.coordinates) <= 200);
    return matches.length === 1 ? matches[0] : undefined;
  };
  return { sites, nearbySite };
}
