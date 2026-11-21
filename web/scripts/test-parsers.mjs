import assert from 'node:assert/strict';
import { parseHourly, parseDaily, pctSeries } from './fetch-xm.mjs';
import { parseListado, groupPlants, matchPlants, coreName } from './fetch-centrales-xm.mjs';
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
console.log('test-parsers: OK');
