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
| UPME líneas STN | `https://services.arcgis.com/deQSb0Gn7gDPf3uV/ArcGIS/rest/services/Lineamientos/FeatureServer/0` (STN, polilínea, maxRecord 2000, soporta f=geojson/paginación, SR nativo 103599) | `NOMB_CIRCUITO`, `NOMBRE_PROPIETARIO`, `NOMBRE_SUBES_INICIO/FIN`; tensión: se extrae del texto "230 kV" (ID_TENSION/NIVEL_TENSION son códigos inconsistentes) | datos abiertos UPME; sin licencia explícita localizada, citar UPME | cuando UPME actualiza (irregular) | sí (campos y 5 registros de muestra); descarga completa no probada |
| UPME subestaciones STN | misma FeatureServer, capa `22` "Subestaciones STN" (puntos) | `NOMBRE_SUBESTACION` (incluye kV), `NOMBRE_PROPIETARIO` | idem | idem | sí (esquema y 3 registros); el campo TERRITORIO sugiere cobertura quizá parcial (Sabana de Bogotá): el script avisa |
| UPME STR (<220 kV) | no se encontró servicio público | - | - | - | no existe en lo hallado |
| UPME plantas (capa 23) | misma FeatureServer, capa 23 | solo Sabana de Bogotá, coordenadas dudosas: **no se usa** | - | - | sí (descartada) |
| Municipios (DIVIPOLA) | `https://geoportal.superservicios.gov.co/server/rest/services/MUNICIPIOS_FASE2/MapServer/0` (derivado del MGN-DANE; sin paginación; maxRecord 2000; f=geojson) | `ID_ESPACIA` (5 díg.), `NOM_MUNICI`, `NOM_DEPART`, `COD_DEPTO` | datos oficiales Superservicios sobre MGN-DANE | anual (MGN) | esquema sí; consulta con filtro devolvió 0 filas en 2 pruebas: el script exige >=1000 municipios válidos o falla sin escribir |
| Departamentos | mismo servicio, capa `1` | `ID_ESPACIA` (2 díg.), `NOMBRE_DPT` (34 registros confirmados) | idem | anual | sí |
| DANE MGN oficial | `https://geoportal.dane.gov.co/mparcgis/rest/services/MGN2025` (carpeta existe; servicios no listables por robots) | `MPIO_CDPMP`, `MPIO_CNMBR`, `DPTO_CCDGO` (esperados) | DANE, datos abiertos | anual | carpeta sí; capa exacta no. Define `DANE_MUN_URL=<.../MapServer/N>` y `DANE_DPTO_URL` para usarla primero |
| Calidad (continuidad) | `https://www.datos.gov.co/resource/as4w-pgry.json` (Socrata, Superservicios "Información de Calidad - itad", Formato 9) | `id_empresa, empresa, anio, periodo, nivel_1, nivel_2_3` | datos abiertos Colombia | trimestral | sí (3 filas). Es ITAD por operador, **no SAIDI/SAIFI por municipio** |
| Calidad, otros ids | `kh9a-6h5u` (variación ITAD), `gjrs-8pqf` (formato 7), `f2yr-8sxq` (Informe Anual Operadores de Red: SAIDI/SAIFI, sin columnas legibles ni acceso JSON probado) | - | - | - | sí existen; f2yr-8sxq no consultable |
| IDEAM alertas | datos.gov.co: Alertas Hidrológicas `h4gs-wsmg`, Deslizamientos `m3en-ptx7` (municipal), Incendios `vnzc-4d6e`, Meteomarinas `3e2y-7ych`; resource JSON no accesible en la prueba | columnas no confirmadas | datos abiertos IDEAM | diaria | ids sí (catálogo Socrata); datos no. Sin script (no hay estructura confirmada); no hay servicio ArcGIS de alertas confirmado |

## Cobertura en el mapa

El mapa ofrece una capa opcional de líneas STN de UPME a partir de `web/public/data/lineas_upme.geojson`. La leyenda muestra la fecha de descarga cuando está disponible. La ficha muestra el nombre, la tensión y, si la fuente los trae, las subestaciones de inicio y fin y el propietario. Los trazos punteados de la capa OpenStreetMap son uniones estimadas entre tramos.

El geoportal de la UPME también documenta una [capa de líneas construidas STN y STR](https://geo.upme.gov.co/server/rest/services/Capas_EnergiaElectrica/Sistema_transmision_lineas_construidas/FeatureServer/layers) y una [capa de líneas de convocatorias](https://geo.upme.gov.co/server/rest/services/Capas_EnergiaElectrica/convocatorias_lineas_transmision/MapServer/1). Quedan por verificar la descarga, la cobertura y la vigencia de sus registros antes de incorporarlas.

Notas: Superservicios también publica `Mapa_Interrupciones` (requiere token) y la carpeta `IDEAM` (solo anomalías climáticas mensuales).
