# 03 — Ecosistema nacional mexicano de agua y datos

*Generado 2026-07-17. Investigación web con fuentes citadas.*

---

## 1. Instituciones y marco normativo

### CONAGUA — SINA / REPDA
- **SINA**: 53 módulos en 6 secciones (contexto, recurso hídrico, usos, infraestructura, gestión, agua-salud-ambiente); descarga libre **CSV, SHP, KML, GeoJSON**. Portal: https://sina.conagua.gob.mx/sina/index.php · v3: https://sinav30.conagua.gob.mx:8080/
- **REPDA**: base descargable de concesiones/asignaciones y permisos de descarga — para validar títulos de pozos de la CEA y grandes usuarios. https://www.gob.mx/conagua/acciones-y-programas/consulta-la-base-de-datos-del-repda
- **SIGACUA** (SIG de acuíferos y cuencas): https://www.gob.mx/conagua/acciones-y-programas/sistema-de-informacion-geografica-de-acuiferos-y-cuencas-sigacua-55161
- Calidad del agua (RENAMECA): https://app.conagua.gob.mx/ica/

### IMTA — PIGOO
- Evalúa desde 2005 el desempeño de organismos operadores (207 ciudades); ~28 indicadores; CSV/PDF descargables. Portal: https://pigoo.imta.gob.mx/ — clave para Hydra: **IP.14 Eficiencia comercial**, eficiencia física, global, micromedición, agua no contabilizada.
- **Libro IMTA "Sistema comercial de organismos de agua potable"** — referencia conceptual directa: define los 4 subsistemas del área comercial (comercialización, padrón de usuarios, medición de consumos, facturación y cobranza). https://www.imta.gob.mx/biblioteca/libros_html/sistema-comercial/Libro-Sistema-Comercial.pdf
- **Recomendación**: diseñar el modelo de datos para que los indicadores PIGOO se calculen automáticamente.

### ANEAS
- +500 organismos afiliados; asesoría jurídica/fiscal, capacitación y **certificación de competencias**; Convención Anual y Aquatech México; Programa de Fortalecimiento de Capacidades 2025 con CONAGUA. https://www.aneas.com.mx/
- Lineamientos NOM-127: https://aneas.com.mx/wp-content/pdf/documentos-oficiales/11-lineamientos%20NOM-127-SSA1-2021.pdf

### MAPAS (CONAGUA)
- Biblioteca técnica de referencia (redes, modelación hidráulica, conducciones, saneamiento): https://www.gob.mx/conagua/documentos/biblioteca-digital-de-mapas

### NOM relevantes
- **NOM-127-SSA1-2021** (calidad agua consumo humano; vigente 26-abr-2023; arsénico 0.025, fluoruros 1.5, cloro residual 0.2–1.5 mg/L, cumplimiento gradual). DOF: https://www.dof.gob.mx/nota_detalle_popup.php?codigo=5650705
- **NOM-179-SSA1-2020** (vigilancia de calidad en sistemas públicos — Hydra podría gestionar puntos de muestreo). https://www.dof.gob.mx/nota_detalle.php?codigo=5603318&fecha=22/10/2020
- **NOM-230-SSA1-2002** (requisitos sanitarios), **NOM-001-CONAGUA-2011** (hermeticidad; absorbió a NOM-013), **NOM-011-CONAGUA-2015** (disponibilidad media anual), **NOM-001-SEMARNAT-2021** (descargas — relevante para cargo de saneamiento).

### ⚠️ Cambio regulatorio mayor: nueva Ley General de Aguas
- Art. 4º constitucional (2012): derecho humano al agua "suficiente, salubre, aceptable y asequible".
- **DOF 11-dic-2025: decreto que expide la Ley General de Aguas y reforma la LAN.** Ejes: prioridad de uso humano/doméstico, **mínimo vital y prohibición de suspensión total del servicio doméstico**, rectoría del Estado, planeación por cuencas, control de concesiones.
- **Impacto directo en Hydra: las reglas de corte por adeudo deben modelarse como *restricción* (reducción a mínimo vital), no corte total, en tomas domésticas.**
- https://www.hoganlovells.com/es/publications/new-water-regime-in-mexico-enactment-of-the-general-water-law-and-substantial-amendments · https://idconline.mx/corporativo/2026/01/19/reforma-ley-de-aguas-impacto-para-el-2026

---

## 2. CEA Querétaro

