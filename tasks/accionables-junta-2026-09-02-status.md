# Junta CEA 02-sep-2026 — Estado de accionables (corte 2026-09-04)

✅ hecho · 🟡 parcial · ⏳ pendiente · 👤 depende de CEA/Jessica

## 0. Urgentes / fuera de producto
| # | Acción | Estado |
|---|--------|--------|
| 0.1 | Repo de Hydra privado (**"urgente"**) | ⏳ **sigue PUBLIC** |
| 0.2 | Usuario de prueba para la contraparte | ⏳ |
| 0.3 | Acceso al Drive (acuerdos y catálogos) | ✅ (llegaron los Excel) |
| 0.4 | Ticket a Jessica | ✅ TKT-20260903-00144 |
| 0.5 | Recibir repo Snapflow + anotaciones | 👤 su lado |

## 1. Tarifas (era el bloqueante)
| # | Acción | Estado |
|---|--------|--------|
| 1.1 | Leer acuerdos tarifarios y modelar desde la ley | 🟡 modelo hecho desde los Excel; lectura formal de acuerdos pendiente |
| 1.2 | Vigencia inicio/fin, cierre automático al crear nueva | ✅ modelo versionado (PR #55) |
| 1.3 | Historial inmutable (refacturar con tarifa de entonces) | ✅ versionado + Kardex |
| 1.4 | Incremento masivo (N tarifas × N admins, hoy 4 días) | ✅ actualización masiva con preview |
| 1.5 | Exigir documento soporte (memo Finanzas / vocal) al cambiar | ⏳ 👤 (definir cuál documento con Jessica) |
| 1.6 | Saneamiento/alcantarillado como % del agua, no tarifa | ✅ regla en BD (`porcentaje_de_servicio`+`porcentaje`, sembrada 10/12 y editable por CEA); cuantificación, modal y PDF de cobro la leen dinámicamente con fallback offline. Facturación periódica la consumirá después (documentado en motor-tarifas.md) |
| 1.7 | IVA determinístico (doméstico 0, resto 16, no capturable) | ✅ CategoriaTarifa + clasificación fiscal por concepto (AMBAS / NO_OBJETO) |
| 1.8 | Tarifas por administración | ✅ (13 admins, 1,570 tarifas en BD) |
| 1.9 | Precios fijos aparte (reconexión, recargos) | ✅ |
| 1.10 | Estructura base + m³ adicional + IVA en una tabla | ✅ |
| 1.11 | Depurar catálogo de conceptos | ✅ importado el real SIGE (21 + 12) · 👤 cotejo final CEA |
| 1.12 | ¿Excel feb-2026 vigente? | 👤 en TKT-144 |

## 2. Cuantificación / Cotización
| # | Acción | Estado |
|---|--------|--------|
| 2.1 | Todos los conceptos en la cuantificación (derechos, medidor…) | ✅ cotización formal API-first contra el motor versionado (fallback offline por concepto); precio hardcodeado 984.11 eliminado; sin carrera al aceptar (botón bloqueado mientras cotiza); lo que se acepta es lo que se persiste y lo que muestra Ver solicitud |
| 2.2 | Conceptos editables (agregar/quitar en cotización) | ⏳ |
| 2.3 | Precargar cuantificación desde inspección | ✅ (modal precarga; variables de inspección solo-lectura en solicitud) |
| 2.4 | Recálculo por antigüedad (meses extra + tarifas nuevas) | ⏳ |
| 2.5 | Fecha de vigencia en la cotización | ⏳ 👤 (¿cuántos días?) |
| 2.6 | Estados hold / devuelta con observación → re-inspección | ⏳ |
| 2.7 | OK explícito del validador de cuantificación | ⏳ |
| 2.8 | Flujo roles (solicitud→inspección→cuantificación→contratación) | ✅ documentado y reflejado |

## 3. Inspección
| # | Acción | Estado |
|---|--------|--------|
| 3.1 | Campos: ¿tiene medidor? S/N, diámetros, materiales calle/banqueta | ✅ formalizados en schema/BD (tieneMedidor bool, diámetro descarga, metros lineales, realizada, motivo, intentos) + DTO con whitelist; ⏳ la captura del inspector en UI va con el bloque 4 (Monitor/órdenes) |
| 3.2 | Precarga inteligente por zona (doméstico = ½") | ⏳ |
| 3.3 | Resultado binario (¿se realizó? sí/no) + intentos | ⏳ |
| 3.4 | Datos llegan solos vía órdenes/Agora (cero recaptura) | ⏳ |

## 4. Monitor / SLA / visibilidad (el bloque más insistido)
| # | Acción | Estado |
|---|--------|--------|
| 4.1 | Monitor: alarma "llegó inspección", bandeja por revisar, órdenes cerradas no resueltas | ⏳ |
| 4.2 | Distinguir atendida ≠ resuelta | ⏳ |
| 4.3 | No cerrar orden sin resolver; solicitud padre no cierra | ⏳ |
| 4.4 | SLA con pausas | ⏳ |
| 4.5 | Regla de 3 intentos con historial | ⏳ |
| 4.6 | Excepciones regresan a Contratación | ⏳ |
| 4.7 | Notificaciones automáticas al ciudadano (modelo Uber) | ⏳ |
| 4.8 | Ontología: solicitud = ente padre de tickets/tareas/órdenes | ⏳ |

## 5. Contrato / predio / punto de servicio
| # | Acción | Estado |
|---|--------|--------|
| 5.1 | Número de contrato inmutable | ✅ (el modelo no lo regenera) |
| 5.2 | Cesión de contrato / cambio de nombre | ⏳ |
| 5.3 | ¿Nuevo titular ve recibos del anterior? | 👤 legal CEA |
| 5.4 | Punto de servicio como entidad central (corte, medidores) | ✅ modelo existente |
| 5.5 | Vista de grafo del predio | ⏳ |
| 5.6 | Tras aceptar cotización, indicar que falta crear contrato | ✅ |

## 6. Solicitud — captura
| # | Acción | Estado |
|---|--------|--------|
| 6.1 | Orden: solicitante → predio → tipo de servicio | ✅ resuelto por decisión de la propia junta: «tiene mucho sentido como está acomodado… mejor no [cambiarlo]» — se mantiene el orden actual con el mapa primero (hecho) |
| 6.2 | Mapa en la solicitud (direcciones de Agora) | ✅ mapa primero + pin prellena dirección + "Usar mi ubicación" |
| 6.3 | Documentos primero + OCR prellenado | ✅ OCR local (tesseract.js) al adjuntar la Identificación: extrae CURP/RFC/nombre y prellena SOLO campos vacíos del propietario; 7 tests |
| 6.4 | Catálogo de documentos × tipo de contratación en el flujo | ✅ (+ mapeo propuesto) · 👤 obligatoriedad y mapeo final CEA |
| 6.5 | Validar el reorden con usuarios finales | 👤 |

## 7. Facturación
| # | Acción | Estado |
|---|--------|--------|
| 7.1 | Afinar módulo de facturación | 🟡 motor por sección PERIODICA operando (otro dev); siguiente paso documentado: consumir la regla % san/alc de BD (motor-tarifas.md) |
| 7.2 | Depende de 1.6/1.7 | 🟡 |

## 8. Sentinel (paralelo)
| # | Acción | Estado |
|---|--------|--------|
| 8.1–8.5 | Repo, mapa de incidencias, geocoding tickets, deploy QRO, token Agora | ⏳ sin iniciar (esperando acceso al repo Sentinel) |

## Preguntas abiertas a CEA (todas en TKT-144 o por agregar)
1. Vigencia oficial de la cotización (días) — en ticket
2. Legalidad de recibos del titular anterior — **agregar al ticket**
3. Excel de tarifas vigente — en ticket
4. Catálogo de conceptos depurado — en ticket
5. Ajuste retroactivo con tarifas retiradas — en ticket
6. Documento que autoriza cambio de tarifas — en ticket
7. **Nuevas**: mapeo documento×tipo + obligatoriedad · clasificación de los 24 docs · cláusulas HYDRA_* vs SIGE (duplicadas) · variables por tipo (propuesta)

## Hecho adicional no listado en la junta
Filtro Doméstico/No Doméstico (admins + tipos) · conceptos y cláusulas SIGE importados con fiscal real ·
variables por tipo (1,433) · tarifas cotizadas en vivo en la solicitud · entrega de archivos por documento ·
precarga de administración desde el pin · dirección fiscal desde predio · búsqueda en todos los dropdowns con catálogo
