# 09 — Diseño preliminar del modelo de IA

*Generado 2026-07-17. Entregable 12 del plan. Principio rector (doc 02 §5): **el activo de datos más valioso que ya posee Hydra es el historial de consumos por toma** — se puede empezar IA sin sensores nuevos, recorriendo el camino "Reactiva → Proactiva" del framework SWAN.*

**Regla arquitectónica (doc 08):** ningún modelo lee tablas transaccionales directamente; todos consumen el kardex/derivados del pipeline canónico. Eso da features estables, linaje y reproducibilidad. Mientras el pipeline no exista, los pilotos pueden leer réplicas de solo lectura de las tablas Prisma citadas abajo — nunca producción.

---

## 1. Priorización de casos de uso (datos que YA existen)

| # | Caso | Valor | Factibilidad | Orden |
|---|---|---|---|---|
| 1 | Anomalías de consumo | Alto (pérdidas aparentes, protección al usuario) | Alta — reglas + estadístico | Fase 1 |
| 2 | Score de riesgo de impago | Alto (eficiencia comercial PIGOO IP.14) | Alta — ML tabular clásico | Fase 1-2 |
| 3 | Forecasting facturación/recaudación/demanda | Medio-alto (planeación financiera) | Alta — series de tiempo | Fase 2 |
| 4 | Estimación de lecturas faltantes | Medio (calidad de facturación, menos quejas) | Alta — estadístico | Fase 1 |
| 5 | Sugerencia de contrato en conciliación ETL | Medio (horas-persona en bandeja) | Muy alta — matching determinístico + fuzzy | Fase 1 (quick win) |

### 1.1 Detección de anomalías de consumo

**Objetivo:** detectar por toma/contrato: **fuga intradomiciliaria** (salto sostenido de consumo), **medidor parado** (consumo cero con historial positivo), **submedición** (deriva descendente gradual — deterioro del medidor), **toma clandestina / consumo no autorizado** (consumo incoherente con estado del contrato o con contratos cortados/restringidos que siguen consumiendo).

**Datos de entrada (tablas Prisma concretas):**
- `Consumo` (`contratoId`, `periodo`, `m3`, `tipo` Real/Promedio/Mixto/Fijo, `confirmado`) — la serie base por contrato.
- `Lectura` (`lecturaActual`, `lecturaAnterior`, `consumoReal`, `consumoEstimado`, `esEstimada`, `incidenciaId`, `lecturaMinZona`, `lecturaMaxZona`) + `CatalogoIncidencia` (`esAveria`) — para separar anomalía real de problema de captura.
- `Medidor` (`fechaInstalacion`, `fechaUltimaVerif`, marca/modelo/calibre) — edad y tipo del medidor como covariables de submedición.
- `Contrato` (`estado`, `tipoContratacionId`, `cicloFacturacion`, `unidadesServidas`, `personasHabitanVivienda`) y `Orden` (`tipo` corte/reconexión, `fechaEjecucion`) — para el caso clandestina: consumo > 0 tras corte ejecutado sin reconexión.
- `PuntoServicio` (`puntoServicioPadreId`, `reparticionConsumo`, `zonaFacturacionId`) — agregación por padre-hijo y comparación contra pares de la misma zona.

**Enfoque técnico (en este orden):**
1. **Reglas** (semana 1 de valor): consumo=0 con N periodos previos >0 → medidor parado; consumo > k·σ del propio historial → posible fuga; consumo tras orden de corte ejecutada → clandestina. Son las mismas reglas que la analítica AMI estándar (flujo nocturno, tamper) pero a resolución mensual.
2. **Estadístico**: z-score robusto (mediana/MAD) sobre la serie propia + comparación contra la distribución de su cohorte (misma clase tarifaria × zona de facturación × calibre). Descomposición estacional simple (STL) si hay ≥24 periodos.
3. **ML solo después**: isolation forest / autoencoder sobre features derivadas, **cuando** las reglas ya generen etiquetas validadas por inspecciones (`Orden` tipo revisión con `datosCampo`).

**Métrica de éxito:** precisión de las alertas verificadas en campo (meta inicial ≥40% de órdenes de inspección derivadas de alerta que confirman el hallazgo); m³ recuperados facturados; reducción de quejas por "consumo elevado" (`QuejaAclaracion.categoria`).

