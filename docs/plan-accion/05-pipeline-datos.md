# 05 — Diseño del pipeline de datos de Hydra

*Generado 2026-07-17. Adapta a Hydra el patrón probado en Katastik/catastro (`~/catastro/docs/motor-normalizacion/`: plan maestro, diseño core R1-R2, diseño governance R3-R7). Materializa la Tarea 15 (`Tareas/15-reglas-calidad-migracion.md`) como gate de migración.*

---

## 0. Principio rector (heredado de Katastik)

**No importa de dónde venga el dato — se normaliza a tablas canónicas a través de un único camino auditable.** El patrón validado en catastro (58k predios, conciliación al centavo contra 820k pagos) se traslada a Hydra con una diferencia de escala y de dominio: aquí el "predio" es el **contrato/toma**, el "kardex predial" es el **ledger de eventos comerciales**, y las fuentes no son 2 sino al menos 7.

Reglas no negociables que se heredan tal cual:

1. **Staging es append-only y nunca se borra.** Un run fallido no publica; sus filas quedan invisibles para el resto del pipeline.
2. **El canónico solo se escribe desde normalizadores**, nunca desde endpoints ad-hoc.
3. **El ledger de eventos comerciales es append-only**: las correcciones son eventos `AJUSTE`, jamás UPDATE/DELETE.
4. **Nada se publica sin pasar expectativas declarativas** (el gate de la Tarea 15).
5. **Conciliación de dinero al centavo** con delta esperado *enumerado* (nunca "banda ciega").
6. **Credenciales por referencia**: la BD solo guarda *nombres* de variables de entorno, jamás secretos.

Lista "No incorporar" (también heredada): sin branching/lakeFS, sin stack Airbyte+Dagster+dbt, sin Great Expectations como dependencia — el catálogo de expectativas son módulos TypeScript propios, ligeros y testeables.

---

## 1. Arquitectura de capas

```
Fuentes (Aquasis, SIGE, 22 recaudadores, SAP, GIS, INEGI, telemetría)
      │  connector.sync() — el ÚNICO camino de entrada
      ▼
staging.*            JSONB crudo, append-only, run_id + contenido_hash
      │  normalizadores (schema-on-read → schema-on-write)
      ▼
canónico             modelos Prisma actuales, alineados al dominio `agua` de Callosum
      │  constructores de eventos
      ▼
kardex comercial     ledger append-only: CARGO/PAGO/AJUSTE/ESTIMACION/CONVENIO/CORTE por contrato
      │  builders de derivados (incrementales por watermark)
      ▼
derivados            read models: saldos, cartera por antigüedad, KPIs (doc 06), perfiles de consumo
```

**Relación con Callosum**: el canónico de Hydra ES la implementación física del dominio `agua` de Callosum (`specs/canonical/agua.yaml`). Los perfiles de fuente (`specs/sources/agua/aquasis.yaml`, `sige.yaml`, `recaudadores.yaml`, …) declaran los layouts; los normalizadores de este pipeline son la implementación runtime de esos mapeos bidireccionales. Cuando Callosum suba de versión el modelo canónico, se versiona la migración Prisma correspondiente (lección conocida: el store debe migrarse o el ingest truena).

---

## 2. Contrato de conector uniforme

Igual que en catastro (`apps/sync/src/connectors/contract.js`), pero en TypeScript/NestJS: `backend/src/pipeline/connectors/`.

