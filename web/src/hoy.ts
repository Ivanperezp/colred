// "Colombia hoy, hora a hora": línea de tiempo, centrales por hora y tarjetas del panel.
import type * as maplibregl from 'maplibre-gl';

export type Hoy = {
  fecha: string; updated_at?: string;
  metricas?: { generacion?: string };
  precio: (number | null)[]; generacion_total_mw: (number | null)[];
  por_tecnologia: Record<string, (number | null)[]>; por_recurso: Record<string, number[]>;
  no_disponible?: { total_mw: number; capacidad_total_mw?: number | null; por_tecnologia?: Record<string, number>; plantas: { codigo: string; nombre: string; tecnologia: string; cap_mw: number; disp_mw: number; no_disp_mw: number }[] };
  fuera_de_servicio?: { total_mw: number; capacidad_total_mw?: number | null; por_tecnologia?: Record<string, number>; plantas: { codigo: string; nombre: string; tecnologia: string; cap_mw: number }[] };
  disponibilidad_total_mw?: (number | null)[];
};
type Ctx = {
  map: () => maplibregl.Map | undefined; features: () => any[];
  tech: Record<string, string>; fmt: (n: number, d?: number) => string; esc: (s: unknown) => string;
  card: (id: string, h: string, body: string) => string;
  foot: (name: 'xm', label: string, upd?: string) => string;
  centralsOn: () => boolean;
};

