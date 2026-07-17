# 02 — SWAN y benchmark internacional

*Generado 2026-07-17. Investigación web con fuentes citadas. **[Verificado]** = directo de la fuente; **[Inferencia]** = interpretación aplicada a Hydra.*

---

## 1. SWAN — Smart Water Networks Forum (base del proyecto)

### 1.1 Qué es [Verificado]

Organización sin fines de lucro fundada en 2010, "la voz global líder del sector de agua inteligente"; une utilities, reguladores, proveedores y expertos para acelerar soluciones basadas en datos. **+350 organizaciones miembro en ~45 países.** Alianzas regionales (Americas, Europa, APAC, India) y grupos: Digital Twin WG, AI Community, Smart Metering, Adaptive Data Management, Interoperable Utility Group, Start-Up Community.

- https://swan-forum.com/ · https://swan-forum.com/ecosystem/ · https://swan-forum.com/groups/

**Desambiguación**: en el sector agua "SWAN" es unívocamente el Smart Water Networks Forum; otras acepciones (State Wide Area Network, SD-WAN) no pertenecen al sector.

### 1.2 Modelo de 5 capas ("SWAN Layers") [Verificado]

1. **Física**: tuberías, bombas, válvulas, PRVs, depósitos.
2. **Sensado y control**: sensores de flujo/presión/calidad/acústica; actuadores remotos.
3. **Recolección y comunicaciones**: transmisión bidireccional (cable, radio, celular).
4. **Gestión y visualización de datos**: SCADA, **GIS**, sistemas empresariales — **aquí vive Hydra hoy** [Inferencia].
5. **Fusión y análisis**: analítica, IA/ML, digital twins — detección de fugas, optimización, predicción.

- https://swan-forum.com/smart-water-network/ · Cahn (2014), Journal AWWA: https://awwa.onlinelibrary.wiley.com/doi/full/10.5942/jawwa.2014.106.0096
- Evolución a framework circular "Smart Water Journey": https://www.wateronline.com/doc/evolving-the-swan-layers-to-a-circular-framework-0001

### 1.3 Grupos de trabajo clave [Verificado]

