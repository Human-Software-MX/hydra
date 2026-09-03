# Accionables — Junta CEA 02-sep-2026 (Meet 247 min)

Fuente: https://fathom.video/share/p6V-Une9vw1bsf_SQBzuPWUQ8fs7TUsM

Leyenda prioridad: **P0** bloqueante · **P1** alto · **P2** siguiente iteración

---

## 0. Urgentes / fuera de producto

| # | Acción | Prio |
|---|--------|------|
| 0.1 | **Hacer PRIVADO el repo de Hydra** (dicho textual: "urgente") | P0 |
| 0.2 | Crear usuario de prueba en Hydra para la contraparte | P1 |
| 0.3 | Pedir acceso al Drive con los acuerdos tarifarios y catálogos | P1 |
| 0.4 | Ticket a Jessica (pendiente propio de Ian) | P1 |
| 0.5 | Recibir de la contraparte: repo **Snapflow** + anotaciones sobre pantallas | — |

---

## 1. Tarifas — **HACER PRIMERO** (bloquea facturación, ajustes, contratos, cobranza)

Frase clave: *"sin tarifas, todo esto lo va a ocupar"*, *"esto impacta en todo: contrato, facturación, ajustes"*.

- **1.1 (P0)** Leer los **Acuerdos Tarifarios** del Drive y conceptualizar el modelo desde la ley, **no** desde cómo lo hace Aquasis. (Ian y Fer.)
- **1.2 (P0)** Agregar **fecha de inicio y fecha de fin de vigencia** a cada tarifa. Al crear una nueva, la anterior se cierra automáticamente un día antes del inicio de la nueva. La vigente queda abierta.
- **1.3 (P0)** **Historial inmutable de tarifas y conceptos**: una tarifa o concepto retirado (ej. "doméstico rural") debe seguir existiendo para poder refacturar/ajustar periodos pasados con el precio que aplicaba entonces.
- **1.4 (P1)** **Incremento masivo**: seleccionar N tarifas × N administraciones y aplicar un % de una sola vez. Hoy en Aquasis tardan **4 días** haciéndolo uno por uno con margen de error (caso Lucina). Así lo hacía SIGE.
- **1.5 (P1)** Al cambiar tarifas, **exigir la carga del documento soporte**: memorándum de Finanzas con el % de incremento (INPC) y/o acuerdo firmado por el vocal. Ideal: cargar el documento y que de ahí se generen las nuevas tarifas.
- **1.6 (P0)** **Saneamiento y alcantarillado NO son tarifas**: son un **porcentaje del agua** (10–12 %). Modelarlos como % derivado, no como tarifa suelta. Aquasis metió todo como tarifa y por eso es un desbarajuste.
- **1.7 (P0)** **IVA determinístico, no capturable**: doméstico = 0 %, todo lo demás = 16 %. El agrupador es "doméstico / no doméstico". Si es doméstico, **el campo de IVA ni siquiera debe aparecer**. Facturar agua doméstica con IVA es ilegal (Ley del IVA, no lo define la CEA). Hidrante = 0 % (surte a familias).
- **1.8 (P1)** Soportar **tarifas distintas por administración** aunque hoy estén homologadas ("piensa que los gobiernos cambian de idea").
- **1.9 (P2)** Precios fijos (reconexión, recargos) se manejan aparte: cambian ~1 vez al año, no en cada acuerdo.
- **1.10 (P1)** Estructura confirmada por tarifa: precio base, metro adicional (aplica a partir del m³ 200), tasa de IVA en la misma tabla (hoy está en otra tabla configurada a mano).
- **1.11 (P1)** Depurar el **catálogo de conceptos**: pasó de ~100 a "muchísimos". Cotejar el catálogo actual de Hydra contra el que tiene la contraparte.
- **1.12 (P2)** Verificar si el Excel de tarifas está actualizado (dice precios a feb-2026; cambian cada 3 meses).

---

## 2. Cuantificación / Cotización