```typescript
// backend/src/pipeline/connectors/contract.ts
export interface ConnectorDescriptor {
  id: string;                        // 'aquasis-lecturas' | 'recaudador-oxxo' | ...
  tipo: 'file' | 'postgres' | 'rest' | 'idoc' | 'arcgis';
  capacidades: {
    supportsIncremental: boolean;
    watermarkKind: 'archivo' | 'columna' | 'ninguno'; // archivos = watermark por nombre/hash de archivo
    bidireccional: boolean;         // Aquasis ida/vuelta, GIS export, SAP export
    explorable: boolean;
  };
  datasets: string[];               // datasets lógicos que emite
}

export interface Connector {
  descriptor: ConnectorDescriptor;
  explorar(ctx: Ctx): Promise<ExploracionResult>;   // READ-ONLY: esquema, volumetría, muestra. Nunca escribe canónico.
  sync(ctx: Ctx, opts: {
    modo: 'snapshot' | 'incremental';
    runId: string;
    watermark?: unknown;            // cursor opaco — cada conector es dueño de su shape (síntesis #2 de catastro)
    dryRun?: boolean;
  }): Promise<{ stats: SyncStats; tipoTransaccion: 'SNAPSHOT' | 'APPEND' | 'UPDATE'; nuevoWatermark?: unknown; filasStaging: number }>;
  frescura(ctx: Ctx): Promise<{ porDataset: FrescuraDataset[] }>;  // MAPA por dataset, no escalar
}
// ctx = { prisma, credencial, config, dryRun }
// Clasificador de errores de transporte pluggable (SFTP ≠ HTTP ≠ archivo corrupto).
```

Un `runner.ejecutarConnector(fuente, opts)` es el único orquestador: resolver credencial → `startRun` → leer watermark → `sync` → escribir linaje → **ejecutar expectativas** → `publishRun` | error sin publicar.

### 2.1 Los conectores concretos

| Conector | Tipo | Datasets | Modo | Watermark | Notas de ground truth |
|---|---|---|---|---|---|
| `aquasis-lecturas` | `file` (posicional ancho fijo, ~1,300 chars/línea) | `lecturas-salida` (0001M08L20), `lecturas-regreso` (0007AM1L44), `lectores` (Lectores.dat), `observaciones` (Observac.dat) | APPEND por lote | nombre + hash de archivo | **Bidireccional**: `sync` ingesta el archivo que emite Aquasis; `exportar()` (extensión del contrato para conectores bidireccionales) genera el archivo de regreso con el mismo layout. Ya existe parsing en T01 (`LoteLecturas`/`Lectura`) — se envuelve, no se reescribe (patrón retrofit de catastro). |
| `aquasis-padron` | `file`/`postgres` | `contratos`, `catalogos` (pobid/barrid ya migrados), `tarifas-legacy` | SNAPSHOT | hash-diff por fila | Fuente de la migración masiva del padrón. |
| `sige` | `postgres`/`file` | `contratos-sige`, `catalogos-actipol`, `crosswalk` | SNAPSHOT | hash-diff | La tabla puente `SigeHydra` (cnttnum, cnttrefant → contratoId) es el crosswalk oficial; el conector la puebla, no la inventa. |
| `recaudador-{oxxo,banorte,bbva,santander,citybanamex,hsbc,amex,elektra,soriana,…}` | `file` (~22 layouts: CSV, posicional, multi-segmento, delimitado) | `pagos-externos` | APPEND por archivo | nombre + hash de archivo | **Un solo conector genérico + 22 parsers registrados** (`parsers/oxxo.ts`, `parsers/banorte.ts`, …) que emiten el mismo shape estándar (layout interno `LAYOUTS_Pagos_20022026.xlsx`). Registrar un recaudador nuevo = un parser nuevo + una fila en `fuentes`, cero cambios al runner. |
| `sap-idoc` | `idoc` (posicional: `Interfaz_AquaCis_SAP_Cabecera`/`Posicion`) | `polizas-export`, `acuses` | export + APPEND | número de póliza | Bidireccional: exporta pólizas (T04) y opcionalmente ingesta acuses/errores SAP. |
| `gis-cea` | `arcgis` (REST `mapa.queretaro.gob.mx`) | `capas-publicas` (169 FeatureServer Hosted), `dwh-publicado` (requiere token — dato a solicitar) | SNAPSHOT | `editDate` de ArcGIS donde exista | Bidireccional: el CDC saliente ya existe (`CambioGIS`); ver §7. |
| `inegi` | `file` | `marco-geoestadistico`, `censo-ageb`, `sepomex` | SNAPSHOT anual | versión de publicación | Alimenta `Catalogo*INEGI`. Cadencia esperada: anual. |
| `telemetria` (futuro) | `rest`/mqtt (SensorThings API) | `lecturas-ami`, `alarmas` | streaming → micro-batch APPEND | timestamp de observación | Se declara HOY en el registro con `estado='experimental'` para que el contrato ya lo contemple (80 mil medidores nuevos en camino). Alta frecuencia: staging particionado por mes. |

