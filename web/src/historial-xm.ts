export const hours = Array.from({ length: 24 }, (_, hour) => hour);
export const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
export const colombiaDate = (value: string) => {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms - 5 * 3600000).toISOString().slice(0, 10) : '';
};

type Day = { fecha_operacion: string };
type Price = { ts: string; value: number };
export type PriceDay = Day & { unit: string; updated_at?: string; series: Price[] };
export const generationKeys = ['Hidráulica', 'Térmica', 'Solar', 'Eólica', 'Otras'] as const;
type GenerationHour = { hora: number } & Partial<Record<(typeof generationKeys)[number], number>>;
export type MixDay = Day & {
  total_mwh: number;
  updated_at?: string;
  por_tecnologia: { tecnologia: string; pct: number; mwh: number }[];
  horario: GenerationHour[];
};

export function datedHistory<T extends Day>(input?: T & { historico?: T[] }) {
  const items = input?.historico?.length ? input.historico : input ? [input] : [];
  return new Map(items.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.fecha_operacion)).map(d => [d.fecha_operacion, d]));
}

export function pricesByHour(day?: PriceDay) {
  const values: (number | undefined)[] = hours.map(() => undefined);
  for (const point of day?.series || []) {
    if (!Number.isFinite(point.value) || colombiaDate(point.ts) !== day?.fecha_operacion) continue;
    const hour = new Date(Date.parse(point.ts) - 5 * 3600000).getUTCHours();
    values[hour] = point.value;
  }
  return values;
}

export function generationByHour(day?: MixDay) {
  const values: (GenerationHour | undefined)[] = hours.map(() => undefined);
  for (const row of day?.horario || []) {
    if (!Number.isInteger(row.hora) || row.hora < 1 || row.hora > 24) continue;
    if (generationKeys.some(key => Number.isFinite(row[key]))) values[row.hora - 1] = row;
  }
  return values;
}

const dateFormat = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium' });
const downloadFormat = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' });
const dateLabel = (date: string) => dateFormat.format(new Date(date + 'T12:00:00-05:00'));
const fmt = (value: number, digits = 2) => value.toLocaleString('es-CO', { maximumFractionDigits: digits });
const esc = (value: string) => value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const colors: Record<string, string> = {
  Hidráulica: '#2b7bd8', Térmica: '#e8742a', 'Térmica gas': '#e8742a',
  'Térmica carbón': '#4a4f57', 'Térmica líquidos': '#c9503a',
  Solar: '#d79f00', Eólica: '#128e82', Biomasa: '#658638', Otras: '#827096',
  'Biomasa y otras': '#658638',
};
const axis = '<div class="ax"><span>00:00</span><span>12:00</span><span>23:00</span></div>';
const chart = (content: string, label: string) => `<svg viewBox="0 0 192 60" preserveAspectRatio="none" role="img" aria-label="${label}">${content}</svg>${axis}`;
const card = (name: string, contents: string) => `<section class="history-metric"><h3>${name}</h3>${contents}</section>`;
const noData = '<p class="src">Sin datos de XM para esta fecha.</p>';
const source = (date: string | undefined, count: number) => {
  const updated = new Date(date || '');
  const stamp = Number.isFinite(+updated) ? ` · descargado el ${downloadFormat.format(updated)}` : '';
  return `<div class="src">XM · ${count} de 24 horas con dato${stamp}</div>`;
};

function priceCard(day: PriceDay | undefined, hourly: (number | undefined)[]) {
  const title = 'Precio de bolsa por hora';
  const values = hourly.filter((v): v is number => v !== undefined);
  if (!day || !values.length) return card(title, noData);
  const lastHour = hourly.reduce<number>((last, v, h) => v === undefined ? last : h, 0);
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const y = (value: number) => 56 - 52 * (value - min) / (max - min || 1);
  const zero = y(0);
  const bars = hourly.map((v, h) => {
    if (v === undefined) return '';
    const yv = y(v);
    return `<rect x="${h * 8 + 1}" y="${Math.min(yv, zero).toFixed(2)}" width="7" height="${Math.max(1, Math.abs(yv - zero)).toFixed(2)}" rx="1" fill="${h === lastHour ? '#c97800' : '#577ee0'}"><title>${hourLabel(h)} · ${fmt(v)} COP/kWh</title></rect>`;
  }).join('');
  const pricePlot = chart(`<path d="M0 ${zero}H192" stroke="#8896a6"/>${bars}`, 'Precio de bolsa en COP por kWh por hora');
  return card(title, `<div class="big">${fmt(values[values.length - 1])} <small>${esc(day.unit)}</small></div>
    <div class="note">Precio mayorista a las ${hourLabel(lastHour)}.</div>${pricePlot}${source(day.updated_at, values.length)}`);
}

