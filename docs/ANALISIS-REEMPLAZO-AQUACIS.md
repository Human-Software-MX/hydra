# Hydra vs AQUACIS — Mapa de Reemplazo

> Investigación interna Humansoftware (2026-07-17). Objetivo: delimitar qué debe cubrir Hydra para **reemplazar AQUACIS** en la CEA Querétaro, y qué queda explícitamente fuera del core.

## Qué es AQUACIS

Suite comercial **AquaCIS** de **Agbar** (Aguas de Barcelona), comercializada bajo la marca Aqualogy (era Suez) y hoy parte del portafolio de **Veolia España**; su desarrollo/mantenimiento corre a cargo de **Synectic** (la empresa TI del grupo Veolia). CIS = *Customer Information System*. Escala reportada (2013–2016): 800+ organismos, ~5–7 M de clientes. Despliegue cloud por instancia dedicada (`aquacis-<cliente>.aquacis.com`).

Se compone de 3 módulos:

| Módulo | Alcance |
|---|---|
| **CRM** | Atención multicanal + oficina virtual 24/7 (autogestión ciudadana) |
| **CF** | Ciclo de facturación: contratación, padrón, lecturas, consumo, tarifas, facturación, cobranza, deuda |
| **EAM** | Gestión de activos de red: inventario, mantenimiento preventivo (ISO 55000), órdenes de campo móviles, integración GIS |

## Mapa de reemplazo (AQUACIS → Hydra)

| Módulo AQUACIS | ¿Hydra lo cubre? | Brecha |
|---|---|---|
| CRM — atención multicanal | 🟡 Parcial-alto (solicitudes E2E, vista 360°, quejas) | Omnicanalidad (WhatsApp/chatbot) — notificaciones reales + integración Agora |
| CRM — oficina virtual | 🟡 Medio (portal cliente: consultas + trámites 5 pasos) | **Pagos en línea** — pieza más visible del reemplazo |
| CF — contratación / padrón | ✅ Alto — núcleo de Hydra (wizard 7 pasos, precarga solicitud↔contrato) | Sin brecha significativa |
| CF — lecturas y consumo | ✅ Alto (lotes, parser AQUACIS, rutas) | Telelectura = integración externa también en AquaCIS |
| CF — tarifas y facturación | 🟡 Estructura sí, montos ahora conectados (ver rama `feat/auditoria-swan-brechas`) | Validar tarifas T14 reales cargadas en DB; timbrado CFDI productivo |
| CF — cobranza y deuda | 🟡 Medio-alto (pagos, ETL bancario, convenios) | Recargos automáticos, corte/reconexión automática |
| EAM — activos y mantenimiento | ❌ No (`Medidor`/`Toma` son entidades comerciales) | **Fuera del core** — decidir con CEA si se conserva un EAM aparte |

## Decisión de alcance recomendada

**Reemplazo en dos frentes desacoplados:**
1. **Hydra sustituye CRM + CF** — es su core natural (alta de contratos y cotización disparadas por solicitudes, desde acometida completa hasta solo instalación de medidor).
2. **EAM se evalúa por separado** — verificar cuánto lo usa realmente la CEA. Si solo es inventario de medidores/tomas, Hydra ya lo cubre; si es gestión real de red, mantener un EAM/GIS especializado en paralelo.

## Riesgos del reemplazo

1. **Migración de histórico** (padrón, lecturas, deuda/pagos) sin perder trazabilidad.
2. **Transición por ciclo de facturación** — sin big-bang a mitad de periodo de lectura (riesgo de doble facturación).
3. **Telelectura**: protocolo de AquaCIS no público; si CEA tiene medidores conectados, se requiere conector equivalente.
4. **Dependencia contractual Synectic/Veolia**: cláusulas de salida y extracción de datos.
5. **Expectativas de stakeholders**: comunicar que el alcance es CRM+CF, no EAM.
6. **Portal sin pagos en línea** se percibiría como retroceso frente a la oficina virtual de AquaCIS.

## Fuentes principales

- https://www.veolia.es/soluciones/agua/digitalizacion-procesos-agua
- https://www.iagua.es/noticias/espana/aqualogy/16/02/23/aquacis-software-gestion-comercial-y-tecnica-operadoras-agua
- https://www.synectic.es/
- https://contratos.gobierto.es/licitaciones/4892707 (soporte AQUACIS Retortillo 2025)
- https://en.wikipedia.org/wiki/Grupo_Agbar

> Documento extendido (benchmark SWAN/IWA/PIGOO + tabla completa de brechas B-01…B-17): vault Obsidian `Clientes/Humansoftware/Productos/Hydra/HYDRA-BRECHAS-SWAN-Y-MEJORES-PRACTICAS.md`.