- **Digital Twin WG** (2019): Digital Twin Readiness Guide (may-2022, PDF gratuito: https://swan-forum.com/wp-content/uploads/2022/08/SWAN-Digital-Twin-Readiness-Guide.pdf), Digital Twin Values Guide (2024), Maturity Assessment Tool (2025). Enfoque escalable, iterativo, por fases; analítica descriptiva → predictiva → prescriptiva; 13 casos (PUB Singapur, BIOFOS, Veolia…).
- **Interoperable Utility Group**: 18 utilities globales (Anglian, Thames, Sydney Water, NYC DEP, PUB…) desarrollando estructuras de datos de activos consistentes y arquitecturas de referencia (PoCs AWS/Azure). https://swan-forum.com/interoperable-utility-group/
- **AI Community** (2024): casos ML en pérdidas + estado futuro (LLMs, chatbots); proyecto de **Agentic AI** en las Américas (2026), coordinado por Seattle Public Utilities y U. de Exeter. https://swan-forum.com/ai-community/

### 1.4 Madurez digital [Verificado]

**"The Water Utility Digital Journey"** (Amir Cahn, CEO SWAN): 4 etapas — **Inactiva** (manual), **Reactiva** (silos), **Proactiva** (sensores + analítica predictiva), **Optimizada** (IA/ML/digital twins con mejora continua) — en 3 dimensiones: personas, procesos, tecnología. https://swan-forum.com/publications/the-water-utility-digital-journey/

[Inferencia] La mayoría de organismos mexicanos está entre etapas 1-2; Hydra es el vehículo de la CEA para pasar a 3.

---

## 2. Asociaciones y estándares

### IWA [Verificado]
- **Balance hídrico estándar IWA** (Water Loss Task Force, 2000): suministro = consumo autorizado (facturado/no facturado) + pérdidas (aparentes: submedición, errores de datos, consumo no autorizado; reales: fugas). Sustituye "agua no contabilizada" por **NRW** con definiciones rigurosas. https://www.leakssuitelibrary.com/iwa-water-balance/
- **IWA Performance Indicators** (Alegre et al., 3.ª ed. 2017): referencia mundial con **data confidence grading**. https://iwaponline.com/ebooks/book/255/

### AWWA [Verificado]
- **Manual M36** (5.ª ed.): auditoría de agua compatible con IWA ("método AWWA/IWA"). https://store.awwa.org/M36-Water-Audits-and-Loss-Control-Programs-Fifth-Edition
- **Free Water Audit Software v6.0**: data grading interactivo + benchmarking. https://www.awwa.org/resource/water-loss-control/
- [Inferencia] Hydra debería incorporar el balance AWWA/IWA como módulo nativo auto-llenado desde facturación y macromedición — ningún CIS mexicano típico lo ofrece.

### ISO [Verificado]
- **ISO 24510/24512** (2024): evaluación/mejora del servicio y gestión de utilities de agua potable. **ISO 24513** terminología, **ISO/TR 24514** ejemplos de PI. https://www.iso.org/standard/82490.html
- **ISO 55000/55001** gestión de activos: Anglian Water certificada desde 2014; Ofwat (2025) propone elevar madurez de asset management. https://www.ofwat.gov.uk/wp-content/uploads/2025/06/Proposal-to-improve-asset-management-maturity-of-water-companies-1.pdf

### EPA / benchmarking [Verificado]
- **AWIA 2018**: planes de gestión de activos y auditorías de pérdidas vía DWSRF; EPA estima 2.1 trillion galones/año perdidos en EE. UU. https://www.epa.gov/ground-water-and-drinking-water/americas-water-infrastructure-act-2018-awia
- **IBNET** (Banco Mundial, 1994): +5,000 prestadores, +150 países; definiciones estándar + **tarifario de 190 países**. https://newibnet.org/
- **EBC** (La Haya): benchmarking anual europeo; **EurEau**. https://www.waterbenchmark.org/
- **ADERASA**: benchmarking regulatorio latinoamericano.
- **OCDE Principles on Water Governance (2015)**: 12 principios; el #5 (datos e información comparables) es el mandato directo de Hydra. https://www.oecd.org/en/topics/sub-issues/water-governance/the-oecd-principles-on-water-governance-and-implementation-strategy.html

---

## 3. KPIs

- **NRW** = suministro − consumo autorizado facturado. Como %, mal comparador entre utilities.
- **ILI** = CARL/UARL (IWA). Bandas World Bank Institute: A (<2 desarrollados / <4 en desarrollo) … D (≥8 / ≥16: programa urgente). https://www.leakssuitelibrary.com/uarl-and-ili/
- **PIGOO (IMTA, desde 2005)**: ~28 indicadores, hasta 387 ciudades evaluadas — eficiencia física (facturado/producido), **comercial (recaudado/facturado)**, global, micromedición, dotación, empleados/mil tomas. https://pigoo.imta.gob.mx/
- [Inferencia] KPIs comerciales nativos para Hydra: eficiencia comercial, periodo medio de cobranza, % y antigüedad de cartera vencida, % micromedición, % lecturas reales vs estimadas, tasa corte/reconexión, quejas/mil usuarios — todos derivables del kardex y alimentando PIGOO/IBNET/balance AWWA automáticamente. **El "motor de KPIs con definiciones estándar" es la mayor oportunidad diferencial del producto.**

---

## 4. Benchmark de plataformas

| Plataforma | Qué es | Idea a copiar |
|---|---|---|
| **Oracle Utilities CC&B/CCS** | CIS meter-to-cash completo con credit & collections | Vista 360° del usuario en una pantalla; cobranza por reglas configurables. https://www.oracle.com/utilities/customer-service/ |
| **SAP S/4HANA Utilities (IS-U)** | Facturación + device management + CRM en tiempo real | Integración transaccional comercial-financiera sin conciliaciones manuales. https://help.sap.com/docs/SAP_for_Utilities |
| **Xylem Vue powered by GoAigua (Idrica)** | Plataforma que unifica AMI+SCADA+GIS+CIS; spin-off de Global Omnium | **El mejor referente arquitectónico**: bus de datos que unifica silos + analítica encima. https://www.idrica.com/ |
| **TaKaDu** | SaaS de Central Event Management: ML 24/7 sobre datos de red | Concepto de "evento" con ciclo de vida (detección→clasificación→asignación→cierre→valor), aplicable a eventos comerciales. https://www.takadu.com/ |
| **Qatium** | Plataforma española "AI Water Platform", freemium | UX de bajo umbral: operador no-modelador puede simular. https://qatium.com/ |
| **Autodesk Water (Innovyze)** | InfoWater/InfoWorks (hidráulica), Info360 (digital twin cloud); AI Assistant 2027 | Analítica operacional en la nube. https://www.autodesk.com/products/info360-insight/overview |
| **Bentley OpenFlows WaterSight** | Digital twin operativo: SCADA+GIS+modelo+clientes | Entorno de datos común con alertas. https://www.bentley.com/software/openflows-watersight/ |
| **Esri ArcGIS Utility Network** | Modelo de red nueva generación + **Water Utility Network Foundation** | Alinear el modelo GIS de Hydra al asset package Esri (trazas, cierres de válvula → avisos a usuarios afectados). https://solutions.arcgis.com/water/help/water-distribution-utility-network-foundation/ |
| **AMI: Itron, Sensus/Xylem, Kamstrup, Badger** | Medidores ultrasónicos con detección acústica embebida, redes celulares/mesh | Analítica AMI: flujo mínimo nocturno, deterioro de exactitud, tamper/backflow, alerta de fuga al usuario. https://www.kamstrup.com/en-us/water-solutions/solutions/ami |

---

## 5. Digital twins e IA — casos reales [Verificado]

- **Valencia / Global Omnium (GoAigua)**: digital twin desde 2009; **NRW −40%, +20% eficiencia O&M, ~1,000 M galones/año ahorrados** (cifras del proveedor). https://www.idrica.com/case-studies/digital-twin-valencia/
- **Anglian Water (UK)**: digital twin + IA (Avanade/Microsoft) para fugas; ISO 55001 desde 2014. https://www.avanade.com/en/clients/anglian-water-digital-twin-ai
- **DC Water — "Pipe Sleuth"**: deep learning sobre CCTV de alcantarillado; 1 h de video: de ~75 a ~10 min. https://builders.intel.com/solutionslibrary/streamlined-sewer-pipe-inspection-analysis-with-intel-ai-technologies
- **Singapur PUB**: detección/localización de fugas con digital twin e IA, **<1 km de precisión**. https://www.bentley.com/wp-content/uploads/cs-pub-digital-anomaly-ltr-en-lr.pdf
- Literatura ML: https://link.springer.com/article/10.1007/s10462-024-11093-7

[Inferencia] **El activo de datos más valioso que ya posee Hydra es el historial de consumos por toma.** Con él se puede empezar IA sin sensores nuevos: anomalías de consumo (fugas intradomiciliarias, medidor parado, submedición, tomas clandestinas), score de riesgo de impago, forecasting de facturación/recaudación, estimación de lecturas faltantes — el camino "Reactiva → Proactiva" del framework SWAN.

---

## Síntesis para Hydra

1. **Adoptar el modelo de capas SWAN como narrativa arquitectónica** — Hydra vive en capa 4, evoluciona a capa 5; el framework de madurez de 4 etapas es el diagnóstico y roadmap de la CEA.
2. **Motor de KPIs estándar** (IWA PI + IBNET + PIGOO + balance AWWA/IWA con data grading) calculado automáticamente desde facturación/recaudación.
3. **Copiar patrones probados**: vista 360° (Oracle), integración transaccional (SAP), plataforma unificadora (GoAigua), eventos con ciclo de vida (TaKaDu), GIS Utility Network (Esri), UX simple (Qatium).
4. **IA con los datos que ya hay** antes de sensorizar; digital twin por fases según la SWAN Readiness Guide.
