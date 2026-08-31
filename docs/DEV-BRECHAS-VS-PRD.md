# DEV — Brechas vs PRD: Proyecto HYDRA

**Fecha de corte:** 2026-05-06
**Revisión:** 1.0
**Clasificación:** Interno — Equipo de Desarrollo

---

## 1. Resumen Ejecutivo

El proyecto HYDRA cubre en promedio **~70% de los requerimientos del PRD** a nivel de modelo de datos y lógica de negocio backend. Sin embargo, existen brechas críticas que bloquean el cierre del ciclo *contract-to-cash* antes de producción:

- ❌ **Motor tarifario T14** sin implementar → prefacturas en cero → facturación bloqueada.
- ❌ **PDF institucional único** (contrato + resumen) sin generar → requerimiento de licitación incumplido.
- ⚠️ **Endpoints sin JWT** detectados → riesgo de seguridad que requiere rework antes de go-live.
- ⚠️ **PAC/SAT** sin validar en producción → timbrado no operativo.
- ⚠️ **Wizard de alta** separa el convenio de pago del flujo principal (F-02 incompleto).

Las brechas de mayor impacto se concentran en los módulos de **Facturación** (≈48%), **Lecturas y Rutas** (≈58%), **Ajustes y Contabilidad** (≈40%) y en las integraciones con **SAP, PAC/SAT y GIS**.

Los módulos con mayor madurez son **Seguridad/Auth** (≈85%), **Puntos de Servicio** (≈82%), **Atención a Clientes** (≈80%) y **Personas/Contratos** (≈80%).

---

## 2. Tabla Maestro PRD vs Implementado por Módulo

| # | Módulo | % Madurez | Estado general | Notas clave |
|---|--------|:---------:|---------------|-------------|
| 3.1 | Contrataciones | ≈78% sol. / ≈75% E2E | ⚠️ Parcial | F-01 PDF y F-02 wizard convenio pendientes |
| 3.2 | Gestión de Contratos y Clientes | ≈80% personas / ≈65% wizard | ⚠️ Parcial | Historial OK; wizard incompleto por brechas F-01–F-04 |
| 3.3 | Puntos de Servicio y Medidores | ≈82% PS / ≈58% medidores | ⚠️ Parcial | UI mock pendiente; API medidores sin endurecer |
| 3.4 | Lecturas y Rutas | ≈58% | ⚠️ Parcial | Parser operativo; estimadas en diseño |
| 3.5 | Facturación | ≈48–42% | ❌ Bloqueado | Motor T14 pendiente; PAC prod sin validar |
| 3.6 | Pagos y Cobranza | ≈72% caja / ≈50% ETL | ⚠️ Parcial | ETL normalizado; conciliación en desarrollo |
| 3.7 | Convenios de Pago | ≈68% | ⚠️ Parcial | Modelo OK; falta integración al wizard F-02 |
| 3.8 | Cortes y Reconexiones | ≈70% órdenes | ⚠️ Parcial | Reconexión automática en evolución |
| 3.9 | Ajustes, NC y Contabilidad | ≈40% SAP | ❌ Crítico | SAP stub; exportación pólizas pendiente |
| 3.10 | Atención a Clientes | ≈70% | ⚠️ Parcial | Vista unificada OK; Ágora en mock |
| 3.11 | Trámites Digitales y Portal | ≈72% | ⚠️ Parcial | `assertOwns` OK; persistencia trámites sin sesión pendiente |
| 3.12 | Seguridad, Roles y Admin | ≈85% auth | ⚠️ Rework | Endpoints sin JWT detectados |

### 2.1 Detalle por requerimiento

