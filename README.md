# RedCO

Mapa abierto de la red eléctrica de Colombia: líneas de transmisión, subestaciones y centrales en un solo mapa, con la demanda, el precio de bolsa y el nivel de los embalses publicados por XM.

## Fuentes principales

- **XM**: demanda, precio de bolsa, embalses y capacidad efectiva neta de las centrales.
- **UPME**: líneas del Sistema de Transmisión Nacional.
- **DANE**: departamentos y municipios (Marco Geoestadístico Nacional).
- **OpenStreetMap**: trazado de líneas, subestaciones y ubicación de centrales (© colaboradores de OpenStreetMap, ODbL).

El detalle de cada fuente está en [FUENTES.md](FUENTES.md).

## Cómo correrlo

Requiere Node 20 o superior.

```
cd web
npm install
npm run vivo      # abre la web y actualiza los datos de XM cada 30 minutos
```

Otros comandos:

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Solo la web, sin actualizar datos |
| `npm run datos:xm` | Demanda, precio de bolsa y embalses (XM) |
| `npm run datos:semanal` | Red de OpenStreetMap, centrales con capacidad de XM, líneas UPME y calidad del servicio |
| `npm run build` | Compila la web en `web/dist` |

## Publicación

GitHub Actions actualiza los datos de XM cada 30 minutos y publica la web en GitHub Pages. Los lunes también actualiza la red y las centrales. Ver `.github/workflows/publicar.yml`.

## Licencia

Código bajo licencia MIT. Los datos derivados de OpenStreetMap se distribuyen bajo ODbL.
