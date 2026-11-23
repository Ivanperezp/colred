import assert from 'node:assert/strict';
import { parseHourly, parseDaily, pctSeries } from './fetch-xm.mjs';
import { parseListado, groupPlants, matchPlants, coreName, fixCoord, parseEpm, parseFncer, buildCentroidIndex, placeFromSources } from './fetch-centrales-xm.mjs';
import { mapLine, mapSub } from './fetch-upme.mjs';
import { mapMunicipio, mapDepto } from './fetch-dane.mjs';
import { buildItems } from './fetch-calidad.mjs';
import { parseKv, geomCentroid } from './lib.mjs';

const h = parseHourly({ Items: [{ Date: '2026-11-19', HourlyEntities: [{ Values: { code: 'Sistema', Hour01: '6000000', Hour02: '5900000', Hour03: '' } }] }] }, 1000);
assert.equal(h.length, 2); assert.equal(h[0].value, 6000); assert.equal(h[0].ts, '2026-11-19T05:00:00.000Z');
const d = parseDaily({ Items: [{ Date: '2026-11-19', DailyEntities: [{ Id: 'GVIO', Values: { code: 'GVIO', Value: '1213000' } }, { Id: 'X', Values: { Value: 'abc' } }] }] });
assert.deepEqual(d, [{ date: '2026-11-19', id: 'GVIO', value: 1213000 }]);
assert.deepEqual(pctSeries([{ date: 'a', value: 50 }], [{ date: 'a', value: 200 }]), [{ date: 'a', pct: 25 }]);

const lst = parseListado({ Items: [{ Date: 'x', ListEntities: [{ Id: 'GVIO', Values: { Code: 'GVIO', Name: 'GUAVIO', Type: 'HIDRAULICA' } }, { Id: 'TF1', Values: { Code: 'TF1', Name: 'TERMOFLORES 1', Type: 'TERMICA' } }, { Id: 'TF2', Values: { Code: 'TF2', Name: 'TERMOFLORES 2', Type: 'TERMICA' } }, { Id: 'ZZ', Values: { Code: 'ZZ', Name: 'PLANTA GRANDE ZETA', Type: 'TERMICA' } }] }] });
const plants = groupPlants(lst, new Map([['GVIO', 1250], ['TF1', 160], ['TF2', 150], ['ZZ', 300]]));
assert.equal(plants.length, 3); assert.equal(plants.find(p => p.key === 'flores').mw, 310);
assert.equal(coreName('Central Hidroeléctrica Guavio'), 'guavio');
const feats = [{ properties: { nombre: 'Central Hidroeléctrica Guavio', tecnologia: 'Hidráulica' } }, { properties: { nombre: 'Termoflores', tecnologia: 'Térmica' } }];
const r = matchPlants(feats, plants);
assert.equal(r.matches.length, 2); assert.equal(r.unmatchedPlants[0].nombre, 'PLANTA GRANDE ZETA');

assert.equal(parseKv('LT Noroeste - Purnio a 230 kV Circuito 1'), 230);
const ln = mapLine({ properties: { NOMB_CIRCUITO: 'LT Chivor - Torca a 230 kV Circuito 1', NOMBRE_PROPIETARIO: 'ISA' }, geometry: { type: 'LineString', coordinates: [[-74.123456, 4.1], [-73, 5]] } });
assert.equal(ln.properties.tension_kv, 230); assert.equal(ln.geometry.coordinates[0][0], -74.1235);
assert.equal(mapSub({ properties: { NOMBRE_SUBESTACION: 'Nueva Esperanza  500 kV' }, geometry: { type: 'Point', coordinates: [-74, 4] } }).properties.nombre, 'Nueva Esperanza');

const sq = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] };
assert.deepEqual(geomCentroid(sq), [1, 1]);
const m = mapMunicipio({ properties: { ID_ESPACIA: '5001', NOM_MUNICI: 'MEDELLÍN', NOM_DEPART: 'ANTIOQUIA' }, geometry: sq });
assert.deepEqual(m.properties, { divipola: '05001', nombre: 'Medellín', departamento: 'Antioquia' });
assert.equal(mapDepto({ properties: { ID_ESPACIA: '11', NOMBRE_DPT: 'BOGOTÁ' }, geometry: sq }).properties.cod_dpto, '11');

const q = buildItems([{ id_empresa: '1', empresa: 'A SA', anio: '2020', periodo: '4', nivel_1: '0.1', nivel_2_3: '0.2' }, { id_empresa: '1', empresa: 'A SA', anio: '2021', periodo: '1', nivel_1: '0.3', nivel_2_3: '0.4' }]);
assert.equal(q.length, 1); assert.equal(q[0].anio, 2021); assert.equal(q[0].itad_nivel_1, 0.3);

assert.equal(fixCoord('-7475839042', true), -74.75839042); assert.equal(fixCoord('6413309229', false), 6.413309229); assert.equal(fixCoord('-75.2271', true), -75.2271);
const epm = parseEpm([{ nombre: 'Caracolí', ubicaci_n: 'Caracolí', tipo: 'Planta de Energía', longitud: '-7475839042', latitud: '6413309229' }, { nombre: 'Prueba temporal', tipo: 'Planta de Energía', longitud: '-75000001', latitud: '6000001' }, { nombre: 'X', tipo: 'Planta de Aguas', longitud: '-75.1', latitud: '6.1' }]);
assert.equal(epm.length, 1); assert.equal(epm[0].lat, 6.413309229);
const fn = parseFncer([{ proyecto: 'BAYUNCA 1', tipo: 'Solar', capacidad: '3.0', departamento: 'BOLÍVAR', municipio: 'CARTAGENA', codigo_municipio: '13001' }]);
const cidx = buildCentroidIndex([{ properties: { divipola: '13001', nombre: 'Cartagena de Indias', departamento: 'Bolívar', cod_dpto: '13' }, geometry: { type: 'Point', coordinates: [-75.5, 10.4] } }]);
const pl = [{ nombre: 'PCH CARACOLI', nombres: ['PCH CARACOLI'], codigos: ['CRCL'], mw: 3.75, tipo: 'HIDRAULICA' }, { nombre: 'BAYUNCA 1', nombres: ['BAYUNCA 1'], codigos: ['BYN1'], mw: 3, tipo: 'SOLAR' }, { nombre: 'MINI 2', nombres: ['MINI 2'], codigos: ['M2'], mw: 0.5, tipo: 'SOLAR' }];
const pr = placeFromSources(pl, [...epm, ...fn], cidx);
assert.equal(pr.length, 2); assert.equal(pr[0].precision, 'oficial'); assert.deepEqual(pr[1].coords, [-75.5, 10.4]); assert.equal(pr[1].precision, 'aproximada');