| ID | Descripción | Estado | Observación |
|----|-------------|:------:|-------------|
| REQ-CONT-01 | Folio único SOL-{año}-{secuencia} + estado trazable | ✅ | Implementado |
| REQ-CONT-02 | Validación tipo contratación en catálogo SIGE | ✅ | Implementado |
| REQ-CONT-03 | Inspección completada → `en_cotizacion` | ✅ | Implementado |
| REQ-CONT-04 | Aceptación crea contrato Pendiente de alta, enlaza domicilio/PS | ✅ | Implementado |
| REQ-CTR-01 | Contrato activo referencia ≥1 punto de servicio | ✅ | Implementado |
| REQ-CTR-02 | Cambio de propietario conserva historial | ✅ | `HistoricoContrato` |
| REQ-PS-01 | Medidor instalado vinculado a PS y contrato | ✅ | Implementado |
| REQ-PS-02 | Catálogos marca/modelo/calibre de catálogo operativo activo | ✅ | Implementado |
| REQ-LEC-01 | Lote rechazado no confirma consumos hasta corregir faltantes | ✅ | Lógica implementada |
| REQ-LEC-02 | Lectura genera trazabilidad: lecturista, fecha, ruta | ✅ | Implementado |
| REQ-FAC-01 | Ninguna prefactura confirmada con total cero (salvo exento) | ❌ | Bloqueado por motor tarifario T14 |
| REQ-FAC-02 | Error timbrado → estado `Error PAC` con causa y reintento | ✅ modelo / ⚠️ prod | Modelo OK; PAC producción por validar |
| REQ-PAG-01 | Fecha contable = día efectivo cliente (layout estándar) | ✅ | `PagoExterno.fechaPagoReal` |
| REQ-PAG-02 | Registros ETL inconsistentes no se aplican sin bandeja | ✅ | `PagoExterno.estado = pendiente_conciliar` |
| REQ-CONV-01 | Convenio vigente prioriza parcialidades en jerarquía de aplicación | ✅ modelo | Integración wizard pendiente |
| REQ-COR-01 | Pago que liquida adeudo → orden de reconexión sin captura manual | ⚠️ | En evolución |
| REQ-CON-01 | Toda póliza reproducible desde pagos y reglas contables vigentes | ⚠️ | Parcial; exportación SAP pendiente |
| REQ-ATN-01 | Agente resuelve ≥90% consultas rutinarias sin sistemas paralelos | ✅ | Vista unificada de contrato |
| REQ-POR-01 | Cliente solo consulta contratos autorizados en su perfil | ✅ | `assertOwns` implementado |
| REQ-POR-02 | Trámites con adeudo bloquean acción con mensaje explícito | ✅ | Implementado |
| REQ-SEG-01 | Endpoints de negocio sensibles exigen auth + rol autorizado | ⚠️ | **REWORK** — endpoints sin JWT detectados |
| REQ-SEG-02 | Acciones alta/timbrado/pago quedan en auditoría | ✅ | `HistoricoContrato`, `Seguimiento*` |

---

## 3. Brechas Críticas para Licitación (F-01 a F-04)

Estas cuatro brechas funcionales cruzan múltiples módulos y son requisito explícito del proceso de licitación / entrega formal.

### F-01 — PDF Institucional Único ❌

| Aspecto | Detalle |
|---------|---------|
| **¿Qué pide el PRD?** | Generación de un PDF institucional único que contenga contrato + resumen de servicio (si aplica), con formato oficial del organismo |
| **Estado actual** | No implementado. No existe generador de PDF enlazado al flujo de contratación |
| **Impacto** | Bloquea entrega documental a cliente; incumple requerimiento de licitación |
| **Módulos afectados** | 3.1 Contrataciones, 3.2 Gestión de Contratos |
| **Prioridad** | 🔴 ALTO |

### F-02 — Convenio en Wizard de Alta ❌

| Aspecto | Detalle |
|---------|---------|
| **¿Qué pide el PRD?** | El wizard de alta contractual debe incluir el paso de convenio de pago de forma integrada |
| **Estado actual** | El convenio existe como modelo independiente (`REQ-CONV-01` parcialmente OK), pero está **separado del wizard** de alta |
| **Impacto** | El flujo de alta E2E está incompleto; agentes deben salir del wizard para gestionar convenios |
| **Módulos afectados** | 3.1 Contrataciones, 3.2 Gestión de Contratos, 3.7 Convenios de Pago |
| **Prioridad** | 🔴 ALTO |

### F-03 — Recálculo de Cuantificación en Paso Facturación ⚠️

| Aspecto | Detalle |
|---------|---------|
| **¿Qué pide el PRD?** | El recálculo de cuantificación debe ser visible en el paso de facturación del wizard |
| **Estado actual** | Parcialmente implementado; el recálculo existe pero su visibilidad en el paso facturación no está completada |
| **Impacto** | Agentes no pueden validar montos antes de confirmar; posibles errores en prefactura |
| **Módulos afectados** | 3.1 Contrataciones, 3.5 Facturación |
| **Prioridad** | 🟡 MEDIO |

### F-04 — Órdenes Automáticas Post-Inspección ⚠️

