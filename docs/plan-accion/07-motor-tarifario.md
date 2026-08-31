# 07 — Unificación del motor tarifario

*Generado 2026-07-17. Problema real detectado en el repo: **hoy existen DOS motores tarifarios que pueden divergir**. Este documento diseña el motor único en backend, su modelo de datos con vigencias, la API de cálculo trazable, el soporte a la nueva Ley General de Aguas (DOF 11-dic-2025) y el plan de migración/deprecación del motor frontend.*

---

## 1. Estado actual: dos motores, cero fuente única de verdad

### Motor A — Frontend, JSON estático (el que se usa de verdad)

| Pieza | Contenido |
|---|---|
| `frontend/src/lib/tarifas.ts` + `src/data/tarifas-agua.json` | Cobro periódico. `tarifasAgua[admin][tipoTarifa] = { precios[0..200], precioBase200, precioM3Adicional, tasa }` — **tabla acumulada**: `precios[m]` es el cargo total para `m` m³ por unidad; >200 m³ aplica fórmula `consumo × precioM3Adicional × unidades + precioBase200`. Constantes hardcodeadas: `ALCANTARILLADO_RATE=0.10`, `SANEAMIENTO_RATE=0.12`, `RECARGO_MENSUAL=0.01470`. Redondeo CEA: fracción >0.50 sube, ≤0.50 baja. IVA por tarifa (`tasa` 0 ó 0.16). 13 administraciones × hasta 12 tipos. Snapshot **Feb-2026, sin vigencias**. |
| `frontend/src/lib/cotizacion-tarifas.ts` + `data/tarifas-contratacion.json` | Cargo único de contratación. Por admin: `longitud.agua/drenaje[{matCalle}-{matBanqueta}] = { precioBase, precioProporcional, tasa }` con fórmula `base + max(0, metros−6) × proporcional` (6 m incluidos); `medidor.instalacion[grupoDiametro]` y `medidorTipos[tipo_diam_plan]`. Contiene placeholders sospechosos (`precioBase: 0.01` en combos ADOQUIN-ADOQUIN / TERRACERÍA-EMPEDRADO). |
| Resolución de claves | **Fuzzy string matching** en 3 lugares: `resolveAdministracion()` (match parcial), `TIPO_CONTRATACION_TO_TARIFA` (mapa manual de nombres), `resolveMatCalle/Banqueta` (con fallbacks silenciosos a `CONCRETO`). Un tipo de contratación nuevo o renombrado cae en silencio a otra tarifa o a `null`. |

### Motor B — Backend, tablas Prisma (T14, incompleto)

`Tarifa` (codigo, tipoServicio `agua|saneamiento|alcantarillado`, tipoCalculo `escalonado|fijo|variable`, rangoMinM3/rangoMaxM3, precioUnitario, cuotaFija, ivaPct **default 16**, vigenciaDesde/Hasta, version) + `CorreccionTarifaria` + `AjusteTarifario` + `ActualizacionTarifaria`. Problemas:

1. **`Tarifa.tipoContratacionCodigo` es un string sin FK** a `TipoContratacion` (y `administracionId` tampoco tiene relación) — la misma fragilidad del fuzzy-match del frontend, ahora en la BD.
2. El shape "un renglón por rango" no puede representar la **tabla acumulada** publicada por la CEA (el precio por m³ no es lineal dentro de bloques: cada m³ tiene cargo propio).
3. `ivaPct default 16` contradice la regla real: **doméstico exento/tasa 0** (LIVA; el JSON sí lo modela con `tasa: 0`).
4. Alcantarillado (10%) y saneamiento (12%) no existen como componentes derivados: `tipoServicio` sugiere tarifas independientes, pero en la realidad CEA son **porcentajes sobre el cargo de agua** (Art. 154, Acuerdo de Precios).
5. Nadie factura con él: `POST /tarifas/calcular` (T14) existe como diseño, pero la cotización y la vista previa de facturación usan el motor A.

**Consecuencia**: cuando el Acuerdo de Precios 2027 actualice tarifas, alguien actualizará los CSVs del frontend o las tablas del backend — no ambos — y el simulador cotizará distinto de lo que facture el sistema. Eso es una divergencia de dinero, no de UI.

---

## 2. Diseño: modelo unificado en BD

Principios: (a) **una sola fuente de verdad en BD, versionada por Acuerdo de Precios**; (b) FKs reales, cero fuzzy matching; (c) el modelo representa fielmente lo que publica la CEA (tabla acumulada por m³ + fórmula de excedente), no una idealización de bloques; (d) los porcentajes legales (10%/12%/IVA) son **datos parametrizados con vigencia**, no constantes de código.

