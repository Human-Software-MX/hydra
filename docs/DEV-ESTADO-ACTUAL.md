# HYDRA — Estado Actual del Desarrollo
### Documento técnico para presentación al manager de proyecto
**Fecha:** 2026-05-06  
**Versión del sistema:** 0.1.0  
**Preparado por:** Ian Hernández, Desarrollador principal

---

## 1. Resumen ejecutivo

HYDRA es un sistema de gestión comercial y operativa para CEA Querétaro construido como monorepo full-stack (React 18 + NestJS 10 + PostgreSQL). Cubre el ciclo completo contrato-a-cobro: solicitud de servicio → inspección → cotización → contratación → toma → lectura → facturación → cobranza.

**El estado actual puede resumirse así:**

- El **flujo principal de contratación** (Solicitud → Inspección → Cotización → Contrato) funciona de extremo a extremo y es demostrable hoy, incluyendo tipos de servicio que requieren inspección y tipos individualizados que la saltan.
- El **portal de cliente** con autenticación JWT y consulta de recibos, facturas y trámites está operativo.
- La **gestión de maestros** (personas, domicilios con catálogos INEGI/Aquasis, puntos de servicio, tipos de contratación) está completa.
- La **facturación y cobranza** es la brecha más grande del sistema: el motor tarifario existe en frontend pero no está conectado al backend; los importes en prefactura están en cero hasta que se implemente el motor T14 en el servidor.
- Las **integraciones externas** (SIGE/AQUACIS, PAC/SAT, GIS, Ágora, LDAP) están en estado stub o parcialmente operativas.
- Quedan **5 controladores sin JWT Guard** (deuda de seguridad catalogada como REWORK prioritario).

La madurez global del sistema se estima en **~65%** sobre los 6 dominios del PRD, con variación de 42% (prefacturas) a 82% (catálogos operativos).

---

## 2. Tabla de madurez por módulo

### 2.1 Backend — 31 módulos NestJS

| Módulo | % Implementado | Estado | Bloqueadores / Pendientes |
|---|---|---|---|
| `auth` | 85% | Funcional con guards | LDAP preparado pero no productivo; refresh token pendiente |
| `solicitudes` | 78% | Funcional | Órdenes automáticas post-inspección (F-04) en evolución |
| `contratos` | 65% | Funcional | Número de contrato auto-increment OK; candados avanzados pendientes |
| `tipos-contratacion` | 80% | Funcional | Variables dinámicas completas |
| `procesos-contratacion` | 75% | Funcional | Hitos manuales; automación parcial |
| `domicilios` | 80% | Funcional | Frontend pendiente de actualizar filtro colonias por `localidadId` |
| `puntos-servicio` | 82% | Funcional | Cortes/reconexiones en diseño |
| `personas` | 80% | Funcional | Actualización datos fiscales pendiente (PRD_2) |
| `catalogos-operativos` | 82% | Funcional | Seed completo SAT + SIGE + INEGI |
| `ordenes` | 70% | Funcional | Órdenes automáticas post-inspección parciales |
| `tramites` | 72% | Funcional | Firma digital NOM-151 pendiente |
| `quejas` | 70% | Funcional | Integración Ágora pendiente |
| `convenios` | 68% | Funcional | Flujo completo de parcialidades pendiente |
| `recibos` | 68% | Funcional | Generación masiva pendiente |
| `lecturas` | 58% | Funcional (parser) | Validación y endurecimiento pendientes |
| `monitoreo` | 55% | Estructura OK | Lógica de alertas/umbrales incompleta |
| `conciliaciones` | 50% | Estructura OK | ETL de conciliación bancaria incompleto |
| `portal` | 72% | Funcional | Candados por adeudo pendientes |
| `tarifas` | Funcional* | Funcional en frontend | Motor T14 backend no conectado a prefactura |
| `prefacturas` | 42% | Estructura OK | **Bloqueado** por motor tarifario — montos en cero |
| `consumos` | Funcional | Funcional | Solo devuelve confirmados |
| `caja` | Funcional | Funcional | Sin cierre de caja formal |
| `pagos` | Stub+ | Creación funcional | Pago anticipado con descuento pendiente (PRD_2) |
| `timbrados` | Stub | Estructura lista | PAC productivo por validar; CFDI no emite |
| `notificaciones` | Stub | Stub con logs | SendGrid/Twilio no conectados |
| `medidores` | Funcional | Funcional | Sin guards JWT (REWORK) |
| `rutas` | Stub | Estructura lista | Frontend en DataContext mock |
| `agora` | Mock | Mock | Integración real pendiente |
| `gis` | Stub | Estructura + tracker | ArcGIS no conectado |
| `contabilidad` | Stub | Estructura OK | Pólizas SAP parciales (T04) |
| `sige-hydra` | Stub | Estructura + ApiTokenGuard | Sincronización bidireccional incompleta |