**Qué NO intentar aún:** detección de fugas de red (requiere macromedición por sector que no existe); modelos de deep learning sobre curvas de carga horarias (no hay AMI); localización espacial de fugas (capa 5 con sensores).

### 1.2 Score de riesgo de impago (cobranza priorizada)

**Objetivo:** probabilidad de que un contrato no pague en los próximos 1-2 periodos, para segmentar cartera y priorizar acciones (recordatorio → convenio ofrecido → restricción conforme a LGA 2025: mínimo vital, no corte total doméstico).

**Datos de entrada:**
- `Pago` (`fecha`*, `monto`, `formaPagoId`, `origen`) y `PagoExterno` (`fechaPagoReal`, `recaudador`, `canal`) — comportamiento histórico de pago: puntualidad, canal preferido, días de atraso promedio. *Nota: `Pago.fecha` es String — la migración a DateTime (doc 12 §1.1) es prerrequisito para features temporales confiables.
- `Recibo` (`saldoVigente`, `saldoVencido`, `fechaVencimiento`, `parcialidades`) y `Timbrado` (`total`, `fechaVencimiento`) — exposición actual.
- `Convenio` (`estado`, `parcialidadesRestantes`, `montoPagado` vs `montoTotal`, `origenTipo`) — historial de convenios rotos/cumplidos, el predictor clásico más fuerte.
- `Contrato` (`mesesAdeudo`, `tipoContratacionId`, `cicloFacturacion`, `domiciliado`, `bloqueadoJuridico`) + `Domicilio`/claves INEGI — segmento y contexto socioterritorial (cruzable con Censo 2020 por AGEB para tarifa social, sin usar variables protegidas como predictores directos).
- `Orden` (cortes/reconexiones previas) y `QuejaAclaracion` (disputas abiertas suprimen acciones de cobranza).

**Enfoque técnico:** gradient boosting (LightGBM/XGBoost) sobre features tabulares con validación temporal (train en periodos t-n…t-1, test en t); baseline previa: reglas de antigüedad de saldo (buckets 30/60/90+). Salida: score 0-1 + razones (SHAP) para el gestor de cobranza. Calibración por clase tarifaria.

**Métrica de éxito:** AUC ≥0.75 vs baseline; uplift de recuperación en piloto A/B (cartera priorizada por score vs orden actual); mejora del periodo medio de cobranza y de la eficiencia comercial (recaudado/facturado, PIGOO IP.14).

**Qué NO intentar aún:** automatizar acciones de restricción desde el score (decisión humana + marco LGA obligatorios); modelos de "propensión a convenio" (pocos datos hasta tener kardex histórico); usar datos externos de buró (implicaciones legales/LFPDPPP).

### 1.3 Forecasting de facturación, recaudación y demanda

**Datos de entrada:** agregados mensuales desde `Timbrado` (`total`, `periodo`), `Pago`+`PagoExterno` (recaudación por canal), `Consumo` (`m3` por clase × zona) — idealmente ya como derivados del kardex. Exógenas: estacionalidad, temporada de estiaje, cambios tarifarios (`ActualizacionTarifaria.fechaAplicacion`), crecimiento del padrón (altas por `Contrato.createdAt`).

**Enfoque técnico:** modelos clásicos de series (SARIMAX / ETS / Prophet) por serie agregada (organismo, administración, clase tarifaria); jerárquico-reconciliado (bottom-up desde zona) cuando el kardex dé historia suficiente. Nada de deep learning: pocas series, frecuencia mensual.

**Métrica de éxito:** MAPE ≤5% a 3 meses en facturación total; intervalo de predicción calibrado (cobertura 80/95%); adopción por finanzas CEA para flujo de caja.

**Qué NO intentar aún:** forecasting de demanda hidráulica horaria/diaria (requiere macromedición/AMI); escenarios climáticos.

### 1.4 Estimación de lecturas faltantes

**Objetivo:** cuando no hay lectura real (`Lectura.esEstimada=true`, incidencias de acceso, medidor con avería), estimar el consumo de forma defendible y trazable, sustituyendo la "bolsa de estimación" opaca de Aquasis.

**Datos de entrada:** `Lectura` (histórico propio, `incidenciaId`, `lecturaMinZona`/`lecturaMaxZona` como cotas), `Consumo` (`tipo` ya distingue Real/Promedio/Mixto/Fijo), `Contrato` (clase, `unidadesServidas`), cohorte de pares (misma clase × zona × calibre).

