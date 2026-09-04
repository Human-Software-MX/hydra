---
description: Contexto completo del proyecto CEA Querétaro — arquitectura, módulos, estado actual y flujos clave.
alwaysApply: true
---

# Contexto del Proyecto — CEA Querétaro (Contract-to-Cash-Flow)

Sistema de gestión de agua potable para la CEA (Comisión Estatal del Agua) de Querétaro. Cubre el ciclo completo: solicitud de servicio → contratación → toma → lectura → facturación → cobranza.

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| UI | Shadcn/UI + Tailwind CSS + Radix UI |
| Estado del servidor | TanStack Query (useQuery / useMutation) |
| Backend | NestJS + TypeScript |
| ORM | Prisma |
| Base de datos | PostgreSQL 35.188.238.10:5433 (base: `hydra`) |
| Auth | JWT (NestJS Guards) |

**MER completo:** `docs/mer-hydra.md` (Mermaid, 10 dominios agrupados)

**Puertos locales:**
- Frontend: `http://localhost:8080` (Vite dev)
- Backend: `http://localhost:3001`
- `VITE_API_BASE_URL=http://localhost:3001`

---

## Estructura de Carpetas

```
contract-to-cash-flow/
├── frontend/src/
│   ├── pages/              # Una página por módulo
│   ├── components/
│   │   ├── contratacion/   # Wizard de alta de contrato
│   │   ├── contratos/      # Diálogos de edición de contrato
│   │   └── ui/             # Componentes Shadcn/custom
│   ├── api/                # Funciones fetch por dominio
│   └── types/              # Interfaces TypeScript compartidas
├── backend/src/modules/    # Un módulo NestJS por dominio
└── backend/prisma/         # schema.prisma + migrations
```

---

## Módulos Frontend (Pages)

| Página | Descripción |
|--------|-------------|
| `Solicitudes.tsx` | Lista y gestión de solicitudes de servicio (entrada del flujo) |
| `SolicitudServicio.tsx` | Formulario completo de solicitud de servicio |
| `Contratos.tsx` | Lista de contratos + wizard de alta + edición |
| `PuntosServicio.tsx` | Catálogo de puntos de servicio (ubicaciones) |
| `TiposContratacion.tsx` | Catálogo de tipos de contratación con variables |
| `Factibilidades.tsx` | Solicitudes de factibilidad técnica |
| `Lecturas.tsx` | Captura y gestión de lecturas de medidores |
| `Consumos.tsx` | Histórico de consumos por punto de servicio |
| `PreFacturacion.tsx` | Pre-facturación masiva por periodo |
| `Pagos.tsx` | Registro de pagos |
| `Recibos.tsx` | Generación y consulta de recibos |
| `Medidores.tsx` | Inventario de medidores |
| `Rutas.tsx` | Rutas de lecturistas |
| `Administraciones.tsx` | Catálogo de administraciones (zonas operativas) |
| `Tarifas.tsx` | Gestión de tarifas por tipo de contratación |

---

## Flujo Principal: Solicitud → Contrato

Este es el flujo más complejo y el que más hemos trabajado:

```
SolicitudServicio (captura)
    ↓ estado: pendiente_revision
Solicitudes (lista)
    ↓ [Inspección si aplica / Cuantificación]
    ↓ estado: en_cotizacion
    ↓ [Aceptar cotización]
    ↓ backend crea Contrato + ProcesoContratacion, guarda contratoId en solicitud
    ↓ navega a /app/contratos?iniciarAlta=1&contratoId=X
Contratos (lista)
    ↓ busca/crea ProcesoContratacion, obtiene procesoId
    ↓ abre WizardContratacion con procesoPrecargaId=procesoId
WizardContratacion (7 pasos)
    ↓ fetcha solicitud via GET /solicitudes?contratoId=X
    ↓ precarga TODOS los campos desde solicitud.formData
    ↓ [usuario valida/edita en modo lectura]
    ↓ POST /contratos → crea contrato definitivo
```

### Estados de Solicitud
`pendiente_revision` → `inspeccion_requerida` → `inspeccion_en_proceso` → `en_cotizacion` → `aceptada` → `contratado`
También: `rechazada`, `cancelada`

### Tipos INDIVIDUAL (esIndividualizacion = true)
- Saltan inspección directamente a cotización
- Campo `requiereInspeccion = false` en DB (migration: `20260420150000_individual_no_requiere_inspeccion`)
- Lógica frontend: `tipoInspeccionMap` usa `!t.esIndividualizacion` como fallback

