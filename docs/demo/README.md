# Demo conceptual Hydra · agua (entregable 14)

Pipeline real corriendo en Docker: lotes de lectura AQUACIS reales (archivos
posicionales de 1,480 caracteres) → KPIs contra el modelo canónico `agua` →
dashboard. **Ningún número está hardcodeado**: el contenedor parsea y calcula
al arrancar; cambia los archivos de entrada y cambian los números.

**Arquitectura:** Hydra consume el **resultado** de Callosum, no el motor. El
modelo canónico entra como artefacto versionado (`docs/canonico/agua.yaml` +
`agua.ttl` + mapeos) generado en design-time en el repo Callosum. Nada de
Callosum corre en este contenedor — TypeScript sobre `oven/bun:1-slim` (el
mismo lenguaje del repo) + el paquete `yaml`.

## Correr

```bash
cd hydra/docs/demo
docker compose up --build
# → http://localhost:8090   (listo en ~2 s; el log narra el pipeline)
```

Todo lo que necesita vive en este repo: muestras AQUACIS
(`Requerimientos/...`), artefactos canónicos (`docs/canonico/`) y este
directorio. Clonar + Docker = corre.

## Qué hace el contenedor

1. `demo.ts` parsea los lotes bajo `Requerimientos/.../Interfase con
   Sistema de Lecturas/` (salida 0001M08L20 y vuelta 0007AM1L44) y el catálogo
   `Observac.dat`.
2. Lee `docs/canonico/agua.yaml` (artefacto Callosum) como diccionario de
   referencia del dominio.
3. Calcula agregados y KPIs en memoria (padrón, consumo, incidencias, banda
   esperada, confianza del dato estilo AWWA).
4. Renderiza `template.html` con los datos → `out/index.html` (+
   `out/data.json` para inspección) y sirve en el puerto 8090.

`demo.ts` y `template.html` van horneados en la imagen — cualquier
edición requiere `docker compose up --build`. Para actualizar el modelo
canónico ver `docs/canonico/README.md` (se regenera en el repo Callosum y se
versiona aquí).

## Archivos

| Archivo | Rol |
|---|---|
| `demo.ts` | Pipeline: parseo → KPIs contra el canónico → render |
| `template.html` | Dashboard (los datos entran por `window.DEMO_DATA`) |
| `Dockerfile` / `docker-compose.yml` | Imagen mínima; monta solo datos del repo y `out/` |
| `../canonico/` | Artefactos canónicos (agua.yaml · agua.ttl · mapeos) — resultado de Callosum |
| `out/` | Generado en cada corrida — no versionar |
| `demo-conceptual-agua.html` | Snapshot estático (histórico) |

Puerto atado a `127.0.0.1` — el demo no se expone fuera de la máquina. Sin
datos personales: el dashboard solo muestra agregados.
