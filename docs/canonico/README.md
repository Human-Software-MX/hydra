# Artefactos canónicos del dominio agua

Estos archivos son el **resultado final de Callosum** — lo único de Callosum
que este proyecto consume. El motor corre en su propio repo en design-time;
aquí solo viven sus artefactos versionados, listos para leerse como datos
(diccionario de referencia, validación schema-on-read, KPIs, knowledge graph).

| Archivo | Qué es |
|---|---|
| `agua.yaml` | Modelo canónico del dominio v0.1.0 — 24 entidades. El diccionario de datos de referencia. |
| `agua.ttl` | La misma ontología en OWL/Turtle — para Knowledge Graph, RAG, SPARQL o Protégé. |
| `mappings/aquasis.yaml` | Mapeo bidireccional aquasis ↔ canónico, campo a campo. |
| `mappings/hydra.yaml` | Mapeo bidireccional hydra ↔ canónico, campo a campo. |

Modelo v0.1.0 · 24 entidades. Adopta: IWA/AWWA standard water balance (Lambert & Hirner 2000; AWWA M36 5th ed. with data validity grading) + IWA PI system (Alegre et al. 3rd ed. 2017) / IBNET / PIGOO (IMTA) for indicators; meter-to-cash core normalized from the IMTA "Sistema comercial" reference (comercialización, padrón, medición, facturación y cobranza) and the CIS vocabulary shared by Oracle CC&B / SAP IS-U.

## Regenerar

En el repo Callosum (fuente de verdad de estos artefactos):

```bash
callosum validate
callosum ontology agua --write
callosum publish agua <este-directorio>
```

Versionar el cambio aquí (commit) — el proyecto nunca depende del repo
Callosum en runtime, solo de estos archivos.

*Generado por `callosum publish`.*
