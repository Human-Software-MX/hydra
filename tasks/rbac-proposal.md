# Propuesta RBAC — segmentación de roles internos (GATE A carryover)

**Estado:** PROPUESTA. No implementado. Requiere aprobación de Fernando antes de cablear `@Roles(...)`.
**Fecha:** 2026-08-11
**Origen:** Hallazgo de GATE A — los roles internos no están segmentados. Ningún controlador declara `@Roles(...)`, así que el `RolesGuard` global es un no-op: cualquier rol interno (incl. `LECTURISTA`) alcanza `/pagos`, `/contabilidad`, `/tarifas`, etc. El `InternalGuard` sólo separa interno-vs-portal, no roles entre sí.

## Por qué es sólo propuesta (no lo cablié)

- El frontend YA filtra el menú por rol (`frontend/src/config/routes.ts`, `routesForRole()`), pero eso es cosmético: la API responde igual a cualquier rol interno con un token válido. Un `LECTURISTA` puede llamar `POST /contabilidad/...` con curl.
- Cablear `@Roles(...)` a ciegas puede ROMPER el frontend: si un endpoint que la UI llama de forma transversal (catálogos, búsqueda de contratos, perfil) queda restringido, pantallas permitidas dejan de cargar. Por eso el mapeo debe validarse contra las llamadas reales de cada página antes de aplicarse.
- Fuente de verdad para el mapeo: los `allowedRoles` de cada ruta del menú (`routes.ts`) + el set de permisos por rol de `frontend/src/hooks/usePermissions.ts`.

## Enum de roles (fuente: `backend/prisma/schema.prisma`, `enum UserRole`)

`SUPER_ADMIN`, `ADMIN`, `OPERADOR`, `LECTURISTA`, `ATENCION_CLIENTES`, `CLIENTE`.

> Nota: el audit mencionaba `CAJERO`/`CONTABILIDAD` como ejemplos, pero **esos roles NO existen** en el enum. Hoy "caja/pagos" y "contabilidad" se gobiernan por `ADMIN`/`ATENCION_CLIENTES`. Si se quiere granularidad de cajero/contador hay que AÑADIR roles al enum (migración) — decisión de producto aparte de esta propuesta.

## Matriz propuesta: grupo de módulos → roles con acceso

Derivada 1:1 de `allowedRoles` en `routes.ts`. `SUPER_ADMIN` y `ADMIN` acceden a todo (no se listan por celda; asúmase ✓ en todas).

| Grupo / Módulo backend | Controladores (`backend/src/modules/...`) | OPERADOR | LECTURISTA | ATENCION_CLIENTES |
|---|---|:--:|:--:|:--:|
| Dashboard / salud | `app.controller` (`/health` es `@Public`) | ✓ | ✓ | ✓ |
| Factibilidades / Construcción | (infra — sin controlador dedicado aún) | ✓ | — | — |
| Puntos de servicio + catálogos | `puntos-servicio`, `puntos-servicio/catalogos` | ✓ | — | ✓ |
| Solicitudes | `solicitudes` | ✓ | — | ✓ |
| Contratos | `contratos`, `procesos-contratacion` | ✓ | — | ✓ (lectura) |
| Medidores | `medidores` | ✓ | — | — |
| Rutas | `rutas` | ✓ | ✓ | — |
| Lecturas | `lecturas` | ✓ | ✓ | — |
| Consumos | `consumos` | ✓ | — | — |
| Tarifas / Simulador | `tarifas` | — | — | — |
| Pre-facturación / Ajustes / Timbrado | `prefacturas`, `timbrados` | — | — | — |
| Recibos | `recibos` | — | — | ✓ |
| Pagos / Caja | `pagos`, `pagos-externos`, `caja` | — | — | ✓ |
| Convenios | `convenios` | — | — | ✓ |
| Contabilidad / Conciliaciones | `contabilidad`, `conciliaciones` | — | — | — |
| Atención a clientes / Quejas | `quejas`, `atencion` | — | — | ✓ |
| Trámites digitales (admin) | `tramites` | — | — | ✓ |
| Monitoreo | `monitoreo` | — | — | — |
| Configuración / catálogos maestros | `catalogos-operativos`, `tipos-contratacion`, `catalogos-contratacion`, `domicilios`, `sige-hydra`, `agora` | — | — | — |
| Portal (externo) | `portal` | — (`@AllowPortal` + `PortalGuard` → sólo `CLIENTE`) | | |