```prisma
// ---- El instrumento legal que da vigencia a todo ----
model AcuerdoTarifario {
  id               String    @id @default(cuid())
  nombre           String                       // "Acuerdo de Precios CEA 2026"
  fundamento       String                       // "Art. 154 Código Urbano / aprobación Consejo Directivo"
  fechaPublicacion DateTime  @map("fecha_publicacion")
  urlDocumento     String?   @map("url_documento") // PDF oficial (La Sombra de Arteaga)
  vigenciaDesde    DateTime  @map("vigencia_desde")
  vigenciaHasta    DateTime? @map("vigencia_hasta") // se cierra al publicar el siguiente
  estado           String    @default("borrador")  // borrador | publicado | superseded
  parametros       ParametroTarifario[]
  tarifasConsumo   TarifaConsumo[]
  productos        ProductoTarifario[]
  @@map("acuerdos_tarifarios")
}

// ---- Parámetros legales con vigencia (hoy hardcodeados en tarifas.ts) ----
model ParametroTarifario {
  id        String  @id @default(cuid())
  acuerdoId String  @map("acuerdo_id")
  clave     String                  // ALCANTARILLADO_PCT | SANEAMIENTO_PCT | RECARGO_MENSUAL_PCT | IVA_PCT | REDONDEO_REGLA | MINIMO_VITAL_M3_PERSONA_DIA
  valor     Decimal @db.Decimal(10, 6)  // 0.10 | 0.12 | 0.01470 | 0.16 | ...
  acuerdo   AcuerdoTarifario @relation(fields: [acuerdoId], references: [id])
  @@unique([acuerdoId, clave])
  @@map("parametros_tarifarios")
}

// ---- Las 11 clases CEA (Doméstica Apoyo/Económica/Media/Alta, Comercial, Industrial,
//      Público Oficial/Concesionado, Beneficencia, Doméstica Rural, Pecuaria) ----
model ClaseTarifaria {
  id          String  @id @default(cuid())
  codigo      String  @unique          // DOM_APOYO | DOM_ECO | DOM_MEDIA | DOM_ALTA | COMERCIAL | INDUSTRIAL | PUB_OFICIAL | PUB_CONCESIONADO | BENEFICENCIA | DOM_RURAL | PECUARIA (+ especiales: HIDRANTE, SANTA_MARIA_MAGDALENA)
  nombre      String
  esDomestica Boolean @map("es_domestica")  // ⇒ IVA tasa 0 (LIVA) Y protección mínimo vital (LGA 2025)
  aplicaIva   Boolean @map("aplica_iva")    // regla Art. 154: IVA solo no doméstico
  activo      Boolean @default(true)
  tarifasConsumo TarifaConsumo[]
  tiposContratacion TipoContratacion[]      // FK REAL: TipoContratacion.claseTarifariaId
  @@map("clases_tarifarias")
}
// En TipoContratacion se AÑADE:  claseTarifariaId String? @map("clase_tarifaria_id")
// — mata TIPO_CONTRATACION_TO_TARIFA (el mapa fuzzy) y Tarifa.tipoContratacionCodigo.

// ---- Tarifa de consumo periódico: clase × administración, con vigencia por acuerdo ----
model TarifaConsumo {
  id               String   @id @default(cuid())
  acuerdoId        String   @map("acuerdo_id")
  claseId          String   @map("clase_id")
  administracionId String   @map("administracion_id")   // FK REAL a Administracion
  cargoFijoMinimo  Decimal  @map("cargo_fijo_minimo") @db.Decimal(12, 5) // = precios[0]: cargo aun con consumo 0
  limiteTabla      Int      @default(200) @map("limite_tabla")
  precioBaseExced  Decimal  @map("precio_base_excedente") @db.Decimal(12, 5) // precioBase200
  precioM3Exced    Decimal  @map("precio_m3_excedente") @db.Decimal(12, 5)   // precioM3Adicional
  acuerdo          AcuerdoTarifario @relation(fields: [acuerdoId], references: [id])
  clase            ClaseTarifaria   @relation(fields: [claseId], references: [id])
  administracion   Administracion   @relation(fields: [administracionId], references: [id])
  renglones        TarifaConsumoM3[]
  @@unique([acuerdoId, claseId, administracionId])
  @@map("tarifas_consumo")
}

// ---- La tabla acumulada publicada: un renglón por m³ (0..200) ----
model TarifaConsumoM3 {
  tarifaConsumoId String  @map("tarifa_consumo_id")
  m3              Int                      // 0..limiteTabla
  cargoAcumulado  Decimal @map("cargo_acumulado") @db.Decimal(12, 5) // total agua para ese consumo/unidad
  tarifaConsumo   TarifaConsumo @relation(fields: [tarifaConsumoId], references: [id], onDelete: Cascade)
  @@id([tarifaConsumoId, m3])
  @@map("tarifas_consumo_m3")
}
// Volumetría: 13 admins × ~12 clases × 201 renglones ≈ 31k filas/acuerdo. Trivial.
// La vista `tarifa_bloques` deriva el precio marginal (cargoAcumulado[m]−cargoAcumulado[m−1])
// para la UI de "escalonamiento visual" de T14 y para la expectativa T15.T3 (rangos sin huecos
// == exactamente 201 renglones consecutivos por tarifa: check trivial).

// ---- Productos: cargos únicos (contratación, medidor, varios) ----
model ProductoTarifario {
  id               String   @id @default(cuid())
  acuerdoId        String   @map("acuerdo_id")
  administracionId String   @map("administracion_id")
  tipo             String                    // CONEXION_AGUA | CONEXION_DRENAJE | INSTALACION_MEDIDOR | MEDIDOR | CONCEPTO_FIJO (inspección, factibilidad, reconexión…)
  // Selectores tipados (matan resolveMatCalle/buildTarifaKey):
  materialCalleId    String? @map("material_calle_id")    // FK a CatalogoMaterial (nuevo, seed: CONCRETO, ASFALTO, ADOQUIN, ADOCRETO, EMPEDRADO, LOSA, TERRACERIA, CANTERA)
  materialBanquetaId String? @map("material_banqueta_id")
  grupoDiametro      String? @map("grupo_diametro")       // '1/2-3/4-1' | '2' | '3' | '4'
  planPago           String? @map("plan_pago")            // contado | financiado (medidorTipos)
  conceptoCobroId    String? @map("concepto_cobro_id")    // liga con ConceptoCobro existente
  // Fórmula: precioBase + max(0, cantidad − cantidadIncluida) × precioProporcional
  precioBase         Decimal @map("precio_base") @db.Decimal(12, 5)
  precioProporcional Decimal @default(0) @map("precio_proporcional") @db.Decimal(12, 5)
  cantidadIncluida   Decimal @default(0) @map("cantidad_incluida") @db.Decimal(10, 2) // 6 m en conexiones
  aplicaIva          Boolean @default(true) @map("aplica_iva")  // productos SÍ llevan IVA aun en doméstico
  acuerdo            AcuerdoTarifario @relation(fields: [acuerdoId], references: [id])
  @@index([acuerdoId, administracionId, tipo])
  @@map("productos_tarifarios")
}
```