- Organismo estatal que opera agua potable, drenaje y saneamiento en la ZM de Querétaro y administraciones del interior (San Juan del Río tiene JAPAM). Gobierno por Consejo Directivo. https://www.ceaqueretaro.gob.mx/comision-estatal-de-aguas-de-queretaro/
- **Servicios digitales actuales (línea base a superar)**: pago en línea (contrato + palabra del titular; tarjeta, **PayPal, CoDi**), app "CEA Querétaro", call center 24/7. **El recibo es CFDI desde el 1-ago-2019** — la facturación masiva CFDI ya es proceso vivo. Tarifario en línea: https://appcea.ceaqueretaro.gob.mx/Tarifario/
- **Tarifas**: 11 clases (Doméstica de Apoyo/Económica/Media/Alta, Comercial, Industrial, Público Oficial/Concesionado, Beneficencia, Doméstica Rural, Pecuaria) × bloques crecientes m³; **+10% alcantarillado, +12% saneamiento**. Fundamento: **Art. 154 de la ley estatal de agua** (tarifas por Consejo Directivo). 2026: solo ajuste inflacionario. Acuerdo de Precios: https://www.ceaqueretaro.gob.mx/wp-content/uploads/2025/02/Acuerdo-de-Precios-31.01.25.pdf
- **Situación hídrica**: 7 de 12 acuíferos en déficit; **Valle de Querétaro (2201) sobreexplotado** (https://sigagis.conagua.gob.mx/gas1/Edos_Acuiferos_18/queretaro/DR_2201.pdf). Acueducto II opera desde 2011; **Acueducto III / Programa Hídrico "agua para 100 años"** en diseño (~2,500 MDP para rehabilitaciones). https://programahidricoqro.mx/
- **Modernización comercial**: renovación de **80 mil medidores** (más 35 mil ya cambiados) — la micromedición y lecturas serán insumo creciente. https://oem.com.mx/diariodequeretaro/local/renovara-la-cea-80-mil-medidores-17877569

---

## 3. Datos abiertos y GIS

### INEGI
- **Marco Geoestadístico** (estados, municipios, localidades, AGEB, manzanas): https://www.inegi.org.mx/programas/mg/ · AGEEML: https://www.inegi.org.mx/app/ageeml/
- **Censo 2020 por AGEB/manzana**: viviendas con agua entubada, drenaje — para mapas de cobertura y tarifas sociales. https://www.inegi.org.mx/app/scitel/doc/descriptor/fd_agebmza_urbana_cpv2020.pdf
- **No existe catálogo INEGI oficial de colonias** — usar SEPOMEX o catálogos municipales (Hydra ya usa catálogos Aquasis pobid/barrid).

### ArcGIS REST de Querétaro (explorado)
- **https://mapa.queretaro.gob.mx/server/rest/services** (ArcGIS Server 10.8). Carpetas: `DHW`, `DWH_publicado`, `DWH_SDE`, `Hosted`, `INT_ARCGIS`, `MGR_SIGEM`, `postgres`, `test`, `Utilities`.
- **`DWH_publicado` y `MGR_SIGEM` → error 499 "Token Required"** (protegidas): solicitar acceso a la CEA/Estado.
- **`Hosted` pública: 169 FeatureServer**, incluyendo **CARCAMOS** (cárcamos de bombeo), `Limites_Municipales`, `Municipios`, `localidades`, vialidades, equipamiento, y numerosas encuestas **Survey123** — el Estado ya usa Survey123 para levantamiento en campo (patrón replicable para padrón y órdenes de Hydra).

### Otros
- datos.gob.mx (CONAGUA histórico): https://historico.datos.gob.mx/busca/organization/conagua
- País dividido en **653 acuíferos** (DOF disponibilidad NOM-011): https://www.dof.gob.mx/nota_detalle.php?codigo=5708074&fecha=09/11/2023

---

## 4. CFDI y estructura tarifaria

- **CFDI 4.0** única versión válida desde 1-abr-2023. Anexo 20: http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Anexo_20_Guia_de_llenado_CFDI.pdf
- Piezas para un organismo de agua:
  - **CFDI global** (público en general, RFC XAXX010101000): http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/GuiallenadoCFDIglobal311221.pdf
  - **Complemento de Recepción de Pagos (REP) v2.0** obligatorio para PPD (convenios/parcialidades): http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Guia_llenado_pagos.pdf
  - No existe "complemento agua"; práctica: CFDI de ingreso + REP + CFDI global mensual. La CEA ya emite recibo-CFDI desde 2019.
- **Patrón tarifario mexicano a parametrizar**: clase de usuario × bloques crecientes m³ (escalonada) + cargo fijo + **10% alcantarillado + 12% saneamiento** sobre agua + **IVA solo en usos no domésticos** (doméstico exento/tasa 0 LIVA) + productos (contratación, reconexión, constancias) por Acuerdo de Precios. En organismos municipales las cuotas van en Ley de Ingresos; en la CEA, por Consejo (Art. 154).

---

## 5. Benchmark nacional

| Organismo | Qué hicieron | Fuente |
|---|---|---|
| **SADM (Monterrey)** | Xylem Vue/GoAigua: **ahorros de agua 17% (hasta 37% por sector)**; premio WEX Global 2024; **doble certificación AquaRating** (única en México); app; modelo "Agua 4.0". **La vara nacional.** | https://www.idrica.com/blog/award-winning-smart-digital-solution-for-water-management-in-monterrey-mexico/ |
| **SACMEX (CDMX)** | Idrica/GoAigua desde jul-2020: integra SCADAs y BDs; pilotos; "Agua en tu colonia". | https://www.idrica.com/es/blog/sacmex-presenta-su-plataforma-de-datos/ |
| **Aguas de Saltillo** | Mixta (Veolia): referente de eficiencia comercial; ACF/Q-Flow, oficina virtual, app. | https://www.aguasdesaltillo.com/ |
| **SIAPA (GDL)** | Pago en línea, recibo digital, cajeros SIAPAMÁTICO. | https://siapa.gob.mx/siapamatico |
| **CESPT (Tijuana)** | App con pago QR y **reporte de fugas con foto georreferenciada**. | https://www.cespt.gob.mx/ |

**Mercado de sistemas comerciales MX**: Aquasis (TDS — Lite <10k, Comercial <100k, Enterprise <300k tomas; http://aquasis.mx — distinto del GoAigua de Idrica), Agua Soluciones, iMexSoft, Acrux, GFDSISCOM. Contexto: **2,356 organismos operadores** en el país (INEGI), mayoría con sistemas precarios. **Patrón de fracaso documentado**: padrón desactualizado, micromedición baja, rotación política trienal, dependencia de un proveedor (CIESAS: https://ciesas.edu.mx/wp-content/uploads/2021/11/DiagnosticoConstruccio%CC%81nSistema-Integral_Flores-Felix-J-Francisco-.pdf). Los éxitos (SADM, Saltillo) comparten continuidad + medición + plataforma de datos integrada.

---

## 6. Interoperabilidad y estándares de datos

- **WaterML 2.0 (OGC)**: series de tiempo hidrológicas. https://www.ogc.org/standards/waterml/
- **OGC SensorThings API**: REST/JSON + MQTT; promovida por OMM/BRGM como sucesor ligero — **recomendada para exponer lecturas/telemetría de Hydra**. https://brgm.hal.science/hal-04456540
- **GWML2**: acuíferos y pozos (pertinente para pozos CEA). https://www.ogc.org/standards/gwml2/
- **EPANET** (EPA v2.2): estándar de facto de modelación hidráulica; formato .INP — Hydra debería exportar red + consumos facturados como demandas. Manual español: https://www.uv.es/idiqlab/labOBPB/documentos/ManualEPANETv2E.pdf
- **AMI**: DLMS/COSEM (IEC 62056), OMS/wM-Bus (EN 13757), LoRaWAN/NB-IoT; arquitectura medidor→concentrador→MDM. **Con 80 mil medidores nuevos, Hydra necesita una capa MDM agnóstica de protocolo.**

---

## Síntesis de implicaciones para Hydra

1. **Regulatorio**: mínimo vital/no-corte doméstico (LGA 2025), tarifa Art. 154 (11 clases × bloques + 10%/12%), CFDI 4.0 + REP + CFDI global.
2. **Datos**: padrón georreferenciado sobre claves INEGI; integrar capas Hosted públicas de Querétaro; solicitar token para `DWH_publicado`/`MGR_SIGEM`.
3. **Indicadores**: PIGOO nativo.
4. **Interoperabilidad**: SensorThings para lecturas AMI, export EPANET, catálogos SINA/REPDA.
5. **Benchmark**: la CEA ya tiene CoDi/PayPal y recibo-CFDI; **el diferencial de Hydra está en padrón GIS, MDM y analítica comercial.**
