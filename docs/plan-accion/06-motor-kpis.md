# 06 — Diseño del motor de KPIs de Hydra

*Generado 2026-07-17. Se apoya en `02-benchmark-internacional-swan.md` (IWA PI, balance AWWA/IWA, IBNET, data confidence grading) y `03-ecosistema-nacional-mx.md` (PIGOO/IMTA, CEA Querétaro). Es el consumidor principal de la capa de derivados del pipeline (doc 05). El "motor de KPIs con definiciones estándar" fue identificado en el benchmark como la mayor oportunidad diferencial del producto.*

---

## 1. Principios de arquitectura

1. **Los KPIs se calculan exclusivamente de los derivados del pipeline (doc 05), nunca de queries ad-hoc sobre tablas transaccionales.** Un KPI es una función pura sobre `kardex_comercial`, `derivado_saldo_contrato`, `derivado_cartera_antiguedad` y agregados de lecturas/órdenes/quejas ya materializados. Esto garantiza: (a) reproducibilidad — el mismo periodo da el mismo número siempre; (b) linaje — cada valor sabe de qué run salió; (c) desempeño — el dashboard nunca escanea `pagos` en vivo.
2. **Definición versionada**: cambiar una fórmula NO reescribe historia. Cada valor calculado apunta a la versión de definición con la que se calculó (patrón `SEMANTIC_VERSION` de catastro: bump ⇒ recomputar solo ese derivado).
3. **Cada celda de dato lleva grado de confianza** (data confidence grading del IWA PI / AWWA Free Water Audit v6): un KPI con insumos estimados se reporta, pero degradado.
4. **Estándares primero**: cada KPI declara su mapeo PIGOO/IBNET/IWA para que el reporteo regulatorio sea un export, no un proyecto.

---

## 2. Modelos Prisma esbozados

```prisma
// ---- Catálogo versionado de definiciones ----
model KpiDefinicion {
  id           String   @id                    // 'eficiencia_comercial'
  version      Int                             // semántica: bump ⇒ recomputa desde vigencia
  nombre       String
  categoria    String                          // comercial | fisica | medicion | cobranza | servicio | perdidas
  unidad       String                          // % | dias | m3 | eventos/1000 tomas | adimensional
  formula      String   @db.Text               // expresión documentada (numerador/denominador)
  insumos      Json                            // datasets derivados que consume + campos
  granularidad Json                            // ['global','administracion','zona','sector_hidraulico']
  frecuencia   String                          // mensual | trimestral | anual
  mapeoPigoo   String?  @map("mapeo_pigoo")    // indicador PIGOO equivalente
  mapeoIbnet   String?  @map("mapeo_ibnet")    // código IBNET
  mapeoIwa     String?  @map("mapeo_iwa")      // código IWA PI (Alegre et al.)
  metaObjetivo Decimal? @map("meta_objetivo") @db.Decimal(12, 4)
  requiereDatoExterno Boolean @default(false) @map("requiere_dato_externo") // p.ej. macromedición
  vigenteDesde DateTime @map("vigente_desde")
  vigenteHasta DateTime? @map("vigente_hasta")
  @@unique([id, version])
  @@map("kpi_definiciones")
}

// ---- Valores calculados (append-only; recálculo = nueva fila, la anterior se marca) ----
model KpiValor {
  id            BigInt   @id @default(autoincrement())
  kpiId         String   @map("kpi_id")
  kpiVersion    Int      @map("kpi_version")
  periodo       String                          // 'AAAA-MM' | 'AAAA-Qn' | 'AAAA'
  dimension     String   @default("global")     // global | administracion | zona | sector_hidraulico
  dimensionId   String?  @map("dimension_id")
  valor         Decimal  @db.Decimal(16, 4)
  numerador     Decimal? @db.Decimal(16, 4)     // trazabilidad del cociente
  denominador   Decimal? @db.Decimal(16, 4)
  confianza     String                          // A1..D4 (matriz IWA: fuente A-D × precisión 1-4)
  detalle       Json?                           // desglose de insumos y exclusiones aplicadas
  runId         String?  @map("run_id")         // SyncRun/corrida de derivación que lo produjo (linaje)
  vigente       Boolean  @default(true)         // false cuando un recálculo lo supersede
  calculadoAt   DateTime @default(now()) @map("calculado_at")
  @@index([kpiId, periodo, dimension, dimensionId])
  @@map("kpi_valores")
}

// ---- Datos externos manuales (macromedición, costos, personal) con captura auditada ----
model DatoOperativoExterno {
  id          String   @id @default(cuid())
  concepto    String                            // 'volumen_producido' | 'volumen_entregado_sector' | 'empleados' | ...
  periodo     String
  dimension   String   @default("global")
  dimensionId String?  @map("dimension_id")
  valor       Decimal  @db.Decimal(16, 4)
  unidad      String                            // m3 | personas | MXN
  confianza   String                            // grading declarado por quien captura
  fuente      String                            // 'SCADA' | 'aforo manual' | 'estimacion' | 'CEA-oficio-123'
  capturadoPor String  @map("capturado_por")
  createdAt   DateTime @default(now()) @map("created_at")
  @@unique([concepto, periodo, dimension, dimensionId])
  @@map("datos_operativos_externos")
}
```