Se **conservan** `CorreccionTarifaria` (correctores: recargos, bonificaciones, descuentos — se le añade FK real y liga a `ClaseTarifaria` o `TarifaConsumo`), `AjusteTarifario` (ajuste manual con aprobación — sigue tal cual, es por contrato/periodo) y `ActualizacionTarifaria` (bitácora de aplicación de un `AcuerdoTarifario`: pasa a referenciarlo por FK). El modelo `Tarifa` actual queda **deprecado** (ver §6).

---

## 3. API de cálculo única — el frontend consume, no calcula

`backend/src/modules/tarifas/motor-tarifario.service.ts`. Todo cálculo queda **persistido y trazable**: la línea de un recibo, una cotización o el simulador referencian un `CalculoTarifario.id`, y el kardex (doc 05) lo lleva en `fuenteRef.calculoId`.

```prisma
model CalculoTarifario {
  id          String   @id @default(cuid())
  tipo        String                    // consumo_periodo | cotizacion_contratacion | simulacion
  contratoId  String?  @map("contrato_id")
  entrada     Json                      // inputs completos: {m3Total, unidades, claseId, administracionId, fecha, variables}
  acuerdoId   String   @map("acuerdo_id")        // QUÉ acuerdo/versión aplicó
  desglose    Json                      // líneas: [{concepto, base, m3Desde, m3Hasta, renglonAplicado, parametro, importe}]
  subtotal    Decimal  @db.Decimal(12, 2)
  iva         Decimal  @db.Decimal(12, 2)
  total       Decimal  @db.Decimal(12, 2)
  createdAt   DateTime @default(now()) @map("created_at")
  @@index([contratoId])
  @@map("calculos_tarifarios")
}
```

### Algoritmo `POST /tarifas/calcular-consumo`