---

## Wizard de Alta de Contrato (7 Pasos)

**Componente principal:** `frontend/src/components/contratacion/WizardContratacion.tsx`

| Paso | Componente | Descripción |
|------|-----------|-------------|
| 0 | `PasoPersonas.tsx` | Propietario/titular, persona fiscal, contacto |
| 1 | `PasoConfigContrato.tsx` | Admin, tipo contratación, actividad, distrito, referencias |
| 2 | `PasoVariables.tsx` | Variables dinámicas del tipo de contratación |
| 3 | `PasoDocumentos.tsx` | Lista de documentos requeridos |
| 4 | `PasoFacturacion.tsx` | Vista previa de facturación + conceptos lectura periódica |
| 5 | `PasoOrdenes.tsx` | Órdenes de instalación (toma/medidor) |
| 6 | `PasoResumen.tsx` | Resumen final antes de crear |

### Precarga desde Solicitud
`WizardContratacion` tiene lógica de precarga completa en el `useEffect` de línea ~238:
- **Personas:** `solicitudFormToWizardPersonas(solForm)` → mapea propietario/fiscal
- **Config:** `adminId`, `tipoContratacionId`, `actividadId`, `distritoId`, `contratoPadre`
- **Variables:** `solicitudVarsToWizardVars(solForm.variablesCapturadas)`
- **Conceptos override:** `extractConceptosCuantificacionOverride(solForm)`

### Sync Bidireccional (Solicitud ↔ Wizard)
- **Paso 0 (Personas):** Modo solo-lectura con botón "Editar" / "Bloquear y guardar". Al guardar → `updateSolicitud(id, { formData, propNombreCompleto, ... })`. También sincroniza al hacer clic en "Siguiente" (`handlePrimary` step 0).
- **Paso 1 (Config):** Mismo patrón — modo solo-lectura con botón "Editar". Al guardar → `updateSolicitud(id, { adminId, tipoContratacionId, formData: { ...snapshot, actividadId, distritoId } })`.

**Archivos de mapeo:**
- `solicitud-personas-wizard.ts` — `solicitudFormToWizardPersonas()` y `wizardPersonasToSolicitudUpdate()`
- `solicitud-variables-precarga.ts` — `solicitudVarsToWizardVars()` y `extractConceptosCuantificacionOverride()`

---

## Modelos Prisma Clave

| Modelo | Descripción |
|--------|-------------|
| `Solicitud` | Solicitud de servicio; tiene `formData` (JSONB = `SolicitudState`) y `contratoId` |
| `SolicitudInspeccion` | Orden de inspección vinculada a solicitud |
| `Contrato` | Contrato definitivo |
| `ProcesoContratacion` | Proceso de alta vinculado a un contrato (hitos, etapas) |
| `PuntoServicio` | Ubicación física de servicio de agua |
| `TipoContratacion` | Catálogo de tipos con `esIndividualizacion`, `requiereInspeccion` |
| `VariableTipoContratacion` | Variables dinámicas por tipo (datos a capturar) |
| `ConceptoCobro` | Conceptos de cobro con tarifas |
| `Persona` | Persona física o moral (propietario, fiscal, contacto) |
| `RolPersonaContrato` | Relación persona ↔ contrato con rol (PROPIETARIO, FISCAL, CONTACTO) |
| `Domicilio` | Domicilio normalizado con claves INEGI/Aquasis |
| `CatalogoLocalidadINEGI` | Localidad Aquasis (aquasisPobid); 3,595 registros, 18 municipios QRO |
| `CatalogoColoniaINEGI` | Colonia Aquasis (aquasisBarrId, localidadId); 3,815 registros |
| `Toma` | Toma de agua (conexión física) |
| `Lectura` | Lectura de medidor |
| `Consumo` | Consumo calculado por periodo |
| `Recibo` | Recibo de cobro |
| `Pago` | Pago registrado |

---

## API Backend — Endpoints Relevantes