**Enfoque técnico:** jerarquía de estimadores con fallback: (1) mediana móvil del propio contrato (últimos 6 periodos reales); (2) mediana de cohorte si no hay historial; (3) mínimo normativo por clase. Cada estimación se persiste con método, insumos y versión (evento `ESTIMACION` en el kardex) — auditable ante quejas. ML (kNN sobre perfiles de consumo) solo si las reglas muestran sesgo medible.

**Métrica de éxito:** error absoluto mediano vs lectura real siguiente (backtest: ocultar lecturas reales y estimar); % de recibos estimados que generan queja/aclaración (debe bajar); % de lecturas estimadas total (KPI que debe **bajar** con mejores rutas — la estimación buena no debe volverse excusa).

**Qué NO intentar aún:** estimación intra-mes o por eventos (sin AMI no hay resolución).

### 1.5 Sugerencia de contrato en la bandeja de conciliación (ETL de pagos)

**Objetivo:** cuando un `PagoExterno` llega con `contratoRaw` ilegible/ambiguo (`estado='pendiente_conciliar'`), sugerir el contrato correcto en la bandeja, con score de confianza.

**Datos de entrada:** `PagoExterno` (`contratoRaw`, `referencia`, `monto`, `fechaPagoReal`, `recaudador`, `datosRaw`), `Contrato` (`numeroContrato`, `ceaNumContrato`), `SigeHydra` (`cnttnum`, `cnttrefant` — referencias del sistema anterior que los recaudadores aún usan), `Recibo`/`Timbrado` (monto esperado y vigencia — un pago que coincide exactamente con un `saldoVigente` es señal fuerte), historial de pagos del contrato (mismo canal/recaudador/monto recurrente).

**Enfoque técnico:** cascada determinística → difusa: (1) match exacto contra `numeroContrato`/`ceaNumContrato`/`cnttnum`/`cnttrefant`; (2) normalización de referencia (ceros a la izquierda, dígito verificador, prefijos por recaudador — declarados en el perfil Callosum de cada layout); (3) fuzzy (Levenshtein en referencia + coincidencia de monto contra recibos abiertos + patrón histórico del pagador). Auto-aplicar solo score alto con match de monto; el resto, sugerencia top-3 en la bandeja. Cada confirmación humana se guarda como etiqueta de entrenamiento.

**Métrica de éxito:** % de pagos externos auto-conciliados (meta >90% con precisión >99.5%); tiempo medio de bandeja; cero aplicaciones erróneas no revertibles (el kardex append-only permite revertir con evento de ajuste).

**Qué NO intentar aún:** LLMs para parsear layouts (son posicionales y determinísticos — pertenecen a perfiles Callosum, no a IA).

---

## 2. Agentes y LLM

### 2.1 Asistente de atención con contexto 360° del contrato
- Materializa el endpoint faltante de la Tarea 07 (`GET /contratos/:id/contexto-atencion`) y lo eleva: el agente recibe el **contexto 360°** (datos del contrato, personas/roles, saldos del kardex, últimos consumos con banderas de anomalía, órdenes abiertas, convenios, quejas previas, tickets Ágora) y asiste al operador de ventanilla/call center: explica el recibo ("subió porque pasó al bloque 3 de la tarifa doméstica media"), propone trámites aplicables, redacta respuestas.
- **Herramientas del agente (tool-use), no acceso SQL libre**: `obtener_contexto_360`, `explicar_calculo_tarifa` (contra el motor tarifario único, con la traza real del cálculo), `simular_convenio`, `consultar_normativa` (RAG §2.2), `crear_queja/orden` (siempre con confirmación humana).
- Fase 1 interno (copiloto del operador); portal ciudadano solo después, con guardrails endurecidos y sin acciones de escritura.

### 2.2 RAG sobre normatividad
- **Corpus:** Ley General de Aguas (DOF 11-dic-2025) y LAN reformada (mínimo vital / prohibición de corte total doméstico), ley estatal de Querétaro (Art. 154), Acuerdos de Precios anuales de la CEA, NOM-127-SSA1-2021, NOM-179-SSA1-2020, NOM-001-CONAGUA-2011, NOM-011-CONAGUA-2015, NOM-001-SEMARNAT-2021, guías CFDI 4.0/REP/global del SAT, biblioteca MAPAS de CONAGUA, y normativa interna CEA (reglamentos, circulares).
- **Diseño:** ingesta con chunking por artículo/fracción, metadatos (documento, vigencia, jerarquía normativa) alineados al nodo `Normativa` del Knowledge Graph (doc 10); respuestas **siempre con cita textual y vigencia**; evaluación con set dorado de ~50 preguntas reales de ventanilla/jurídico; re-ingesta versionada cuando cambie el DOF.
- Casos: "¿puedo cortar el servicio a un doméstico con 6 meses de adeudo?" → responde restricción a mínimo vital citando LGA; "¿qué tarifa aplica a una escuela pública?" → clase Público Oficial + Acuerdo vigente.

