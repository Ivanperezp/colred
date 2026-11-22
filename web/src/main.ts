import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { operadoresDe } from './operadores';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);

type Fc = { type: 'FeatureCollection'; features: any[]; sample?: boolean };
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
const data: Record<string, Fc> = {};
const load = async () => {
  const names = ['lineas', 'subestaciones', 'centrales', 'municipios_centroides', 'departamentos'];
  const res = await Promise.all(names.map(n => tryGet(`data/${n}.geojson`)));
  names.forEach((n, i) => { data[n] = res[i] || empty; flagSample(res[i]); });
};

const rank = (n: string) => ({ roja: 3, naranja: 2, amarilla: 1 } as Record<string, number>)[n] || 0;
const groups: Record<string, string[]> = { lineas: ['lineas-glow', 'lineas-casing', 'lineas', 'lineas-inferidas'], subestaciones: ['subestaciones'], centrales: ['centrales', 'centrales-label'], alertas: ['alertas'] };
const labels: Record<string, string> = { lineas: 'Líneas', subestaciones: 'Subestaciones', centrales: 'Centrales', alertas: 'Alertas IDEAM' };
const on: Record<string, boolean> = { lineas: true, subestaciones: true, centrales: true, alertas: true };
let calidadData: any = null; let alertasData: any = null; let isFallback = false; let map!: maplibregl.Map;

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
  src('departamentos', data.departamentos as any, { promoteId: 'cod_dpto' }); src('lineas', data.lineas as any); src('subestaciones', data.subestaciones as any);
  src('centrales', data.centrales as any); src('alertas', alertFc() as any);
  const fb = isFallback;
  lay({ id: 'dept-fill', type: 'fill', source: 'departamentos', paint: { 'fill-color': fb ? '#f7f5ef' : '#2457d6', 'fill-opacity': fb ? 1 : ['case', ['boolean', ['feature-state', 'hover'], false], .1, .035] } });
  lay({ id: 'dept-line', type: 'line', source: 'departamentos', paint: { 'line-color': fb ? '#b8c3cf' : '#8896a6', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, .5, 9, 1.2], 'line-opacity': .8 } });
  lay({ id: 'dept-sel', type: 'line', source: 'departamentos', filter: ['==', ['get', 'cod_dpto'], ''], paint: { 'line-color': '#2457d6', 'line-width': 2.5 } });
  const kv: any = ['to-number', ['get', 'tension_kv'], 0];
  const w = (a: number, b: number, c: number) => ['interpolate', ['linear'], ['zoom'], 4, ['case', ['>=', kv, 500], a, ['>=', kv, 220], b, c], 9, ['case', ['>=', kv, 500], a * 2.4, ['>=', kv, 220], b * 2.4, c * 2.4]] as any;
  const vis = (k: string) => ({ visibility: on[k] ? 'visible' : 'none' } as any);
  lay({ id: 'lineas-glow', type: 'line', source: 'lineas', filter: ['all', ['>=', kv, 500], ['!=', ['get', 'inferido'], true]], layout: { ...vis('lineas'), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#c0152f', 'line-opacity': .22, 'line-blur': 3, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 7, 9, 16] } });
  lay({ id: 'lineas-casing', type: 'line', source: 'lineas', filter: ['!=', ['get', 'inferido'], true], layout: { ...vis('lineas'), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-opacity': .85, 'line-width': w(3.6, 2.8, 2.2) } });
  const lc: any = ['case', ['>=', kv, 500], LINE_C[0][1], ['>=', kv, 220], LINE_C[1][1], ['>=', kv, 110], LINE_C[2][1], LINE_C[3][1]];
  lay({ id: 'lineas', type: 'line', source: 'lineas', filter: ['!=', ['get', 'inferido'], true], layout: { ...vis('lineas'), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': lc, 'line-width': w(2, 1.4, 1) } });
  lay({ id: 'lineas-inferidas', type: 'line', source: 'lineas', filter: ['==', ['get', 'inferido'], true], layout: { ...vis('lineas'), 'line-cap': 'butt' }, paint: { 'line-color': lc, 'line-opacity': .8, 'line-width': w(1.6, 1.2, 0.9), 'line-dasharray': [2, 2] } });
  lay({ id: 'subestaciones', type: 'circle', source: 'subestaciones', minzoom: 5, layout: vis('subestaciones'), paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 10, 6], 'circle-color': '#fff', 'circle-stroke-color': '#14202e', 'circle-stroke-width': 1.6 } });
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

const popupHtml: Record<string, (p: any) => string> = {
  lineas: p => `<div class="pp"><b>${esc(p.name || 'Línea de transmisión')}</b><div class="m">${p.tension_kv && p.tension_kv !== 'null' ? esc(p.tension_kv) + ' kV' : 'Tensión desconocida'}</div>${errLink(p.name || 'Línea de transmisión')}</div>`,
  subestaciones: p => `<div class="pp"><b>${esc(p.nombre || p.name || 'Subestación')}</b><div class="m">${p.tension_kv && p.tension_kv !== 'null' ? esc(p.tension_kv) + ' kV' : 'Subestación'}</div>${errLink(p.nombre || p.name || 'Subestación')}</div>`,
  centrales: p => `<div class="pp"><b>${esc(/^central sin nombre$/i.test(String(p.nombre)) ? 'Central ' + String(p.tecnologia).toLowerCase() : p.nombre)}</b><div class="m">${esc(p.tecnologia)}</div><div class="m">${Number(p.mw) ? 'Potencia: ' + fmt(Number(p.mw)) + ' MW' : 'Potencia no registrada'}</div>${errLink(p.nombre)}</div>`,
  alertas: p => `<div class="pp"><b>${esc(p.municipio)}</b><div class="m">${esc(p.departamento)}</div><div class="m">Alerta ${esc(p.nivel)} · ${esc(p.tipo)}</div><div class="m">${esc(p.texto)}</div></div>`,
};
const HIT = ['alertas', 'centrales', 'subestaciones', 'lineas'];

// ---------- Ficha de departamento ----------
const inRing = (pt: number[], r: number[][]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
const inGeom = (pt: number[], g: any) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).some((p: number[][][]) => inRing(pt, p[0]) && !p.slice(1).some(h => inRing(pt, h)));
const bboxOf = (g: any) => { let a = 180, b = 90, c = -180, d = -90; JSON.stringify(g.coordinates).match(/-?\d+\.?\d*,-?\d+\.?\d*/g)!.forEach(s => { const [x, y] = s.split(',').map(Number); a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }); return [a, b, c, d] as [number, number, number, number]; };
const calidadHtml = (code: string) => {
  const ops = calidadData?.items ? operadoresDe(calidadData.items, code) : [];
  if (!ops.length) return '';
  const f = (v: number | null) => v == null ? 's/d' : v.toLocaleString('es-CO', { maximumFractionDigits: 4 });
  return `<h3>Calidad del servicio (continuidad)</h3>` + ops.map(o => `<div class="pl" style="display:block;font-size:13px"><b>${esc(o.nombre)}</b><div class="m">ITAD nivel 1: ${f(o.n1)} · niveles 2 y 3: ${f(o.n23)}</div><div class="m">Último reporte: ${o.anio}, trimestre ${o.trimestre}</div></div>`).join('') + `<div class="src" style="margin:6px 0 0">ITAD: índice trimestral agrupado de discontinuidad por nivel de tensión (adimensional; menor es mejor). Es del operador, no del departamento. Fuente: Superservicios</div>`;
};
const openFicha = (f: any, fit = true) => {
  const code = String(f.properties.cod_dpto), nombre = f.properties.nombre, g = f.geometry;
  const pls = (data.centrales.features || []).filter(c => inGeom(c.geometry.coordinates, g)).sort((a, b) => (b.properties.mw || 0) - (a.properties.mw || 0));
  const total = pls.reduce((s, c) => s + (Number(c.properties.mw) || 0), 0);
  const unk = (c: any) => /^central sin nombre$/i.test(String(c.properties.nombre)) && !Number(c.properties.mw);
  const nUnk = pls.filter(unk).length; const shown = pls.filter(c => !unk(c));
  const al = (alertasData?.alertas || []).filter((a: any) => String(a.divipola_mpio).slice(0, 2) === code);
  $('ficha').innerHTML = `<button class="x" type="button" aria-label="Cerrar ficha">×</button><h2>${esc(nombre)}</h2><div class="src" style="margin:0">Departamento · código DANE ${esc(code)}</div>
  ${alertasData ? `<h3>Alertas IDEAM</h3>` : ''}${!alertasData ? '' : al.length ? al.map((a: any) => `<span class="tag" style="background:${LVL[a.nivel] || '#ccc'}22;color:#14202e;border:1px solid ${LVL[a.nivel] || '#ccc'}">${esc(a.municipio)}: ${esc(a.tipo)} (${esc(a.nivel)})</span>`).join('') : '<div class="src" style="margin:0">Sin alertas registradas.</div>'}
  <h3>Centrales</h3>${pls.length ? shown.map(c => `<div class="pl"><span><i style="background:${TECH[c.properties.tecnologia] || '#8a5fb5'}"></i>${esc(c.properties.nombre)}</span><span>${c.properties.mw ? fmt(Number(c.properties.mw)) + ' MW' : 's/d'}</span></div>`).join('') + (nUnk ? `<div class="src" style="margin:6px 0 0">y ${nUnk} centrales pequeñas sin nombre registrado</div>` : '') + `<div class="tot"><span>Total</span><span>${fmt(total)} MW</span></div>` : '<div class="src" style="margin:0">No hay centrales registradas en este departamento.</div>'}
  ${calidadHtml(code)}`;
  $('ficha').hidden = false; document.body.classList.add('sheet'); ($('ficha').querySelector('.x') as HTMLElement).onclick = closeFicha;
  map.setFilter('dept-sel', ['==', ['get', 'cod_dpto'], code]);
  if (fit) { const [a, b, c, d] = bboxOf(g); map.fitBounds([[a, b], [c, d]], { padding: { top: 140, bottom: 60, left: 280, right: 360 }, maxZoom: 7, duration: 800 }); }
};
const closeFicha = () => { $('ficha').hidden = true; document.body.classList.remove('sheet'); if (map.getLayer('dept-sel')) map.setFilter('dept-sel', ['==', ['get', 'cod_dpto'], '']); };

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
    const f = feats[0];
    if (f) { const lid = f.layer.id; new maplibregl.Popup({ maxWidth: '260px' }).setLngLat(lid === 'lineas' ? e.lngLat : (f.geometry as any).coordinates).setHTML(popupHtml[lid](f.properties)).addTo(map); return; }
    const d = map.queryRenderedFeatures(e.point, { layers: ['dept-fill'] })[0];
    if (d) { const full = data.departamentos.features.find(x => String(x.properties.cod_dpto) === String(d.properties.cod_dpto)); if (full) openFicha(full); }
  });
};

const buildChips = () => {
  const box = $('chips');
  Object.keys(groups).filter(k => labels[k]).forEach(k => {
    const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.textContent = labels[k]; b.setAttribute('aria-pressed', 'true');
    b.onclick = () => { on[k] = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on[k])); groups[k].forEach(l => map.getLayer(l) && map.setLayoutProperty(l, 'visibility', on[k] ? 'visible' : 'none')); };
    box.append(b);
  });
};
const buildLegend = () => {
  const row = (c: string, t: string, dot = false, h = 3) => `<div><span class="${dot ? 'dot' : 'sw'}" style="background:${c};${dot ? '' : `height:${h}px`}"></span>${t}</div>`;
  $('legend-body').innerHTML = `<div class="lg"><h3>Líneas por tensión</h3>${LINE_C.map(([t, c], i) => row(c, t, false, [4, 3, 2, 2][i])).join('')}
  <h3>Centrales por tecnología</h3>${Object.entries(TECH).map(([t, c]) => row(c, t, true)).join('')}<span class="src">Tamaño según potencia (MW); punto pequeño = sin dato</span>
  <h3>Subestaciones</h3><div><span class="dot" style="background:#fff;border:2px solid #14202e;box-shadow:none"></span>Subestación</div>
  ${alertasData ? '<h3>Alertas IDEAM</h3>' : ''}${!alertasData ? '' : Object.entries(LVL).map(([t, c]) => row(c, t[0].toUpperCase() + t.slice(1), true)).join('')}
  <span class="src" style="margin-top:10px">Fuentes: XM, UPME, DANE y OpenStreetMap.</span></div>`;
};

// ---------- Tarjetas nacionales ----------
type S = { ts: string; value: number }[];
const meta = { v: null as any };
const foot = (name: 'xm' | 'ideam', label: string, upd?: string) => {
  const m = meta.v?.sources?.[name]; const bad = m && m.status !== 'ok';
  const old = upd && Date.now() - +new Date(upd) > 6 * 3600e3;
  return `<div class="src">Fuente: ${label} · actualizado ${hhmm(upd)}</div>` + (bad ? `<div class="warn" role="alert">Sin datos nuevos de ${label} desde ${hhmm(m.last_ok)}</div>` : old ? `<div class="warn" role="alert">Datos con más de 6 horas de antigüedad</div>` : '');
};
const spark = (v: number[], label: string) => {
  if (v.length < 2) return '';
  const mn = Math.min(...v), mx = Math.max(...v), r = mx - mn || 1;
  const pts = v.map((y, i) => `${(i / (v.length - 1) * 200).toFixed(1)},${(54 - (y - mn) / r * 48).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 200 60" preserveAspectRatio="none" role="img" aria-label="${label}"><polygon points="0,60 ${pts} 200,60" fill="#2457d6" opacity=".1"/><polyline points="${pts}" fill="none" stroke="#2457d6" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
};
const bars = (v: number[], label: string) => {
  if (!v.length) return '';
  const mx = Math.max(...v, 1), w = 200 / v.length;
  return `<svg viewBox="0 0 200 60" preserveAspectRatio="none" role="img" aria-label="${label}">${v.map((y, i) => `<rect x="${(i * w + .6).toFixed(1)}" y="${(58 - y / mx * 56).toFixed(1)}" width="${(w - 1.2).toFixed(1)}" height="${(y / mx * 56).toFixed(1)}" rx="1" fill="${i === v.length - 1 ? '#f5a300' : '#9db4ee'}"/>`).join('')}</svg>`;
};
const card = (id: string, h: string, body: string) => `<section class="dc" id="${id}"><h2>${h}</h2>${body}</section>`;
const MIX_C: Record<string, string> = { ...TECH, 'Térmica líquidos': '#c9503a', 'Biomasa y otras': TECH['Biomasa'], 'Térmica': TECH['Térmica gas'], 'Otras': TECH['Biomasa'] };
const riesgoCard = (r: any) => {
  if (!r || !['bajo', 'medio', 'alto'].includes(r.nivel)) return '';
  const C: Record<string, string> = { bajo: '#0a7a45', medio: '#b86e00', alto: '#b42318' }, BG: Record<string, string> = { bajo: '#e3f5ec', medio: '#fff1d6', alto: '#fde4e1' };
  const rows = (r.senales || []).map((x: any) => `<div class="sg"><span>${esc(x.nombre)}</span><b class="${x.estado === 'alerta' ? 'dn' : ''}" title="${esc(x.detalle)}">${typeof x.valor === 'number' ? fmt(x.valor, 1) + ' ' + esc(x.unidad) : 's/d'}</b></div>`).join('');
  const err = r.status === 'error' ? '<div class="warn" role="alert">Sin datos nuevos de XM; se muestra el último cálculo.</div>' : '';
  return card('riesgo', 'Riesgo de racionamiento', `<span class="rnivel" style="background:${BG[r.nivel]};color:${C[r.nivel]}">${r.nivel.toUpperCase()}</span>${rows}${err}<div class="src">Indicador propio con datos de XM · <a href="./como-funciona.html#riesgo">cómo se calcula</a></div>`);
};
const mixCard = (g: any) => {
  const t: any[] = g?.por_tecnologia; if (!Array.isArray(t) || !t.length) return '';
  const fecha = g.fecha_operacion ? ' · ' + new Date(g.fecha_operacion + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) : '';
  const bar = `<div class="mixbar" role="img" aria-label="Participación por tecnología">${t.map(x => `<i style="width:${x.pct}%;background:${MIX_C[x.tecnologia] || '#8a5fb5'}" title="${esc(x.tecnologia)} ${fmt(x.pct, 1)} %"></i>`).join('')}</div>`;
  const leg = `<div class="mixlg">${t.map(x => `<span><i style="background:${MIX_C[x.tecnologia] || '#8a5fb5'}"></i>${esc(x.tecnologia)} <b>${fmt(x.pct, 1)} %</b></span>`).join('')}</div>`;
  let area = '';
  const hz: any[] = g.horario;
  if (Array.isArray(hz) && hz.length > 1) {
    const ks = ['Hidráulica', 'Térmica', 'Solar', 'Eólica', 'Otras'], mx = Math.max(...hz.map(o => ks.reduce((a, k) => a + (o[k] || 0), 0)), 1), n = hz.length;
    const cum = hz.map(() => 0); let paths = '';
    ks.forEach(k => {
      const top = hz.map((o, i) => (cum[i] += o[k] || 0)), bot = top.map((y, i) => y - (hz[i][k] || 0)), X = (i: number) => (i / (n - 1) * 200).toFixed(1), Y = (v: number) => (58 - v / mx * 54).toFixed(1);
      paths += `<polygon points="${top.map((y, i) => `${X(i)},${Y(y)}`).join(' ')} ${bot.map((y, i) => `${X(n - 1 - i)},${Y(bot[n - 1 - i])}`).join(' ')}" fill="${MIX_C[k]}" opacity=".85"/>`;
    });
    area = `<svg viewBox="0 0 200 60" preserveAspectRatio="none" role="img" aria-label="Perfil horario de generación por tecnología">${paths}</svg><div class="ax"><span>00:00</span><span>12:00</span><span>23:00</span></div>`;
  }
  return card('mix', `Generación por tecnología${fecha}`, `<div class="big">${fmt(g.total_mwh / 1000, 1)} <small>GWh en el día</small></div>${bar}${leg}${area}${foot('xm', 'XM', g.updated_at)}`);
};
const buildCards = (dem: any, pre: any, emb: any, rie?: any, mix?: any) => {
  let h = riesgoCard(rie) + mixCard(mix);
  if (dem?.series?.length) { const s: S = dem.series.slice(-48); const l = s[s.length - 1]; h += card('demanda', 'Demanda de energía', `<div class="big">${fmt(l.value)} <small>${esc(dem.unit)}</small></div>${spark(s.map(x => x.value), 'Demanda reciente')}${foot('xm', 'XM', dem.updated_at)}`); flagSample(dem); }
  else h += card('demanda', 'Demanda de energía', '<div class="src">Sin datos disponibles.</div>');
  if (pre?.series?.length) {
    const today = new Date().toDateString(); let s: S = pre.series.filter((x: any) => new Date(x.ts).toDateString() === today); if (s.length < 2) s = pre.series.slice(-24);
    const l = s[s.length - 1];
    h += card('precio', `Precio de bolsa por hora${pre.fecha_operacion ? ' · ' + new Date(pre.fecha_operacion + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) : ''}`, `<div class="big">${fmt(l.value, 1)} <small>${esc(pre.unit)}</small></div>${bars(s.map(x => x.value), 'Precio de bolsa por hora')}<div class="ax"><span>${hhmm(s[0].ts)}</span><span>${hhmm(l.ts)}</span></div><div class="note">Precio mayorista; no es tu tarifa.</div>${foot('xm', 'XM', pre.updated_at)}`); flagSample(pre);
  } else h += card('precio', 'Precio de bolsa por hora', '<div class="src">Sin datos disponibles.</div>');
  if (emb?.nacional && typeof emb.nacional.volumen_util_pct === 'number') {
    const a = emb.nacional.volumen_util_pct, b = emb.nacional.anio_anterior_pct;
    const cmp = typeof b === 'number' && isFinite(b) ? (() => { const d = a - b; return `<div class="cmp">Año anterior: ${fmt(b, 1)} % · <span class="${d >= 0 ? 'up' : 'dn'}">${d >= 0 ? '+' : '−'}${fmt(Math.abs(d), 1)} pp</span></div>`; })() : '';
    h += card('embalses', 'Embalses · volumen útil', `<div class="big">${fmt(a, 1)} <small>%</small></div>${cmp}${spark((emb.series || []).map((x: any) => x.pct), 'Volumen útil reciente')}${foot('xm', 'XM', emb.updated_at)}`); flagSample(emb);
  } else h += card('embalses', 'Embalses · volumen útil', '<div class="src">Sin datos disponibles.</div>');
  h += '<div class="src" style="padding:6px 8px 0;border-top:1px solid var(--line)">Estimaciones propias marcadas como tales. No reemplaza avisos de XM, IDEAM ni de tu empresa de energía.</div>';
  $('cards').innerHTML = h;
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
if (mobile) { setPanel(false); $('legend').removeAttribute('open'); }
$('menu').onclick = () => { const o = $('nav').classList.toggle('open'); $('menu').setAttribute('aria-expanded', String(o)); };
document.querySelectorAll<HTMLElement>('[data-go]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); closeFicha(); setPanel(true); $('nav').classList.remove('open'); $('menu').setAttribute('aria-expanded', 'false');
  document.querySelectorAll('#nav a').forEach(x => { x.classList.toggle('on', x === a); x.removeAttribute('aria-current'); }); a.setAttribute('aria-current', 'page');
  const t = $(a.dataset.go!); if (!t) return;
  requestAnimationFrame(() => { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash'); });
}));
document.querySelector<HTMLElement>('#nav a[href="./"]')!.addEventListener('click', e => { e.preventDefault(); closeFicha(); document.querySelectorAll('#nav a').forEach(x => x.classList.toggle('on', x.getAttribute('href') === './')); map.flyTo({ center: [-73.8, 5.2], zoom: mobile ? 4.3 : 5.2 }); });

(async () => {
  const [style, , m, dem, pre, emb, al, rie, mix, cal] = await Promise.all([fetchStyle(), load(), tryGet('api/v1/meta.json'), tryGet('api/v1/demanda.json'), tryGet('api/v1/precio_bolsa.json'), tryGet('api/v1/embalses.json'), tryGet('api/v1/alertas.json'), tryGet('api/v1/riesgo.json'), tryGet('api/v1/generacion.json'), tryGet('api/v1/calidad_municipios.json')]);
  calidadData = cal; meta.v = m; alertasData = al && !al.sample ? al : null; flagSample(m);
  if (!alertasData) { delete labels.alertas; on.alertas = false; }
  buildLegend(); buildCards(dem, pre, emb, rie, mix); initSearch(); buildChips();
  initMap(style);
  (window as any).__map = map;
})();