```
# Solicitudes
GET    /solicitudes?estado=&contratoId=&page=&limit=
POST   /solicitudes
PATCH  /solicitudes/:id
POST   /solicitudes/:id/inspeccion
POST   /solicitudes/:id/aceptar      → crea Contrato + ProcesoContratacion
POST   /solicitudes/:id/rechazar
POST   /solicitudes/:id/cancelar     ✅ implementado
POST   /solicitudes/:id/retomar      ✅ implementado
POST   /solicitudes/:id/cotizacion-pdf  → guarda PDF en uploads/cotizaciones/
GET    /solicitudes/:id/cotizacion-pdf  → descarga PDF (requiere JWT; usar openCotizacionPdf())

# Contratos
GET    /contratos
POST   /contratos
PATCH  /contratos/:id

# Procesos de contratación
GET    /procesos-contratacion?contratoId=
GET    /procesos-contratacion/:id
POST   /procesos-contratacion

# Tipos de contratación
GET    /tipos-contratacion
GET    /tipos-contratacion/:id

# Catálogos
GET    /catalogos/actividades
GET    /catalogos/administraciones
GET    /catalogos/distritos
GET    /catalogos/sat?tipo=REGIMEN_FISCAL|USO_CFDI
```

---

## Tipos Frontend Importantes

### `SolicitudState` (`types/solicitudes.ts`)
JSONB guardado en `solicitud.formData`. Contiene todos los campos del formulario:
`adminId`, `tipoContratacionId`, `actividadId`, `distritoId`, `contratoPadre`,
`propPaterno/Materno/Nombre/Rfc/Correo/Telefono`, `propTipoPersona`,
`predioDir`, `variablesCapturadas`, `conceptosCuantificacionOverride`, `documentosRecibidos`,
`cotizacionItems?` (ítems aprobados en cotización — guardados al aceptar para precarga en wizard), etc.

### `WizardData` (`hooks/useWizardState.ts`)
Estado del wizard de alta. Campos clave:
- `solicitudId?` — ID de solicitud vinculada (activa el modo precarga)
- `solicitudFormSnapshot?` — snapshot del formData para sync bidireccional
- `propietario`, `personaFiscal`, `personaContacto` — tipo `PersonaWizard`
- `fiscalIgualTitular?` — checkbox "persona fiscal = titular"
- `administracion`, `tipoContratacionId`, `actividadId`, `distritoId`
- `variablesCapturadas`, `conceptosOverride`, `documentosRecibidos`
- `cotizacionPrevia?` — ítems de cotización aprobada (mostrados en PasoFacturacion)

---

## Patrones de Código Frecuentes

### Modo Solo-Lectura en Pasos del Wizard
Patrón implementado en `PasoPersonas` y `PasoConfigContrato`:
```tsx
const [soloLectura, setSoloLectura] = useState(true);
const tieneSolicitud = Boolean(data.solicitudId && data.solicitudFormSnapshot);

// Botón Editar / Guardar y bloquear
// Mutation que llama updateSolicitud() y luego setSoloLectura(true)
```

### SearchableSelect
Componente en `components/ui/searchable-select.tsx` — Combobox Shadcn con búsqueda:
```tsx
<SearchableSelect
  options={[{ value: 'id', label: 'Nombre' }]}
  value={selected}
  onValueChange={setSelected}
  placeholder="Seleccione..."
/>
```

### TanStack Query — patrón estándar
```tsx
const q = useQuery({ queryKey: ['clave', params], queryFn: () => fetchFn(params) });
const mutation = useMutation({ mutationFn: apiCall, onSuccess: () => queryClient.invalidateQueries(...) });
```

---

## Estado Actual de Features (2026-04-27)

### ✅ Implementado y funcionando
- Flujo completo solicitud → inspección → cotización → aceptar → wizard de alta
- Tipos INDIVIDUAL (esIndividualizacion): saltan inspección, van directo a cotización
- Botón "Cancelar solicitud" + "Ver" en cada fila de la lista
- Endpoints `POST /solicitudes/:id/cancelar` y `POST /solicitudes/:id/retomar`
- Ordenamiento por fecha (asc/desc) en lista de solicitudes
- Pre-carga bidireccional wizard ↔ solicitud: personas y configuración
  - Paso 0 Personas: modo lectura + Editar + sync back a solicitud
  - Paso 1 Config: modo lectura + Editar + sync back a solicitud (fillDemo cuando no hay solicitud)