### 2.3 Clasificación de quejas
- `QuejaAclaracion` ya tiene `tipo`, `categoria`, `prioridad`, `areaAsignada` — hoy capturadas a mano. Un clasificador LLM (few-shot, o fine-tune ligero cuando haya >5k etiquetas) asigna categoría/prioridad/área desde `descripcion` y sugiere respuesta inicial; cruza con anomalías (§1.1): una queja de "cobro excesivo" con bandera de fuga intradomiciliaria se enruta distinto.
- Métrica: acuerdo con etiqueta humana ≥85%; tiempo de primera asignación.

**Guardrails comunes:** PII enmascarada en prompts hacia proveedores externos; log completo de prompts/respuestas (auditoría); el LLM nunca calcula tarifas ni saldos (siempre tool-use contra motores deterministas); disclaimers en canal ciudadano.

---

## 3. Ruta a digital twin (SWAN Digital Twin Readiness Guide)

La guía SWAN (2022) prescribe un enfoque **escalable, iterativo y por fases**: descriptiva → predictiva → prescriptiva. Aplicado a Hydra:

| Fase | Capacidad | Qué se construye | Hito verificable |
|---|---|---|---|
| **DT-0 Fundación** | Datos confiables y georreferenciados | Pipeline canónico + kardex; padrón con GPS/INEGI completo; motor de KPIs | 100% de puntos de servicio con coordenadas válidas; KPIs PIGOO auto-calculados |
| **DT-1 Descriptiva** | "Qué está pasando" | Vista espacial de consumo/cartera/anomalías por sector (`SectorHidraulico`, `CatalogoZonaFacturacion`); balance parcial: consumo autorizado facturado por sector | Mapa de calor de consumo y NRW-proxy por sector en producción |
| **DT-2 Predictiva** | "Qué va a pasar" | Modelos §1 en producción (anomalías, score, forecasting); con macromedición por fuente/sector: balance IWA/AWWA completo, NRW/ILI reales; **export EPANET**: padrón + consumos facturados como demandas nodales del modelo .INP | **Archivo .INP válido que corre en EPANET 2.2** con demandas reales por nodo — el hito bisagra hacia lo hidráulico |
| **DT-3 Prescriptiva** | "Qué hacer" | Con AMI (80k medidores) y modelo calibrado: simulación de escenarios (cierres de válvula → contratos afectados vía Utility Network), optimización de presiones/sectores, priorización de renovación de redes | Recomendaciones operativas cerradas en ciclo (recomendación → acción → medición del efecto) |

**Regla de la guía SWAN que adoptamos:** no perseguir el "twin completo" — cada fase debe pagar su costo con valor comercial propio (DT-1 ya sirve a cobranza y pérdidas aparentes sin un solo sensor nuevo). El export EPANET es deliberadamente el hito de transición: es barato (formato abierto, datos ya en el canónico) y convierte a Hydra en insumo directo del área técnica/proyectos (Acueducto III, sectorización).

---

## 4. Secuencia de implementación propuesta

1. **Quick wins sin ML** (con réplicas de lectura, antes del pipeline): sugerencia de contrato en bandeja (§1.5, cascada determinística) y reglas de medidor parado/consumo cero (§1.1 nivel 1).
2. **Con kardex v1**: anomalías estadísticas + estimación de lecturas + RAG normativo + clasificación de quejas.
3. **Con 12+ meses de kardex histórico** (backfill desde Aquasis/SIGE): score de impago + forecasting.
4. **Con motor de KPIs y padrón GPS completo**: DT-1 y export EPANET.
5. **Con AMI**: analítica de curvas de carga y DT-3.

Cada modelo entra a producción con: versionado de datos y modelo, backtest documentado, métrica de negocio acordada con la CEA, y monitoreo de deriva.