```
entrada: { contratoId | (claseId, administracionId), m3Total, unidades=1, fecha, periodoMeses=1 }

1. Resolver acuerdo vigente a `fecha` (vigenciaDesde <= fecha < vigenciaHasta). ERROR si no hay — nunca fallback silencioso.
2. Resolver TarifaConsumo por (acuerdo, clase del contrato vía TipoContratacion.claseTarifariaId, administración). ERROR si no existe.
3. consumoPorUnidad = redondeoCEA(m3Total / unidades)        [regla parametrizada REDONDEO_REGLA]
4. agua = consumoPorUnidad <= limiteTabla
          ? renglon(consumoPorUnidad).cargoAcumulado × unidades
          : consumoPorUnidad × precioM3Exced × unidades + precioBaseExced
5. alcantarillado = agua × param(ALCANTARILLADO_PCT)          [si el contrato tiene el servicio]
   saneamiento    = agua × param(SANEAMIENTO_PCT)             [ídem]
6. iva = clase.aplicaIva ? (agua × param(IVA_PCT)) : 0        [Art. 154: solo no doméstico; alcant./san. sin IVA — regla actual del JSON, confirmable por acuerdo]
7. correctores activos (CorreccionTarifaria) en orden declarado; cada uno emite línea de desglose.
8. Persistir CalculoTarifario con desglose línea a línea:
   { concepto:'AGUA', renglonAplicado:{tarifaConsumoId, m3:18, cargoAcumulado:…}, importe }
   { concepto:'ALCANTARILLADO', parametro:{clave:'ALCANTARILLADO_PCT', valor:0.10, acuerdoId}, importe } …
9. Responder { calculoId, subtotal, iva, total, desglose, acuerdo:{id,nombre,vigenciaDesde} }
```

### `POST /tarifas/calcular-cotizacion`

Mismo patrón para productos: entrada `{administracionId, items:[{tipo:'CONEXION_AGUA', materialCalleId, materialBanquetaId, cantidad: mlToma}, {tipo:'INSTALACION_MEDIDOR', grupoDiametro}, …]}` → cada ítem resuelve su `ProductoTarifario` vigente y emite línea con la fórmula `base + max(0, cantidad − incluida) × proporcional`. Sustituye a `calcularDerechosAgua/Drenaje/InstalacionMedidor` de `cotizacion-tarifas.ts`.

Endpoints restantes (T14 se respeta): `GET /tarifas/vigentes?fecha=`, `POST /tarifas/validar-asignacion` (ahora es un JOIN por FKs, no matching), `POST /acuerdos-tarifarios` + `POST /acuerdos-tarifarios/:id/publicar` (cierra vigencia del anterior, dispara `ActualizacionTarifaria`), `POST /acuerdos-tarifarios/:id/clonar?incremento=X%` (la "actualización trimestral/anual" de T14: clona renglones con incremento, queda en borrador para revisión y preview).

---

## 4. Reglas de calidad del propio motor (se integran al catálogo del doc 05)

- `T15.T1/T2`: acuerdos sin traslape de vigencias (constraint + expectativa FAIL).
- `T15.T3`: cada `TarifaConsumo` tiene exactamente los renglones 0..limiteTabla consecutivos y `cargoAcumulado` **monotónico no decreciente** (detecta typos de captura del Acuerdo) — FAIL.
- `T15.T4/CC1`: todo contrato activo resuelve clase+administración+acuerdo vigente — WARN en padrón, FAIL como pre-condición de facturación masiva.
- `tarifa.paridad-legacy` (temporal, durante la transición): el resultado del motor DB == motor JSON para el universo completo (ver §6.2) — FAIL.
- `tarifa.placeholders`: ningún `precioBase <= 0.01` en productos publicados (los combos ADOQUIN-ADOQUIN hoy en el JSON) — WARN hasta aclarar con la CEA si es dato real o hueco.

---

## 5. Regla nueva: Ley General de Aguas (DOF 11-dic-2025) — mínimo vital y "restricción"

La LGA prohíbe la **suspensión total** del servicio doméstico por adeudo: procede solo la **restricción al mínimo vital**. Impacto en el motor y su periferia:

1. **Estado de suministro de primera clase**: `Contrato.estadoSuministro` (nuevo campo o catálogo): `NORMAL | RESTRINGIDO | SUSPENDIDO`. `SUSPENDIDO` es ilegal para clases con `esDomestica=true` — validación dura en el servicio de órdenes.
2. **Guard en órdenes de corte**: al crear `Orden{tipo:CORTE}`, si la clase tarifaria del contrato es doméstica ⇒ solo se permiten `subtipoCorte` con `catalogo_tipos_corte.impacto = 'restriccion_parcial'` (el catálogo ya contempla ese valor — se explota, no se inventa). El intento de suspensión total se rechaza con referencia normativa.
3. **Facturación bajo restricción**: parámetro `MINIMO_VITAL_M3_PERSONA_DIA` en `ParametroTarifario` (valor conforme al reglamento de la LGA cuando se publique; provisional ~50 L/persona/día × `personasHabitanVivienda` del contrato). El motor expone `calcular-consumo` con flag `regimen: 'restringido'`: el consumo dentro del mínimo vital se factura al primer renglón de la clase (o a la regla que fije el reglamento — parametrizado, no cableado).
4. **Kardex**: la ejecución de restricción/levantamiento emite eventos `RESTRICCION`/`RECONEXION` (doc 05 §3.1), y el KPI K05 (doc 06) desglosa restricción vs suspensión — evidencia de cumplimiento ante el regulador.
5. **Convenios**: la restricción convive con `Convenio` (origenTipo `corte`): reconexión a flujo normal al firmar convenio es una regla de negocio configurable del módulo de órdenes, no del motor tarifario.

---

## 6. Plan de migración y deprecación del motor frontend

### 6.1 Carga inicial (los JSON son el seed, vía pipeline)

Los JSON actuales se generaron de los CSV/XLSX oficiales Feb-2026 (`build-tarifas-json.cjs`, `build-cotizacion-json.cjs`). Migración = conector `tarifas-cea` del pipeline (doc 05): staging del JSON crudo → normalizador → `AcuerdoTarifario{nombre:'Acuerdo de Precios 31-01-2026', vigenciaDesde:2026-02-01}` + 11+ clases + ~31k renglones + productos + parámetros (0.10/0.12/0.01470/0.16). Gate: expectativas T3 (monotonicidad) y conteos de control (13 admins × clases esperadas). Los placeholders `0.01` entran marcados y generan el WARN de §4.

### 6.2 Paridad (el test sagrado, análogo a la conciliación al centavo de catastro)

Script `scripts/paridad-tarifas.ts`: para **todas** las combinaciones (admin × clase × m³ 0..250 × unidades {1,2,4}) compara `calcularCargoPeriodo()` (motor A) vs `POST /tarifas/calcular-consumo` (motor nuevo) — diferencia exigida: $0.00 (misma aritmética decimal; definir redondeo a 2 decimales en un solo lugar). Ídem cotización: todos los combos material × longitudes {3,6,10,25} × diámetros. **El motor nuevo no se activa hasta paridad 100% o diffs explicados y aceptados por la CEA.**

### 6.3 Corte por consumidor (strangler)

| Consumidor hoy | Cambio |
|---|---|
| `PasoFacturacion` (vista previa wizard) | usa `POST /tarifas/calcular-consumo` (muestra el desglose que responde la API) |
| Cotización (`Solicitudes.tsx` → `calcularCotizacionDesdeCuantificacion`, `cotizacion.ts`, PDFs) | usa `POST /tarifas/calcular-cotizacion`; el PDF imprime `calculoId` (folio trazable de la cotización) |
| Simulador (`Simulador.tsx`, hoy stub) | **se construye directo contra la API** — nunca conoce el JSON |
| `billing-engine` del backend (384 líneas en contratos) | se refactoriza para delegar en `MotorTarifarioService` — un solo camino de cálculo también dentro del backend |

### 6.4 Deprecación

1. `lib/tarifas.ts` y `lib/cotizacion-tarifas.ts` se reducen a re-exports de tipos + cliente de la API; los JSON se eliminan del bundle (≈ cientos de KB menos).
2. ESLint rule/CI: prohibido importar `@/data/tarifas-*.json` fuera del script de paridad.
3. La expectativa `tarifa.paridad-legacy` corre en CI hasta borrar los JSON; después se elimina.
4. `Tarifa`/`tipoContratacionCodigo` (modelo T14 actual): se migran las filas existentes si las hay, se marca `@deprecated` en el schema un release, y se dropea en el siguiente.
5. Actualizar `docs/motor-tarifas.md` → apuntar a este diseño; las "tareas pendientes" de ese doc (incrementales automáticos, modificaciones masivas, vigencias, backend con tablas) quedan resueltas por §2-§3.

### 6.5 Operación anual (el ciclo real)

Cada enero: `POST /acuerdos-tarifarios/:id/clonar?incremento=inflacionario` → captura/ajuste de renglones contra el PDF oficial → expectativas T3 + diff vs año anterior (preview de T14: tarifa actual vs nueva) → aprobación → `publicar` (cierra vigencia 2026, abre 2027) → `ActualizacionTarifaria` registra quién/cuándo/fuenteOficial. Ningún deploy, ningún CSV, ningún JSON.