El motor (`backend/src/modules/kpis/`) es un builder de derivados más del pipeline: `calcularKpisPeriodo(periodo)` corre tras el cierre del periodo, lee derivados publicados, escribe `KpiValor`, registra linaje. El catálogo de fórmulas vive como módulos TS (`kpis/catalogo/*.ts`) igual que las expectativas — `KpiDefinicion` es el espejo persistido/versionado para UI y auditoría.

---

## 3. Catálogo de KPIs (definición, fórmula exacta, fuentes en el modelo Hydra)

Convención: los insumos citan tabla Prisma (`@@map`) o derivado del doc 05. "Periodo" = mes calendario salvo nota.

### 3.1 Comerciales

| # | KPI | Fórmula exacta | Insumos (tablas Prisma / derivados) |
|---|---|---|---|
| K01 | **Eficiencia comercial** | `Σ recaudado del periodo / Σ facturado del periodo × 100`. Recaudado = eventos `PAGO` del kardex con `fecha` en el periodo (fecha REAL de pago, incluye `pagos` de caja y `pagos_externos` conciliados). Facturado = eventos `CARGO{agua+alcantarillado+saneamiento+iva}` del periodo (espejo de `timbrados.subtotal+iva`). Variante "cobranza sobre lo facturado del propio periodo" se publica como K01b (cohorte). | `kardex_comercial`; conciliación contra `pagos`, `pagos_externos`, `timbrados` |
| K02 | **Periodo medio de cobranza (días)** | `Σ (fecha_pago − fecha_emision) ponderada por monto, para CARGOs saldados en la ventana / Σ montos` — sobre cohortes de facturación; los no pagados se censuran al cierre. Aproximación simple publicable: `(cartera total / facturación promedio diaria)` (DSO). | `kardex_comercial` (pareo CARGO↔PAGO por contrato+periodo), `timbrados.fecha_emision` |
| K03 | **Cartera vencida (%)** | `Σ saldo vencido / Σ facturación últimos 12 meses × 100` | `derivado_saldo_contrato`, `kardex_comercial` |
| K04 | **Antigüedad de cartera** | Distribución del saldo vencido en buckets `0-30 / 31-60 / 61-90 / 91-180 / 180+` días desde `fecha_vencimiento` | `derivado_cartera_antiguedad` (del kardex + `recibos.fecha_vencimiento`) |
| K05 | **Tasa de corte** | `# órdenes de corte ejecutadas en el periodo / # contratos activos × 1000`. Se desglosa por `subtipo`: `restriccion_parcial` vs `suspension_total` (obligatorio post-LGA 2025, ver doc 07 §5) | `ordenes` (tipo=CORTE, fechaEjecucion) + `catalogo_tipos_corte.impacto`; eventos `CORTE`/`RESTRICCION` del kardex |
| K06 | **Tasa de reconexión y tiempo medio de reconexión** | `# reconexiones / # cortes × 100`; `mediana(fecha_reconexion − fecha_corte)` en horas | `ordenes` (tipo=RECONEXION) pareadas por contrato; eventos kardex |
| K07 | **Convenios: cumplimiento** | `Σ montoPagado / Σ montoTotal de convenios activos×100`; % convenios incumplidos | `convenios` (montoPagado, montoTotal, estado); eventos `CONVENIO` |

