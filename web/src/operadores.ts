// Operador (id_empresa de Superservicios) -> nombre corto y códigos DANE de departamento donde es el operador de red principal.
// Solo se incluyen vínculos seguros; los operadores municipales o parciales se omiten.
export const OPERADORES: Record<string, { nombre: string; dptos: string[] }> = {
  '48307': { nombre: 'Air-e', dptos: ['08', '47', '44'] },
  '48305': { nombre: 'Afinia', dptos: ['13', '23', '70', '20'] },
  '536': { nombre: 'Celsia Valle', dptos: ['76'] },
  '44278': { nombre: 'Celsia Tolima', dptos: ['73'] },
  '502': { nombre: 'CHEC', dptos: ['17', '66'] },
  '2073': { nombre: 'Energía de Pereira', dptos: ['66'] },
  '2438': { nombre: 'Emcali', dptos: ['76'] },
  '637': { nombre: 'CETSA (Tuluá)', dptos: ['76'] },
  '2371': { nombre: 'Energía del Bajo Putumayo', dptos: ['86'] },
  '520': { nombre: 'CEDENAR', dptos: ['52'] },
  '604': { nombre: 'CENS', dptos: ['54'] },
  '2103': { nombre: 'Enel Colombia (Codensa)', dptos: ['11', '25'] },
};
// Respaldo por nombre cuando el id no coincide
export const POR_NOMBRE: [RegExp, string, string[]][] = [
  [/OCCIDENTE/i, 'Compañía Energética de Occidente', ['19']],
  [/ELECTRIFICADORA DE SANTANDER/i, 'ESSA', ['68']],
  [/ELECTRIFICADORA DEL CAQUETA/i, 'Electrificadora del Caquetá', ['18']],
  [/ELECTRIFICADORA DEL HUILA/i, 'Electrificadora del Huila', ['41']],
  [/ELECTRIFICADORA DEL META/i, 'Electrificadora del Meta', ['50']],
  [/ENERGIA DE ARAUCA/i, 'Enelar', ['81']],
  [/ENERGIA DE BOYACA/i, 'EBSA', ['15']],
  [/ENERGIA DE CUNDINAMARCA/i, 'Energía de Cundinamarca', ['25']],
  [/ENERGIA DEL QUINDIO/i, 'Energía del Quindío', ['63']],
  [/DISTRIBUIDORA DEL PACIFICO/i, 'Dispac', ['27']],
  [/EMPRESAS PÚBLICAS DE MEDELLIN/i, 'EPM', ['05']],
];
export type Op = { nombre: string; operador: string; anio: number; trimestre: number; n1: number | null; n23: number | null };
export const operadoresDe = (items: any[], code: string): Op[] => {
  const out: Op[] = [];
  for (const it of items) {
    let nombre = '', dptos: string[] = [];
    const m = OPERADORES[String(it.id_empresa)];
    if (m && m.nombre) { nombre = m.nombre; dptos = m.dptos; }
    else { const h = POR_NOMBRE.find(x => x[0].test(it.operador)); if (h) { nombre = h[1]; dptos = h[2]; } }
    if (dptos.includes(code)) out.push({ nombre, operador: it.operador, anio: it.anio, trimestre: it.trimestre, n1: it.itad_nivel_1, n23: it.itad_nivel_2_3 });
  }
  return out;
};

// Departamentos abastecidos en su mayoría por las Zonas No Interconectadas (no están conectados a la red nacional)
export const ZNI = new Set(['88', '91', '94', '97', '99']);