- Combobox con búsqueda para tipo de contratación en PasoConfigContrato
- Vista previa de facturación en PasoFacturacion con conceptos de lectura periódica
- **PasoFacturacion muestra "Cotización aprobada por cliente"** (ítems de cuantificación)
  - Al aceptar cotización: `handleAceptar` guarda `cotizacionItems` en `solicitud.formData`
  - Wizard precarga: lee `solForm.cotizacionItems`, fallback a `solDto.inspeccion`
  - `VerSolicitudDialog`: auto-backfill `cotizacionItems` para solicitudes previas al fix
- **PDF de cotización** generado con `@react-pdf/renderer`
  - Template: `frontend/src/lib/cotizacion-pdf.tsx`
  - Motor compartido: `frontend/src/lib/cotizacion.ts` (`calcularCotizacion`, `inspeccionDtoToOrdenData`)
  - Backend: `POST/GET /solicitudes/:id/cotizacion-pdf` → guarda en `backend/uploads/cotizaciones/`
  - Frontend: `openCotizacionPdf(id)` — fetch con JWT → blob URL (evita 401 de `window.open` directo)
  - Botones en `VerSolicitudDialog`: "Descargar PDF" (servidor) + "Regenerar PDF" (local)
- ContratoEditDialog para editar contratos existentes
- `VerSolicitudDialog` con resumen completo: propietario, predio, estado, cuantificación, botones PDF
- **CuantificacionModal TDZ fix** (2026-04-27)
  - Variables `vc`, `matCalleDefault`, `mlTomaDefault`, etc. movidas ANTES de los `useState` calls
  - Error original: `Cannot access 'Be' before initialization` (Rollup flattening en producción)
- **Inputs especializados en SolicitudServicio** (2026-04-27)
  - Textarea genérica reemplazada por Selects + number inputs según código de variable reservado
  - Códigos: DIAMETRO_TOMA, DIAMETRO_DESCARGA, MATERIAL_CALLE, MATERIAL_BANQUETA, TIPO_MEDIDOR, PLAN_PAGO_MEDIDOR → Select
  - METROS_TOMA, METROS_DESCARGA, UNIDADES_SERVIDAS, tipo NUMERO → input number
- **CotizacionModal recalcula precios** al cambiar cuantificación (2026-04-27)
  - `onAceptar` de CuantificacionModal ahora pasa los datos al `cotizandoRecord.formData`
- **Catálogos Aquasis — Localidades y Colonias** (2026-04-27)
  - Migration: `20260427000000_aquasis_localidades_colonias`
  - 3,595 localidades (Aquasis Localidad Población) + 3,815 colonias (Colonia Barrio) para 18 municipios QRO
  - Schema: `CatalogoLocalidadINEGI.aquasisPobid` (UK), `CatalogoColoniaINEGI.aquasisBarrId` (UK), `localidadId` FK
  - La tabla intermedia Localidad de Aquasis se usa solo en migración; colonia→localidad es relación directa
  - Scripts obsoletos: `import-inegi-catalog.ts`, `import-localidades-sige-qro.ts` → stubs
  - Backend: `domicilios.service.ts` filtra colonias por `localidadId` (antes por `municipioId`)
  - Frontend: `domicilios-inegi.ts` — interfaces actualizadas con campos Aquasis

- **Ubicación exacta del predio en mapa** (2026-09-02)
  - `components/ui/map-picker.tsx`: port React (react-leaflet, ya instalado) del `MapPicker.vue` de Agora Core: tiles OSM, click/arrastre de marcador, "Ubicar por dirección" (Nominatim acotado a Querétaro), redondeo a 7 decimales; lógica pura en `lib/geo-picker.ts`
  - `DomicilioFormValue` tiene `gpsLat?/gpsLng?` opcionales; `DomicilioPickerForm` muestra el mapa con la prop `conMapa` (activa en StepPredio de `SolicitudServicio` y en el alta de punto de servicio del wizard)
  - Persistencia: viaja en `solicitud.formData.predioDir` y al aceptar la solicitud `predioDirToCreateDomicilioDto` (`predio-geo.ts`) la copia a `Domicilio.gpsLat/gpsLng` → alimenta `GET /gis/padron.geojson` (mapa operativo)
  - Nota: **Sentinel no es un proveedor geográfico**; en Agora es un mapa externo que *lee* `GET /api/v1/tickets/export/geo`. No hay conexión a Sentinel que reutilizar; el equivalente Hydra ya es `/gis/padron.geojson`
  - Env opcional: `VITE_NOMINATIM_EMAIL` (identificación ante Nominatim según su política de uso)