| Aspecto | Detalle |
|---------|---------|
| **¿Qué pide el PRD?** | Tras completar la inspección, el sistema genera órdenes de trabajo automáticamente |
| **Estado actual** | En evolución; la lógica de transición de estado existe pero la generación automática de órdenes no está completamente implementada |
| **Impacto** | Operación manual de órdenes; riesgo de omisiones en campo |
| **Módulos afectados** | 3.1 Contrataciones, 3.8 Cortes y Reconexiones |
| **Prioridad** | 🟡 MEDIO |

---

## 4. Estado de Integraciones

| Sistema | Estado PRD | Estado Real | Brecha |
|---------|:----------:|:-----------:|--------|
| **AQUACIS / App lecturas** | Operativo parcial T01 | ⚠️ Operativo parcial | Parser archivo plano funcional; estimadas pendientes |
| **Recaudación externa** | Operativo parcial T02 | ⚠️ Parcial | ETL normalizado, `PagoExterno` en BD; conciliación en desarrollo |
| **SAP / ERP** | Parcial T04 | ❌ Stub | `ReglaContable` + `Poliza` en BD; generación y exportación pendientes |
| **PAC / SAT CFDI** | Parcial; PAC prod por validar | ⚠️ Sin definir | Modelo `Timbrado` en BD; integración con PAC de producción sin definir |
| **GIS / ArcGIS** | Parcial T05 | ❌ Stub | `LogSincronizacion` + `CambioGIS` en BD; sincronización real pendiente |
| **SIGE / Aquasis** | Operativo consulta | ✅ Funcional | Catálogos importados; mapeo `SigeHydra` operativo |
| **Ágora** | Mock | ❌ Mock | `AgoraTicket` en BD; API no conectada |
| **PorCobrar** | Diseño | ❌ No implementado | Sin avance |
| **LDAP / Microsoft Entra** | Preparado, no prod | ⚠️ Inactivo | `ldap.strategy.ts` existe; no activado en producción |
| **INEGI / SEPOMEX** | Operativo | ✅ Operativo | 3,595 localidades + 3,815 colonias Aquasis importadas |
| **Q Order** | Decisión pendiente | ❌ No implementado | Decisión de integración pendiente |

### Resumen integraciones

| Estado | Cantidad | Sistemas |
|--------|:--------:|---------|
| ✅ Operativo | 2 | SIGE/Aquasis, INEGI/SEPOMEX |
| ⚠️ Parcial / Inactivo | 4 | AQUACIS, Recaudación, PAC/SAT, LDAP |
| ❌ Stub / No implementado | 5 | SAP, GIS, Ágora, PorCobrar, Q Order |

---

## 5. KPIs del PRD y Estado Actual

| KPI | Meta PRD | Fase meta | Estado actual |
|-----|----------|:---------:|:-------------:|
| Reducción tiempo de alta contractual (≥30% vs legado) | ≥30% | F2 | ⚠️ Wizard implementado; pendiente medir vs legado |
| Paridad documental — PDF único | 100% | F2 | ❌ Brecha F-01; no implementado |
| Prefacturas correctas | ≥99% | F3 | ❌ Motor tarifario T14 pendiente; prefacturas en cero |
| Lecturas primera pasada | ≥98% | F3 | ⚠️ Parser operativo; estimadas en diseño |
| ETL pagos (100% layout estándar) | 100% | F1–F2 | ⚠️ Parcial (≈50% ETL masivo) |
| Reconexión automática | ≥90% casos | F1 | ⚠️ En evolución |
| Disponibilidad API | ≥99.5% mensual | Operación | ❌ No medido aún; sin observabilidad activa |

**KPIs en riesgo crítico:** Paridad documental y prefacturas correctas son las métricas de mayor riesgo para la fecha de entrega, dado que dependen de brechas sin inicio de implementación (F-01) o con complejidad técnica alta (motor T14).

---

## 6. Deuda Técnica Priorizada

