// Conserva únicamente contornos cerrados tal como están dibujados en OpenStreetMap.
export function substationFootprints(elements) {
  return elements.flatMap(element => {
    const points = element.geometry;
    if (element.type !== 'way' || element.tags?.power !== 'substation' || !points || points.length < 4) return [];
    const first = points[0], last = points.at(-1);
    if (!points.every(p => Number.isFinite(p?.lon) && Number.isFinite(p?.lat))
      || first.lon !== last.lon || first.lat !== last.lat) return [];
    const ring = points.map(p => [p.lon, p.lat]);
    if (new Set(ring.slice(0, -1).map(p => p.join(','))).size < 3) return [];
    return [{
      type: 'Feature',
      properties: { nombre: element.tags.name || null, osm_id: element.id, fuente: 'OpenStreetMap' },
      geometry: { type: 'Polygon', coordinates: [ring] },
    }];
  });
}