- **Tarifas: versionado, Kardex y clasificación fiscal** (2026-09-03)
  - Modelo: `CategoriaTarifa` (IVA por defecto; DOMESTICA = 0) → `ClaseTarifa` (variantes, IVA heredado u override, `sigeTpsId`) → `Tarifa` versionada por fila (`codigo` + `version`, `tarifaAnteriorId`, vigencias) + `TarifaMovimiento` (Kardex). `TipoContratacion.claseTarifaId` enlaza contrato → clase.
  - Datos: `docs/Tarifas_periodicas.xlsx` → `npm run export:tarifas-periodicas-json` → `backend/prisma/data/tarifas-periodicas.json` → `seedTarifasPeriodicas` (idempotente, no reescribe historia).
  - API y reglas: `docs/tarifas-kardex-api.md`; motor: `docs/motor-tarifas.md` §3. Facturación resuelve tarifas por administración + clase y soporta `tabla`/`lineal`.
  - UI `/app/tarifas`: vigentes con filtros, actualizar (%/valores), actualización masiva con preview, Kardex, configuración fiscal.
  - Tarifas de contratación (`docs/Tarifas_contratacion.xlsx`, 2026-09-03): mismo modelo con `seccion = CONTRATACION`, `variante`, `parametros`, `ivaNoObjeto`; `tipoServicio` prefijado `contratacion_`; `GET /tarifas/contratacion/cotizar`. El wizard sigue usando `lib/cotizacion-tarifas.ts` (JSON estático).

### 🔧 Pendiente / En progreso
- Aplicar migración DB en servidor: `requiereInspeccion = false` para tipos INDIVIDUAL
  - Archivo: `backend/prisma/migrations/20260420150000_individual_no_requiere_inspeccion/migration.sql`
  - Servidor: 35.188.238.10:5433
- **Aplicar migración Aquasis en servidor** (2026-04-27)
  - Archivo: `backend/prisma/migrations/20260427000000_aquasis_localidades_colonias/migration.sql`
  - Servidor: 35.188.238.10:5433
- **DomicilioPickerForm frontend**: actualizar para filtrar colonias por `localidadId` en vez de `municipioId`
- SearchableSelect pendiente en: régimen fiscal/CFDI (PasoPersonas)

### ⚠️ Notas de comportamiento
- `tipoInspeccionMap` en Solicitudes.tsx: usa `(t.requiereInspeccion ?? true) && !t.esIndividualizacion` para determinar si tipo requiere inspección (doble guarda hasta que corra migración)
- El wizard requiere `solicitudId` en la URL para activar precarga directa (`solicitudDirectaQ`)
- `PasoConfigContrato` limpia `variablesCapturadas` al cambiar tipo de contratación — intencional para evitar datos huérfanos
- PDFs guardados en `backend/uploads/cotizaciones/{id}.pdf` (en .gitignore); cuando se migre a bucket S3/GCS solo cambiar `uploadCotizacionPdf()` en `api/solicitudes.ts`
- `SolicitudState.cotizacionItems` — nuevo campo JSONB opcional; guarda los ítems que se mostraron al cliente en la cotización
- **TDZ en producción**: Rollup flatten puede reordenar módulos y exponer `const`/`let` antes de declaración. Si aparece `Cannot access 'Xx' before initialization`, revisar orden de declaraciones en el componente afectado. Fix: mover declaraciones que alimentan `useState(defaultValue)` antes de los useState calls.

---

## Comandos de Desarrollo

```bash
# Frontend
cd frontend && npm run dev          # localhost:8080
cd frontend && npm run build
cd frontend && npx tsc --noEmit     # Type-check

# Backend
cd backend && npm run start:dev     # localhost:3001
cd backend && npx prisma migrate dev
cd backend && npx prisma studio

# Migraciones en producción
cd backend && npx prisma migrate deploy
```

---

## Convenciones del Proyecto

- **IDs:** UUIDs generados por Prisma (`@default(uuid())`)
- **Fechas:** ISO string en frontend, `DateTime` en Prisma
- **snake_case** en BD, **camelCase** en TypeScript
- **JSONB** para `formData` en Solicitud y `variablesCapturadas` en Contrato
- Los catálogos SAT (régimen fiscal, uso CFDI) tienen fallback offline en `lib/sat-catalog-fallback.ts`
- `hasApi()` en `api/client.ts` — devuelve false cuando no hay backend disponible; los componentes lo usan para mostrar datos demo
