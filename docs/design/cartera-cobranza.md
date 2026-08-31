# Diseño: Módulo de Cartera Vencida y Gestión de Cobranza

> Brecha P0 #1 de `docs/state-of-the-art-roadmap.md` · Diseñado 2026-07-17
> Estado: **propuesta — pendiente de validación** (ver §9 R2/R3 antes de implementar dunning)

## 1. Resumen y motivación

Hoy el adeudo **no existe como dato**: se recalcula on-the-fly en tres lugares con la misma fórmula:

- `restricciones.service.ts:43` y `:104` — `pendiente = saldoVigente + saldoVencido − pagos` por recibo, sumado sobre **todos** los recibos.
- `facturacion.service.ts:296` (`calcularSaldoVencido`) — misma fórmula sobre recibos anteriores.
- `pagos.service.ts` (`verificarAutoReconexion`) — `Σ timbrado.total − Σ pago.monto`.

### ⚠️ Bug confirmado: doble conteo del arrastre (compuesto)

`Recibo.saldoVencido` es un **arrastre** (pendiente acumulado de recibos anteriores, poblado por
`persistirFactura`). Al sumar `saldoVigente + saldoVencido` a través de varios recibos, el arrastre
se cuenta una vez por cada recibo posterior, y además el propio arrastre se calcula con la fórmula
inflada, por lo que **se compone**:

| Recibos impagos de $100 | Deuda real | `adeudoContrato()` reporta |
|---|---|---|
| R1 | 100 | 100 |
| R1, R2 (vencido=100) | 200 | 300 |
| R1, R2, R3 (vencido=300) | 300 | 700 |

Todo candidato a restricción con ≥2 recibos impagos hoy trae adeudo inflado. La corrección
estructural es este módulo (contabilidad por documento).
Nota: al corregir, los adeudos reportados **bajarán** — validar con el organismo antes de activar
en producción (§9 R2).

**Fix interino aplicado (2026-07-17):** mientras llega el módulo de cartera, el cálculo se corrigió
a nivel contrato con pagos aplicados FIFO al recibo más antiguo (`adeudoFifo`, exportado en
`restricciones.service.ts`): `restricciones` (adeudoContrato + candidatos), `facturacion`
(`calcularSaldoVencido`, ahora `max(0, Σ vigente anteriores − Σ pagos)`), `indicadores` (cartera
vencida PIGOO), `portal` (`getSaldos` — antes sumaba los arrastres de TODOS los recibos), y
frontend `Pagos.tsx` / `AtencionClientes.tsx` (deuda por contrato sin `saldoVencido`). Los usos
sobre un solo recibo (notificaciones, recibo impreso, aviso de vencimiento del batch) conservan
`vigente + vencido` porque ahí el arrastre es correcto. El FIFO evita perder pagos hechos "sobre
el recibo más reciente" que en papel incluían el arrastre (`Pago.reciboId` es opcional).

El módulo introduce un **libro de cartera de partida abierta** (open-item, estilo SAP IS-U /
Oracle CC&B): un documento de adeudo por recibo, aplicación explícita de pagos a documentos (FIFO),
estado de cuenta materializado con aging buckets y score, reglas de dunning configurables por
segmento, y un pipeline batch que **origina** restricciones/avisos reutilizando los módulos
existentes.

## 2. Decisiones clave

- **D1 — Libro por documento (`DocumentoCartera`), no recomputar.** `montoOriginal = recibo.saldoVigente`
  (solo cargos del periodo; **nunca** el arrastre). El "vencido" son los documentos viejos abiertos.
  Elimina el doble conteo estructuralmente y da fuente única de verdad + historial para aging/dunning.
- **D2 — Aplicación de pagos explícita (`AplicacionPago`), FIFO más antiguo primero.** No se toca la
  semántica de `Pago`; se engancha en el hook post-pago existente (donde vive `verificarAutoReconexion`).