const TECH_ORDER = ['Hidráulica', 'Térmica', 'Solar', 'Eólica', 'Otras'];
const hh = (h: number) => String(h).padStart(2, '0') + ':00';
const bogotaDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const bogotaHour = () => Number(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota', hour: 'numeric', hour12: false })) % 24;
const title = (s: string) => s.toLowerCase().replace(/(^|[\s\-(\/])([a-záéíóúñü])/g, (_, a, b) => a + b.toUpperCase()).replace(/\b(De|Del|La|Las|Los|Y|El)\b/g, w => w.toLowerCase());
const short = (s: string) => title(s).replace(/^(Central\s+)?(Hidroel[eé]ctrica|Termoel[eé]ctrica|Termo)\s+/i, '').replace(/^./, c => c.toUpperCase());
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export const validHoy = (d: any): d is Hoy => !!d && typeof d.fecha === 'string' && Array.isArray(d.generacion_total_mw) && d.generacion_total_mw.length === 24 && d.por_tecnologia && typeof d.por_tecnologia === 'object';

export function createHoy(ctx: Ctx) {
  let d: Hoy | null = null;
  let hour = 0, active = true, playing = false, timer = 0;
  let perFeature: { mwh: number[] | null; fs: boolean }[] = [];
  const normal: Record<string, any> = {};
  let el: HTMLElement | null = null;

  const techColor = (t: string) => t === 'Térmica' ? ctx.tech['Térmica gas'] : t === 'Otras' ? ctx.tech['Otra'] : ctx.tech[t] || '#8a5fb5';
  const dayName = () => {
    if (!d) return '';
    const today = bogotaDate();
    if (d.fecha === today) return 'Hoy';
    if (d.fecha === bogotaDate(new Date(Date.now() - 86400000))) return 'Ayer';
    return new Date(d.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  };
  const isToday = () => !!d && d.fecha === bogotaDate();
  const label = () => `${dayName()} · ${hh(hour)}`;
  const genLabel = () => d?.metricas?.generacion === 'GeneProgDesp' ? 'despacho' : 'redespacho';
  const footer = () => ctx.foot('xm', `XM · generación programada (${genLabel()})`, d?.updated_at);

  // ---- datos por central ----
  const prepare = () => {
    const fs = new Set((d?.fuera_de_servicio?.plantas || []).flatMap(p => String(p.codigo).split(',').map(s => s.trim())));
    perFeature = ctx.features().map(f => {
      const codes = String(f.properties?.xm_codigos || '').split(',').map((s: string) => s.trim()).filter(Boolean);
      if (!codes.length) return { mwh: null, fs: false };
      const sum = Array(24).fill(0);
      for (const c of codes) { const a = d!.por_recurso[c]; if (a) for (let i = 0; i < 24; i++) sum[i] += Number(a[i]) || 0; }
      return { mwh: sum, fs: codes.some(c => fs.has(c)) };
    });
  };
  const featuresAt = () => ({
    type: 'FeatureCollection' as const,
    features: ctx.features().map((f, i) => {
      const p = perFeature[i];
      return { ...f, properties: { ...f.properties, mwh: p?.mwh ? +p.mwh[hour].toFixed(1) : -1, fs: !!p?.fs } };
    }),
  });

  // ---- mapa ----
  const MW = ['to-number', ['get', 'mw'], 0] as any;
  const MWH = ['to-number', ['get', 'mwh'], -1] as any;
  const FS = ['==', ['get', 'fs'], true] as any;
  const NODATA = ['<', MWH, 0] as any;
  const ZERO = ['all', ['>=', MWH, 0], ['<', MWH, 0.05]] as any;
  const V = ['case', NODATA, MW, MWH] as any;
  const tc = () => { const e: any[] = ['match', ['get', 'tecnologia']]; Object.entries(ctx.tech).forEach(([k, v]) => e.push(k, v)); e.push('#8a5fb5'); return e; };
  const activePaint = (): Record<string, any> => ({
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['case', ZERO, 3.5, ['+', 3, ['*', .17, ['sqrt', V]]]], 9, ['case', ZERO, 5.5, ['+', 5, ['*', .4, ['sqrt', V]]]]],
    'circle-color': ['case', ZERO, ['rgba', 255, 255, 255, 0], tc()],
    'circle-opacity': ['case', FS, 0, NODATA, .3, .92],
    'circle-stroke-color': ['case', ZERO, tc(), '#fff'],
    'circle-stroke-opacity': ['case', FS, 0, NODATA, .3, ZERO, .45, 1],
  });
  const ring = () => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fillStyle = 'rgba(138,148,160,.55)'; g.fill();
    g.setLineDash([7, 5]); g.lineWidth = 4; g.strokeStyle = '#3d4856'; g.stroke();
    return g.getImageData(0, 0, 64, 64);
  };
  const applyMap = () => {
    const map = ctx.map(); if (!map || !d) return;
    const src = map.getSource<maplibregl.GeoJSONSource>('centrales'); if (!src || !map.getLayer('centrales')) return;
    const on = active;
    if (!('circle-radius' in normal)) for (const k of Object.keys(activePaint())) normal[k] = map.getPaintProperty('centrales', k as any);
    if (!('label' in normal) && map.getLayer('centrales-label')) normal.label = map.getLayoutProperty('centrales-label', 'text-field');
    src.setData((on ? featuresAt() : { type: 'FeatureCollection', features: ctx.features() }) as any);
    const paint = on ? activePaint() : normal;
    for (const k of Object.keys(paint)) map.setPaintProperty('centrales', k as any, paint[k]);
    if (map.getLayer('centrales-label') && 'label' in normal)
      map.setLayoutProperty('centrales-label', 'text-field', on ? ['case', NODATA, ['concat', ['get', 'nombre'], '\n', ['to-string', MW], ' MW'], ['concat', ['get', 'nombre'], '\n', ['to-string', ['round', MWH]], ' MW']] : normal.label);
  };

  // ---- tarjetas ----
  const ahoraBody = () => {
    if (!d) return '';
    const total = d.generacion_total_mw[hour], pr = d.precio?.[hour];
    const parts = TECH_ORDER.map(t => ({ t, v: Number(d!.por_tecnologia[t]?.[hour]) || 0 })).filter(x => x.v > 0.05);
    const sum0 = parts.reduce((s, x) => s + x.v, 0);
    parts.splice(0, parts.length, ...parts.filter(x => 100 * x.v / sum0 >= 0.5));
    const sum = parts.reduce((s, x) => s + x.v, 0);
    const bar = sum > 0
      ? `<div class="mixbar" role="img" aria-label="${ctx.esc(parts.map(x => `${x.t} ${ctx.fmt(100 * x.v / sum)} %`).join(', '))}">${parts.map(x => `<i style="width:${(100 * x.v / sum).toFixed(2)}%;background:${techColor(x.t)}"></i>`).join('')}</div><div class="mixlg">${parts.map(x => `<span><i style="background:${techColor(x.t)}"></i>${x.t} <b>${ctx.fmt(100 * x.v / sum)} %</b></span>`).join('')}</div>`
      : '<div class="note">Sin generación programada para esta hora.</div>';
    return `<div class="now-row"><div><div class="big">${isNum(pr) ? ctx.fmt(pr) : 's/d'} <small>COP/kWh</small></div><div class="cmp">previsto por XM</div></div><div class="now-gen"><div class="big">${isNum(total) ? ctx.fmt(total) : 's/d'} <small>MW</small></div><div class="cmp">generación programada</div></div></div>${bar}`;
  };
  const ahoraTitle = () => `${isToday() && hour === bogotaHour() ? 'Ahora' : dayName()} · ${hh(hour)}`;
  const cardAhora = () => {
    if (!d) return '';
    return `<section class="dc" id="ahora" aria-live="off"><h2 id="ahora-h">${ahoraTitle()}</h2><div id="ahora-b">${ahoraBody()}</div>${footer()}</section>`;
  };
  const cardFuera = () => {
    const n = d?.no_disponible, f = d?.fuera_de_servicio;
    if (!d || !n?.plantas?.length) return '';
    const fuera = new Set((f?.plantas || []).map(p => p.codigo));
    const pct = isNum(n.capacidad_total_mw) && n.capacidad_total_mw > 0 ? n.total_mw / n.capacidad_total_mw * 100 : NaN;
    const top = n.plantas.slice(0, 7).map(p => `<div class="pl"><span><i style="background:${techColor(p.tecnologia)}"></i>${ctx.esc(short(p.nombre))}${fuera.has(p.codigo) ? ' <b class="off">fuera de servicio</b>' : ''}</span><span>${ctx.fmt(p.disp_mw)} de ${ctx.fmt(p.cap_mw)} MW</span></div>`).join('');
    const more = n.plantas.length > 7 ? `<div class="src" style="margin:4px 0 0">y ${n.plantas.length - 7} centrales más con capacidad reducida</div>` : '';
    const tec = Object.entries(n.por_tecnologia || {}).sort((x, y) => y[1] - x[1]).map(([t, v]) => `${ctx.esc(t)} ${ctx.fmt(v)} MW`).join(' · ');
    return ctx.card('fuera', 'Capacidad no disponible hoy', `<div class="big">${ctx.fmt(n.total_mw)} <small>MW</small></div>${isFinite(pct) ? `<div class="cmp">El ${ctx.fmt(pct, 1)} % de ${ctx.fmt(n.capacidad_total_mw ?? 0)} MW de centrales hidráulicas y térmicas · ${tec}</div>` : ''}<div style="margin-top:6px">${top}</div>${more}<div class="note">Capacidad efectiva menos la disponibilidad real que las centrales reportan a XM hoy. Puede ser mantenimiento, una falla, falta de combustible o de agua. No incluye solar ni eólica.</div>${footer()}`);
  };
  const updateCards = () => {
    const h = document.getElementById('ahora-h'), b = document.getElementById('ahora-b');
    if (h) h.textContent = ahoraTitle(); if (b) b.innerHTML = ahoraBody();
  };

  // ---- línea de tiempo ----
  const sparkPath = () => {
    const v = d!.precio || [], nums = v.filter(isNum); if (nums.length < 2) return '';
    const mn = Math.min(...nums), mx = Math.max(...nums), r = mx - mn || 1;
    const pt = (i: number) => `${(i / 23 * 240).toFixed(1)},${(26 - ((v[i] as number) - mn) / r * 24).toFixed(1)}`;
    let path = '', pen = false;
    v.forEach((x, i) => { if (!isNum(x)) { pen = false; return; } path += (pen ? 'L' : 'M') + pt(i); pen = true; });
    return path;
  };
  const sparkY = () => {
    const v = d!.precio || [], nums = v.filter(isNum), x = v[hour];
    if (!isNum(x) || nums.length < 2) return -1;
    const mn = Math.min(...nums), mx = Math.max(...nums);
    return (26 - (x - mn) / ((mx - mn) || 1) * 24) / 28;
  };
  const sync = () => {
    if (!el) return;
    const slider = el.querySelector<HTMLInputElement>('#tl-hour')!;
    slider.value = String(hour); slider.setAttribute('aria-valuetext', label());
    el.querySelector('#tl-label')!.textContent = label();
    const dot = el.querySelector<HTMLElement>('.tl-dot')!, y = sparkY();
    dot.style.left = `${hour / 23 * 100}%`; dot.style.top = `${y * 100}%`; dot.style.display = y < 0 ? 'none' : '';
    const play = el.querySelector<HTMLButtonElement>('#tl-play')!;
    play.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir las 24 horas');
    play.innerHTML = playing
      ? '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M6 4h3v12H6zM11 4h3v12h-3z" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M6 3.5v13l11-6.5z" fill="currentColor"/></svg>';
    const tg = el.querySelector<HTMLButtonElement>('#tl-mode')!;
    tg.setAttribute('aria-pressed', String(active));
    tg.textContent = active ? 'Ver capacidad instalada' : 'Ver generación de la hora';
    el.classList.toggle('off', !active);
  };
  const setHour = (h: number, fromUser = false) => {
    hour = ((h % 24) + 24) % 24;
    if (fromUser) stop();
    sync(); updateCards(); if (active) applyMap();
  };
  const stop = () => { if (timer) { clearInterval(timer); timer = 0; } playing = false; };
  const play = () => { stop(); playing = true; timer = window.setInterval(() => { if (document.hidden) return; setHour(hour + 1); }, 700); sync(); };
  const setActive = (on: boolean) => { active = on; sync(); applyMap(); };

  const mount = () => {
    el = document.createElement('div'); el.id = 'timeline'; el.className = 'card';
    el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Colombia hoy, hora a hora');
    el.innerHTML = `<button id="tl-play" class="tl-play" type="button"></button>
      <div class="tl-mid"><div class="tl-spark"><svg viewBox="0 0 240 28" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="${sparkPath()}" fill="none" stroke="#c2410c" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg><span class="tl-dot"></span></div>
      <input id="tl-hour" type="range" min="0" max="23" step="1" value="${hour}" aria-label="Hora del día para ver la generación programada"></div>
      <div class="tl-right"><output id="tl-label" for="tl-hour"></output><button id="tl-mode" class="tl-mode" type="button" aria-pressed="true"></button></div>
      <div class="tl-key" aria-hidden="true">Tamaño: MW de la hora · hueco: sin generación · gris punteado: fuera de servicio</div>`;
    document.body.append(el);
    el.querySelector<HTMLInputElement>('#tl-hour')!.addEventListener('input', e => setHour(Number((e.target as HTMLInputElement).value), true));
    el.querySelector('#tl-play')!.addEventListener('click', () => (playing ? (stop(), sync()) : play()));
    el.querySelector('#tl-mode')!.addEventListener('click', () => setActive(!active));
    sync();
  };

  return {
    init(raw: any) {
      if (!validHoy(raw)) return false;
      d = raw; hour = bogotaHour(); active = true; // nunca se reproduce solo (tampoco con prefers-reduced-motion)
      prepare(); mount(); return true;
    },
    cardAhora, cardFuera,
    // llamar al final de addDataLayers (y en cada style.load)
    onStyle() {
      const map = ctx.map(); if (!map || !d || !map.getLayer('centrales')) return;
      if (!map.hasImage('fs-ring')) map.addImage('fs-ring', ring(), { pixelRatio: 2 });
      if (!map.getLayer('centrales-fs')) {
        const r = (a: number, b: number) => ['/', ['+', a, ['*', b, ['sqrt', MW]]], 16];
        map.addLayer({ id: 'centrales-fs', type: 'symbol', source: 'centrales', filter: FS, layout: { 'icon-image': 'fs-ring', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 4, r(3, .17), 9, r(5, .4)] as any, visibility: ctx.centralsOn() ? 'visible' : 'none' } } as any, map.getLayer('alertas') ? 'alertas' : undefined);
      }
      applyMap();
    },
    popupLine(p: any) {
      if (!d || !active || !isNum(Number(p.mwh)) || Number(p.mwh) < 0) return '';
      const x = Number(p.mwh), mw = Number(p.mw);
      const f = (n: number) => ctx.fmt(n, n < 10 ? 1 : 0);
      const fs = p.fs === true || p.fs === 'true';
      return `<div class="m"><b>Programado a las ${hh(hour)}: ${f(x)} MW</b>${mw ? ` de ${f(mw)} MW` : ''}</div>${fs ? '<div class="m">Sin disponibilidad reportada a XM hoy.</div>' : ''}`;
    },
  };
}