- **2.1 (P0)** La cuantificación debe incluir **todos los conceptos a cobrar**, no solo agua/alcantarillado/saneamiento: derechos de conexión, inspección, medidor, gastos de instalación. Se toman del catálogo de conceptos del tipo de contratación.
- **2.2 (P0)** Los conceptos deben ser **editables**: agregar, quitar y modificar, dentro de lo permitido cobrar. (Hoy "derecho de conexión de agua" aparece hardcodeado desde el formulario y no se puede tocar.)
- **2.3 (P0)** **Precargar y precalcular** la cuantificación con los datos de la inspección. El agente interno solo ajusta periodos y valida — no captura.
- **2.4 (P0)** **Recálculo por antigüedad**: si el usuario acepta meses después, hay que recalcular — meses adicionales de agua + tarifas nuevas vigentes. La cuantificación debe poder editarse al momento de contratar.
- **2.5 (P1)** **Fecha de vigencia** en la cotización impresa (definir con CEA de cuántos días).
- **2.6 (P1)** Estados de la cotización: aceptada / rechazada / **hold** (cotizada, esperando) / **devuelta con observación** (ej. "sí tengo medidor") → regresa a editar cuantificación o incluso a re-inspección.
- **2.7 (P1)** Quien valida la cuantificación debe **dar el "OK" explícito** — validar lo que se va a cobrar es una tarea con responsable.
- **2.8 (P1)** Flujo lógico confirmado con roles: Solicitud (agente) → Inspección (inspector) → Cuantificación (agente) → Cotización al usuario → Contratación. La cuantificación **es** la cotización (no es un paso interno separado).

---

## 3. Inspección

- **3.1 (P0)** Campos nuevos obligatorios en la inspección:
  - ¿Tiene medidor? **binario Sí/No**
  - Diámetro de **toma**
  - Diámetro de **descarga**
  - **Material de banqueta**
  - **Material de calle**
  (Las tarifas están construidas sobre estos datos.)
- **3.2 (P1)** **Precarga inteligente por zona y tipo**: doméstico siempre 1/2", por zona/fraccionamiento ya se conoce el diámetro de la red. El inspector **valida**, no captura. Argumento: "si yo ya la tengo, ¿por qué te voy a dejar que te equivoques". Sigue requiriendo que alguien vaya físicamente.
- **3.3 (P0)** El resultado de la inspección es **binario**: ¿se realizó? Sí / No. El "sí" obliga a traer todos los datos completos. Nada de "fui pero…".
- **3.4 (P0)** Los datos deben llegar por el **servicio de órdenes (Agora)** y cargarse solos. Cero recaptura ("en Aquasis te hacen meter 20 veces la misma información").

---

## 4. Órdenes, SLA y visibilidad — el "Monitor"

Este fue el bloque más largo y más insistido. Problema raíz: *"no hay visibilidad del proceso completo; cada área es un silo y se deslinda"*.

- **4.1 (P0)** **Monitor de contratación** con al menos:
  - Solicitudes esperando inspección
  - **Alarma: "llegó la inspección, ya puedes cuantificar"**
  - Bandeja "cuantificaciones por revisar/validar"
  - **Órdenes cerradas como atendidas pero NO resueltas**
  - Inspecciones no ejecutadas (predio no encontrado, usuario ausente)
- **4.2 (P0)** Distinguir **atendida ≠ resuelta**. Hoy cierran la orden como atendida para no romper su SLA y el caso se pierde. Revisar esto en el sistema de órdenes nuevo.
- **4.3 (P1)** **No permitir cerrar** la orden si no se resolvió. La solicitud (ente padre) no se cierra hasta que todos sus entes hijos cierren.
- **4.4 (P1)** **SLA con pausas**, igual que en tickets: si se está esperando al ciudadano, el SLA se detiene. No penalizar al inspector que sí fue.
- **4.5 (P1)** **Regla de 3 intentos**: si no está el usuario / no se encuentra el predio, el SLA reinicia al siguiente intento; al tercero se escala y se decide. Historial de intentos visible (analogía paquetería).
- **4.6 (P1)** **Ruteo de excepciones a Contratación**: si no se encontró el predio, regresa a contratación (que es quien pidió la inspección) para que contacte al ciudadano. Hoy queda en tierra de nadie.
- **4.7 (P1)** **Notificaciones automáticas al ciudadano** (modelo Uber): aviso 1–2 días antes de la inspección por correo/WhatsApp, ventana de atención, sin exponer datos del inspector. La programación ya se hace con 1–2 días de anticipación.
- **4.8 (P1)** **Ontología**: la Solicitud es el ente padre; cuelga tickets, tareas y órdenes. Es lo que permite el "seguimiento de contratación".

---

## 5. Contrato, predio y punto de servicio (modelo de datos)

