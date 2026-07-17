# Artefactos canónicos del dominio agua

Estos archivos son el **resultado final de Callosum** — lo único de Callosum
que Hydra consume. El motor corre en su propio repo (`~/Desktop/AI/callosum`)
en design-time; aquí solo viven sus artefactos versionados:

| Archivo | Qué es |
|---|---|
| `agua.yaml` | Modelo canónico del dominio agua v0.1.0 — 24 entidades meter-to-cash + balance hídrico sobre IWA/AWWA/PIGOO. El diccionario de datos de referencia. |
| `agua.ttl` | La misma ontología en OWL/Turtle — para Knowledge Graph, RAG, SPARQL o Protégé (entregable 10 del plan). |
| `mappings/hydra.yaml` | Mapeo bidireccional Hydra ↔ canónico (24 entity maps, caveats de deuda técnica anotados por campo). |
| `mappings/aquasis.yaml` | Mapeo AQUACIS ↔ canónico (registro de lote 1,480c → 6 entidades). |

## Regenerar

En el repo Callosum (fuente de verdad de estos artefactos):

```bash
cd ~/Desktop/AI/callosum
# editar specs/... según el cambio
.venv/bin/python -m callosum.cli validate
.venv/bin/python -m callosum.cli ontology agua --write
cp specs/canonical/agua.yaml specs/canonical/agua.ttl <hydra>/docs/canonico/
cp specs/mappings/agua/{hydra,aquasis}.yaml <hydra>/docs/canonico/mappings/
```

Versionar el cambio aquí (commit) — Hydra nunca depende del repo Callosum en
runtime, solo de estos archivos.