function mixCard(day: MixDay | undefined, hourly: (GenerationHour | undefined)[]) {
  const title = 'Generación real por tecnología';
  if (!day?.por_tecnologia?.length) return card(title, noData);
  const count = hourly.filter(Boolean).length;
  const mixBar = `<div class="mixbar" role="img" aria-label="Participación por tecnología">${day.por_tecnologia.map(t =>
    `<i style="width:${t.pct}%;background:${colors[t.tecnologia] || colors.Otras}" title="${esc(t.tecnologia)} · ${fmt(t.pct, 1)} %"></i>`).join('')}</div>`;
  const mixLegend = `<div class="mixlg">${day.por_tecnologia.map(t =>
    `<span><i style="background:${colors[t.tecnologia] || colors.Otras}"></i>${esc(t.tecnologia)} <b>${fmt(t.pct, 1)} %</b> · ${fmt(t.mwh / 1000)} GWh</span>`).join('')}</div>`;
  const max = Math.max(1, ...hourly.map(o => generationKeys.reduce((sum, key) => sum + Math.max(0, o?.[key] ?? 0), 0)));
  const bars = hourly.map((o, hour) => {
    let bottom = 58;
    return generationKeys.map(key => {
      const value = o?.[key] ?? 0;
      if (value <= 0) return '';
      const height = value / max * 54;
      bottom -= height;
      return `<rect x="${hour * 8 + 1}" y="${bottom.toFixed(2)}" width="7" height="${height.toFixed(2)}" fill="${colors[key]}"><title>${hourLabel(hour)} · ${key} · ${fmt(value, 1)} MWh</title></rect>`;
    }).join('');
  }).join('');
  return card(title, `<div class="big">${fmt(day.total_mwh / 1000, 1)} <small>GWh ${count === 24 ? 'en el día' : 'reportados'}</small></div>
    ${mixBar}${mixLegend}${count ? chart(bars, 'Generación real en MWh por hora') : ''}${source(day.updated_at, count)}`);
}

export function mountHistory(container: HTMLElement, pre?: PriceDay & { historico?: PriceDay[] }, mix?: MixDay & { historico?: MixDay[] }) {
  const prices = datedHistory(pre), generation = datedHistory(mix);
  const dates = [...new Set([...prices.keys(), ...generation.keys()])].sort().reverse();
  if (!dates.length) {
    container.innerHTML = '<h2>Historial de precio y generación</h2><p class="src">No hay registros de XM disponibles.</p>';
    return;
  }
  const latest = (history: Map<string, unknown>) => {
    const date = dates.find(d => history.has(d));
    return date ? dateLabel(date) : 'sin dato';
  };
  container.innerHTML = `<h2>Historial de precio y generación</h2>
    <label for="history-date">Fecha de operación</label>
    <select id="history-date">${dates.map(d => `<option value="${d}">${dateLabel(d)}</option>`).join('')}</select>
    <p class="src">Últimos datos de XM · Precio: ${latest(prices)} · Generación: ${latest(generation)}</p>
    <p id="history-status" class="history-status" role="status"></p>
    <div id="history-series"></div>
    <details><summary>Ver datos de las 24 horas</summary><div class="history-table" tabindex="0" role="region" aria-label="Tabla horaria de precio y generación">
      <table><caption>Hora de Colombia · Precio en COP/kWh · Generación en MWh</caption>
      <thead><tr><th scope="col">Hora</th><th scope="col">Precio</th>${generationKeys.map(key => `<th scope="col">${key}</th>`).join('')}</tr></thead>
      <tbody id="history-hours"></tbody></table></div></details>`;
  const selected = container.querySelector<HTMLSelectElement>('#history-date')!;
  const series = container.querySelector<HTMLElement>('#history-series')!;
  const status = container.querySelector<HTMLElement>('#history-status')!;
  const tbody = container.querySelector<HTMLElement>('#history-hours')!;
  const render = () => {
    const date = selected.value;
    const price = prices.get(date), mixDay = generation.get(date);
    const p = pricesByHour(price), g = generationByHour(mixDay);
    series.innerHTML = priceCard(price, p) + mixCard(mixDay, g);
    status.textContent = `${dateLabel(date)} · ${p.filter(v => v !== undefined).length} horas de precio · ${g.filter(Boolean).length} horas de generación`;
    const cell = (value?: number) => Number.isFinite(value) ? `<td>${fmt(value!)}</td>` : '<td aria-label="Sin dato">—</td>';
    tbody.innerHTML = hours.map(h => `<tr><th scope="row">${hourLabel(h)}</th>${cell(p[h])}${generationKeys.map(key => cell(g[h]?.[key])).join('')}</tr>`).join('');
  };
  selected.onchange = render;
  render();
}