- **5.1 (P0)** El **número de contrato es inmutable** — es con el que se firmó físicamente. En Aquasis se llama "referencia" porque en la migración generaron números propios.
- **5.2 (P1)** Implementar **cesión de contrato / cambio de nombre**: se firma un contrato nuevo ligado al anterior, **conserva el mismo número**, con fecha de corte de titularidad. Facturas anteriores quedan timbradas al titular anterior; a partir del cambio, al nuevo.
- **5.3 (P1)** **Revisar la condición legal/privacidad**: si el nuevo titular pide historial de 5 años, ¿puede ver recibos timbrados al titular anterior? Internamente el histórico se conserva íntegro; lo que se expone hay que validarlo legalmente. → **pregunta abierta para CEA/legal**.
- **5.4 (P0)** **La entidad central es el predio / punto de servicio, no el contrato**:
  - Un predio puede tener varios puntos de servicio
  - El **corte** aplica al punto de servicio, no al contrato
  - El **historial de medidores** cuelga del punto de servicio
  - Consultar todo el histórico del predio sin conocer el número de contrato
- **5.5 (P2)** Modelar como grafo: solicitud → inspección → contrato ↔ predio ↔ punto de servicio ↔ persona ↔ medidor.
- **5.6 (P1)** Tras aceptar la cotización, el flujo debe indicar explícitamente que **falta crear el contrato**. Salidas de pago: línea de pago, **convenio**, o sin pago.

---

## 6. Solicitud de servicio — rediseño de captura

- **6.1 (P1)** Replantear el orden de captura: **nombre del solicitante → localización del predio → tipo de servicio**. De la localización del predio se derivan administración, tipo de contratación, tarifas, diámetros.
- **6.2 (P1)** **Mapa en la solicitud** para ubicar el predio. Reutilizar los formatos/direcciones del repo de **Agora**.
- **6.3 (P1)** **Invertir el flujo documental**: subir documentos → **OCR** → prellenar → el usuario solo valida. Hoy se llena todo y al final los documentos están mal y se atora el trámite. *"¿Para qué lleno algo que puede estar mal?"*
- **6.4 (P0)** **Catálogo de documentos requeridos por tipo de contratación** y su integración al flujo de contratación. Definir qué dato se deriva de cada documento. ← *(este ya lo tenías identificado)*
- **6.5 (P2)** La estructura actual del wizard (predio → propietario → fiscal → solicitud → contratación → resumen) le pareció lógica; el cambio es el orden documentos-primero, no reordenar todos los pasos. Validar con los usuarios finales antes de mover.

---

## 7. Facturación

- **7.1 (P1)** El módulo está a medias: hoy la "factura" solo muestra el concepto de derechos de conexión. Afinar una vez que estén tarifas y conceptos.
- **7.2 (P1)** Depende directamente de 1.6 (% saneamiento/alcantarillado) y 1.7 (IVA determinístico).

---

## 8. Sentinel (proyecto paralelo, desplegable ya)

- **8.1 (P1)** Recibir acceso al repo **Sentinel** (mapa de incidencias).
- **8.2 (P1)** Que los reportes de Agora se pinten como **puntos de colores en un mapa real**: falta de agua = un color, fuga = otro. Ligados a los tickets de Agora.
- **8.3 (P1)** Hacer que la **dirección del ticket se traduzca a coordenadas** y renderee correctamente en el mapa (geocoding).
- **8.4 (P1)** **Desplegar Sentinel para Querétaro** (hoy existen dos users: Saltillo y Querétaro; no está desplegado). Dominio tipo `sentinel.*`.
- **8.5 (P1)** Revisar el **token de autorización** de la integración Agora → Sentinel (está registrada como integración en Agora) y mapearlo.

---

## Preguntas abiertas para CEA

1. ¿Cuál es la vigencia oficial de una cotización (días)?
2. ¿Es legal mostrar al nuevo titular los recibos timbrados al titular anterior tras una cesión?
3. ¿El Excel de tarifas del Drive está actualizado (dice feb-2026)?
4. ¿Catálogo de conceptos vigente y depurado?
5. ¿Cómo ajustan retroactivamente cuando la tarifa que aplicaba ya no existe (ej. doméstico rural)?
6. ¿Quién y con qué documento autoriza formalmente el cambio de tarifas (memo de Finanzas vs. acuerdo del vocal)?

---

## Orden sugerido de ataque

1. Repo privado + usuario de prueba (bloqueo trivial, 30 min)
2. **Tarifas** — leer acuerdos → modelo (vigencias, % derivados, IVA determinístico, histórico) → rediseño del módulo
3. Catálogo de documentos × tipo de contratación (tu pendiente)
4. Campos de inspección + precarga → cuantificación con conceptos editables
5. Monitor / SLA / órdenes no resueltas
6. Sentinel Querétaro (paralelizable, no depende de nada de arriba)
