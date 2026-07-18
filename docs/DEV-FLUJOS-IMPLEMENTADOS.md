# HYDRA — Flujos de Negocio Implementados

> Estado: **Demostrable en producción** — 2026-05-06
>
> Este documento describe los flujos E2E que funcionan actualmente en HYDRA (contract-to-cash-flow) y pueden ser ejecutados de extremo a extremo en un ambiente de demostración.

---

## Flujo 1: Solicitud de Servicio → Alta de Contrato (E2E)

Cubre el ciclo completo desde que un ciudadano solicita un servicio de agua hasta que el contrato queda activo en el sistema.

### 1.1 Captura de Solicitud

**Endpoint:** `POST /solicitudes`
**Componente:** `SolicitudServicio.tsx` (1877 líneas)

El formulario digital CEA-FUS01 captura:

| Sección | Campos |
|---|---|
| **Predio** | Clave catastral, domicilio INEGI jerárquico (estado → municipio → localidad → colonia) |
| **Propietario** | Tipo persona (física / moral), RFC, CURP, datos fiscales SAT |
| **Uso** | Doméstico / no-doméstico, condominio, infraestructura |
| **Variables dinámicas** | `DIAMETRO_TOMA`, `MATERIAL_CALLE`, `METROS_TOMA`, etc. (configuradas por tipo de contratación) |

- Estado inicial asignado: `inspeccion_pendiente`
- Folio generado automáticamente: `SOL-{año}-{secuencia}`

---

### 1.2 Inspección Técnica

**Endpoint:** `POST /solicitudes/:id/inspeccion`
**Componente:** Modal en `Solicitudes.tsx`

El inspector de campo registra:

- Área de terreno, condición de la toma, materiales, metros de ruptura
- Evidencias fotográficas (base64)
- Datos del inspector y firma digital

Transición de estados:

```
inspeccion_pendiente → inspeccion_completada → en_cotizacion
```

---

### 1.3 Cotización

**Componentes:** `CuantificacionModal` + motor de cotización

Proceso:

1. Se listan los conceptos de cobro configurados para el tipo de contratación
2. El motor tarifario aplica: `longitud × material × factor administrativo`
3. El operador puede hacer override de cantidades
4. Se genera un PDF de cotización (`@react-pdf/renderer`)
5. El PDF se sube vía `POST /solicitudes/:id/cotizacion-pdf`
6. Los ítems quedan almacenados en `solicitud.formData.cotizacionItems`

---

### 1.4 Tipos INDIVIDUAL (sin inspección)

Cuando `TipoContratacion.requiereInspeccion = false`:

- La solicitud salta directamente de `inspeccion_pendiente` a `en_cotizacion`
- No se requiere visita de campo
- Migration aplicable: `20260420150000_individual_no_requiere_inspeccion`

---

### 1.5 Aceptación

**Endpoint:** `POST /solicitudes/:id/aceptar`

Al aceptar la cotización el sistema:

1. Crea un registro `Contrato` en estado `Pendiente de alta`
2. Crea un `ProcesoContratacion` con etapa inicial `solicitud`
3. Enlaza: domicilio, punto de servicio, tipo de contratación
4. Cambia el estado de la solicitud a `contratado`

---

### 1.6 Wizard de Alta de Contrato (7 pasos)

**Componente:** `WizardContratacion.tsx`

| Paso | Nombre | Contenido |
|---|---|---|
| 1 | **Personas** | Propietario, representante fiscal, contacto — modo lectura con opción de edición |
| 2 | **Configuración** | Administración, tipo de contrato, actividad, distrito, zona de facturación |
| 3 | **Variables** | Campos dinámicos según tipo (e.g., `DIAMETRO_TOMA`, `MATERIAL_CALLE`) |
| 4 | **Documentos** | Lista de documentos requeridos configurada por tipo de contratación |
| 5 | **Facturación** | Cotización aprobada y preview de conceptos de lectura periódica |
| 6 | **Órdenes** | Órdenes de instalación (toma y/o medidor) |
| 7 | **Resumen** | Revisión final antes de crear el contrato |

---

### 1.7 Proceso E2E — Avance de Etapas

**Endpoint:** `POST /procesos-contratacion/:id/avanzar-etapa`

El `ProcesoContratacion` avanza por 6 etapas con hitos automáticos:

```
solicitud → factibilidad → contrato → instalacion_toma → instalacion_medidor → alta
```

- Al llegar a `instalacion_toma` e `instalacion_medidor` se generan las órdenes de trabajo correspondientes.
- Cada transición registra un hito con fecha y usuario responsable.

---

## Flujo 2: Portal de Cliente

Interfaz de autoservicio para que los contratistas consulten su contrato y gestionen trámites sin asistencia presencial.

### 2.1 Autenticación

- JWT con rol `CLIENTE`
- `PortalGuard` valida que el usuario sea propietario del contrato (`assertOwns`)

### 2.2 Vistas Disponibles

| Vista | Descripción |
|---|---|
| **Inicio** | KPIs del contrato: saldo, consumo actual, estado |
| **Trámites** | Lista de trámites disponibles con su estado actual |
| **Consumo** | Histórico de lecturas y consumos por período |
| **Facturas** | Lista de CFDI timbrados |
| **Recibos** | Recibos descargables |
| **Pagos** | Historial de pagos aplicados |