---

## 3. Esquema del pipeline (modelos Prisma esbozados)

Migración 100% aditiva — no toca ningún modelo existente.

```prisma
// ---- Registro de fuentes (R1) ----
model Fuente {
  id             String   @id                    // 'aquasis-lecturas', 'recaudador-oxxo', ...
  tipo           String                          // file | postgres | rest | idoc | arcgis
  nombre         String
  config         Json     @default("{}")         // SIN secretos: rutas SFTP, layout id, url base
  credencialRef  Json?    @map("credencial_ref") // NOMBRES de env vars: {"SFTP":"AQUASIS_SFTP_URL"}
  capacidades    Json     @default("{}")
  frescuraPolicy Json     @default("{}") @map("frescura_policy") // cadencia esperada por dataset
  estado         String   @default("activa")     // activa | pausada | experimental
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")
  syncRuns       SyncRun[]
  watermarks     FuenteWatermark[]
  @@map("pipeline_fuentes")
}

// ---- Runs + publicación (R2) ----
model SyncRun {
  id              String    @id @default(cuid())
  fuenteId        String    @map("fuente_id")
  modo            String                          // snapshot | incremental | export
  tipoTransaccion String?   @map("tipo_transaccion") // SNAPSHOT | APPEND | UPDATE
  estado          String    @default("en_progreso") // en_progreso | ok | error | sospechosa
  publishedAt     DateTime? @map("published_at")  // NULL = staging de este run es invisible
  stats           Json?
  errorMsg        String?   @map("error_msg")
  inicio          DateTime  @default(now())
  fin             DateTime?
  fuente          Fuente    @relation(fields: [fuenteId], references: [id])
  staging         StagingRegistro[]
  linaje          Linaje[]
  expectativas    ExpectativaResultado[]
  @@index([fuenteId, inicio])
  @@map("pipeline_sync_runs")
}

model FuenteWatermark {
  fuenteId   String   @map("fuente_id")
  dataset    String
  watermark  Json                                 // cursor opaco (nombre+hash de archivo, editDate, etc.)
  ultimoRunId String? @map("ultimo_run_id")
  updatedAt  DateTime @updatedAt @map("updated_at")
  fuente     Fuente   @relation(fields: [fuenteId], references: [id])
  @@id([fuenteId, dataset])
  @@map("pipeline_fuente_watermarks")
}

// ---- Staging tipado append-only (R2) ----
model StagingRegistro {
  id            BigInt   @id @default(autoincrement())
  runId         String   @map("run_id")
  fuenteId      String   @map("fuente_id")
  dataset       String
  clave         String                            // clave natural de la fila en la fuente (contrato, referencia, línea)
  payload       Json                              // fila cruda completa; para archivos posicionales incluye {linea, numLinea, archivo}
  contenidoHash String   @map("contenido_hash")   // sha256 canónico → skip-unchanged + idempotencia
  fetchedAt     DateTime @default(now()) @map("fetched_at")
  run           SyncRun  @relation(fields: [runId], references: [id])
  @@index([fuenteId, dataset, clave, contenidoHash])
  @@index([runId])
  @@map("pipeline_staging")
}
// Vista `pipeline_staging_publicado`: JOIN sync_runs WHERE published_at IS NOT NULL.
// Los normalizadores SOLO leen la vista — la garantía R2 de catastro ("run fallido nunca
// es snapshot autoritativo") se obtiene por visibilidad, sin partition-promotion.

// ---- Linaje Foundry-lite (grano dataset) ----
model Linaje {
  id        BigInt   @id @default(autoincrement())
  runId     String   @map("run_id")
  rol       String                                // input | output
  dataset   String                                // 'staging:pagos-externos' | 'canonico:pagos' | 'kardex' | 'derivado:cartera'
  filas     Int
  createdAt DateTime @default(now()) @map("created_at")
  run       SyncRun  @relation(fields: [runId], references: [id])
  @@index([runId])
  @@map("pipeline_linaje")
}
// + constante estática LINAJE_DEPS en connectors/lineage.ts (dataset staging → tabla canónica → derivado)

// ---- Expectativas: solo RESULTADOS a tabla; el catálogo son módulos TS ----
model ExpectativaResultado {
  id          BigInt   @id @default(autoincrement())
  categoria   String                              // expectation | health
  checkId     String   @map("check_id")           // 'T15.C1', 'T15.CC4', 'dinero.recaudadores', ...
  onError     String   @map("on_error")           // FAIL | WARN
  ok          Boolean?                            // NULL = no evaluable
  valor       Json?                               // métricas: total, conProblema, pctCumplimiento, ejemplos[5]
  runId       String?  @map("run_id")
  createdAt   DateTime @default(now()) @map("created_at")
  run         SyncRun? @relation(fields: [runId], references: [id])
  @@index([checkId, createdAt(sort: Desc)])
  @@map("pipeline_checks_resultados")
}
```

