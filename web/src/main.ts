import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { operadoresDe, ZNI, MANUAL } from './operadores';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { completeStationNames } from './nombres-subestaciones';
import { circuitKey, complementaryLines, complementaryStations } from './red-unificada';
import { stationSites, type StationSite } from './fichas-subestaciones';
import { mountHistory } from './historial-xm';

maplibregl.setWorkerUrl(workerUrl);

type Fc = { type: 'FeatureCollection'; features: any[]; sample?: boolean; properties?: { generated_at?: string; coverage?: string } };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const jget = async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(u); return r.json(); };
const tryGet = (u: string) => jget(u).catch(() => null);
const hhmm = (s?: string) => { if (!s) return '--:--'; const d = new Date(s); return isNaN(+d) ? '--:--' : d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }); };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const REPORT = 'https://github.com/Ivanperezp/colred/issues/new?template=reportar-error.yml';
const errLink = (n: string) => `<a class="err" href="${REPORT}&title=${encodeURIComponent('Error: ' + n)}" target="_blank" rel="noopener">¿Dato incorrecto?</a>`;
const fmt = (n: number, d = 0) => n.toLocaleString('es-CO', { maximumFractionDigits: d });

const TECH: Record<string, string> = { 'Hidráulica': '#2b7bd8', 'Térmica gas': '#e8742a', 'Térmica carbón': '#4a4f57', 'Eólica': '#12a594', 'Solar': '#f0b400', 'Biomasa': '#7fa32a', 'Otra': '#8a5fb5' };
const LINE_C: [string, string][] = [['500 kV', '#c0152f'], ['230–220 kV', '#e07b00'], ['115–110 kV', '#2a7fb8'], ['<110 kV / desconocido', '#8794a3']];
const UPME_COLOR = '#5635a5';
const LVL: Record<string, string> = { roja: '#d7191c', naranja: '#f08000', amarilla: '#e8c400' };
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Límites: DANE';

// Estilo local de respaldo: sin glyphs ni sprites, solo fondo (el relleno de departamentos lo añade addDataLayers)
const fallbackStyle: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#d6e4ee' } }] };

const fetchStyle = async (): Promise<StyleSpecification | null> => {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 6000);
  try { const r = await fetch(STYLE_URL, { signal: ac.signal }); if (!r.ok) throw new Error(String(r.status)); return await r.json(); }
  catch { return null; } finally { clearTimeout(t); }
};

let sample = false;
const flagSample = (d: any) => { if (d && (d.sample || d.properties?.sample)) sample = true; };
const empty: Fc = { type: 'FeatureCollection', features: [] };
const collection = (features: any[]): Fc => ({ type: 'FeatureCollection', features });
const data: Record<string, Fc> = {};
type NetworkMode = 'unificada' | 'osm' | 'upme';
let networkMode: NetworkMode = 'unificada';
const network: Record<string, Record<NetworkMode, Fc>> = {};
let selectedCircuit = '';
let mapPopup: maplibregl.Popup | undefined;
let stationsById = new Map<string, StationSite>();
const load = async () => {
  const names = ['lineas', 'lineas_upme', 'subestaciones', 'subestaciones_upme', 'predios_subestaciones', 'centrales', 'municipios_centroides', 'departamentos'];
  const res = await Promise.all(names.map(n => tryGet(`data/${n}.geojson`)));
  names.forEach((n, i) => { data[n] = res[i] || empty; flagSample(res[i]); });
  const osmStations = completeStationNames(data.subestaciones.features, data.subestaciones_upme.features, data.lineas_upme.features);
  const withCircuit = (f: any, i: number, source: string) => ({
    ...f, properties: { ...f.properties, circuito_mapa: circuitKey(f, `${source}-${i}`) },
  });
  const officialLines = data.lineas_upme.features.map((f, i) => withCircuit(f, i, 'upme'));
  const officialStations = data.subestaciones_upme.features;
  const { sites, nearbySite } = stationSites(officialStations, officialLines);
  stationsById = sites;
  const stationPoint = (point: any, site?: StationSite) => ({
    ...point, properties: { ...point.properties, ficha_subestacion: site?.id || null },
  });
  const officialPoints = [...sites.values()].map(site => stationPoint(site.representative, site));
  const osmLines = data.lineas.features.filter(f => !f.properties.inferido);
  const complementary = complementaryLines(osmLines, officialLines);
  network.lineas = {
    osm: collection(osmLines.map((f, i) => withCircuit(f, i, 'osm'))),
    upme: collection(officialLines),
    unificada: collection([...complementary.map((f, i) => withCircuit(f, i, 'osm')), ...officialLines]),
  };
  network.subestaciones = {
    osm: collection(osmStations.map(f => stationPoint(f, nearbySite(f)))),
    upme: collection(officialPoints),
    unificada: collection([...complementaryStations(osmStations, officialStations).map(f => stationPoint(f, nearbySite(f))), ...officialPoints]),
  };
};