### 3.2 Medición y facturación

| # | KPI | Fórmula exacta | Insumos |
|---|---|---|---|
| K08 | **% micromedición** | `# contratos activos con medidor funcionando / # contratos activos × 100`. "Funcionando" = `medidores.estado='Activo'` y con lectura real en los últimos 2 periodos | `contratos`, `medidores`, `lecturas` |
| K09 | **% lecturas reales vs estimadas** | `# lecturas con esEstimada=false y estado válido / # lecturas del periodo × 100`. Complemento: % estimadas por incidencia (avería vs no-acceso, vía `catalogo_incidencias.esAveria`) | `lecturas` (esEstimada, incidenciaId, periodo), `lotes_lecturas` |
| K10 | **% consumos facturados por tipo** | Distribución de `consumos.tipo` (Real / Promedio histórico / Mixto / Consumo fijo) sobre el total del periodo | `consumos` |
| K11 | **Consumo medio doméstico (m³/toma/mes)** | `Σ m3 de contratos clase doméstica / # contratos domésticos` — por clase tarifaria y por administración | `consumos`, `contratos.tipoContratacionId` → clase (doc 07) |
| K12 | **Efectividad de timbrado CFDI** | `# timbrados estado='Timbrada OK' / # intentos × 100`; reintentos y errores PAC | `timbrados` (estado, error) |

### 3.3 Servicio al usuario

| # | KPI | Fórmula exacta | Insumos |
|---|---|---|---|
| K13 | **Quejas por mil tomas** | `# quejas_aclaraciones[tipo='Queja'] abiertas en el periodo / # contratos activos × 1000`; desglose por categoría y canal | `quejas_aclaraciones`, `contratos` |
| K14 | **Tiempo medio de resolución de quejas/trámites** | `mediana(updatedAt del cierre − fecha)` por tipo | `quejas_aclaraciones` + `seguimientos_queja`; `tramites` |
| K15 | **Órdenes atendidas en plazo** | `# órdenes con fechaEjecucion ≤ fechaProgramada / # ejecutadas × 100` por tipo | `ordenes` |

### 3.4 Pérdidas (requieren macromedición — **dato a solicitar a la CEA**)

Estos KPIs se declaran en el catálogo desde el día 1 con `requiereDatoExterno=true`; se publican en cuanto exista `DatoOperativoExterno{volumen_producido}` por sistema y `volumen_entregado_sector` por `SectorHidraulico`. Hoy Hydra tiene el lado del consumo (facturación); el lado de producción/entrega viene de macromedidores/SCADA que no están en el sistema comercial.