> *El motor de tarifas está implementado en `frontend/src/lib/tarifas.ts` y opera correctamente para cotización y simulación. El backend (`/tarifas`) persiste las tarifas pero no las aplica en el cálculo de prefacturas.

### 2.2 Frontend — ~35 páginas React

| Página | Líneas | Estado | Observaciones |
|---|---|---|---|
| `Solicitudes.tsx` | 1,997 | Completa | Lista, filtros, acciones, flujo completo |
| `SolicitudServicio.tsx` | 1,877 | Completa | Formulario + variables dinámicas + domicilio INEGI |
| `Contratos.tsx` | 1,388 | Completa | Lista + wizard 7 pasos + edición |
| `PortalCliente.tsx` | 1,203 | Madurez media-alta | Autenticación JWT CLIENTE funcional |
| `PuntosServicio.tsx` | 982 | Completa | Catálogo completo |
| `AtencionClientes.tsx` | Completa | Completa | Módulo interno de atención |
| `Lecturas.tsx` | Funcional | Funcional | Parser archivo plano operativo |
| `Medidores.tsx` | Funcional | Funcional | Sin endurecimiento |
| `Tarifas.tsx` | Funcional | Funcional | CRUD tarifas OK |
| `TiposContratacion.tsx` | Funcional | Funcional | Variables dinámicas completas |
| `VariablesContratacion.tsx` | Funcional | Funcional | — |
| `PreFacturacion.tsx` | Funcional | Funcional* | Montos en cero por motor T14 |
| `Recibos.tsx` | Funcional | Funcional | — |
| `Convenios.tsx` | Funcional | Funcional | Flujo parcialidades incompleto |
| `Pagos.tsx` | Funcional | Funcional | — |
| `Dashboard.tsx` | Funcional | 6 queries reales | — |
| `Monitoreo.tsx` | Funcional | Estructura OK | Umbrales/alertas pendientes |
| `Catalogos.tsx` | Funcional | Funcional | — |
| `CatalogosContrato.tsx` | Funcional | Funcional | — |
| `TramitesDigitales.tsx` | Funcional | Madurez media | Firma digital pendiente |
| `Rutas.tsx` | Stub | DataContext mock | Backend stub sin service |
| `Construcciones.tsx` | Funcional | API real | `fetchOrdenes`, `updateOrdenEstado` |
| `Factibilidades.tsx` | Funcional | API real | `fetchProcesos`, `avanzarEtapa` |
| `Simulador.tsx` | Funcional | Funcional | Motor tarifas local |
| `Contabilidad.tsx` | Stub | Stub | SAP pendiente |

### 2.3 Madurez por área PRD

| Área PRD | % Madurez | Descripción | Brechas principales |
|---|---|---|---|
| **Área 1** — Gestión de Servicio | ~77% | Maestros personas/domicilios/PS completos | PDF legal único (F-01), convenio en alta (F-02) |
| **Área 2** — Operación de Servicio | ~58% | Parser lecturas operativo | Rutas stub, medidores sin endurecimiento |
| **Área 3** — Administración de Servicio | ~55% | Estructura lista | Motor T14 bloquea importes; prefactura 42% |
| **Área 4** — Calidad y Monitoreo | ~55% | Estructura OK | Umbrales y alertas incompletos |
| **Área 5** — Interfaces de Cliente | ~72% | Portal y trámites madurez media-alta | Candados adeudo, firma digital |
| **Área 6** — Administración e Integraciones | ~46–82% | Varía por integración | LDAP, Ágora, GIS, PAC/SAT no productivos |