Leyenda: ✓ = acceso; — = sin acceso; `SUPER_ADMIN`/`ADMIN` = ✓ en todo.

## Lectura vs. escritura (de `usePermissions.ts`)

El menú es más grueso que los permisos reales. Donde el frontend YA distingue lectura/escritura, la API debería reflejarlo con `@Roles` por endpoint (no por controlador):

- **Contratos**: `contratos.view` lo tienen OPERADOR y ATENCION_CLIENTES; `contratos.editFiscal` (PATCH de datos fiscales) sólo SUPER_ADMIN/ADMIN. → `GET /contratos*` abierto a los 4 roles; `PATCH /contratos/:id` (campos fiscales) restringido a ADMIN/SUPER_ADMIN.
- **Convenios**: `convenios.create/edit` los tiene OPERADOR; ATENCION_CLIENTES sólo `view/create/checklist` (no `edit`). → separar `PATCH /convenios/:id` de los `GET/POST`.
- **Quejas**: `quejas.resolve` sólo ADMIN/SUPER_ADMIN; OPERADOR/ATENCION_CLIENTES sólo `view/create`. → restringir el endpoint de resolución.
- **Órdenes**: `ordenes.changeEstado` lo tienen SUPER_ADMIN/ADMIN/OPERADOR, NO ATENCION_CLIENTES/LECTURISTA (que sólo `ordenes.view`). → separar el POST de cambio de estado.

## Endpoints transversales que NO deben restringirse por rol (riesgo de romper la UI)

Estos los consumen varias pantallas de distintos roles; deben quedar accesibles a todo usuario interno (sin `@Roles`, protegidos sólo por `InternalGuard`):

- `GET /auth/me` (ya `@AllowPortal`), perfil.
- `GET /contratos/search`, `GET /contratos/:id/*` (contexto de atención, historial) — usados por Solicitudes, Atención, Lecturas.
- Catálogos de lectura: `catalogos-operativos`, `puntos-servicio/catalogos`, `domicilios`, `tipos-contratacion` (GET), `catalogos-contratacion` (GET), catálogos SAT.
- `GET` de tarifas vigentes si alguna pantalla de facturación de OPERADOR las consulta (verificar antes de restringir `tarifas`).

## Plan de implementación sugerido (para cuando Fernando apruebe)

1. Definir constantes de grupos de roles en `auth/roles.decorator.ts` (p.ej. `ROLES_FACTURACION = ['SUPER_ADMIN','ADMIN']`) para no repetir literales.
2. Aplicar `@Roles(...)` a NIVEL de controlador para los módulos "duros" (tarifas, prefacturas, timbrados, contabilidad, conciliaciones, monitoreo, configuración) → sólo ADMIN/SUPER_ADMIN.
3. Aplicar `@Roles(...)` a NIVEL de método donde lectura y escritura difieren (contratos fiscal, convenios edit, quejas resolve, ordenes changeEstado).
4. Dejar SIN `@Roles` los transversales de la sección anterior.
5. Verificación: por cada rol, montar un token y recorrer las páginas del menú de ese rol (`routesForRole`) confirmando que todas sus llamadas siguen en 2xx, y que al menos un endpoint fuera de su menú responde 403. Idealmente, un e2e por rol (bloqueado hoy por dependencia de BD; ver `authz-guards.spec.ts` que ya cubre el mecanismo del `RolesGuard`).
6. Añadir `@Roles` a la superficie Swagger para que la doc refleje la restricción.

## Riesgos

- El enum no tiene cajero/contador: si se quiere ese detalle hay que migrar el enum y re-asignar usuarios (afecta login y `seed`/`bootstrap:admin`).
- `usePermissions.ts` y `routes.ts` pueden divergir entre sí; antes de cablear, reconciliar ambos como especificación única.
- Un `@Roles` mal puesto en un endpoint transversal degrada pantallas permitidas a "carga vacía / 403 silencioso"; de ahí el paso 5 obligatorio.