### 3.1 Kardex — ledger de eventos comerciales

Es el equivalente Hydra del kardex fiscal de Katastik. **Todo lo que mueve el saldo de un contrato es un evento append-only**; el saldo es siempre reconstruible.

```prisma
model EventoComercial {
  id          BigInt   @id @default(autoincrement())
  contratoId  String   @map("contrato_id")
  tipo        String                        // CARGO | PAGO | AJUSTE | ESTIMACION | CONVENIO | CORTE | RECONEXION | RESTRICCION
  subtipo     String?                       // CARGO: agua|alcantarillado|saneamiento|iva|recargo|producto ; PAGO: caja|externo|domiciliacion ; CORTE: restriccion_parcial|suspension_total
  periodo     String?                       // 'AAAA-MM' cuando aplica
  monto       Decimal  @db.Decimal(14, 2)   // signo contable: CARGO +, PAGO −, AJUSTE ±
  fecha       DateTime                      // fecha REAL del hecho (p.ej. fecha en que el cliente pagó en OXXO)
  fuente      String                        // 'nativo:facturacion' | 'staging:recaudador-oxxo' | 'migracion:aquasis'
  fuenteRef   Json?    @map("fuente_ref")   // {stagingId, reciboId, timbradoId, pagoExternoId, ordenId, calculoId (doc 07)}
  eventoUid   String   @unique @map("evento_uid") // sha256 de tupla natural → dedup entre fuentes (patrón catastro)
  runId       String?  @map("run_id")
  createdAt   DateTime @default(now()) @map("created_at")
  @@index([contratoId, fecha])
  @@index([tipo, periodo])
  @@map("kardex_comercial")
}
```

Reglas del ledger:
- `eventoUid` compartido entre fuentes evita duplicar el mismo pago que llega por archivo bancario Y por webhook.
- La facturación nativa (Timbrado/Recibo) y la caja (Pago) **emiten** eventos al kardex; los modelos actuales no se tocan, se les añade el emisor.
- Las correcciones son `AJUSTE` con `fuenteRef.motivo` — nunca se edita un evento (las compensaciones estilo `compensacion.js` de catastro).
- `RESTRICCION` es un evento de primera clase (mínimo vital, Ley General de Aguas — ver doc 07 §5).

### 3.2 Derivados

Read models regenerables, con watermark de derivación incremental (patrón R4 de catastro):

