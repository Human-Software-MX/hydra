# HYDRA — Arquitectura Técnica Implementada

> Documento de referencia técnica para el sistema Contract-to-Cash-Flow (HYDRA).
> Generado: 2026-05-06

---

## Tabla de Contenidos

1. [Diagrama General de Arquitectura](#1-diagrama-general-de-arquitectura)
2. [Stack Tecnológico](#2-stack-tecnológico)
3. [Estructura de Módulos Frontend](#3-estructura-de-módulos-frontend)
4. [Estructura de Módulos Backend](#4-estructura-de-módulos-backend)
5. [Modelo de Datos — Dominios](#5-modelo-de-datos--dominios)
6. [Flujo de Autenticación](#6-flujo-de-autenticación)
7. [Motor Tarifario Dual](#7-motor-tarifario-dual)
8. [Generación y Gestión de PDFs](#8-generación-y-gestión-de-pdfs)
9. [Configuración de Deploy](#9-configuración-de-deploy)
10. [Variables de Entorno Requeridas](#10-variables-de-entorno-requeridas)
11. [URLs y Puertos](#11-urls-y-puertos)
12. [CORS y Segregación de Canales](#12-cors-y-segregación-de-canales)

---

## 1. Diagrama General de Arquitectura

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GCP VM  35.188.238.30                               │
│                         Easypanel (Docker Compose)                          │
│                                                                             │
│  ┌─────────────────────┐        ┌──────────────────────────────────────┐   │
│  │   FRONTEND           │        │   BACKEND (API)                      │   │
│  │   Nginx              │        │   NestJS 10                          │   │
│  │   (build Vite)       │ HTTP   │   31 módulos                         │   │
│  │                      │───────▶│   Puerto 3000                        │   │
│  │   Puerto 80/443      │        │                                      │   │
│  │                      │        │   Prisma 6.8.2 ORM                   │   │
│  │   /app  → internos   │        │                     │                │   │
│  │   /portal → clientes │        └─────────────────────┼────────────────┘   │
│  └─────────────────────┘                               │                    │
│                                                         │ TCP 5432           │
│                                              ┌──────────▼──────────┐        │
│                                              │   PostgreSQL         │        │
│                                              │   Volumen persistente│        │
│                                              └──────────────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
         │                                          │
         │ Proxy dev                                │ Integraciones externas
         ▼                                          ▼
┌─────────────────────┐              ┌──────────────────────────┐
│ CEA Web Services    │              │ Aquasis (Aquacis CF)     │
│ appcea.ceaqueretaro │              │ aquacis-cf-int...        │
│   .gob.mx           │              │  /Comercial              │
│ /ceadevws (proxy)   │              │ /aquacis-cea (proxy)     │
└─────────────────────┘              └──────────────────────────┘

Actores:
  [Interno: SUPER_ADMIN / ADMIN / OPERADOR / LECTURISTA / ATENCION_CLIENTES]
       └──▶ https://<host>/app  (React SPA — AppLayout)
  [Cliente: CLIENTE]
       └──▶ https://<host>/portal  (React SPA — PortalLayout)
  [Server-to-Server]
       └──▶ API con ApiTokenGuard (header Authorization: ApiToken <token>)
```

---

## 2. Stack Tecnológico

### Frontend

| Tecnología              | Versión  | Rol                                          |
|-------------------------|----------|----------------------------------------------|
| React                   | 18.3.1   | UI framework                                 |
| TypeScript              | 5.8.3    | Tipado estático                              |
| Vite                    | 7.3.1    | Bundler / dev server                         |
| Tailwind CSS            | latest   | Utility-first CSS                            |
| shadcn/ui               | —        | 45+ componentes sobre Radix UI               |
| TanStack Query          | 5.x      | Server-state, cache, sincronización          |
| React Router            | 6.x      | Enrutamiento SPA + RBAC en routes.ts         |
| @react-pdf/renderer     | 4.5.1    | Generación de PDFs en browser                |
| Recharts                | latest   | Gráficas y KPIs                              |
| React Hook Form         | latest   | Formularios                                  |
| Zod                     | latest   | Validación de esquemas (compartido)          |

**Notas de build:**
- `@react-pdf/renderer` se incluye en chunk separado (`manualChunks` en `vite.config.ts`) para evitar error TDZ (Temporal Dead Zone) en la inicialización del módulo.
- Proxies de desarrollo configurados en Vite (ver §11).

### Backend

| Tecnología              | Versión  | Rol                                          |
|-------------------------|----------|----------------------------------------------|
| NestJS                  | 10.x     | Framework API REST                           |
| Prisma                  | 6.8.2    | ORM + migraciones                            |
| PostgreSQL               | 16.x     | Base de datos relacional                     |
| bcrypt                  | —        | Hash de contraseñas                          |
| passport-jwt            | —        | Estrategia JWT                               |
| multer                  | —        | Upload de archivos (PDFs cotización)         |
| Zod                     | —        | Validación en endpoints seleccionados        |

### Infraestructura

| Componente   | Detalle                                              |
|--------------|------------------------------------------------------|
| Cloud        | GCP VM — IP pública `35.188.238.30`                  |
| Orquestación | Easypanel (UI sobre Docker)                          |
| Containers   | Docker Compose — 3 servicios: `postgres`, `api`, `frontend` |
| Reverse Proxy| Easypanel / Nginx (SSL termination)                  |

---

## 3. Estructura de Módulos Frontend

```
frontend/src/
├── api/                    # 26 módulos cliente HTTP (fetch + TanStack Query)
│   ├── solicitudes.ts
│   ├── contratos.ts
│   ├── procesos-contratacion.ts
│   ├── personas.ts
│   ├── lecturas.ts
│   ├── recibos.ts
│   └── ... (21 módulos más)
│
├── components/
│   ├── AppLayout.tsx        # Shell interno: sidebar, nav, permisos por rol
│   ├── PortalLayout.tsx     # Shell cliente: navbar, acceso limitado
│   ├── wizard/              # Wizard de 7 pasos para nueva solicitud
│   └── ui/                  # Componentes Shadcn/Radix reutilizables
│
├── config/
│   └── routes.ts            # Definición de rutas con RBAC (allowedRoles por ruta)
│
├── context/
│   ├── AuthContext.tsx      # JWT: login, logout, validación de expiración, rol activo
│   └── DataContext.tsx      # Estado global de datos compartidos
│
├── data/
│   ├── tarifas-agua.json           # 344 KB — motor tarifario periódico (13 admins, 201 precios)
│   └── tarifas-contratacion.json   # Motor tarifario por variable (longitud, diámetro)
│
├── hooks/
│   ├── usePermissions.ts           # Verificación de permisos por rol
│   └── useSolicitudesStore.ts      # Persistencia de solicitudes en localStorage
│
├── lib/
│   ├── tarifa-engine.ts            # Cálculo tarifas agua periódica
│   ├── tarifa-contratacion.ts      # Cálculo tarifas cotización/contratación
│   ├── cotizacion-pdf.tsx          # Template PDF cotización (@react-pdf/renderer)
│   ├── cobro-agua-pdf.tsx          # Template PDF recibo agua
│   └── validaciones-wizard.ts     # Validaciones Zod para los 7 pasos del wizard
│
├── pages/                   # ~40 páginas organizadas por dominio
│   ├── app/                 # Páginas internas (internos)
│   └── portal/              # Páginas portal cliente
│
├── types/
│   ├── SolicitudState.ts    # Estado del wizard y solicitud
│   └── OrdenInspeccionData.ts
│
└── App.tsx                  # Router raíz + providers (QueryClient, AuthContext, DataContext)
```

### Wizard de 7 Pasos (Nueva Solicitud / Contratación)

```
Paso 1: Tipo de contratación + datos básicos
Paso 2: Domicilio (INEGI 4 niveles: Estado → Municipio → Localidad → Colonia)
Paso 3: Datos del solicitante (Persona)
Paso 4: Configuración técnica (diámetro, longitud, etc.)
Paso 5: Cotización (motor tarifario + preview PDF)
Paso 6: Documentación requerida
Paso 7: Confirmación y envío
```

---

## 4. Estructura de Módulos Backend

**31 módulos NestJS** compuestos en `app.module.ts`:

```
backend/src/modules/
│
├── auth/                    # Autenticación y autorización
│   ├── estrategias JWT (passport-jwt)
│   ├── LDAP / Microsoft Entra (preparado, no productivo)
│   └── Guards: JwtAuthGuard, RolesGuard, PortalGuard, ApiTokenGuard, InternalGuard
│
├── solicitudes/             # Ciclo de vida de solicitudes de contratación
│   ├── CRUD completo + máquina de estados
│   ├── Gestión de inspección técnica
│   └── Upload/download de PDF cotización (multer)
│
├── contratos/               # Gestión de contratos activos
│   ├── CRUD + historial
│   └── billing-engine (hook de facturación)
│
├── procesos-contratacion/   # Flujo E2E de contratación
│   ├── 6 etapas secuenciales
│   ├── Hitos de proceso
│   └── Órdenes automáticas por etapa
│
├── tipos-contratacion/      # Parametrización de tipos de servicio
│   ├── Conceptos de cobro por tipo
│   ├── Cláusulas contractuales
│   ├── Documentos requeridos
│   └── Variables configurables
│
├── domicilios/              # Gestión de domicilios
│   ├── CRUD
│   └── Catálogos INEGI 4 niveles (Estado/Municipio/Localidad/Colonia)
│
├── puntos-servicio/         # Puntos de suministro
│   ├── CRUD
│   └── Relaciones padre-hijo (toma → servicio)
│
├── personas/                # Gestión de personas físicas/morales
│   ├── CRUD
│   └── Roles en contratos (titular, copropietario, representante)
│
├── lecturas/                # Proceso de lectura de medidores
│   ├── Lotes de lectura
│   ├── Lecturas individuales
│   └── Incidencias de lectura
│
├── consumos/                # Tipos de consumo
│   └── real | estimado | fijo
│
├── timbrados/               # CFDI / Facturación electrónica
│   └── Estados: OK | Error PAC | Pendiente
│
├── recibos/                 # Recibos de cobro
│   └── Saldo vigente + saldo vencido
│
├── pagos/                   # Registro de pagos (stub — en desarrollo)
│
├── convenios/               # Convenios de pago
│   └── Parcialidades + anticipo
│
├── ordenes/                 # Órdenes de campo
│   ├── Tipos: instalación | corte | reconexión
│   └── Seguimiento de órdenes
│
├── tramites/                # Trámites administrativos
│   ├── Documentos adjuntos
│   ├── Seguimiento
│   └── Notificaciones
│
├── quejas/                  # Quejas y aclaraciones
│   ├── Queja / Aclaración
│   └── Integración Ágora (tickets)
│
├── tarifas/                 # Motor tarifario backend
│   ├── Motor dual: periódico + contratación
│   └── T14: estructura lista, montos prefactura en cero (prioridad F3 PRD)
│
├── monitoreo/               # Dashboard de KPIs operativos
│
├── conciliaciones/          # Conciliación de pagos externos
│   ├── ETL de pagos externos
│   └── Match automático
│
├── caja/                    # Módulo de caja
│   ├── Sesiones de caja
│   └── Arqueo
│
├── portal/                  # API exclusiva del portal cliente
│   └── assertOwns() — validación de propiedad de recursos
│
├── prefacturas/             # Prefacturación masiva
│   └── Proceso por período
│
├── catalogos-operativos/    # Catálogos de operación
│   └── Administraciones, SAT, actividades, distritos
│
├── notificaciones/          # Notificaciones (stub)
│   └── Email / WhatsApp
│
├── medidores/               # Gestión de medidores
│   ├── Bodega (inventario)
│   └── Instalados (en campo)
│
├── agora/                   # Integración Ágora (mock)
│   └── Tickets mock
│
├── gis/                     # Integración GIS (stub)
│   ├── Delta sincronización
│   └── LogSincronizacion
│
├── contabilidad/            # Integración contabilidad (stub)
│   └── Pólizas SAP
│
├── sige-hydra/              # Mapeo sistema legacy SIGE
│
└── rutas/                   # Gestión de rutas (stub)
```

---

## 5. Modelo de Datos — Dominios

**51 modelos Prisma** organizados en 17 dominios:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  DOMINIO              │  MODELOS PRISMA                                  │
├───────────────────────┼──────────────────────────────────────────────────┤
│ Territorial           │  Administracion, Zona, Distrito, Ruta            │
├───────────────────────┼──────────────────────────────────────────────────┤
│ Obras                 │  Factibilidad, Construccion, Toma                │
├───────────────────────┼──────────────────────────────────────────────────┤
│ Contratos             │  Contrato, CostoContrato, ContratoConcepto,      │
│                       │  Medidor, MedidorBodega                          │
├───────────────────────┼──────────────────────────────────────────────────┤
│ Personas              │  Persona, RolPersonaContrato, DomicilioPersona   │
├───────────────────────┼──────────────────────────────────────────────────┤
│ INEGI                 │  Domicilio, CatalogoEstadoINEGI,                 │
│                       │  CatalogoMunicipioINEGI, CatalogoLocalidadINEGI, │
│                       │  CatalogoColoniaINEGI                            │
├───────────────────────┼──────────────────────────────────────────────────┤
│ Tipos Contratación    │  TipoContratacion, VariableTipoContratacion,     │
│                       │  TipoVariable, ConceptoCobro,                    │
│                       │  ConceptoCobroTipoContratacion,                  │
│                       │  ClausulaContractual, ClausulaTipoContratacion,  │
│                       │  DocumentoRequeridoTipoContratacion,             │
│                       │  ClaseContrato, CatalogoTipoRelacionPS           │
├───────────────────────┼──────────────────────────────────────────────────┤
│ Punto de Servicio     │  PuntoServicio, CatalogoTipoSuministro,          │
│                       │  CatalogoEstructuraTecnica,                      │
│                       │  CatalogoZonaFacturacion,                        │
│                       │  CatalogoCodigoRecorrido, CatalogoTipoCorte      │
├───────────────────────┼──────────────────────────────────────────────────┤
│ Lecturas              │  LoteLecturas, Lectura, CatalogoIncidencia,      │
│                       │  Lecturista, Contratista, MensajeLecturista,     │
│                       │  Consumo                                         │
├───────────────────────┼──────────────────────────────────────────────────┤
│ Facturación           │  Timbrado, Recibo, Pago, PagoExterno, Convenio, │
│                       │  Anticipo, SesionCaja, FormaPago, MensajeRecibo  │
├───────────────────────┼──────────────────────────────────────────────────┤
│ Órdenes               │  Orden, SeguimientoOrden                         │
├───────────────────────┼──────────────────────────────────────────────────┤
│ Quejas                │  QuejaAclaracion, SeguimientoQueja, AgoraTicket  │
├───────────────────────┼──────────────────────────────────────────────────┤
│ Trámites              │  Tramite, SeguimientoTramite, Documento,         │
│                       │  CatalogoTramite, HistoricoContrato              │
├───────────────────────┼──────────────────────────────────────────────────┤
│ Contabilidad          │  ReglaContable, Poliza, LineaPoliza               │
├───────────────────────┼──────────────────────────────────────────────────┤
│ GIS                   │  LogSincronizacion, CambioGIS                    │
├───────────────────────┼──────────────────────────────────────────────────┤
│ Motor Tarifario       │  Tarifa, CorreccionTarifaria, AjusteTarifario,   │
│                       │  ActualizacionTarifaria                          │
├───────────────────────┼──────────────────────────────────────────────────┤
│ Catálogos Medidores   │  CatalogoMarcaMedidor, CatalogoModeloMedidor,    │
│                       │  CatalogoCalibre, CatalogoEmplazamiento,         │
│                       │  CatalogoTipoContador                            │
├───────────────────────┼──────────────────────────────────────────────────┤
│ Catálogos Generales   │  CatalogoActividad, CatalogoGrupoActividad,      │
│                       │  CatalogoCategoria, CatalogoSat, TipoOficina,    │
│                       │  Oficina, SectorHidraulico, TipoVia              │
└───────────────────────┴──────────────────────────────────────────────────┘
```

---

## 6. Flujo de Autenticación

### Roles del sistema

| Rol                | Acceso               | Descripción                              |
|--------------------|----------------------|------------------------------------------|
| `SUPER_ADMIN`      | `/app`               | Acceso total, configuración del sistema  |
| `ADMIN`            | `/app`               | Gestión operativa completa               |
| `OPERADOR`         | `/app`               | Operación diaria (solicitudes, contratos)|
| `LECTURISTA`       | `/app`               | Solo módulo de lecturas                  |
| `ATENCION_CLIENTES`| `/app`               | Atención a clientes, quejas, trámites    |
| `CLIENTE`          | `/portal`            | Autoservicio cliente final               |

### Flujo JWT

```
┌──────────┐   POST /auth/login        ┌──────────────┐
│ Usuario  │ ─────────────────────────▶│  NestJS API  │
│          │   {email, password}        │              │
│          │◀─────────────────────────  │  bcrypt hash │
│          │   { access_token (JWT) }   │  + JWT sign  │
└──────────┘                           └──────────────┘
     │
     │ localStorage.setItem('ctcf_access_token', token)
     ▼
┌──────────────────────────────────────────────┐
│  AuthContext.tsx                              │
│  - Decodifica JWT en cliente                 │
│  - Valida expiración (exp claim)             │
│  - Expone: user, rol, isAuthenticated        │
│  - logout() limpia localStorage              │
└──────────────────────────────────────────────┘
     │
     │ Authorization: Bearer <token>
     ▼
┌──────────────────────────────────────────────┐
│  Guards NestJS (en orden de ejecución)        │
│                                              │
│  JwtAuthGuard    → valida firma del JWT      │
│  RolesGuard      → verifica rol en @Roles()  │
│  PortalGuard     → solo permite rol CLIENTE  │
│  ApiTokenGuard   → server-to-server token    │
│  InternalGuard   → bloquea acceso externo    │
└──────────────────────────────────────────────┘
```

### LDAP / Microsoft Entra

- Infraestructura preparada en módulo `auth/`
- **No productivo en la implementación actual**
- Activación pendiente de configuración de tenant

### Segregación de rutas

```
/app/*     → Solo roles internos (SUPER_ADMIN, ADMIN, OPERADOR, LECTURISTA, ATENCION_CLIENTES)
             PortalGuard rechaza CLIENTE aquí

/portal/*  → Solo rol CLIENTE
             assertOwns() en cada endpoint: valida que el recurso pertenece al usuario autenticado
```

---

## 7. Motor Tarifario Dual

El sistema implementa **dos motores tarifarios** que operan en paralelo:

### Motor 1 — Agua Periódica (frontend)

Calcula el cargo por consumo de agua en recibos periódicos.

```
Fuente:  frontend/src/data/tarifas-agua.json  (344 KB)
Lógica:  frontend/src/lib/tarifa-engine.ts

Estructura del JSON:
{
  "administraciones": [
    {
      "id": "ADM-01",
      "nombre": "...",
      "tarifas": [
        { "m3": 0,   "precio": 0.00 },
        { "m3": 1,   "precio": 12.50 },
        ...
        { "m3": 200, "precio": X.XX }   // 201 rangos por administración
      ]
    },
    ... // 13 administraciones en total
  ]
}

Funcionamiento:
  consumo (m³) + administración → lookup tabla → monto a cobrar
```

### Motor 2 — Cotización / Contratación (frontend)

Calcula los derechos de contratación para nuevos servicios.

```
Fuente:  frontend/src/data/tarifas-contratacion.json
Lógica:  frontend/src/lib/tarifa-contratacion.ts

Variables de entrada:
  - longitud (m)      → cargo por metro lineal de tubería
  - diámetro (pulg)   → factor multiplicador por calibre
  - tipo_contratacion → selecciona tabla tarifaria aplicable

Salida:
  - Desglose de conceptos de cobro
  - Total cotización
  - Input para generación de PDF cotización
```

### Motor 3 — T14 Backend (en desarrollo)

```
Estado: Estructura de módulo lista en backend/src/modules/tarifas/
        Modelos Prisma definidos: Tarifa, CorreccionTarifaria,
                                   AjusteTarifario, ActualizacionTarifaria
        Montos en prefactura: actualmente en CERO
        Prioridad: F3 según PRD
```

### Flujo de cálculo para una solicitud nueva

```
Usuario ingresa datos técnicos (Wizard Paso 4)
         │
         ▼
tarifa-contratacion.ts
  lee tarifas-contratacion.json
  aplica variables: longitud, diámetro, tipo
         │
         ▼
Desglose de conceptos (Wizard Paso 5)
         │
         ├──▶ Preview PDF en navegador (cotizacion-pdf.tsx)
         │
         └──▶ POST /solicitudes/:id/cotizacion-pdf
                  multer → almacena PDF en servidor
```

---

## 8. Generación y Gestión de PDFs

| Aspecto           | Detalle                                                   |
|-------------------|-----------------------------------------------------------|
| Librería          | `@react-pdf/renderer` v4.5.1                              |
| Build             | Chunked en Vite (`manualChunks`) — evita error TDZ        |
| Template cotización | `frontend/src/lib/cotizacion-pdf.tsx`                   |
| Template cobro agua | `frontend/src/lib/cobro-agua-pdf.tsx`                   |
| Upload            | `POST /solicitudes/:id/cotizacion-pdf` (multer, JWT req.) |
| Download          | `GET /solicitudes/:id/cotizacion-pdf` (JWT req.)          |

```
// Fragmento relevante vite.config.ts (manualChunks)
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'react-pdf': ['@react-pdf/renderer'],
      }
    }
  }
}
```

---

## 9. Configuración de Deploy

### Docker Compose

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - hydra_net

  api:
    build: ./backend
    command: >
      sh -c "npx prisma migrate deploy &&
             npx prisma db seed &&
             node dist/main"
    environment:
      DATABASE_URL: ${DATABASE_URL}
      JWT_SECRET: ${JWT_SECRET}
      # ... (ver §10)
    depends_on:
      - postgres
    ports:
      - "3000:3000"
    networks:
      - hydra_net

  frontend:
    build: ./frontend
    # Nginx sirve el build de Vite
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - api
    networks:
      - hydra_net

volumes:
  postgres_data:

networks:
  hydra_net:
    driver: bridge
```

### Secuencia de arranque del contenedor `api`

```
1. prisma migrate deploy   → aplica migraciones pendientes sobre PostgreSQL
2. prisma db seed          → datos iniciales (catálogos, usuario SUPER_ADMIN, etc.)
3. node dist/main.js       → inicia servidor NestJS en puerto 3000
```

### Build del contenedor `frontend`

```dockerfile
# Etapa build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build          # vite build → dist/

# Etapa producción
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

---

## 10. Variables de Entorno Requeridas

### Backend (`api`)

| Variable                  | Descripción                                          | Ejemplo                                      |
|---------------------------|------------------------------------------------------|----------------------------------------------|
| `DATABASE_URL`            | Cadena de conexión Prisma a PostgreSQL               | `postgresql://user:pass@postgres:5432/hydra` |
| `JWT_SECRET`              | Secreto para firma de tokens JWT                     | `<string aleatorio 64+ chars>`               |
| `JWT_EXPIRATION`          | Tiempo de vida del token                             | `8h`                                         |
| `CORS_ORIGIN`             | Origen legacy (canal único)                          | `https://app.hydra.com`                      |
| `CORS_INTERNAL_ORIGIN`    | Origen del frontend interno (`/app`)                 | `https://app.hydra.com`                      |
| `CORS_PORTAL_ORIGIN`      | Origen del portal cliente (`/portal`)                | `https://portal.hydra.com`                   |
| `API_TOKEN`               | Token para autenticación server-to-server            | `<token seguro>`                             |
| `POSTGRES_HOST`           | Host de PostgreSQL (interno en Docker)               | `postgres`                                   |
| `POSTGRES_PORT`           | Puerto PostgreSQL                                    | `5432`                                       |
| `POSTGRES_DB`             | Nombre de la base de datos                           | `hydra`                                      |
| `POSTGRES_USER`           | Usuario PostgreSQL                                   | `hydra_user`                                 |
| `POSTGRES_PASSWORD`       | Contraseña PostgreSQL                                | `<password seguro>`                          |

### Frontend (`frontend`, tiempo de build Vite)

| Variable                  | Descripción                                          | Ejemplo                                      |
|---------------------------|------------------------------------------------------|----------------------------------------------|
| `VITE_API_URL`            | URL base de la API NestJS                            | `https://api.hydra.com`                      |
| `VITE_APP_TITLE`          | Título de la aplicación                              | `HYDRA`                                      |

### PostgreSQL (`postgres`)

| Variable            | Descripción                   |
|---------------------|-------------------------------|
| `POSTGRES_DB`       | Nombre de la base de datos    |
| `POSTGRES_USER`     | Usuario administrador         |
| `POSTGRES_PASSWORD` | Contraseña                    |

---

## 11. URLs y Puertos

### Producción

| Servicio              | URL / Endpoint                              | Puerto |
|-----------------------|---------------------------------------------|--------|
| Frontend (app interna)| `https://<host>/app`                        | 443    |
| Frontend (portal)     | `https://<host>/portal`                     | 443    |
| API REST              | `https://<host>/api/v1/...`                 | 443    |
| Servidor GCP          | `35.188.238.30`                             | —      |

### Desarrollo local

| Servicio    | URL                          | Puerto |
|-------------|------------------------------|--------|
| Frontend    | `http://localhost:5173`      | 5173   |
| API         | `http://localhost:3000`      | 3000   |
| PostgreSQL  | `localhost:5432`             | 5432   |

### Proxies de desarrollo (Vite `vite.config.ts`)

```typescript
server: {
  proxy: {
    '/ceadevws': {
      target: 'https://appcea.ceaqueretaro.gob.mx',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/ceadevws/, ''),
    },
    '/aquacis-cea': {
      target: 'https://aquacis-cf-int.ceaqueretaro.gob.mx/Comercial',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/aquacis-cea/, ''),
    },
  },
},
```

| Proxy local         | Destino externo                                           |
|---------------------|-----------------------------------------------------------|
| `/ceadevws`         | `https://appcea.ceaqueretaro.gob.mx` (Web Services CEA)  |
| `/aquacis-cea`      | `https://aquacis-cf-int.ceaqueretaro.gob.mx/Comercial`   |

---

## 12. CORS y Segregación de Canales

### 3 canales CORS configurados

```typescript
// backend/src/main.ts (esquema)
app.enableCors({
  origin: [
    process.env.CORS_ORIGIN,           // legacy (canal único anterior)
    process.env.CORS_INTERNAL_ORIGIN,  // frontend interno /app
    process.env.CORS_PORTAL_ORIGIN,    // portal cliente /portal
  ],
  credentials: true,
});
```

### Separación de contextos

```
Canal INTERNAL  ──▶  /app/*       Usuarios internos con roles operativos
                     Guards: JwtAuthGuard + RolesGuard
                     Roles permitidos: SUPER_ADMIN, ADMIN, OPERADOR,
                                       LECTURISTA, ATENCION_CLIENTES

Canal PORTAL    ──▶  /portal/*    Solo CLIENTE
                     Guards: JwtAuthGuard + PortalGuard
                     assertOwns() en cada endpoint del módulo portal/

Canal API_TOKEN ──▶  endpoints internos server-to-server
                     Guard: ApiTokenGuard
                     Uso: integraciones, ETL, conciliaciones externas
```

---

*Documento técnico interno — HYDRA / Contract-to-Cash-Flow*
*Última actualización: 2026-05-06*