---

## 3. Lo que está funcionando hoy (demostrable)

Estas funcionalidades pueden mostrarse en el entorno de producción (GCP 35.188.238.30) o localmente sin preparación adicional:

### 3.1 Flujo de contratación completo (E2E)
1. **Solicitud de servicio** — Formulario con variables dinámicas por tipo de contratación, búsqueda de domicilios INEGI/Aquasis (3,595 localidades, 3,815 colonias QRO), captura de datos de propietario/fiscal/contacto.
2. **Inspección** — Asignación de orden de inspección, captura de datos técnicos (diámetro, material, metros ruptura).
3. **Cotización** — Modal de cuantificación con proyección de cobro en tiempo real. Generación de PDF con `@react-pdf/renderer`. Descarga segura (Bearer JWT, no URL directa).
4. **Aceptación** — Guarda `cotizacionItems` en `solicitud.formData`; crea `Contrato` + `ProcesoContratacion` en backend; redirige al wizard.
5. **Wizard de alta (7 pasos)** — Precarga bidireccional desde solicitud: personas, config, variables, documentos, facturación, órdenes, resumen. Modo solo-lectura + botón "Editar" + sync back a solicitud.
6. **Tipos INDIVIDUAL** — Saltan la inspección (campo `requiereInspeccion = false`, campo `esIndividualizacion = true`), van directo a cotización.

### 3.2 Portal de cliente
- Autenticación JWT con rol `CLIENTE`
- Consulta de recibos, facturas, trámites por contrato
- Contratos asignados al usuario autenticado

### 3.3 Operación
- **Lecturas** — Parser de archivo plano AQUACIS/SIGE, carga por lote, validación básica
- **Pagos y recibos** — Registro de pagos en caja, generación de recibos
- **Órdenes** — CRUD con seguimiento de estado, órdenes de instalación toma/medidor
- **Quejas y trámites** — CRUD completo con seguimiento interno

### 3.4 Catálogos y maestros
- Tipos de contratación con variables dinámicas
- Administraciones, zonas, distritos, actividades
- Catálogos SAT (régimen fiscal, uso CFDI) — con fallback offline
- Catálogos INEGI/Aquasis — cargados en base de datos
- Formularios/opciones: SIGE completo (municipios, actividades, etc.)

### 3.5 Dashboard
- 6 queries reales: contratos activos, solicitudes pendientes, órdenes abiertas, lecturas del mes, etc.

---

## 4. Lo que está en construcción activa

| Funcionalidad | Estado actual | Próximo paso |
|---|---|---|
| Motor tarifario T14 en backend | Tarifas en DB, cálculo solo en frontend | Conectar `tarifas.service` al motor de `prefacturas.service` |
| DomicilioPickerForm (colonias por localidad) | Backend OK, frontend filtra por `municipioId` (obsoleto) | Actualizar query a `localidadId` |
| Órdenes automáticas post-inspección (F-04) | Creación manual funcional | Trigger automático al avanzar etapa inspección |
| Reconexión automática | Flujo diseñado | Implementar condición: pago total / cumplimiento convenio → orden reconexión |
| Convenios de pago (flujo completo) | CRUD básico funcional | Parametrización parcialidades, checklist documentos, asignación facturas |
| Integración SIGE/AQUACIS (T01) | Parser archivo plano operativo para T01 | Sincronización bidireccional pendiente |
| Integración recaudación externa (T02) | ETL TXT/CSV parcial | Conciliación bancaria incompleta |

---

## 5. Brechas críticas vs PRD

Las siguientes brechas tienen impacto directo en la operación y bloquean flujos de negocio:

### F-01 — PDF institucional único (crítica)
**Estado:** No implementado.  
**Descripción:** El PRD requiere un PDF legal único que combine contrato firmado + resumen de alta. Actualmente el sistema genera solo el PDF de cotización. El contrato definitivo no tiene representación PDF.  
**Impacto:** Los contratos no pueden formalizarse digitalmente sin este documento.  
**Esfuerzo estimado:** 3–5 días (plantilla HTML/PDF con datos del contrato + firmas).

### F-02 — Convenio en alta (wizard paso 7)
**Estado:** Flujo separado, no integrado en wizard.  
**Descripción:** El paso 7 del wizard (Resumen) debería permitir crear un convenio de pago inicial al momento de la alta. Actualmente convenios y alta son flujos completamente separados.  
**Impacto:** Clientes con convenio desde el inicio deben ser procesados en dos flujos separados.  
**Esfuerzo estimado:** 2–3 días.

### F-03 — Recálculo de cuantificación visible en paso facturación
**Estado:** Parcial.  
**Descripción:** `PasoFacturacion` muestra los ítems de cotización aprobada, pero no recalcula en tiempo real si se modifican variables en pasos anteriores dentro del mismo wizard.  
**Impacto:** Inconsistencias entre lo cotizado y lo mostrado en facturación si el usuario edita variables.  
**Esfuerzo estimado:** 1–2 días.

### F-04 — Órdenes automáticas post-inspección
**Estado:** En evolución.  
**Descripción:** Las órdenes de instalación (toma, medidor) deberían generarse automáticamente al completar la etapa de inspección. Actualmente se crean manualmente en el paso 5 del wizard.  
**Impacto:** Riesgo de olvido; carga operativa manual.  
**Esfuerzo estimado:** 2 días.

### F-05 — Motor tarifario T14 (bloqueante para facturación)
**Estado:** Motor en frontend, no conectado al backend.  
**Descripción:** `prefacturas.service` devuelve consumos con `total = 0` porque no aplica el motor de tarifas. El motor existe en `frontend/src/lib/tarifas.ts` y funciona correctamente para cotizaciones y simulaciones, pero no está implementado en NestJS.  
**Impacto:** **Toda la facturación periódica está bloqueada.** No se pueden generar recibos reales ni timbrar.  
**Esfuerzo estimado:** 4–6 días (portar lógica de `tarifas.ts` a NestJS + integrar en `prefacturas.service`).

### REWORK — Seguridad: 5 endpoints sin JWT Guard
**Estado:** Identificado, pendiente de aplicar.  
**Controladores expuestos:** `consumos`, `medidores`, `prefacturas`, `rutas`, `timbrados`.  
**Impacto:** Endpoints sensibles accesibles sin autenticación.  
**Esfuerzo estimado:** 4 horas (agregar `@UseGuards(JwtAuthGuard)` + prueba).

---

## 6. Deuda técnica priorizada

| Prioridad | Ítem | Descripción | Esfuerzo |
|---|---|---|---|
| P0 | Motor tarifario T14 en backend | Bloquea facturación completa | 4–6 días |
| P0 | JWT Guards en 5 controladores | Vulnerabilidad de seguridad activa | 4 horas |
| P1 | PDF institucional de contrato (F-01) | Formalización digital bloqueada | 3–5 días |
| P1 | DomicilioPickerForm — colonias por `localidadId` | Frontend desactualizado tras migración Aquasis | 1 día |
| P1 | Aplicar migraciones pendientes en GCP | Ver sección 7 | 2 horas |
| P2 | Reconexión automática | Alto valor operativo, flujo diseñado | 3–4 días |
| P2 | Convenio en alta (F-02) | Integración wizard paso 7 | 2–3 días |
| P2 | Órdenes automáticas post-inspección (F-04) | Reduce carga operativa | 2 días |
| P2 | Notificaciones (email/WhatsApp) | Stub funcional, credenciales pendientes | 2 días + config |
| P3 | Integración LDAP/Entra | Preparado, no productivo | 1–2 días |
| P3 | PAC/SAT CFDI productivo | Estructura lista, validación PAC prod pendiente | 2–3 días |
| P3 | Integración Ágora (tickets/quejas) | Mock funcional | 3–5 días |
| P3 | ETL conciliaciones bancarias (T02) | Parcial, flujo completo pendiente | 3–4 días |
| P3 | GIS/ArcGIS (T05) | Stub + tracker listo | 5–7 días |
| P4 | Refresh token JWT | Sin expiración gestionada actualmente | 1 día |
| P4 | Cierre formal de caja | Caja funcional sin cierre periódico | 1–2 días |
| P4 | Frontend Rutas (DataContext mock) | Backend stub, sin service | 2–3 días |