```prisma
model DerivadoWatermark {
  derivado           String   @id            // 'saldos' | 'cartera_antiguedad' | 'kpis' | 'perfil_consumo'
  semanticVersion    String   @map("semantic_version")  // bump → full recompute de ESE derivado
  watermarkKardexId  BigInt?  @map("watermark_kardex_id")
  updatedAt          DateTime @updatedAt @map("updated_at")
  @@map("pipeline_derivados_watermark")
}
```

Derivados iniciales: `derivado_saldo_contrato` (saldo vigente/vencido reconstruido del kardex), `derivado_cartera_antiguedad` (buckets 0-30/31-60/61-90/90+), `derivado_kpi_periodo` (insumo del doc 06), `derivado_perfil_consumo` (base de anomalías/IA). Solo el que haga N sub-queries por contrato se vuelve incremental primero (lección de catastro: perfiles sí, agregados GROUP BY baratos quedan full-recompute documentado).

---

## 4. Expectativas declarativas de calidad (motor)

Mismo patrón que R3 de catastro: **motor + catálogo de módulos TS** (no tabla de configuración), solo los resultados van a BD.

```typescript
// backend/src/pipeline/expectations/catalog/*.ts
export interface Expectativa {
  id: string;                       // 'T15.C1'
  dominio: string;                  // Contratos | Personas | Domicilios | PuntoServicio | Tarifas | Cruzada | Dinero
  onError: 'FAIL' | 'WARN';         // FAIL bloquea publishRun / gate de migración; WARN marca sospechosa
  alcance: 'staging' | 'canonico' | 'kardex' | 'derivado';
  evaluar(prisma: PrismaClient, ctx: { runId?: string }): Promise<{
    ok: boolean | null;
    valor: { total: number; conProblema: number; pctCumplimiento: number; ejemplos: string[] };
  }>;
}
```

Factories estilo dbt-tests: `checkNotNull`, `checkUnique`, `checkFormato(regex)`, `checkFkExiste`, `checkSinTraslape(vigencias)`, `checkRangosSinHuecos`, `checkSumaNoExcede`, `checkConteoVsControl`, `checkDineroConserva`, `checkFrescura`.

`ejecutarExpectativas()` retorna `{ ok, bloqueaPublicacion, resultados }`; el runner la consume antes de `publishRun`. Severidades de la Tarea 15 → semántica del gate: **Error = FAIL** (bloquea), **Warning = WARN** (publica marcando el run `sospechosa`, reporta), **Info = WARN sin marcar**.

### 4.1 Materialización de la Tarea 15 — mapeo regla por regla

Cada regla del PRD (req 32/33) es una entrada del catálogo con id `T15.*`. El endpoint `GET /monitoreo/calidad-datos` y el script `scripts/validar-calidad-datos.ts` de la tarea dejan de ser código bespoke: ambos invocan `ejecutarExpectativas({ alcance: 'canonico' })` y formatean `ExpectativaResultado` (que ya trae el shape `ResultadoValidacion` pedido: total, conProblema, pctCumplimiento, 5 ejemplos).

**Contratos**

| Regla | Expectativa (factory + predicado sobre modelos Prisma) | Gate |
|---|---|---|
| C1 Contrato activo con ≥1 Persona rol Propietario | `checkExiste(Contrato[estado=Activo] ⇒ RolPersonaContrato[rol=PROPIETARIO, activo=true])` | FAIL |
| C2 Contrato activo con PuntoServicio | `checkNotNull(Contrato.puntoServicioId WHERE estado=Activo)` | WARN |
| C3 Contrato activo con Domicilio estructurado | `checkNotNull(Contrato.domicilioId WHERE estado=Activo)` — no basta `direccion` string legacy | WARN |
| C4 Contrato activo con TipoContratacion | `checkNotNull(Contrato.tipoContratacionId WHERE estado=Activo)` | FAIL |
| C5 Estado ∈ catálogo | `checkEnum(Contrato.estado, CATALOGO_ESTADOS)` | FAIL |
| C6 RFC contrato = RFC PersonaFiscal | `checkCruce(Contrato.rfc == Persona.rfc vía RolPersonaContrato[rol=FISCAL])` | WARN |