- **D3 — Cobranza *origina* restricciones, no las reimplementa.** La acción `generar_restriccion` llama
  a `RestriccionesService.programar()` (ya exportado), que aplica sus guardas (convenio activo,
  `bloqueadoJuridico`, `cortable`, aviso previo LGA). Reversa al pagar ya la maneja `cronReversas`.
- **D4 — Dunning como datos (`ReglaDunning`).** Pipeline `días de mora → acción → canal`, segmentable
  por `tipoContratacionId`/`tipoServicio` (null = todos). Doméstico → restricción mínimo vital;
  no doméstico → corte.
- **D5 — `EstadoCuenta` materializado** (1 por contrato) con buckets denormalizados para que el
  dashboard de aging por administración/zona sea un `groupBy` barato. Refresco nocturno + on-demand al pagar.
- **D6 — Batch con el patrón vigente:** `@Cron(env ?? default)` + `HYDRA_JOBS_ENABLED` + `LogProceso`
  (`conLog` de `batch.service.ts`; precedente de cron en service de dominio: `RestriccionesService.cronReversas`).

## 3. Modelos Prisma

Seis modelos nuevos: `DocumentoCartera`, `AplicacionPago`, `EstadoCuenta`, `ReglaDunning`,
`CampanaCobranza`, `AccionCobranza`. Relaciones inversas en `Contrato`, `Recibo`, `Pago` (solo líneas
de relación).