### 2.3 Trámites Digitales (Wizards de 5 pasos)

Trámites disponibles desde el portal con sesión iniciada:

- **Baja definitiva** — `TramiteBajaDefinitiva.tsx`
- **Baja temporal** — `TramiteBajaTemporal.tsx`
- **Cambio de propietario** — `TramiteCambioPropietario.tsx`

Trámites públicos sin sesión (ruta `/tramites-digitales`):

- Accesibles para ciudadanos sin contrato en el sistema

### 2.4 Candados de Seguridad

| Candado | Efecto |
|---|---|
| **Adeudo** | Bloquea trámites con mensaje explícito al cliente |
| **Bloqueo jurídico** | Oculta operaciones prohibidas mientras dure el proceso |

---

## Flujo 3: Atención a Clientes (Vista Unificada)

Panel de 360° para el agente de atención que permite resolver cualquier consulta o acción sobre un contrato en menos de 2 segundos de carga.

### 3.1 Contexto de Atención

**Endpoint:** `GET /contratos/:id/contexto-atencion`

Carga en una sola llamada:

- Datos fiscales del contrato
- Medidor actual asignado
- Adeudos y facturas pendientes
- Lecturas recientes (últimos períodos)
- Órdenes de trabajo activas
- Historial de pagos
- Quejas y aclaraciones abiertas

Objetivo: < 2 segundos de tiempo de respuesta.

### 3.2 Acciones Disponibles desde Atención

| Acción | Endpoint |
|---|---|
| Crear queja / aclaración | `POST /quejas` |
| Cambio de nombre | Vía trámite |
| Carta de no adeudo | Generación documental |
| Aplicar descuento | Según nivel de autorización |
| Registrar convenio de pago | Módulo convenios |
| Seguimiento de órdenes | Vista de detalle de orden |

---

## Flujo 4: Carga de Lecturas

Proceso de ingreso masivo de lecturas de medidores para generar consumos facturables.

### 4.1 Carga del Archivo

1. El operador sube un archivo plano en formato AQUACIS / layout estándar
2. El parser crea un registro `LoteLecturas`

### 4.2 Validación del Lote

Reglas de negocio aplicadas:

- Cada contrato incluido en el lote debe tener una lectura **o** una incidencia documentada
- Si faltan lecturas obligatorias, el lote completo es **rechazado**

### 4.3 Datos por Lectura

Cada registro de `Lectura` incluye:

- Trazabilidad: lecturista + fecha + ruta
- Incidencias catalogadas (medidor dañado, inaccesible, etc.)
- Evidencias fotográficas opcionales

### 4.4 Cierre del Lote

1. El consumo se calcula (lectura actual − lectura anterior)
2. El campo `confirmado` se marca `true`
3. El consumo confirmado queda disponible para el proceso de prefacturación

---

## Flujo 5: Pagos y Conciliación ETL

Automatización de la recepción de pagos bancarios y su aplicación a saldos de contratos.

### 5.1 Recepción del Archivo Bancario

Bancos soportados:

- OXXO, BBVA, Banorte, HSBC, Santander, CityBanamex, CSV genérico

### 5.2 Normalización ETL

1. El ETL normaliza el archivo al layout estándar
2. Se crea un `PagoExterno` con:
   - `fechaPagoReal`: fecha efectiva del pago del cliente (no la fecha del archivo)
   - `estado`: `pendiente_conciliar`

### 5.3 Conciliación

Match aplicado en orden:

1. Referencia de pago
2. Número de contrato
3. RFC

### 5.4 Resultados de la Conciliación

| Resultado | Estado | Acción |
|---|---|---|
| Inconsistente | `rechazado` | Se almacena `motivoRechazo`; **no** se aplica al saldo |
| Concordado | — | Se crea `Pago` y se aplica al saldo del contrato |

---

## Flujo 6: Tipos de Contratación (Parametrización Admin)

El administrador puede configurar cada tipo de contratación sin modificar código.

### 6.1 Parámetros Configurables

| Parámetro | Descripción |
|---|---|
| **Conceptos de cobro** | Fijo / variable / porcentual, con fórmulas evaluables |
| **Cláusulas contractuales** | Texto versionado por número de versión |
| **Documentos requeridos** | Lista de documentos que el cliente debe entregar |
| **Variables dinámicas** | Tipos: `TEXTO`, `NUMERO`, `FECHA`, `BOOLEANO`, `LISTA` |
| **Clase de proceso** | `AN` / `CN` / `PB` / `BJ` |
| **Flags de comportamiento** | `requiereInspeccion`, `requiereMedidor`, `requiereSolicitudPrevia` |

---

## Resumen de Estados del Sistema

### Solicitud

```
inspeccion_pendiente → en_cotizacion → aceptada → contratado
                                              ↘ rechazada / cancelada
```

### ProcesoContratacion

```
solicitud → factibilidad → contrato → instalacion_toma → instalacion_medidor → alta
```

### Contrato

```
Pendiente de alta → Activo → Cortado → BajaTemp → BajaDef
```
