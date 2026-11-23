# Fuentes de datos

Ejecutar en tu PC (Node 18+): `cd web && npm run datos:oficiales` (o cada `datos:xm|centrales|upme|dane|calidad`). `npm run datos:test` prueba los parsers.
"Verificado" = confirmado con consulta real a la URL durante la investigación; "no" = tomado de documentación/conocimiento, se valida en la primera ejecución.

| Fuente | Endpoint exacto | Campos usados | Licencia / términos | Frecuencia | Verificado |
|---|---|---|---|---|---|
| XM API (formato de petición) | POST `https://servapibi.xm.com.co/{hourly,daily,monthly,lists}` body `{MetricId,StartDate,EndDate,Entity,Filter}`; catálogo: `MetricId:"ListadoMetricas"` en `/lists` | respuesta `Items[].Date` + `HourlyEntities`/`DailyEntities`/`ListEntities` | API pública de XM; citar XM como fuente | horaria/diaria | sí (formato, README oficial y pydataxm) |
| Demanda real SIN | `/hourly` `MetricId:"DemaReal"` `Entity:"Sistema"` | `Values.Hour01..Hour24` (kWh, se divide por 1000 a MWh) | idem | hora | no (nombres de métrica no confirmados por consulta) |
| Precio de bolsa nacional | `/hourly` `PrecBolsNaci` `Sistema` | `Hour01..Hour24` (COP/kWh) | idem | hora | no |
| Embalses (% útil nacional) | `/daily` `VoluUtilDiarEner` y `CapaUtilDiarEner`, `Sistema`; % = volumen/capacidad | `Values.Value` (kWh) | idem | diaria | no |
| Listado de recursos | `/lists` `ListadoRecursos` (Entity `Sistema`, reintenta `Recurso`) | `Values.Code/Name/Type` (insensible a mayúsculas) | idem | variable | no |
| Capacidad efectiva neta | `/daily` `CapEfecNeta` `Recurso` | `Values.Value` (kW; el script detecta kW vs MW) | idem | diaria | no |
| UPME líneas construidas STN y STR | [Geoportal UPME, capa 17](https://geo.upme.gov.co/server/rest/services/Capas_EnergiaElectrica/Sistema_transmision_lineas_construidas/FeatureServer/17) | sistema, circuito, tensión, extremos, propietario y vigencia | geoservicio público UPME | cuando UPME actualiza (irregular) | sí, descarga de 798 trazados el 22 de noviembre de 2026 |
| UPME subestaciones construidas STN y STR | [Geoportal UPME, capa 18](https://geo.upme.gov.co/server/rest/services/Capas_EnergiaElectrica/sistema_transmision_subestaciones_construidas/FeatureServer/18) | nombre, coordenadas, sistema, tensión, municipio, departamento y propietario | geoservicio público UPME | cuando UPME actualiza (irregular) | sí, descarga de 514 registros |
| UPME plantas (capa 23) | Lineamientos, capa 23 | solo Sabana de Bogotá, coordenadas dudosas: **no se usa** | - | - | sí (descartada) |
| Municipios (DIVIPOLA) | `https://geoportal.superservicios.gov.co/server/rest/services/MUNICIPIOS_FASE2/MapServer/0` (derivado del MGN-DANE; sin paginación; maxRecord 2000; f=geojson) | `ID_ESPACIA` (5 díg.), `NOM_MUNICI`, `NOM_DEPART`, `COD_DEPTO` | datos oficiales Superservicios sobre MGN-DANE | anual (MGN) | esquema sí; consulta con filtro devolvió 0 filas en 2 pruebas: el script exige >=1000 municipios válidos o falla sin escribir |
| Departamentos | mismo servicio, capa `1` | `ID_ESPACIA` (2 díg.), `NOMBRE_DPT` (34 registros confirmados) | idem | anual | sí |
| DANE MGN oficial | `https://geoportal.dane.gov.co/mparcgis/rest/services/MGN2025` (carpeta existe; servicios no listables por robots) | `MPIO_CDPMP`, `MPIO_CNMBR`, `DPTO_CCDGO` (esperados) | DANE, datos abiertos | anual | carpeta sí; capa exacta no. Define `DANE_MUN_URL=<.../MapServer/N>` y `DANE_DPTO_URL` para usarla primero |
| Calidad (continuidad) | `https://www.datos.gov.co/resource/as4w-pgry.json` (Socrata, Superservicios "Información de Calidad - itad", Formato 9) | `id_empresa, empresa, anio, periodo, nivel_1, nivel_2_3` | datos abiertos Colombia | trimestral | sí (3 filas). Es ITAD por operador, **no SAIDI/SAIFI por municipio** |
| Calidad, otros ids | `kh9a-6h5u` (variación ITAD), `gjrs-8pqf` (formato 7), `f2yr-8sxq` (Informe Anual Operadores de Red: SAIDI/SAIFI, sin columnas legibles ni acceso JSON probado) | - | - | - | sí existen; f2yr-8sxq no consultable |
| IDEAM alertas | datos.gov.co: Alertas Hidrológicas `h4gs-wsmg`, Deslizamientos `m3en-ptx7` (municipal), Incendios `vnzc-4d6e`, Meteomarinas `3e2y-7ych`; resource JSON no accesible en la prueba | columnas no confirmadas | datos abiertos IDEAM | diaria | ids sí (catálogo Socrata); datos no. Sin script (no hay estructura confirmada); no hay servicio ArcGIS de alertas confirmado |

## Cobertura en el mapa

La capa opcional **Subestaciones UPME** muestra puntos del inventario oficial de subestaciones construidas STN y STR. Los registros pueden representar distintos niveles de tensión de un mismo predio. Las fichas OSM conservan sus nombres y solo se completan cuando hay una coincidencia única.

El mapa ofrece una capa opcional de líneas construidas STN y STR de UPME a partir de `web/public/data/lineas_upme.geojson`. La leyenda muestra la fecha de descarga. La ficha muestra el circuito, la tensión, las subestaciones de inicio y fin, el propietario y la vigencia cuando están disponibles. Los trazos punteados de la capa OpenStreetMap son uniones estimadas entre tramos.

El importador usa la [capa de líneas construidas STN y STR](https://geo.upme.gov.co/server/rest/services/Capas_EnergiaElectrica/Sistema_transmision_lineas_construidas/FeatureServer/17) del geoportal UPME. Los marcadores de subestaciones OSM pueden representar el centro de un predio y los circuitos pueden terminar en su borde. La [capa de líneas de convocatorias](https://geo.upme.gov.co/server/rest/services/Capas_EnergiaElectrica/convocatorias_lineas_transmision/MapServer/1) corresponde a proyectos y queda fuera de la capa de líneas construidas.

Notas: Superservicios también publica `Mapa_Interrupciones` (requiere token) y la carpeta `IDEAM` (solo anomalías climáticas mensuales).