const rank = (n: string) => ({ roja: 3, naranja: 2, amarilla: 1 } as Record<string, number>)[n] || 0;
const groups: Record<string, string[]> = { lineas: ['lineas-glow', 'lineas-casing', 'lineas', 'lineas-seleccion', 'lineas-flujo'], subestaciones: ['subestaciones', 'predios-relleno', 'predios-borde'], centrales: ['centrales', 'centrales-label'], alertas: ['alertas'], intercambios: [] };
const labels: Record<string, string> = { lineas: 'Líneas', subestaciones: 'Subestaciones', centrales: 'Centrales', alertas: 'Alertas IDEAM', intercambios: 'Intercambios' };
const on: Record<string, boolean> = { lineas: true, subestaciones: true, centrales: true, alertas: true, intercambios: true };
let calidadData: any = null; let alertasData: any = null; let isFallback = false; let map!: maplibregl.Map;
const footprintVisibility = () => on.subestaciones && networkMode !== 'upme' ? 'visible' : 'none';
const selectCircuit = (key = '') => {
  selectedCircuit = key;
  if (map?.getLayer('lineas-seleccion')) map.setFilter('lineas-seleccion', ['==', ['get', 'circuito_mapa'], key]);
};
const setNetworkMode = (mode: NetworkMode) => {
  networkMode = mode;
  $<HTMLSelectElement>('network-source').value = mode;
  for (const id of ['lineas', 'subestaciones']) {
    map?.getSource<maplibregl.GeoJSONSource>(id)?.setData(network[id][mode] as any);
  }
  updateFootprintVisibility();
};
const updateFootprintVisibility = () => {
  for (const layer of ['predios-relleno', 'predios-borde']) {
    if (map?.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', footprintVisibility());
  }
};

const alertFc = (): Fc => {
  const byId = new Map<string, any>();
  (alertasData?.alertas || []).forEach((a: any) => { const p = byId.get(a.divipola_mpio); if (!p || rank(a.nivel) > rank(p.nivel)) byId.set(a.divipola_mpio, a); });
  return { type: 'FeatureCollection', features: (data.municipios_centroides?.features || []).filter(f => byId.has(String(f.properties.divipola))).map(f => ({ ...f, properties: { ...f.properties, ...byId.get(String(f.properties.divipola)) } })) };
};

// Idempotente: se llama en cada 'style.load'
const addDataLayers = () => {
  const src = (id: string, d: any, extra: object = {}) => { if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: d, ...extra }); };
  const lay = (l: any) => { if (!map.getLayer(l.id)) map.addLayer(l); };
  const hasGlyphs = !!map.getStyle()?.glyphs;
  src('departamentos', data.departamentos as any, { promoteId: 'cod_dpto' });
  src('lineas', network.lineas[networkMode], { attribution: 'UPME' });
  src('subestaciones', network.subestaciones[networkMode], { attribution: 'UPME' });
  src('predios-subestaciones', data.predios_subestaciones);
  src('centrales', data.centrales as any); src('alertas', alertFc() as any);
  const fb = isFallback;
  lay({ id: 'dept-fill', type: 'fill', source: 'departamentos', paint: { 'fill-color': fb ? '#f7f5ef' : '#2457d6', 'fill-opacity': fb ? 1 : ['case', ['boolean', ['feature-state', 'hover'], false], .1, .035] } });
  lay({ id: 'dept-line', type: 'line', source: 'departamentos', paint: { 'line-color': fb ? '#b8c3cf' : '#8896a6', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, .5, 9, 1.2], 'line-opacity': .8 } });
  lay({ id: 'dept-sel', type: 'line', source: 'departamentos', filter: ['==', ['get', 'cod_dpto'], ''], paint: { 'line-color': '#2457d6', 'line-width': 2.5 } });
  const kv: any = ['to-number', ['get', 'tension_kv'], 0];
  const w = (a: number, b: number, c: number) => ['interpolate', ['linear'], ['zoom'], 4, ['case', ['>=', kv, 500], a, ['>=', kv, 220], b, c], 9, ['case', ['>=', kv, 500], a * 2.4, ['>=', kv, 220], b * 2.4, c * 2.4]] as any;
  const vis = (k: string) => ({ visibility: on[k] ? 'visible' : 'none' } as any);
  lay({ id: 'predios-relleno', type: 'fill', source: 'predios-subestaciones', minzoom: 10, layout: { visibility: footprintVisibility() }, paint: { 'fill-color': UPME_COLOR, 'fill-opacity': .18 } });
  lay({ id: 'predios-borde', type: 'line', source: 'predios-subestaciones', minzoom: 10, layout: { visibility: footprintVisibility() }, paint: { 'line-color': UPME_COLOR, 'line-width': 1.5, 'line-opacity': .8 } });
  lay({ id: 'lineas-glow', type: 'line', source: 'lineas', filter: ['all', ['>=', kv, 500], ['!=', ['get', 'inferido'], true]], layout: { ...vis('lineas'), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#c0152f', 'line-opacity': .22, 'line-blur': 3, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 7, 9, 16] } });
  lay({ id: 'lineas-casing', type: 'line', source: 'lineas', filter: ['!=', ['get', 'inferido'], true], layout: { ...vis('lineas'), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-opacity': .85, 'line-width': w(3.6, 2.8, 2.2) } });
  const lc: any = ['case', ['>=', kv, 500], LINE_C[0][1], ['>=', kv, 220], LINE_C[1][1], ['>=', kv, 110], LINE_C[2][1], LINE_C[3][1]];
  lay({ id: 'lineas', type: 'line', source: 'lineas', filter: ['!=', ['get', 'inferido'], true], layout: { ...vis('lineas'), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': lc, 'line-width': w(2, 1.4, 1) } });
  lay({ id: 'lineas-seleccion', type: 'line', source: 'lineas', filter: ['==', ['get', 'circuito_mapa'], selectedCircuit], layout: { ...vis('lineas'), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#154b49', 'line-width': w(4, 3.5, 3) } });
  lay({ id: 'lineas-flujo', type: 'line', source: 'lineas', minzoom: 5, filter: ['all', ['>=', kv, 110], ['!=', ['get', 'inferido'], true]], layout: { visibility: on.lineas && flowOn ? 'visible' : 'none', 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-opacity': .6, 'line-width': w(1.2, 0.9, 0.7), 'line-dasharray': DASH[0] } });
  lay({ id: 'subestaciones', type: 'circle', source: 'subestaciones', minzoom: 5, layout: vis('subestaciones'), paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 10, 6], 'circle-color': ['case', ['==', ['get', 'fuente'], 'UPME'], UPME_COLOR, '#fff'], 'circle-stroke-color': '#14202e', 'circle-stroke-width': 1.6 } });
  const tc: any[] = ['match', ['get', 'tecnologia']]; Object.entries(TECH).forEach(([k, v]) => tc.push(k, v)); tc.push('#8a5fb5');
  const mw: any = ['to-number', ['get', 'mw'], 0];
  lay({ id: 'centrales', type: 'circle', source: 'centrales', layout: vis('centrales'), paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['+', 3, ['*', .17, ['sqrt', mw]]], 9, ['+', 5, ['*', .4, ['sqrt', mw]]]], 'circle-color': tc as any, 'circle-opacity': .92, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.8 } });
  lay({ id: 'alertas', type: 'circle', source: 'alertas', layout: vis('alertas'), paint: { 'circle-radius': 8, 'circle-color': ['match', ['get', 'nivel'], 'roja', LVL.roja, 'naranja', LVL.naranja, LVL.amarilla] as any, 'circle-stroke-color': '#14202e', 'circle-stroke-width': 1.5 } });
  if (hasGlyphs) {
    const font = ['Noto Sans Regular'], fontB = ['Noto Sans Bold'];
    // evita duplicar los nombres de departamento del estilo base
    (map.getStyle().layers || []).forEach(l => { if (l.type === 'symbol' && /state|region|province/i.test(l.id) && !['dept-label'].includes(l.id)) map.setLayoutProperty(l.id, 'visibility', 'none'); });
    lay({ id: 'dept-label', type: 'symbol', source: 'departamentos', minzoom: 5.4, layout: { 'text-field': ['get', 'nombre'], 'text-font': font, 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': .08, 'text-max-width': 7 }, paint: { 'text-color': '#5d6b7b', 'text-halo-color': 'rgba(255,255,255,.9)', 'text-halo-width': 1.4 } });
    lay({ id: 'centrales-label', type: 'symbol', source: 'centrales', minzoom: 5, filter: ['>=', mw, 500], layout: { ...vis('centrales'), 'text-field': ['concat', ['get', 'nombre'], '\n', ['to-string', mw], ' MW'], 'text-font': fontB, 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 1.1], 'text-optional': true }, paint: { 'text-color': '#14202e', 'text-halo-color': '#fff', 'text-halo-width': 1.6 } });
  }
};

// ---------- Animación de corriente (ilustrativa) ----------
const DASH = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
let flowOn = !matchMedia('(max-width:720px)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches;
let flowTimer = 0, flowStep = 0;
const flowStop = () => { if (flowTimer) { clearInterval(flowTimer); flowTimer = 0; } };
const flowTick = () => { if (map.getLayer('lineas-flujo') && map.getZoom() >= 5) { flowStep = (flowStep + 1) % DASH.length; map.setPaintProperty('lineas-flujo', 'line-dasharray', DASH[flowStep] as any); } };
const applyFlow = () => {
  if (map.getLayer('lineas-flujo')) map.setLayoutProperty('lineas-flujo', 'visibility', on.lineas && flowOn ? 'visible' : 'none');
  flowStop(); if (flowOn && on.lineas && !document.hidden) flowTimer = window.setInterval(flowTick, 80);
};
document.addEventListener('visibilitychange', () => { if (map) applyFlow(); });

// ---------- Intercambios internacionales ----------
const ARROW_AT: Record<string, [number, number]> = { Ecuador: [-77.64, 0.81], Venezuela: [-72.3, 11.0] };
const ARROW_DIR: Record<string, number> = { Ecuador: 205, Venezuela: 75 }; // grados de la flecha "saliendo" de Colombia (0 = norte)
let intercambios: any = null; const ixMarkers: maplibregl.Marker[] = [];
const ixPaises = () => Object.keys(ARROW_AT).map(pais =>
  intercambios?.paises?.find((p: any) => p.pais === pais) || { pais, saldo_mwh: null });
const ixBalance = (p: any) => {
  const s = p.saldo_mwh;
  if (!Number.isFinite(s)) return 'Sin dato de saldo';
  return `${s > 0 ? 'Exporta ' : s < 0 ? 'Importa ' : 'Saldo '}${fmt(Math.abs(s), 1)} MWh`;
};
const ixDate = () => intercambios?.fecha_operacion
  ? new Date(intercambios.fecha_operacion + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
  : '';
const addIxMarkers = () => {
  ixPaises().filter((p: any) => p.pais === 'Ecuador' || Number.isFinite(p.saldo_mwh)).forEach((p: any) => {
    const s = Number(p.saldo_mwh) || 0, ang = ARROW_DIR[p.pais] + (s < 0 ? 180 : 0);
    const el = document.createElement('div'); el.className = 'ix';
    el.classList.toggle('ix-empty', !s);
    const date = Number.isFinite(p.saldo_mwh) && ixDate() ? ` · ${ixDate()}` : '';
    el.innerHTML = `<i style="transform:rotate(${ang}deg)">${s ? '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</i><span><b>${esc(p.pais)}</b> · ${ixBalance(p)}${date}</span>`;
    el.setAttribute('role', 'img'); el.setAttribute('aria-label', `${p.pais} · ${ixBalance(p)}${date}`);
    ixMarkers.push(new maplibregl.Marker({ element: el, anchor: 'left', offset: [-12, 0] }).setLngLat(ARROW_AT[p.pais]).addTo(map));
  });
};
const setIx = () => ixMarkers.forEach(m => { m.getElement().style.display = on.intercambios ? '' : 'none'; });
const ixCard = () => {
  const fecha = ixDate() ? ' · ' + ixDate() : '';
  const rows = ixPaises().map((p: any) => `<div class="sg"><span>${esc(p.pais)}</span><b class="${p.saldo_mwh < 0 ? 'dn' : ''}">${ixBalance(p)}</b></div>`).join('');
  return card('intercambios', `Intercambios internacionales${fecha}`, `${rows}<div class="note">Saldo de Colombia en el último día disponible.</div>${foot('xm_intercambios', 'XM', intercambios?.updated_at)}`);
};

const popupHtml: Record<string, (p: any) => string> = {
  lineas: p => p.fuente === 'UPME' ? popupHtml.lineas_upme(p) : `<div class="pp"><b>${esc(p.name || 'Línea de transmisión')}</b><div class="m">${p.tension_kv && p.tension_kv !== 'null' ? esc(p.tension_kv) + ' kV' : 'Tensión desconocida'}</div><div class="m">Fuente: OpenStreetMap</div>${errLink(p.name || 'Línea de transmisión')}</div>`,
  'predios-relleno': p => `<div class="pp"><b>${esc(p.nombre || 'Predio de subestación')}</b><div class="m">Límite cartográfico · OpenStreetMap</div>${errLink(p.nombre || 'Predio de subestación')}</div>`,
  lineas_upme: p => {
    const name = p.nombre || p.name || 'Línea de transmisión';
    const details = [
      p.tension_kv && `${p.tension_kv} kV`,
      p.subestacion_inicio && `Inicio: ${p.subestacion_inicio}`,
      p.subestacion_fin && `Fin: ${p.subestacion_fin}`,
      p.propietario && `Propietario: ${p.propietario}`,
      p.vigencia && `Vigencia del registro: ${p.vigencia}`,
      `Fuente: UPME · ${p.sistema || 'STN'}`,
    ];
    return `<div class="pp"><b>${esc(name)}</b>${details.filter(Boolean).map(value => `<div class="m">${esc(value)}</div>`).join('')}${errLink(name)}</div>`;
  },
  subestaciones: p => {
    const site = stationsById.get(p.ficha_subestacion);
    const official = site?.representative.properties;
    const name = site?.name || p.nombre || p.name || 'Subestación';
    const levels = site?.voltages.length ? site.voltages : Number(p.tension_kv) > 0 ? [Number(p.tension_kv)] : [];
    const location = [official?.municipio, official?.departamento].filter(Boolean).join(', ');
    const details = [
      levels.length ? levels.map(v => `${fmt(v, 1)} kV`).join(' · ') : 'Tensión sin registrar',
      location, official?.propietario,
      p.fuente === 'UPME' ? 'Fuente: UPME' : 'Ubicación: OpenStreetMap',
      p.fuente !== 'UPME' && (site || p.fuente_nombre === 'UPME') ? 'Nombre según UPME' : '',
      !p.nombre && !p.name && !site ? 'Sin nombre registrado' : '',
    ];
    const circuits = site?.circuits.length
      ? `<ul class="station-circuits">${site.circuits.map((c, i) => `<li><button type="button" data-circuit="${i}" aria-pressed="false">${esc(c.name)}</button></li>`).join('')}</ul>`
      : '<div class="m">ColRed no tiene circuitos UPME verificados para este sitio.</div>';
    return `<div class="pp"><b>${esc(name)}</b>${details.filter(Boolean).map(value => `<div class="m">${esc(value)}</div>`).join('')}<h3>Circuitos registrados por UPME</h3>${circuits}${errLink(name)}</div>`;
  },
  centrales: p => `<div class="pp"><b>${esc(/^central sin nombre$/i.test(String(p.nombre)) ? 'Central ' + String(p.tecnologia).toLowerCase() : p.nombre)}</b><div class="m">${esc(p.tecnologia)}</div><div class="m">${Number(p.mw) ? 'Potencia: ' + fmt(Number(p.mw)) + ' MW' : 'Potencia no registrada'}</div>${errLink(p.nombre)}</div>`,
  alertas: p => `<div class="pp"><b>${esc(p.municipio)}</b><div class="m">${esc(p.departamento)}</div><div class="m">Alerta ${esc(p.nivel)} · ${esc(p.tipo)}</div><div class="m">${esc(p.texto)}</div></div>`,
};
const HIT = ['alertas', 'centrales', 'subestaciones', 'lineas', 'predios-relleno'];

// ---------- Ficha de departamento ----------
const inRing = (pt: number[], r: number[][]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
const inGeom = (pt: number[], g: any) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).some((p: number[][][]) => inRing(pt, p[0]) && !p.slice(1).some(h => inRing(pt, h)));
const bboxOf = (g: any) => { let a = 180, b = 90, c = -180, d = -90; JSON.stringify(g.coordinates).match(/-?\d+\.?\d*,-?\d+\.?\d*/g)!.forEach(s => { const [x, y] = s.split(',').map(Number); a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }); return [a, b, c, d] as [number, number, number, number]; };
const calidadHtml = (code: string) => {
  const ops = calidadData?.items ? operadoresDe(calidadData.items, code) : [];
  const names = [...new Set([...ops.map(o => o.nombre), ...(MANUAL[code] || [])])];
  const zni = ZNI.has(code) ? `<div class="opr zni">La mayor parte del departamento está en las Zonas No Interconectadas: se abastece con plantas locales, no con la red nacional.</div>` : '';
  return (names.length ? `<div class="opr"><span>${names.length > 1 ? 'Prestadores' : 'Prestador'}</span><b>${names.map(esc).join(' · ')}</b></div>` : '') + zni;
};
const openFicha = (f: any, fit = true) => {
  const code = String(f.properties.cod_dpto), nombre = f.properties.nombre, g = f.geometry;
  const pls = (data.centrales.features || []).filter(c => inGeom(c.geometry.coordinates, g)).sort((a, b) => (b.properties.mw || 0) - (a.properties.mw || 0));
  const total = pls.reduce((s, c) => s + (Number(c.properties.mw) || 0), 0);
  const unk = (c: any) => /^central sin nombre$/i.test(String(c.properties.nombre)) && !Number(c.properties.mw);
  const nUnk = pls.filter(unk).length; const shown = pls.filter(c => !unk(c));
  const al = (alertasData?.alertas || []).filter((a: any) => String(a.divipola_mpio).slice(0, 2) === code);
  $('ficha').innerHTML = `<button class="x" type="button" aria-label="Cerrar ficha">×</button><h2>${esc(nombre)}</h2><div class="src" style="margin:0">Departamento · código DANE ${esc(code)}</div>
  ${calidadHtml(code)}
  ${alertasData ? `<h3>Alertas IDEAM</h3>` : ''}${!alertasData ? '' : al.length ? al.map((a: any) => `<span class="tag" style="background:${LVL[a.nivel] || '#ccc'}22;color:#14202e;border:1px solid ${LVL[a.nivel] || '#ccc'}">${esc(a.municipio)}: ${esc(a.tipo)} (${esc(a.nivel)})</span>`).join('') : '<div class="src" style="margin:0">Sin alertas registradas.</div>'}
  <h3>Centrales</h3>${pls.length ? shown.map(c => `<div class="pl"><span><i style="background:${TECH[c.properties.tecnologia] || '#8a5fb5'}"></i>${esc(c.properties.nombre)}</span><span>${c.properties.mw ? fmt(Number(c.properties.mw)) + ' MW' : 's/d'}</span></div>`).join('') + (nUnk ? `<div class="src" style="margin:6px 0 0">y ${nUnk} centrales pequeñas sin nombre registrado</div>` : '') + `<div class="tot"><span>Total</span><span>${fmt(total)} MW</span></div>` : '<div class="src" style="margin:0">No hay centrales registradas en este departamento.</div>'}`;
  $('ficha').hidden = false; document.body.classList.add('sheet'); ($('ficha').querySelector('.x') as HTMLElement).onclick = closeFicha;
  map.setFilter('dept-sel', ['==', ['get', 'cod_dpto'], code]);
  if (fit) { const [a, b, c, d] = bboxOf(g); map.fitBounds([[a, b], [c, d]], { padding: { top: 140, bottom: 60, left: 280, right: 360 }, maxZoom: 7, duration: 800 }); }
};
const closeFicha = () => { $('ficha').hidden = true; document.body.classList.remove('sheet'); if (map.getLayer('dept-sel')) map.setFilter('dept-sel', ['==', ['get', 'cod_dpto'], '']); };

const bindStationCircuits = (popup: maplibregl.Popup, site: StationSite) => {
  const buttons = popup.getElement().querySelectorAll<HTMLButtonElement>('[data-circuit]');
  buttons.forEach(button => {
    button.onclick = () => {
      const circuit = site.circuits[Number(button.dataset.circuit)];
      if (!circuit) return;
      if (networkMode === 'osm') setNetworkMode('unificada');
      if (!on.lineas) $('chip-lineas').click();
      selectCircuit(circuit.key);
      buttons.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      const compact = matchMedia('(max-width:720px)').matches;
      map.fitBounds(circuit.bounds, { padding: compact ? 44 : { top: 90, bottom: 52, left: 72, right: 330 }, maxZoom: 12, duration: 550 });
    };
  });
};

const initMap = (style: StyleSpecification | null) => {
  isFallback = !style;
  map = new maplibregl.Map({ container: 'map', style: style || fallbackStyle, center: [-73.8, 5.2], zoom: matchMedia('(max-width:720px)').matches ? 4.3 : 5.2, minZoom: 3.5, attributionControl: false });
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: ATTR }), 'bottom-right');
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.on('style.load', addDataLayers);
  let hov: string | null = null;
  map.on('mousemove', e => {
    const pad = 4, feats = map.queryRenderedFeatures([[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]], { layers: HIT.filter(l => map.getLayer(l)) });
    map.getCanvas().style.cursor = feats.length ? 'pointer' : (map.getLayer('dept-fill') && map.queryRenderedFeatures(e.point, { layers: ['dept-fill'] }).length ? 'pointer' : '');
    const d = feats.length ? [] : map.getLayer('dept-fill') ? map.queryRenderedFeatures(e.point, { layers: ['dept-fill'] }) : [];
    const id = d[0] ? String(d[0].properties.cod_dpto) : null;
    if (id !== hov) { if (hov) map.setFeatureState({ source: 'departamentos', id: hov }, { hover: false }); hov = id; if (id) map.setFeatureState({ source: 'departamentos', id }, { hover: true }); }
  });
  map.on('click', e => {
    const pad = 5, feats = map.queryRenderedFeatures([[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]], { layers: HIT.filter(l => map.getLayer(l)) });
    const f = feats.find(feature => feature.layer.id === 'subestaciones') || feats[0];
    mapPopup?.remove();
    if (f) {
      const lid = f.layer.id;
      selectCircuit(lid === 'lineas' ? f.properties.circuito_mapa : '');
      const popup = new maplibregl.Popup({ maxWidth: '260px', closeOnClick: false })
        .setLngLat(f.geometry.type === 'Point' ? f.geometry.coordinates as [number, number] : e.lngLat)
        .setHTML(popupHtml[lid](f.properties))
        .addTo(map);
      mapPopup = popup;
      popup.on('close', () => { mapPopup = undefined; selectCircuit(); });
      const site = lid === 'subestaciones' && stationsById.get(f.properties.ficha_subestacion);
      if (site) bindStationCircuits(popup, site);
      return;
    }
    const d = map.getLayer('dept-fill') && map.queryRenderedFeatures(e.point, { layers: ['dept-fill'] })[0];
    if (d) { const full = data.departamentos.features.find(x => String(x.properties.cod_dpto) === String(d.properties.cod_dpto)); if (full) openFicha(full); }
  });
};

const buildChips = () => {
  const box = $('chips');
  Object.keys(groups).filter(k => labels[k]).forEach(k => {
    const b = document.createElement('button'); b.id = `chip-${k}`; b.className = 'chip'; b.type = 'button'; b.textContent = labels[k]; b.setAttribute('aria-pressed', String(on[k]));
    b.onclick = () => {
      on[k] = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on[k]));
      groups[k].forEach(l => map.getLayer(l) && map.setLayoutProperty(l, 'visibility', on[k] ? 'visible' : 'none'));
      if (k === 'lineas') {
        if (!on.lineas) mapPopup?.remove();
        applyFlow();
      }
      if (k === 'subestaciones') updateFootprintVisibility();
      if (k === 'intercambios') setIx();
    };
    box.append(b);
  });
};
const buildLegend = () => {
  const row = (c: string, t: string, dot = false, h = 3) => `<div><span class="${dot ? 'dot' : 'sw'}" style="background:${c};${dot ? '' : `height:${h}px`}"></span>${t}</div>`;
  const syncedAt = data.lineas_upme.properties?.generated_at;
  const syncedDate = syncedAt ? new Date(syncedAt) : null;
  const upmeDate = syncedDate && Number.isFinite(+syncedDate)
    ? ` · descarga del ${syncedDate.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}`
    : '';
  $('legend-body').innerHTML = `<div class="lg"><label for="network-source">Fuente de la red</label>
  <select id="network-source"><option value="unificada">Vista unificada</option><option value="osm">OpenStreetMap</option><option value="upme">UPME</option></select>
  <h3>Líneas por tensión</h3><div class="legend-grid">${LINE_C.map(([t, c], i) => row(c, t, false, [4, 3, 2, 2][i])).join('')}</div>
  <h3>Subestaciones</h3><div class="legend-grid">
  <div><span class="dot" style="background:#fff;border:2px solid #14202e;box-shadow:none"></span>OpenStreetMap</div>
  ${data.subestaciones_upme.features.length ? row(UPME_COLOR, 'UPME', true) : ''}</div>
  <details class="legend-more"><summary>Más símbolos y opciones</summary>
  <h3>Centrales por tecnología</h3><div class="legend-grid">${Object.entries(TECH).map(([t, c]) => row(c, t, true)).join('')}</div>
  <span class="src">El tamaño indica potencia en MW. Punto pequeño: sin dato.</span>
  ${data.predios_subestaciones.features.length ? `<span class="src">Predios de OpenStreetMap visibles al acercar el mapa${data.predios_subestaciones.properties?.coverage ? ' · ' + esc(data.predios_subestaciones.properties.coverage) : ''}.</span>` : ''}
  ${alertasData ? '<h3>Alertas IDEAM</h3>' : ''}${!alertasData ? '' : Object.entries(LVL).map(([t, c]) => row(c, t[0].toUpperCase() + t.slice(1), true)).join('')}
  <h3>Intercambios</h3><div><svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true" style="margin-right:8px;flex:none"><path d="M1 6H15" stroke="#0b6e4f" stroke-width="3"/><path d="M13 1L21 6L13 11Z" fill="#0b6e4f"/></svg>Sentido del saldo publicado</div>
  <label class="sw-t"><input type="checkbox" id="flow-t" role="switch" ${flowOn ? 'checked' : ''}><span>Animación ilustrativa</span></label>
  ${data.lineas_upme.features.length ? `<span class="src">Trazados UPME${upmeDate}</span>` : ''}
  </details></div>`;
  const source = $<HTMLSelectElement>('network-source');
  source.options[2].disabled = !data.lineas_upme.features.length && !data.subestaciones_upme.features.length;
  source.onchange = () => {
    mapPopup?.remove();
    setNetworkMode(source.value as NetworkMode);
  };
};

// ---------- Tarjetas nacionales ----------
type S = { ts: string; value: number }[];
const meta = { v: null as any };
const foot = (name: 'xm' | 'ideam' | 'xm_intercambios', label: string, upd?: string) => {
  const m = meta.v?.sources?.[name]; const bad = m && m.status !== 'ok';
  const old = upd && Date.now() - +new Date(upd) > 6 * 3600e3;
  return `<div class="src">Fuente: ${label}${upd ? ' · actualizado ' + hhmm(upd) : ''}</div>` + (bad ? `<div class="warn" role="alert">Sin datos nuevos de ${label}${m.last_ok ? ' desde ' + hhmm(m.last_ok) : ''}</div>` : old ? `<div class="warn" role="alert">Datos con más de 6 horas de antigüedad</div>` : '');
};
const spark = (v: number[], label: string) => {
  if (v.length < 2) return '';
  const mn = Math.min(...v), mx = Math.max(...v), r = mx - mn || 1;
  const pts = v.map((y, i) => `${(i / (v.length - 1) * 200).toFixed(1)},${(54 - (y - mn) / r * 48).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 200 60" preserveAspectRatio="none" role="img" aria-label="${label}"><polygon points="0,60 ${pts} 200,60" fill="#2457d6" opacity=".1"/><polyline points="${pts}" fill="none" stroke="#2457d6" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
};
const card = (id: string, h: string, body: string) => `<section class="dc" id="${id}"><h2>${h}</h2>${body}</section>`;
const riesgoCard = (r: any) => {
  if (!r || !['bajo', 'medio', 'alto'].includes(r.nivel)) return '';
  const C: Record<string, string> = { bajo: '#0a7a45', medio: '#b86e00', alto: '#b42318' }, BG: Record<string, string> = { bajo: '#e3f5ec', medio: '#fff1d6', alto: '#fde4e1' };
  const rows = (r.senales || []).map((x: any) => `<div class="sg"><span>${esc(x.nombre)}</span><b class="${x.estado === 'alerta' ? 'dn' : ''}" title="${esc(x.detalle)}">${typeof x.valor === 'number' ? fmt(x.valor, 1) + ' ' + esc(x.unidad) : 's/d'}</b></div>`).join('');
  const err = r.status === 'error' ? '<div class="warn" role="alert">Sin datos nuevos de XM; se muestra el último cálculo.</div>' : '';
  return card('riesgo', 'Riesgo de racionamiento', `<span class="rnivel" style="background:${BG[r.nivel]};color:${C[r.nivel]}">${r.nivel.toUpperCase()}</span>${rows}${err}<div class="src">Indicador propio con datos de XM · <a href="./como-funciona.html#riesgo">cómo se calcula</a></div>`);
};
const horaBogota = () => Number(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota', hour: 'numeric', hour12: false })) % 24;
const fechaCorta = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short' });
const barras = (v: number[], marca: number, label: string) => {
  const W = 260, H = 54, max = Math.max(...v, 1), bw = W / v.length;
  return `<svg class="bars" viewBox="0 0 ${W} ${H + 12}" role="img" aria-label="${esc(label)}">${v.map((x, i) => `<rect x="${(i * bw + 1).toFixed(1)}" y="${(H - x / max * H).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(x / max * H).toFixed(1)}" rx="1.5" fill="${i === marca ? '#c2410c' : '#93a5d8'}"/>`).join('')}<text x="0" y="${H + 11}" font-size="9" fill="#6b7785">00:00</text><text x="${W / 2}" y="${H + 11}" font-size="9" fill="#6b7785" text-anchor="middle">12:00</text><text x="${W}" y="${H + 11}" font-size="9" fill="#6b7785" text-anchor="end">23:00</text></svg>`;
};
const precioHoyCard = (ph: any) => {
  if (!ph?.series?.length) return '';
  const v: number[] = ph.series.map((x: any) => x.value);
  const esHoy = ph.fecha_operacion === new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const i = esHoy ? Math.min(horaBogota(), v.length - 1) : -1;
  const big = i >= 0 ? `<div class="big">${fmt(v[i], 0)} <small>COP/kWh</small></div><div class="cmp">Previsto para esta hora (${String(i).padStart(2, '0')}:00) · mín. ${fmt(Math.min(...v))} · máx. ${fmt(Math.max(...v))}</div>`
    : `<div class="big">${fmt(v.reduce((a, b) => a + b, 0) / v.length)} <small>COP/kWh</small></div><div class="cmp">Promedio previsto del ${esc(fechaCorta(ph.fecha_operacion))}</div>`;
  return card('hoy', `Precio previsto ${esHoy ? 'de hoy' : 'del ' + esc(fechaCorta(ph.fecha_operacion))}`, `${big}${barras(v, i, 'Precio previsto por hora')}<div class="note">Costo marginal del despacho programado por XM. Es una estimación del precio de bolsa; el valor definitivo se publica unos días después.</div>${foot('xm', 'XM', ph.updated_at)}`);
};
const demandaDiariaHtml = (dd: any) => {
  const s: { date: string; gwh: number }[] = dd?.series || []; if (!s.length) return '';
  const l = s[s.length - 1], prev = s.slice(-8, -1), avg = prev.length ? prev.reduce((a, b) => a + b.gwh, 0) / prev.length : NaN;
  const d = isFinite(avg) ? (l.gwh - avg) / avg * 100 : NaN;
  return `<div class="big">${fmt(l.gwh, 1)} <small>GWh</small></div><div class="cmp">Total del ${esc(fechaCorta(l.date))}${isFinite(d) ? ` · <span class="${d <= 0 ? 'up' : 'dn'}">${d >= 0 ? '+' : '−'}${fmt(Math.abs(d), 1)} %</span> frente al promedio de la semana anterior` : ''}</div>${spark(s.slice(-30).map(x => x.gwh), 'Demanda diaria, últimos 30 días')}<div class="note">Demanda diaria de los últimos 30 días.</div>`;
};
const buildCards = (dem: any, pre: any, emb: any, rie?: any, mix?: any, ph?: any, dd?: any) => {
  let h = riesgoCard(rie) + precioHoyCard(ph) + '<section id="precio" class="dc hourly-history"></section>' + ixCard();
  if (dd?.series?.length) h += card('demanda', 'Demanda de energía', `${demandaDiariaHtml(dd)}${foot('xm', 'XM', dd.updated_at)}`);
  else if (dem?.series?.length) { const s: S = dem.series.slice(-48); const l = s[s.length - 1]; h += card('demanda', 'Demanda de energía', `<div class="big">${fmt(l.value)} <small>${esc(dem.unit)}</small></div>${spark(s.map(x => x.value), 'Demanda reciente')}${foot('xm', 'XM', dem.updated_at)}`); flagSample(dem); }
  else h += card('demanda', 'Demanda de energía', '<div class="src">Sin datos disponibles.</div>');
  if (emb?.nacional && typeof emb.nacional.volumen_util_pct === 'number') {
    const a = emb.nacional.volumen_util_pct, b = emb.nacional.anio_anterior_pct;
    const cmp = typeof b === 'number' && isFinite(b) ? (() => { const d = a - b; return `<div class="cmp">Año anterior: ${fmt(b, 1)} % · <span class="${d >= 0 ? 'up' : 'dn'}">${d >= 0 ? '+' : '−'}${fmt(Math.abs(d), 1)} pp</span></div>`; })() : '';
    h += card('embalses', 'Embalses · volumen útil', `<div class="big">${fmt(a, 1)} <small>%</small></div>${cmp}${spark((emb.series || []).map((x: any) => x.pct), 'Volumen útil reciente')}${foot('xm', 'XM', emb.updated_at)}`); flagSample(emb);
  } else h += card('embalses', 'Embalses · volumen útil', '<div class="src">Sin datos disponibles.</div>');
  h += '<div class="src" style="padding:6px 8px 0;border-top:1px solid var(--line)">Estimaciones propias marcadas como tales. No reemplaza avisos de XM, IDEAM ni de tu empresa de energía.</div>';
  $('cards').innerHTML = h;
  flagSample(pre); flagSample(mix);
  mountHistory($('precio'), pre, mix);
};

// ---------- Búsqueda ----------
const initSearch = () => {
  const q = $<HTMLInputElement>('q'), ul = $('results'); let sel = -1; let cur: any[] = [];
  const norm = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const idx = [
    ...data.departamentos.features.map(f => ({ f, kind: 'dpto', k: norm(f.properties.nombre) })),
    ...data.municipios_centroides.features.map(f => ({ f, kind: 'mpio', k: norm((f.properties.nombre || '') + ' ' + (f.properties.departamento || '')) })),
  ];
  const close = () => { ul.hidden = true; q.setAttribute('aria-expanded', 'false'); q.removeAttribute('aria-activedescendant'); sel = -1; };
  const go = (it: any) => {
    close(); q.blur();
    if (it.kind === 'dpto') { q.value = it.f.properties.nombre; openFicha(it.f); return; }
    const f = it.f, c = f.geometry.coordinates as [number, number]; q.value = f.properties.nombre; map.flyTo({ center: c, zoom: 9 });
    const p = f.properties, al = (alertasData?.alertas || []).find((a: any) => String(a.divipola_mpio) === String(p.divipola));
    new maplibregl.Popup().setLngLat(c).setHTML(`<div class="pp"><b>${esc(p.nombre)}</b><div class="m">${esc(p.departamento)}</div><div class="m">DIVIPOLA ${esc(p.divipola)}</div>${al ? `<div class="m">Alerta ${esc(al.nivel)}: ${esc(al.tipo)}</div>` : ''}</div>`).addTo(map);
  };
  const render = () => {
    ul.innerHTML = cur.map((it, i) => `<li role="option" id="o${i}" aria-selected="${i === sel}"><span>${esc(it.f.properties.nombre)}</span><span class="src">${it.kind === 'dpto' ? 'Departamento' : esc(it.f.properties.departamento)}</span></li>`).join('');
    ul.hidden = !cur.length; q.setAttribute('aria-expanded', String(!!cur.length)); if (sel >= 0) q.setAttribute('aria-activedescendant', 'o' + sel);
  };
  q.addEventListener('input', () => { const t = norm(q.value.trim()); cur = t ? idx.filter(i => i.k.includes(t)).sort((a, b) => (a.k.startsWith(t) ? 0 : 1) - (b.k.startsWith(t) ? 0 : 1) || a.k.indexOf(t) - b.k.indexOf(t)).slice(0, 8) : []; sel = -1; render(); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, cur.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  $('search').addEventListener('submit', e => { e.preventDefault(); const it = cur[sel >= 0 ? sel : 0]; if (it) go(it); });
  ul.addEventListener('mousedown', e => { const li = (e.target as HTMLElement).closest('li'); if (li) go(cur[+li.id.slice(1)]); });
  q.addEventListener('blur', () => setTimeout(close, 150));
};

// ---------- UI ----------
const handle = $('handle'), panel = $('panel');
const setPanel = (open: boolean) => { panel.classList.toggle('closed', !open); handle.setAttribute('aria-expanded', String(open)); };
handle.onclick = () => setPanel(panel.classList.contains('closed'));
const mobile = matchMedia('(max-width:720px)').matches;
if (mobile) setPanel(false);
$('menu').onclick = () => { const o = $('nav').classList.toggle('open'); $('menu').setAttribute('aria-expanded', String(o)); };
document.querySelectorAll<HTMLElement>('[data-go]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); closeFicha(); setPanel(true); $('nav').classList.remove('open'); $('menu').setAttribute('aria-expanded', 'false');
  document.querySelectorAll('#nav a').forEach(x => { x.classList.toggle('on', x === a); x.removeAttribute('aria-current'); }); a.setAttribute('aria-current', 'page');
  const t = $(a.dataset.go!); if (!t) return;
  requestAnimationFrame(() => { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash'); });
}));
document.querySelector<HTMLElement>('#nav a[href="./"]')!.addEventListener('click', e => { e.preventDefault(); closeFicha(); document.querySelectorAll('#nav a').forEach(x => x.classList.toggle('on', x.getAttribute('href') === './')); map.flyTo({ center: [-73.8, 5.2], zoom: mobile ? 4.3 : 5.2 }); });

(async () => {
  const [style, , m, dem, pre, emb, al, rie, mix, cal, ixd, ph, dd] = await Promise.all([fetchStyle(), load(), tryGet('api/v1/meta.json'), tryGet('api/v1/demanda.json'), tryGet('api/v1/precio_bolsa.json'), tryGet('api/v1/embalses.json'), tryGet('api/v1/alertas.json'), tryGet('api/v1/riesgo.json'), tryGet('api/v1/generacion.json'), tryGet('api/v1/calidad_municipios.json'), tryGet('api/v1/intercambios.json'), tryGet('api/v1/precio_hoy.json'), tryGet('api/v1/demanda_diaria.json')]);
  calidadData = cal; if (ixd && Array.isArray(ixd.paises)) intercambios = ixd; meta.v = m; alertasData = al && !al.sample ? al : null; flagSample(m);
  if (!alertasData) { delete labels.alertas; on.alertas = false; }
  buildLegend(); buildCards(dem, pre, emb, rie, mix, ph, dd); initSearch(); buildChips();
  initMap(style); addIxMarkers();
  $<HTMLInputElement>('flow-t').onchange = e => { flowOn = (e.target as HTMLInputElement).checked; applyFlow(); };
  map.on('load', applyFlow);
  (window as any).__map = map;
})();
