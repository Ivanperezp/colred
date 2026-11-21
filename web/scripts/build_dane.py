"""Convierte el Marco Geoestadístico Nacional 2021 del DANE (GeoJSON) en capas livianas para la web.
Uso: python scripts/build_dane.py <MGN2021_DPTO_web.geo.json> <MGN2021_MPIO_web.geo.json>
Fuente: DANE, MGN 2021 (copia en github.com/macortesgu/MGN_2021_geojson). EPSG:4686 ~ WGS84.
"""
import json, sys
from shapely.geometry import shape, mapping

def title(s):
    small = {'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e'}
    w = s.lower().split()
    return ' '.join(x if (i and x in small) else x[:1].upper() + x[1:] for i, x in enumerate(w)).replace('D.c.', 'D.C.')

def rnd(g, n):
    if isinstance(g, (list, tuple)):
        return [rnd(x, n) for x in g] if g and isinstance(g[0], (list, tuple)) else [round(v, n) for v in g]
    return g

dpto_src, mpio_src = sys.argv[1], sys.argv[2]
out = 'public/data/'

d = json.load(open(dpto_src, encoding='utf-8'))
feats = []
for f in d['features']:
    g = shape(f['geometry']).simplify(0.01, preserve_topology=True)
    m = mapping(g)
    feats.append({'type': 'Feature', 'properties': {'cod_dpto': f['properties']['DPTO_CCDGO'], 'nombre': title(f['properties']['DPTO_CNMBR'])},
                  'geometry': {'type': m['type'], 'coordinates': rnd(m['coordinates'], 4)}})
json.dump({'type': 'FeatureCollection', 'source': 'DANE MGN 2021', 'features': feats}, open(out + 'departamentos.geojson', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

m = json.load(open(mpio_src, encoding='utf-8'))
pts = []
for f in m['features']:
    p = f['properties']
    pt = shape(f['geometry']).representative_point()
    pts.append({'type': 'Feature', 'properties': {'divipola': p['MPIO_CDPMP'], 'nombre': title(p['MPIO_CNMBR']), 'departamento': title(p['DPTO_CNMBR']), 'cod_dpto': p['DPTO_CCDGO']},
                'geometry': {'type': 'Point', 'coordinates': [round(pt.x, 5), round(pt.y, 5)]}})
json.dump({'type': 'FeatureCollection', 'source': 'DANE MGN 2021', 'features': pts}, open(out + 'municipios_centroides.geojson', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f'departamentos {len(feats)}, municipios {len(pts)} (DANE MGN 2021)')