| # | Prioridad | Ítem | Módulos afectados | Notas |
|---|:---------:|------|------------------|-------|
| 1 | 🔴 CRÍTICO | **Motor tarifario T14** | 3.5 Facturación | Montos en prefactura en cero; bloquea ciclo contract-to-cash completo |
| 2 | 🔴 CRÍTICO | **Endpoints sin JWT (REWORK seguridad)** | Transversal | Riesgo de exposición antes de producción; debe resolverse antes de go-live |
| 3 | 🔴 ALTO | **PDF institucional único (F-01)** | 3.1, 3.2 | Requerimiento de licitación; sin esto no hay entrega documental válida |
| 4 | 🔴 ALTO | **PAC/SAT validación en producción** | 3.5 Facturación | Sin timbrado válido no hay facturación electrónica legal |
| 5 | 🔴 ALTO | **Migraciones pendientes en servidor GCP** | Infraestructura | 2 migrations sin aplicar; riesgo de inconsistencia en datos de producción |
| 6 | 🟡 MEDIO | **ETL pagos masivo completo (≈50%)** | 3.6 Pagos y Cobranza | Conciliación automática incompleta |
| 7 | 🟡 MEDIO | **Ágora — integración productiva** | 3.10 Atención | Sin conexión real a sistema de tickets |
| 8 | 🟡 MEDIO | **LDAP en producción** | 3.12 Seguridad | `ldap.strategy.ts` existe; requiere activación y pruebas |
| 9 | 🟢 BAJO | **Suite de tests backend** | Transversal | Sin cobertura automatizada; aumenta riesgo de regresiones |
| 10 | 🟢 BAJO | **GitHub Actions CI/CD** | Infraestructura | Sin pipeline de integración/despliegue continuo |

---

## 7. Roadmap Sugerido para Cerrar Brechas

El roadmap se organiza en tres fases orientadas al cierre del ciclo *contract-to-cash* y al cumplimiento de los requerimientos de licitación.

### Fase 0 — Estabilización y Seguridad (≈2 semanas)

Objetivo: dejar el sistema en condición segura para pruebas con datos reales.

| Tarea | Tipo | Dependencia |
|-------|------|------------|
| Auditar y proteger endpoints sin JWT | Rework seguridad | — |
| Aplicar 2 migrations pendientes en GCP | Infraestructura | — |
| Configurar observabilidad básica (uptime + alertas) | Infraestructura | — |

### Fase 1 — Ciclo Contract-to-Cash Básico (≈6 semanas)

Objetivo: habilitar el flujo completo desde alta hasta pago con facturación legal.

| Tarea | Tipo | Dependencia |
|-------|------|------------|
| Implementar motor tarifario T14 | Desarrollo core | Migraciones GCP |
| Validar e integrar PAC/SAT en producción | Integración | Motor T14 |
| Generador PDF institucional único (F-01) | Desarrollo | Motor T14 |
| Integrar convenio al wizard de alta (F-02) | Desarrollo | — |
| Recálculo cuantificación visible en facturación (F-03) | Desarrollo | Motor T14 |
| Completar reconexión automática post-pago (F-04 / REQ-COR-01) | Desarrollo | — |

### Fase 2 — Integraciones y Automatización (≈6 semanas)

Objetivo: conectar sistemas externos críticos y automatizar procesos masivos.

| Tarea | Tipo | Dependencia |
|-------|------|------------|
| ETL pagos masivo — conciliación completa | Integración | Fase 1 |
| SAP/ERP — generación y exportación de pólizas | Integración | Motor T14 |
| LDAP/Microsoft Entra — activar en producción | Integración | Fase 0 |
| Ágora — conexión API productiva | Integración | — |
| UI de medidores (mock → productivo) | Frontend | — |
| Lecturas estimadas + bolsa de estimación | Desarrollo | — |

### Fase 3 — Calidad, Observabilidad y Cierre (≈4 semanas)

Objetivo: alcanzar los KPIs del PRD y dejar el sistema en condición de operación sostenida.

| Tarea | Tipo | Dependencia |
|-------|------|------------|
| Suite de tests backend (unitarios + integración) | Calidad | Fase 1 y 2 |
| GitHub Actions CI/CD | Infraestructura | Tests |
| GIS/ArcGIS — sincronización real | Integración | — |
| PorCobrar — implementación inicial | Integración | — |
| Persistencia trámites públicos sin sesión (Portal F1) | Desarrollo | — |
| Medición de KPIs vs legado (tiempo de alta, prefacturas) | Operación | Todo lo anterior |

---

## Apéndice — Leyenda de Estados

| Símbolo | Significado |
|:-------:|-------------|
| ✅ | Implementado y funcional |
| ⚠️ | Parcialmente implementado o en evolución |
| ❌ | No implementado / Bloqueado |

---

*Documento generado el 2026-05-06. Actualizar en cada sprint review.*