**Personas**

| Regla | Expectativa | Gate |
|---|---|---|
| P1 Física con nombre | `checkNotNull(Persona.nombre WHERE tipo=Fisica)` | FAIL |
| P2 Moral con razonSocial y RFC | `checkNotNull(Persona.razonSocial, Persona.rfc WHERE tipo=Moral)` | FAIL |
| P3 RFC formato (13 física / 12 moral) | `checkFormato(Persona.rfc, RFC_REGEX por tipo)` | WARN |
| P4 Sin duplicados por RFC | `checkUnique(Persona.rfc, {excluirNull: true, excluirGenerico: 'XAXX010101000'})` | WARN |
| P5 CURP 18 chars formato | `checkFormato(Persona.curp, CURP_REGEX)` | WARN |

**Domicilios**

| Regla | Expectativa | Gate |
|---|---|---|
| D1 Calle + (CP o colonia) | `checkNotNull(Domicilio.calle) AND checkAlgunoNotNull(codigoPostal, coloniaINEGIId)` | FAIL |
| D2 CP existe en catálogo INEGI/SEPOMEX | `checkFkExiste(Domicilio.codigoPostal → catálogo CP del conector inegi)` | WARN |
| D3 Colonia pertenece al municipio | `checkCruce(Domicilio.coloniaINEGI.localidad.municipioId == Domicilio.municipioINEGIId)` | WARN |
| D4 Sin duplicados calle+número+colonia | `checkUnique(Domicilio, [calle, numExterior, coloniaINEGIId], {normalizado: true})` | WARN |
| D5 direccionConcatenada generada | `checkNotNull(Domicilio.direccionConcatenada)` | WARN (Info) |

**Puntos de servicio**

| Regla | Expectativa | Gate |
|---|---|---|
| PS1 Código único | `checkUnique(PuntoServicio.codigo)` — refuerza el `@unique` durante staging pre-carga | FAIL |
| PS2 Activo con tipo de suministro | `checkNotNull(PuntoServicio.tipoSuministroId WHERE estado=Activo)` | WARN |
| PS3 Hijos con % repartición | `checkNotNull(reparticionConsumo WHERE puntoServicioPadreId IS NOT NULL AND tipoRelacionPadre.reparteConsumo)` | WARN |
| PS4 Σ reparticiones hijos ≤ 100% | `checkSumaNoExcede(GROUP BY puntoServicioPadreId: SUM(reparticionConsumo) <= 100)` | FAIL |

**Tarifas** (contra el modelo unificado del doc 07)

| Regla | Expectativa | Gate |
|---|---|---|
| T1 Tarifa activa con vigenciaDesde | `checkNotNull(Tarifa.vigenciaDesde WHERE activo)` | FAIL |
| T2 Sin vigencias superpuestas por código | `checkSinTraslape(Tarifa, [codigo], [vigenciaDesde, vigenciaHasta])` | FAIL |
| T3 Escalonada sin huecos en rangos | `checkRangosSinHuecos(bloques por tarifa: max(rango_n) + 1 == min(rango_n+1))` | FAIL |
| T4 Contrato activo con tarifa vigente | `checkCruce(Contrato[Activo] ⇒ ∃ Tarifa vigente para su tipoContratacion/administración a hoy)` | WARN |

**Consistencia cruzada (req 33)** — corren además en el monitoreo periódico (T09):