```prisma
model DocumentoCartera {
  id             String   @id @default(cuid())
  contratoId     String   @map("contrato_id")
  reciboId       String?  @unique @map("recibo_id")
  tipo           String   @default("recibo")          // recibo | convenio | ajuste | recargo
  periodo        String?                               // YYYY-MM
  // montoOriginal = SOLO cargos del periodo (recibo.saldoVigente); NUNCA el arrastre saldoVencido
  montoOriginal  Decimal  @map("monto_original") @db.Decimal(12, 2)
  montoAbonado   Decimal  @default(0) @map("monto_abonado") @db.Decimal(12, 2)
  saldo          Decimal  @db.Decimal(12, 2)
  fechaEmision   String   @map("fecha_emision")
  fechaVencimiento String @map("fecha_vencimiento")
  diasVencido    Int      @default(0) @map("dias_vencido")
  bucket         String   @default("corriente")        // corriente | b1_30 | b31_60 | b61_90 | b90_mas
  estado         String   @default("vigente")          // vigente | vencido | parcial | pagado | en_convenio | incobrable
  convenioId     String?  @map("convenio_id")
  recalculadoEn  DateTime @default(now()) @map("recalculado_en")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")
  contrato       Contrato @relation(fields: [contratoId], references: [id], onDelete: Cascade)
  recibo         Recibo?  @relation(fields: [reciboId], references: [id], onDelete: SetNull)
  aplicaciones   AplicacionPago[]

  @@index([contratoId])
  @@index([estado])
  @@index([bucket])
  @@index([fechaVencimiento])
  @@map("documentos_cartera")
}

model AplicacionPago {
  id                 String           @id @default(cuid())
  pagoId             String           @map("pago_id")
  documentoCarteraId String           @map("documento_cartera_id")
  monto              Decimal          @db.Decimal(12, 2)
  fecha              String
  createdAt          DateTime         @default(now()) @map("created_at")
  pago               Pago             @relation(fields: [pagoId], references: [id], onDelete: Cascade)
  documento          DocumentoCartera @relation(fields: [documentoCarteraId], references: [id], onDelete: Cascade)

  @@index([pagoId])
  @@index([documentoCarteraId])
  @@map("aplicaciones_pago")
}

model EstadoCuenta {
  id               String   @id @default(cuid())
  contratoId       String   @unique @map("contrato_id")
  saldoTotal       Decimal  @default(0) @map("saldo_total") @db.Decimal(12, 2)
  saldoCorriente   Decimal  @default(0) @map("saldo_corriente") @db.Decimal(12, 2)
  saldoVencido     Decimal  @default(0) @map("saldo_vencido") @db.Decimal(12, 2)
  bucketCorriente  Decimal  @default(0) @map("bucket_corriente") @db.Decimal(12, 2)
  bucket1_30       Decimal  @default(0) @map("bucket_1_30") @db.Decimal(12, 2)
  bucket31_60      Decimal  @default(0) @map("bucket_31_60") @db.Decimal(12, 2)
  bucket61_90      Decimal  @default(0) @map("bucket_61_90") @db.Decimal(12, 2)
  bucket90_mas     Decimal  @default(0) @map("bucket_90_mas") @db.Decimal(12, 2)
  docsVencidos     Int      @default(0) @map("docs_vencidos")
  diasMoraMax      Int      @default(0) @map("dias_mora_max")
  scoreMorosidad   Int      @default(0) @map("score_morosidad")   // 0-100
  categoria        String   @default("AL_CORRIENTE")              // AL_CORRIENTE|INCIPIENTE|MODERADO|ALTO|CRITICO
  enConvenio       Boolean  @default(false) @map("en_convenio")
  restringido      Boolean  @default(false)
  recalculadoEn    DateTime @default(now()) @map("recalculado_en")
  contrato         Contrato @relation(fields: [contratoId], references: [id], onDelete: Cascade)

  @@index([categoria])
  @@index([scoreMorosidad])
  @@index([saldoVencido])
  @@map("estados_cuenta")
}

model ReglaDunning {
  id                 String   @id @default(cuid())
  nombre             String
  orden              Int      @default(0)
  activo             Boolean  @default(true)
  tipoContratacionId String?  @map("tipo_contratacion_id")   // null = todos
  tipoServicio       String?  @map("tipo_servicio")
  diasMoraMin        Int      @map("dias_mora_min")
  minDocsVencidos    Int      @default(1) @map("min_docs_vencidos")
  montoMinimo        Decimal  @default(0) @map("monto_minimo") @db.Decimal(12, 2)
  accion             String   // notificar_aviso | notificar_requerimiento | generar_restriccion | generar_corte | ofrecer_convenio | proponer_incobrable
  canal              String?  // email | whatsapp | ambos
  reintentoDias      Int      @default(15) @map("reintento_dias")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  @@index([activo, orden])
  @@map("reglas_dunning")
}

model CampanaCobranza {
  id               String           @id @default(cuid())
  nombre           String
  descripcion      String?
  estado           String           @default("borrador") // borrador | activa | finalizada
  administracionId String?          @map("administracion_id")
  bucketObjetivo   String?          @map("bucket_objetivo")
  fechaInicio      DateTime?        @map("fecha_inicio")
  fechaFin         DateTime?        @map("fecha_fin")
  createdAt        DateTime         @default(now()) @map("created_at")
  updatedAt        DateTime         @updatedAt @map("updated_at")
  acciones         AccionCobranza[]

  @@index([estado])
  @@map("campanas_cobranza")
}

model AccionCobranza {
  id                String           @id @default(cuid())
  contratoId        String           @map("contrato_id")
  campanaId         String?          @map("campana_id")
  reglaId           String?          @map("regla_id")
  etapa             Int              @default(0)
  tipo              String           // aviso | requerimiento | restriccion | corte | convenio_ofrecido | incobrable
  canal             String?          // email | whatsapp | orden | interno
  estado            String           @default("ejecutada") // ejecutada | fallida | omitida
  saldoAlMomento    Decimal          @default(0) @map("saldo_al_momento") @db.Decimal(12, 2)
  diasMoraAlMomento Int              @default(0) @map("dias_mora_al_momento")
  notificacionLogId String?          @map("notificacion_log_id")
  restriccionId     String?          @map("restriccion_id")
  ordenId           String?          @map("orden_id")
  autorizadoPor     String?          @map("autorizado_por")  // requerido para 'incobrable'
  motivo            String?
  createdAt         DateTime         @default(now()) @map("created_at")
  contrato          Contrato         @relation(fields: [contratoId], references: [id], onDelete: Cascade)
  campana           CampanaCobranza? @relation(fields: [campanaId], references: [id], onDelete: SetNull)

  @@index([contratoId])
  @@index([tipo])
  @@index([campanaId])
  @@index([createdAt])
  @@map("acciones_cobranza")
}
```