---

## 7. Migraciones pendientes de aplicar en servidor GCP

El servidor de producción está en **35.188.238.30:5433** (base `hydra`). Las siguientes migraciones están versionadas localmente pero **no han sido aplicadas en producción**:

### Migración 1 — `20260420150000_individual_no_requiere_inspeccion`
```
backend/prisma/migrations/20260420150000_individual_no_requiere_inspeccion/migration.sql
```
**Qué hace:** Establece `requiereInspeccion = false` para los tipos de contratación con `esIndividualizacion = true`.  
**Impacto si no se aplica:** Los tipos INDIVIDUAL siguen mostrando el botón de inspección en producción. El frontend tiene un doble-guard como mitigación temporal (`(t.requiereInspeccion ?? true) && !t.esIndividualizacion`), pero la lógica correcta requiere el campo en DB.

### Migración 2 — `20260427000000_aquasis_localidades_colonias`
```
backend/prisma/migrations/20260427000000_aquasis_localidades_colonias/migration.sql
```
**Qué hace:** Agrega tablas `CatalogoLocalidadINEGI` (3,595 localidades, 18 municipios QRO) y `CatalogoColoniaINEGI` (3,815 colonias) con referencias Aquasis (`aquasisPobid`, `aquasisBarrId`). Cambia la relación colonia → localidad (antes era colonia → municipio).  
**Impacto si no se aplica:** La búsqueda de domicilios en producción no tiene los catálogos Aquasis; el picker de colonias usa datos desactualizados.

### Comando para aplicar en producción
```bash
# Desde el servidor o con acceso remoto a la VM GCP
cd /path/to/contract-to-cash-flow/backend
DATABASE_URL=postgresql://[user]:[pass]@35.188.238.30:5433/hydra \
  npx prisma migrate deploy
```

> **Nota:** Después de aplicar la migración Aquasis es necesario re-ejecutar el seed de localidades y colonias para poblar los 7,410 registros de catálogo.

---

## 8. Cómo correr el proyecto localmente

### Opción A — Docker Compose (recomendada, sin instalaciones adicionales)

```bash
# Clonar repositorio
git clone <repo-url>
cd contract-to-cash-flow

# Levantar todo el stack (PostgreSQL + API + Frontend)
docker compose up -d

# La primera vez: api-migrate ejecuta migraciones y seed automáticamente
# Esperar ~2 minutos para que el build esté completo

# Verificar estado
docker compose ps
docker compose logs api --tail=20
```

| Servicio | URL |
|---|---|
| Frontend | http://localhost:8080 |
| Backend API | http://localhost:3001 |
| PostgreSQL | localhost:5432 (user: `postgres`, pass: `postgres`, db: `ctcf_dev`) |

### Opción B — Desarrollo local (hot-reload)

**Prerrequisitos:** Node.js 20+, PostgreSQL 15+ corriendo localmente o vía Docker.

```bash
# 1. Base de datos (solo PostgreSQL vía Docker)
docker run -d --name hydra-pg \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ctcf_dev \
  -p 5432:5432 postgres:15-alpine

# 2. Backend
cd backend
cp .env.example .env           # Ajustar DATABASE_URL y JWT_SECRET
npm install
npx prisma migrate dev          # Aplica migraciones + seed
npm run start:dev               # http://localhost:3001

# 3. Frontend (nueva terminal)
cd frontend
cp .env.example .env.local      # VITE_API_BASE_URL=http://localhost:3001
npm install
npm run dev                     # http://localhost:8080
```