| Regla | Expectativa | Gate |
|---|---|---|
| CC1 Contrato activo sin tarifa vigente | = T4 con severidad elevada en contexto de facturación | FAIL |
| CC2 Corte activo ⇒ estado del contrato correspondiente | `checkCruce(Orden[tipo=CORTE, ejecutada, sin reconexión posterior] ⇒ Contrato.estado ∈ {Cortado, Restringido})` — y contra kardex: último evento CORTE/RECONEXION consistente | FAIL |
| CC3 Lectura ⇒ contrato con medidor activo | `checkCruce(Lectura ⇒ Medidor[contratoId, estado=Activo] existe)` | FAIL |
| CC4 Pago aplicado ⇒ recibo/factura existente | `checkFkExiste(Pago.reciboId/timbradoId)` + kardex: todo evento PAGO con `fuenteRef` resoluble | FAIL |
| CC5 Póliza cuadra con facturación del periodo | `checkDineroConserva(Σ LineaPoliza[periodo] == Σ kardex CARGO[periodo] ± delta esperado enumerado)` — el gate de dinero de catastro, con decimal de precisión alta | FAIL |
| CC6 Cambio de tipo de contrato ⇒ conceptos y tarifa actualizados | `checkCruce(HistoricoContrato[campo=tipoContratacionId] ⇒ ContratoConcepto y tarifa asignada re-derivados después del cambio)` | WARN |

**Expectativas de dinero adicionales** (no están en T15 pero el patrón catastro las exige):

- `dinero.recaudadores`: Σ montos de archivo staging de cada recaudador == Σ `PagoExterno` aplicados + rechazados de ese archivo, al centavo. FAIL.
- `dinero.kardex-vs-recibos`: saldo reconstruido del kardex == saldos de `Recibo` para muestra de N contratos de control (el "conciliar sagrado" de catastro). FAIL.
- `salud.frescura`: cada fuente dentro de su cadencia declarada (`frescuraPolicy`). WARN → dashboard.

---

## 5. Plan de migración Aquasis/SIGE — el pipeline ES el gate

**Nada entra al canónico sin pasar por staging y expectativas.** La migración masiva no es un script suelto: es una corrida `snapshot` de los conectores `aquasis-padron` y `sige` con el gate en FAIL.

```
Fase 0 — Infraestructura
  Migración Prisma aditiva (§3) + motor de expectativas + runner + CLI
  (`pipeline fuentes|explorar|sync|frescura|expectativas`).

Fase 1 — Exploración y crosswalk
  `explorar()` de aquasis-padron y sige: volumetría real, esquema, muestras.
  Poblar SigeHydra (crosswalk cnttnum/cnttrefant → contrato) vía staging.
  Ejecutar `scripts/homologar-catalogos.ts` (T15) COMO normalizador de catálogos:
  legacy → CatalogoActividad/TipoContratacion/Catalogo*INEGI, con linaje.

Fase 2 — Ensayo (dry-run del gate)
  sync snapshot → staging → normalizar a un schema espejo (o dryRun) →
  ejecutarExpectativas() → REPORTE DE CALIDAD (el entregable 5 de T15, generado
  del propio pipeline, no a mano). Iterar limpieza en ORIGEN o en normalizador
  (limpiar-duplicados.ts de T15 = normalizador de dedup con bitácora, idempotente).

Fase 3 — Carga canónica gateada
  Orden de dependencias: catálogos → Personas → Domicilios → PuntosServicio →
  Contratos → Medidores → kardex histórico (saldos iniciales como eventos
  CARGO/PAGO migrados con fuente='migracion:aquasis' + eventoUid → re-corridas
  idempotentes). publishRun solo si 0 FAIL. Los WARN quedan en el reporte y se
  aceptan explícitamente (run 'sospechosa' publicable manual con nota — patrón catastro).

Fase 4 — Corte y convivencia
  Aquasis sigue emitiendo/recibiendo archivos de lecturas → el conector bidireccional
  mantiene ambos mundos sincronizados durante el strangler. Watermarks + frescura
  monitorean el rezago. Las expectativas CC* corren en cron (T09) — la calidad no es
  un evento único de migración, es un invariante permanente.
```