**Scoring (fórmula única en `cartera.service`):**
`score = min(100, 25*docsVencidos + round(diasMoraMax/3))`;
`categoria` por `diasMoraMax`: 0 → AL_CORRIENTE, 1-30 → INCIPIENTE, 31-60 → MODERADO, 61-90 → ALTO, 90+ → CRITICO.

## 4. Flujos

### 4.1 Recálculo de cartera (idempotente, nocturno + on-demand)
1. Upsert de `DocumentoCartera` por recibo: `montoOriginal = recibo.saldoVigente` (**nunca** `saldoVencido`).
2. `montoAbonado = Σ AplicacionPago`; `saldo = montoOriginal − montoAbonado`.
3. `diasVencido`, `bucket`, `estado` derivados; convenio activo → `en_convenio` (excluido del vencido).
4. Recalcular `EstadoCuenta`: buckets, saldos, `docsVencidos`, `diasMoraMax`, score, `enConvenio`
   (`Convenio.estado='Activo'`), `restringido` (`RestriccionServicio` vigente).

### 4.2 Aplicación de pago (FIFO)
`CarteraService.aplicarPago(pagoId)`: documentos abiertos ordenados por `fechaVencimiento` asc; si el
pago trae `reciboId` explícito se respeta primero (compatibilidad con caja/conciliación); sobrante →
saldo a favor / `Anticipo`. Todo en `$transaction`. Enganches: `pagos.service.crear()` (junto a
`verificarAutoReconexion`), `PagosExternosService.conciliar()`, `ConveniosService.aplicarParcialidad()`.

### 4.3 Pipeline de dunning (nocturno)
Para cada contrato con `saldoVencido > 0`, excluyendo convenio activo / `bloqueadoJuridico` /
restricción vigente:
1. Cargar `ReglaDunning` activas ordenadas, filtradas por segmento del contrato.
2. Elegir la etapa de mayor `diasMoraMin` alcanzada que cumpla `minDocsVencidos`/`montoMinimo`.
3. Idempotencia (patrón `yaAvisado`): omitir si hay `AccionCobranza` de esa etapa en `reintentoDias`.
4. Ejecutar y registrar `AccionCobranza` con referencia cruzada:
   - `notificar_*` → `NotificacionesService` (nuevos tipos `aviso_cobranza`, `requerimiento_pago`).
   - `generar_restriccion` → `RestriccionesService.programar()` (mínimo vital LGA).
   - `generar_corte` → `Orden` tipo Corte (no doméstico).
   - `ofrecer_convenio` → notifica y marca candidato (creación real manual).
   - `proponer_incobrable` → **nunca automático**; solo candidato en reporte.

Orden de crons: ETL/conciliación pagos → facturación → **cartera** → **dunning** → reversas de restricción.

## 5. API (`backend/src/modules/cartera/`)

Módulo espejo de `restricciones` (importa `PrismaModule`, `RestriccionesModule`, `NotificacionesModule`;
exporta `CarteraService`). `JwtAuthGuard + RolesGuard + @Roles` y DTOs `class-validator`.

```
GET  /cartera/contratos/:id/estado-cuenta      [ADMIN,OPERADOR,ATENCION_CLIENTES]
GET  /cartera                                  filtros: administracionId, zonaId, bucket, minDiasMora, categoria, scoreMin, page/limit
GET  /cartera/aging                            resumen por administración/zona (dashboard)
POST /cartera/recalcular                       trigger manual (full=1 → backfill)  [SUPER_ADMIN,ADMIN]
POST /cartera/evaluar-dunning                  corrida manual (soporta dry-run)    [SUPER_ADMIN,ADMIN]
GET/POST/PATCH/DELETE /cartera/reglas-dunning[/:id]                                [SUPER_ADMIN,ADMIN]
GET/POST /cartera/campanas · GET /cartera/campanas/:id · POST /cartera/campanas/:id/ejecutar
GET  /cartera/acciones?contratoId=&tipo=
POST /cartera/contratos/:id/incobrable  { motivo, autorizadoPor }                  [SUPER_ADMIN,ADMIN]
```