**Variables de entorno clave (backend):**

| Variable | Valor local | Descripción |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/ctcf_dev` | Conexión PostgreSQL |
| `JWT_SECRET` | `dev-jwt-secret-change-in-production` | Secreto JWT (cambiar en prod) |
| `CORS_ORIGIN` | `http://localhost:8080` | Origen permitido |
| `PORT` | `3001` | Puerto del API |

**Variables de entorno clave (frontend):**

| Variable | Valor local | Descripción |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:3001` | URL del API backend |

### Comandos de desarrollo frecuentes

```bash
# Verificar tipos TypeScript (frontend)
cd frontend && npx tsc --noEmit

# Explorar base de datos visualmente
cd backend && npx prisma studio     # http://localhost:5555

# Generar cliente Prisma tras cambios en schema
cd backend && npx prisma generate

# Crear nueva migración
cd backend && npx prisma migrate dev --name nombre_de_la_migracion

# Build de producción (frontend)
cd frontend && npm run build

# Aplicar migraciones en producción (sin seed)
cd backend && npx prisma migrate deploy
```

### Acceso a producción

| Entorno | URL |
|---|---|
| Producción GCP | http://35.188.238.30 (Easypanel) |
| API producción | http://35.188.238.30:3001 |
| PostgreSQL producción | 35.188.238.30:5433 (base: `hydra`) |

---

## 9. Base de datos — resumen técnico

| Dato | Valor |
|---|---|
| Motor | PostgreSQL 15 |
| ORM | Prisma 6 |
| Modelos | 93 (incluyendo catálogos) |
| Migraciones versionadas | 26 |
| Seed incluye | Catálogos SAT/CFDI, tipos de contratación SIGE, INEGI/Aquasis (7,410 registros) |
| JSONB en uso | `Solicitud.formData`, `Contrato.variablesCapturadas` |
| Convención IDs | UUID v4 (`@default(uuid())`) |
| Numeración contratos | Auto-increment desde 100001 (`@default(autoincrement())`) |

**Dominios modelados (10 grupos):**
1. Flujo principal: Solicitud → Contrato → ProcesoContratacion
2. Personas y domicilios (normalizado con claves INEGI/Aquasis)
3. Puntos de servicio, tomas, medidores
4. Lecturas, consumos, prefacturas, timbrados (CFDI)
5. Recibos, pagos, caja, convenios
6. Órdenes y seguimiento
7. Trámites, quejas, Ágora
8. Catálogos (operativos + SAT + tipos de contratación)
9. Integraciones (SIGE, GIS, contabilidad)
10. Portal, usuarios, autenticación

---

## 10. Integraciones — estado

| Integración | Clave | Estado | Notas |
|---|---|---|---|
| AQUACIS/SIGE (archivo plano) | T01 | Operativo parcial | Parser lecturas funcional; sincronización bidireccional pendiente |
| Recaudación externa (OXXO, BBVA, Banorte) | T02 | Operativo parcial | ETL TXT/CSV funcional; conciliación incompleta |
| SAP/ERP (pólizas) | T04 | Parcial | Módulo `contabilidad` con guards; lógica de pólizas incompleta |
| PAC/SAT CFDI | — | Parcial | Estructura lista; PAC productivo por validar; no emite CFDIs |
| GIS/ArcGIS | T05 | Stub | Tracker de cambios implementado; conexión ArcGIS pendiente |
| LDAP/Microsoft Entra | — | Preparado | `ldap.strategy.ts` existe; no productivo |
| Ágora (tickets/quejas) | — | Mock | Controller con guard; datos mock |
| PorCobrar | — | Diseño | Sin implementación |
| Notificaciones (email/WhatsApp) | — | Stub | Logger funcional; SendGrid/Twilio pendientes |

---

*Documento generado: 2026-05-06. Para preguntas técnicas contactar al desarrollador principal.*
