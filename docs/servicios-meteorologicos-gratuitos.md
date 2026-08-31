# Servicios meteorológicos gratuitos para alertamiento — evaluación e integración

Evaluación (2026-07-19) de fuentes gratuitas para el alertamiento operativo de
organismos operadores de agua en México, alineada a la práctica SWAN Forum de
pasar de operación *reactiva* → *proactiva* → *predictiva*. Estado de cada
fuente en Hydra al cierre de la Ola 6.

## Integradas en Hydra

| Fuente | Qué aporta | Costo / API key | Estado |
|---|---|---|---|
| **Open-Meteo** (`api.open-meteo.com`) | Pronóstico diario 16 días (Tmáx/Tmín, precipitación, rachas) — alimenta el motor de riesgos propio (lluvia/calor/helada/viento/estiaje) | Gratis, sin key (uso no comercial/institucional) | ✅ Ola 4 (provider default) |
| **SMN/CONAGUA web service** (`smn.conagua.gob.mx`, method=1) | Pronóstico oficial mexicano por municipio, 4 días; actualización horaria | Gratis, sin key | ✅ Ola 4 (`CLIMA_PROVIDER=smn`, fallback a Open-Meteo) |
| **Monitor de Sequía de México** (SMN/CONAGUA, quincenal) | Categorías D0-D4 por municipio; escala el riesgo de estiaje estructural | Gratis (CSV/shapefile) | ✅ Ola 5 (ingesta idempotente + escalamiento) |
| **NHC/NOAA ciclones** (`nhc.noaa.gov/CurrentStorms.json`) | Sistemas tropicales activos en Atlántico y Pacífico Oriental: posición, categoría, intensidad, movimiento — las dos cuencas que afectan a México | Gratis, sin key, JSON por aviso oficial | ✅ **Ola 6** (`evaluarCiclones`: radios 800/500/300 km a la sede, escala por categoría HU/MH) |
| **Open-Meteo Flood API / GloFAS Copernicus** (`flood-api.open-meteo.com`) | Caudal diario del río principal en ~5 km del punto; 90 días de historia + pronóstico | Gratis, sin key | ✅ **Ola 6** (`evaluarCrecidaRio`: pico pronosticado vs p90 histórico del propio río; punto configurable `CLIMA_FLOOD_LAT/LNG` — usar la captación superficial principal) |
| **Avisos CAP 1.2** (estándar OASIS/WMO — SMN, CENAPRED, agregadores WMO) | Alertamientos oficiales de protección civil con severidad, vigencia, zonas e instrucción | Gratis (feeds públicos) | ✅ **Ola 6** (parser CAP propio sin dependencias; feeds configurables `CLIMA_CAP_URLS`) |

## Evaluadas y descartadas (por ahora)

| Fuente | Motivo |
|---|---|
| **OpenWeatherMap One Call** | Requiere API key y tarjeta; el tier gratuito (1,000 llamadas/día) no aporta nada que Open-Meteo + NHC no den ya |
| **MeteoAlarm** | Solo cubre Europa; el equivalente correcto para México es CAP del SMN/CENAPRED (ya soportado vía `CLIMA_CAP_URLS`) |
| **Tomorrow.io / WeatherAPI / Meteosource** | Tiers gratuitos con key, límites bajos y términos comerciales; sin ventaja sobre las fuentes oficiales gratuitas |
| **CLICOM (climatología histórica)** | Útil para *calibrar umbrales locales* del motor de riesgos, no para alertamiento en línea — candidato a fase de calibración |
| **SINA/CONAGUA (presas, acuíferos)** | Valioso para balance de fuentes (nivel de presas en estiaje), pero es hidrológico-administrativo, no alertamiento meteorológico; candidato a ola futura |

## Cómo fluye una alerta en Hydra (Ola 6)

```
NHC ciclones ──┐
GloFAS caudal ─┼→ AlertasClimaService (cache 30 min, tolerante a fallas por fuente)
Feeds CAP ─────┘        │
                        ├→ GET /clima/alertas            (panel en Mapa operativo)
                        ├→ POST /clima/alertas/difundir   (manual, ADMIN)
                        └→ cron JOB_ALERTAS_CLIMA_CRON    (cada 6 h)
                                │ dedup por claveDedup (alertas_climaticas_emitidas)
                                └→ email/WhatsApp a CLIMA_ALERTAS_EMAILS / _WHATSAPP
                                   (bitácora en notificacion_logs, tipo alerta_climatica)
```

Severidades: `media | alta | critica`. Solo se difunde ≥ `CLIMA_ALERTAS_SEVERIDAD_MIN`
(default `alta`); cada alerta se emite UNA vez por nivel de severidad (si un
ciclón se acerca y sube de nivel, se vuelve a notificar).

## Configuración mínima recomendada para producción (CEA)

```env
CLIMA_PROVIDER=smn                      # pronóstico oficial, cae a Open-Meteo
CLIMA_FLOOD_LAT=…                       # captación superficial principal
CLIMA_FLOOD_LNG=…
CLIMA_CAP_URLS=…                        # feeds CAP del SMN/CENAPRED cuando se publiquen
CLIMA_ALERTAS_EMAILS=operacion@…,guardia@…
CLIMA_ALERTAS_WHATSAPP=+52…
```

Nota sobre CAP en México: el SMN publica avisos (frentes fríos, ciclones,
tiempo severo) en su sitio; la disponibilidad de un feed CAP público estable ha
variado. Hydra acepta cualquier documento CAP 1.2 vía `CLIMA_CAP_URLS`
(incluidos agregadores WMO), de modo que conectar el feed es solo
configuración, sin cambios de código.