**Criterio de aceptación duro**: conservación de dinero. Σ cartera Aquasis == Σ saldos derivados del kardex migrado, con delta esperado enumerado por regla de exclusión (contratos cancelados, cuentas legacy no migrables — cada exclusión con su peso en $, como la cuarentena del 3.5% de catastro que se reporta en pesos, no solo en filas).

---

## 6. Encaje con los modelos existentes (no se reinventa nada)

| Modelo existente | Rol en el pipeline |
|---|---|
| `LogProceso` (T09) | Se conserva para procesos de negocio (facturación masiva, prefacturación). Los runs de ingesta usan `SyncRun` (semántica más rica: published_at, watermark, linaje). Un adaptador escribe un `LogProceso{tipo:'SYNC'}` espejo por cada SyncRun para que el dashboard de monitoreo actual los muestre sin cambios. |
| `ConciliacionReporte` (T09) | Se convierte en la **vista de presentación** de las expectativas: una corrida de expectativas de categoría dinero/cruzada genera un `ConciliacionReporte{tipo:'CALIDAD_DATOS'}` (el nuevo tipo que la propia T15 pedía) con `detalles` = resultados. Sus columnas `contratosSinPunto/domiciliosSinINEGI/tarifasVencidas` son exactamente T15.C2, T15.D2 y T15.T4 — ya no se calculan ad-hoc. |
| `LogSincronizacion` + `CambioGIS` (T05) | Es el **conector `gis-cea` saliente** ya construido: CDC + export diferencial + log. Se registra como fila en `Fuente{id:'gis-cea', bidireccional:true}` y su `LogSincronizacion` se espeja como SyncRun de modo `export`. La conciliación padrón-vs-GIS (req 27) se vuelve expectativa `T05.conciliacion-gis` (WARN). |
| `LoteLecturas`/`Lectura` (T01) | El upload actual es el `sync()` del conector `aquasis-lecturas`: se le añade `runId` y hash de archivo (columna `archivoHash` ya existe), y la validación de lote ("todo contrato con lectura o incidencia") se vuelve expectativa FAIL del dataset. |
| `PagoExterno` (T02) | Staging especializado de recaudadores ya construido — el conector genérico escribe además el crudo a `pipeline_staging` y el flujo conciliar/aplicar emite eventos `PAGO` al kardex con la **fecha real** del cliente. |
| `Poliza`/`LineaPoliza`/`ReglaContable` (T04) | Consumidores del kardex: la póliza se genera de eventos comerciales del periodo (CC5 los cuadra); el conector `sap-idoc` la exporta. |

---

## 7. Secuencia de PRs (estilo waves de catastro)

1. **W1** — Migración aditiva (§3) + seed de `Fuente` (9 filas) + motor de expectativas con 3 checks piloto (C1, PS4, dinero.recaudadores). Cero cambio de conducta.
2. **W2** — Runner + contrato + retrofit de lo existente como conectores (lecturas, pagos externos, GIS) sin reescribir internals; CLI.
3. **W3** — Catálogo T15 completo (26 expectativas) + `GET /monitoreo/calidad-datos` servido por el motor + `ConciliacionReporte{CALIDAD_DATOS}`.
4. **W4** — Conectores `aquasis-padron` + `sige` + crosswalk; ensayo de migración (Fase 2) y reporte de calidad.
5. **W5** — Kardex comercial + emisores desde facturación/pagos/órdenes + derivado de saldos + gates de dinero; migración gateada (Fase 3).
6. **W6** — Derivados de KPIs (doc 06) + linaje completo + health/frescura en dashboard.

**Riesgos principales**: (1) doble escritura Pago/kardex durante transición — mitigar con emisor transaccional en el mismo commit; (2) layouts de recaudadores "Verificar formato" (7 de 22) — `explorar()` con archivos reales antes de escribir parser; (3) fechas `String` en modelos legacy (Contrato, Pago) contaminan el kardex — el normalizador convierte y la expectativa `checkFormato(fecha)` FAIL protege; (4) volumen telemetría futura — staging particionado y `tipoTransaccion=APPEND` desde el día uno.