import { parseCatalogo, pickMetric, parseRecursos } from './xm-catalogo.mjs';
import { clasificar, agregarGeneracion, construirMix } from './fetch-mix.mjs';
import { evaluar, ratioAportes } from './fetch-riesgo.mjs';
const cat = parseCatalogo({ Items: [{ ListEntities: [{ Values: { MetricId: 'Gene', MetricName: 'Generación real', Entity: 'Recurso', Type: 'HourlyEntities' } }, { Values: { MetricId: 'PrecEscasez', MetricName: 'Precio de Escasez', Entity: 'Sistema', Type: 'DailyEntities' } }] }] });
assert.equal(pickMetric(cat, { idRe: /^Gene$/, entity: 'Recurso' }).id, 'Gene');
assert.equal(pickMetric(cat, { idRe: /^PrecEsca/, entity: 'Sistema' }).id, 'PrecEscasez');
assert.equal(pickMetric(cat, { nameRe: /^nada/, entity: 'Sistema' }), null);
const rec = parseRecursos({ Items: [{ ListEntities: [{ Values: { Code: 'GVIO', Type: 'HIDRAULICA', EnerSource: 'AGUA' } }, { Values: { Code: 'TF1', Type: 'TERMICA', EnerSource: 'GAS' } }, { Values: { Code: 'S1', Type: 'SOLAR', EnerSource: 'RAD_SOLAR' } }] }] });
assert.equal(clasificar(rec.get('TF1')).fine, 'Térmica gas'); assert.equal(clasificar({ type: 'TERMICA', source: 'CARBÓN' }).fine, 'Térmica carbón');
const gj = { Items: [{ Date: '2026-11-19', HourlyEntities: [{ Id: 'GVIO', Values: { code: 'GVIO', Hour01: '3000000', Hour02: '1000000' } }, { Id: 'TF1', Values: { code: 'TF1', Hour01: '1000000' } }] }] };
const ag = agregarGeneracion(gj, rec)['2026-11-19']; const mx = construirMix(ag, '2026-11-19', 'x');
assert.equal(mx.total_mwh, 5000); assert.equal(mx.por_tecnologia[0].pct, 80); assert.equal(mx.horario[0].Térmica, 1000); assert.equal(mx.horario.length, 24);
assert.equal(evaluar({ embalse: 35 }), 'alto'); assert.equal(evaluar({ embalse: 70, precio: 900, escasez: 800 }), 'alto');
assert.equal(evaluar({ embalse: 50 }), 'medio'); assert.equal(evaluar({ embalse: 70, aportes: 70 }), 'medio'); assert.equal(evaluar({ embalse: 70, tendencia: -6 }), 'medio');
assert.equal(evaluar({ embalse: 70, aportes: 100, tendencia: 1, precio: 300, escasez: 800 }), 'bajo'); assert.equal(evaluar({}), 'bajo');
assert.equal(ratioAportes([{ date: 'a', value: 80 }, { date: 'b', value: 120 }], [{ date: 'a', value: 100 }, { date: 'b', value: 100 }]), 100);

import { elegirMetricas, agregar, construir, paisDe } from './fetch-intercambios.mjs';
{
  const cat = [{ id: 'CompBolsaTIEEner', name: 'Compras en Bolsa TIE', entity: 'Sistema', type: 'DailyEntities' }, { id: 'VentBolsaTIEEner', name: 'Ventas en Bolsa TIE', entity: 'Sistema', type: 'DailyEntities' }, { id: 'VentBolsaIntEner', name: 'Ventas en Bolsa Int', entity: 'Sistema', type: 'DailyEntities' }];
  const sel = elegirMetricas(cat);
  assert.equal(sel.length, 3); assert.equal(sel[0].pais, 'Ecuador'); assert.equal(sel[2].pais, 'Venezuela');
  assert.equal(paisDe('Enlace Jamondino-Pomasqui'), 'Ecuador');
  const exp = agregar(parseDaily({ Items: [{ Date: '2026-11-19', DailyEntities: [{ Values: { Value: '2000000' } }] }] }), 'Ecuador');
  const zero = new Map([['2026-11-19|Ecuador', 0]]);
  const out = construir(sel, sel.map((s, i) => ({ ...s, acc: i === 1 ? exp : i === 0 ? zero : new Map() })), '2026-11-19', 'x');
  assert.equal(out.paises[0].saldo_mwh, 2000); assert.equal(out.paises[1].saldo_mwh, null);
  const physical = elegirMetricas([...sel.map(s => s.m), { id: 'ExpoEner', entity: 'Sistema' }, { id: 'ExpoEner', entity: 'Enlace' }]);
  assert.deepEqual(physical.map(s => s.m.entity), ['Enlace']);
}
console.log('test-parsers: OK');