| # | KPI | Fórmula exacta | Insumos |
|---|---|---|---|
| K16 | **Eficiencia física** | `Σ volumen facturado (m³) / Σ volumen producido (m³) × 100` | `consumos` (m3 del periodo) + `DatoOperativoExterno{volumen_producido}` ⚠️ **solicitar: macromedición por fuente de abastecimiento/pozo (REPDA) y por entrada de sector** |
| K17 | **Eficiencia global** | `Eficiencia física × Eficiencia comercial / 100` (definición PIGOO) | K16 × K01 |
| K18 | **NRW (agua no facturada)** | `(volumen suministrado − consumo autorizado facturado) / volumen suministrado × 100` — por sistema y por `SectorHidraulico` | balance hídrico (§4) |
| K19 | **ILI (Infrastructure Leakage Index)** | `CARL / UARL`, con `UARL = (18 × Lm + 0.8 × Nc + 25 × Lp) × P` (L/día; Lm=km de red, Nc=# tomas, Lp=km de ramal, P=presión media m). CARL = pérdidas reales del balance | balance §4 + ⚠️ **solicitar: longitud de red por sector (GIS `dwh-publicado`), presión media (telemetría/SCADA), # tomas por sector** (`puntos_servicio` georreferenciados × `sectores_hidraulicos`) |
| K20 | **Pérdidas aparentes** | `submedición estimada + consumo no autorizado + errores de manejo de datos` (m³) — cada término con su método de estimación documentado en `detalle` | balance §4; submedición estimada del parque de medidores (`medidores.fechaInstalacion` → curva de degradación); anomalías del `derivado_perfil_consumo` |

**Nota de granularidad**: NRW/ILI *por sector hidráulico* exige que cada `PuntoServicio` esté asignado a un `SectorHidraulico` (hoy el modelo existe pero no hay FK punto→sector — añadir `sectorHidraulicoId` a `PuntoServicio` es prerequisito) y que cada sector tenga macromedidor de entrada. Marcar ambos como datos/obras a solicitar.

---

## 4. Balance hídrico IWA/AWWA como estructura de datos

El balance no es un reporte: es una estructura persistida que se autollena desde facturación y se completa con datos externos, celda por celda, con grado de confianza (compatible con AWWA Free Water Audit v6 y M36).

```prisma
model BalanceHidrico {
  id          String   @id @default(cuid())
  periodo     String                             // 'AAAA' o 'AAAA-MM' rodante
  dimension   String   @default("global")        // global | sector_hidraulico
  dimensionId String?  @map("dimension_id")
  estado      String   @default("borrador")      // borrador | publicado
  createdAt   DateTime @default(now()) @map("created_at")
  celdas      BalanceHidricoCelda[]
  @@unique([periodo, dimension, dimensionId])
  @@map("balances_hidricos")
}

model BalanceHidricoCelda {
  id         String  @id @default(cuid())
  balanceId  String  @map("balance_id")
  celda      String  // jerarquía IWA:
                     // SUMINISTRO
                     //  ├ CONSUMO_AUTORIZADO
                     //  │   ├ FACTURADO_MEDIDO | FACTURADO_NO_MEDIDO
                     //  │   └ NO_FACTURADO_MEDIDO | NO_FACTURADO_NO_MEDIDO
                     //  └ PERDIDAS
                     //      ├ APARENTES { CONSUMO_NO_AUTORIZADO, SUBMEDICION, ERRORES_DATOS }
                     //      └ REALES   { FUGAS_RED, FUGAS_TANQUES, FUGAS_RAMALES }
  volumenM3  Decimal @db.Decimal(16, 2)
  metodo     String  // 'derivado:consumos' | 'dato_externo' | 'estimacion_default' | 'residual'
  confianza  String  // grading IWA/AWWA por CELDA: A1..D4 (A=medido calibrado … D=estimación gruesa)
  fuenteRef  Json?   @map("fuente_ref")   // linaje: derivado/run o DatoOperativoExterno.id
  balance    BalanceHidrico @relation(fields: [balanceId], references: [id], onDelete: Cascade)
  @@unique([balanceId, celda])
  @@map("balance_hidrico_celdas")
}
```

Autollenado: `FACTURADO_MEDIDO` = Σ `consumos` con lectura real; `FACTURADO_NO_MEDIDO` = Σ consumos tipo fijo/promedio; `NO_FACTURADO_*` (hidrantes, usos oficiales exentos) desde contratos con `indicadorExentarFacturacion`; `SUMINISTRO` desde `DatoOperativoExterno`; `PERDIDAS` como residual con confianza heredada de la peor celda insumo. La invariante contable (Σ hijos == padre) es una expectativa FAIL del pipeline.

---

## 5. Mapeo a PIGOO e IBNET para reporteo automático

Objetivo: que el reporte anual PIGOO (IMTA) y el cuestionario IBNET salgan de `KpiValor` con un export, sin recaptura. El mapeo se guarda en `KpiDefinicion.mapeoPigoo/mapeoIbnet`.

| KPI Hydra | Indicador PIGOO (pigoo.imta.gob.mx) | IBNET | IWA PI |
|---|---|---|---|
| K01 Eficiencia comercial | **Eficiencia comercial** (IP.14, recaudado/facturado) | 23.2 Collection ratio (cash income/billed revenue) | Fi46/Fi47 |
| K16 Eficiencia física | Eficiencia física (facturado/producido) | 6.1 NRW (%) — inverso | Op23-27 (pérdidas) |
| K17 Eficiencia global | Eficiencia global | — (derivado) | — |
| K08 Micromedición | Cobertura de micromedición (tomas con medidor/total) | 7.1 Metering level | Op4 |
| K18 NRW | Agua no contabilizada | 6.1 (% del suministro), 6.2 (m³/km/día) | Fi36-37, Op24 |
| K19 ILI | — (no está en PIGOO; reportar como complemento) | — | Op29 / WBI bandas A-D |
| K11 Consumo medio | Dotación (l/hab/día — requiere población servida ⚠️ dato INEGI/censo) | 4.1 Water consumption | — |
| K13 Quejas/1000 tomas | Quejas (por mil tomas o mil usuarios) | 12.1 Complaints | QS26-28 |
| K02 Periodo medio cobranza | — | 23.1 Collection period (days) | Fi48 |
| — Empleados/1000 tomas | Empleados por cada mil tomas | 12.3 Staff/1000 connections | Pe1 | 

⚠️ **Acción previa al primer reporte**: confirmar los IDs numéricos exactos del portal PIGOO vigente (el portal renumera entre ediciones; IP.14 = eficiencia comercial está verificado en doc 03, el resto se valida al dar de alta el catálogo). El export PIGOO/IBNET es un endpoint `GET /kpis/export?formato=pigoo&anio=2026` que serializa los `KpiValor` anuales vigentes con su confianza.

---

## 6. Flujo de cálculo y API

```
cierre de periodo (facturación + conciliación de recaudación OK)
  → pipeline publica derivados (doc 05)
  → job kpis: calcularKpisPeriodo('2026-07')
      por cada KpiDefinicion vigente × granularidad declarada:
        leer insumos SOLO de derivados/datos externos publicados
        si requiereDatoExterno y falta el dato → KpiValor con valor NULL no se crea;
          se registra pendiente + alerta (nunca inventar denominadores)
        escribir KpiValor {numerador, denominador, confianza, runId}
  → expectativas post-cálculo: series sin saltos > 3σ (WARN), invariantes (K17 == K16×K01)
```

API: `GET /kpis` (catálogo + versión), `GET /kpis/:id/serie?dimension=&desde=&hasta=`, `GET /kpis/tablero?periodo=` (dashboard), `POST /kpis/recalcular {kpiId, desde}` (tras bump de versión — recalcula marcando `vigente=false` los valores anteriores, historia auditable), `GET /balance-hidrico/:periodo`, `POST /datos-operativos` (captura de macromedición con confianza obligatoria).

Frontend: página `Indicadores` con tablero por categoría, semáforo vs `metaObjetivo`, drill-down por administración/zona/sector, y la matriz del balance hídrico coloreada por grado de confianza (la visualización estándar AWWA).

---

## 7. Datos a solicitar a la CEA (bloqueantes de KPIs físicos)

1. **Macromedición**: volúmenes producidos por fuente/pozo (¿existe SCADA/telemetría en captaciones? ¿bitácoras de aforo?) y por entrada de sector hidráulico. Sin esto: K16-K20 no publican.
2. **Sectorización**: catálogo real de sectores hidráulicos con su polígono (GIS `DWH_publicado`/`MGR_SIGEM` — token pendiente) y asignación punto de servicio→sector.
3. **Red**: longitud de tubería por sector y presión media de operación (para UARL/ILI).
4. **Población servida** por administración (para dotación PIGOO) — derivable de censo INEGI por AGEB + padrón georreferenciado.
5. **Histórico PIGOO de la CEA** (si ha reportado): para baseline y validación de las fórmulas contra lo ya publicado.