## 6. Frontend

- `frontend/src/api/cartera.ts` (patrón `apiRequest` de `api/convenios.ts`).
- `frontend/src/pages/Cartera.tsx` + ruta lazy `/app/cartera`: dashboard de aging (por bucket,
  filtro admin/zona), tabla de padrón vencido (saldo/score/días), tabs de reglas de dunning y campañas.
- Estado de cuenta en `AtencionClientes.tsx`: pestaña/Sheet con documentos abiertos, aplicaciones,
  aging, historial de acciones, botones "Ofrecer convenio" / "Marcar incobrable" (por rol).

## 7. Plan de implementación (pasos verificables)

1. **Schema + migración** — `prisma validate` + `migrate dev` + `generate` OK. *(Aditivo, sin riesgo.)*
2. **`CarteraService.recalcular()`** — probar explícitamente el caso de 2+ recibos: ya no duplica arrastre.
3. **`aplicarPago()` + enganches** — pago parcial reparte FIFO; auto-reconexión sigue funcionando.
4. **Backfill** (`POST /cartera/recalcular?full=1` con `LogProceso`) — totales cuadran; reporte de descuadres.
5. **Dunning + reglas semilla** — dry-run primero; revisar `AccionCobranza`.
6. **Crons** (`JOB_CARTERA_CRON`, `JOB_DUNNING_CRON`) — respetan `HYDRA_JOBS_ENABLED`.
7. **Controllers + DTOs + RBAC** — `tsc --noEmit` + smoke por rol.
8. **Tipos de notificación nuevos** — canal consola en dev + `notificacion_logs`.
9. **`api/cartera.ts` + `Cartera.tsx` + ruta** — `npm run build` + dashboard con datos.
10. **Estado de cuenta en AtencionClientes** — pestaña funcional.
11. **`/decision`**: "el adeudo es `EstadoCuenta`/`DocumentoCartera`, no on-the-fly"; migrar las 3
    fórmulas legadas a `CarteraService` progresivamente.

## 8. Reutilización de patrones del repo

Batch (`conLog`/`LogProceso`/master switch), máquina de estados de restricciones (se invoca, no se
copia), hook post-pago, guardas de exclusión de restricciones, `NotificacionesService` + guarda
`yaAvisado`, controller/DTO/RBAC de `restricciones.controller.ts`, `apiRequest` + TanStack Query +
tabs de `AtencionClientes.tsx`, refresco tras `conciliar()`.

## 9. Riesgos / puntos de validación con el usuario

- **R1 — Backfill (alto):** recibos históricos creados fuera de `persistirFactura` podrían traer
  `saldoVigente` contaminado. Mitigación: backfill regenerable + reporte de descuadres.
- **R2 — Los adeudos BAJARÁN al corregir el doble conteo (medio):** impacta candidatos a restricción
  y cifras ya socializadas. **Validar antes de activar en producción.**
- **R3 — Criterio "doméstico vs no doméstico" (incógnita):** no está confirmado el campo canónico
  (¿`tipoServicio`? ¿categoría?). Restricción se apoya en `puntoServicio.cortable` (correcto), pero
  segmentar reglas de dunning necesita fijar la fuente. **Preguntar antes de sembrar reglas.**
- **R4 — Concurrencia:** `aplicarPago`/`recalcular` en `$transaction`; el recálculo nocturno es red
  de seguridad idempotente.
- **R5 — Drift de migraciones en servidor:** hay migraciones previas pendientes de `migrate deploy`
  (Aquasis, `requiereInspeccion`); coordinar.

## 10. Fuera de alcance de esta ola

Pasarelas de pago en tiempo real y portal de pago (brechas #2/#3), automatización de incobrables y
de creación de convenios (siempre manuales con rol), y el reemplazo inmediato de las 3 fórmulas
legadas (primero paridad verificada, luego migración con decisión registrada).
