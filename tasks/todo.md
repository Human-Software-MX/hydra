# Roadmap "State of the Art" — ejecución

Base: `docs/analisis-state-of-the-art.md`. Rama: `feat/state-of-the-art-billing`.
Se ejecuta por iteraciones autoprogramadas (/loop). Cada iteración deja código compilable y verificado.

## Iteración 1 — Motor de facturación de consumo periódico (P0 #1) ✅ COMPLETA

- [x] Calculador puro `billing-calculator.ts` (escalonado, variable, fijo, IVA por línea, multi-servicio)
- [x] `FacturacionService`: tarifas vigentes por servicio+administración, cálculo por consumo, arrastre de saldo vencido
- [x] Facturación individual y masiva por periodo (preview dry-run + ejecutar)
- [x] `FacturacionController` con RBAC aplicado (`@Roles`) — primer uso real de RBAC en el proyecto
- [x] `prefacturas` conectado al motor real (antes devolvía total=0)
- [x] Script de verificación aritmética `scripts/verify-billing.ts`
- [x] Verificar: typecheck backend (`tsc --noEmit` OK) + verify-billing (11/11 aserciones OK)
- [x] Frontend: panel "Facturación del periodo" en PreFacturacion (preview + ejecutar) — typecheck OK
- [x] Commit

## Próximas iteraciones (pendientes)

- [x] **It. 2 — CFDI 4.0** ✅: constructor XML CFDI 4.0 puro (Emisor/Receptor/Conceptos/Impuestos, clave 83101509, MTQ/E48, público general), abstracción PAC (adapter) con proveedor simulado + factory por env, `TimbradoService` (timbrar individual + masivo por periodo, reconciliación de importes, descarga XML), columnas fiscales en `Timbrado` + migración, RBAC en endpoints, panel frontend en TimbradoPage. Verificado: verify-cfdi 13/13 + typecheck OK.
- [ ] **It. 3 — PDF de recibos** + **notificaciones reales** (abstracción de proveedor email/WhatsApp con adapters; no-op por defecto sin secretos).
- [ ] **It. 4 — Scheduler/batch** (`@nestjs/schedule`): facturación mensual, vencimientos, generación de órdenes por adeudo.
- [ ] **It. 5 — Mínimo vital (LGA 2025)**: restricción de flujo como estado de la toma, con trazabilidad probatoria — diferenciador regulatorio.
- [ ] **It. 6 — Dashboard PIGOO**: indicadores de eficiencia física/comercial, export.
- [ ] **It. 7 — Pipeline VEE** sobre lecturas + cola de excepciones de anomalías.
- [ ] **It. 8 — RBAC global** en todos los controladores + auditoría global.
- [ ] **It. 9 — Balance hídrico M36 / NRW** por distrito.
- [ ] **It. 10 — Tests + CI** (GitHub Actions).

## Notas de diseño

- El calculador es puro (sin Prisma/Nest) para poder verificarlo aislado — es código que mueve dinero.
- Tarifa específica de administración manda sobre la global del mismo servicio (dedup en `tarifasVigentesPorServicio`).
- Timbrado se crea `estado: 'Pendiente'`; el módulo CFDI (It. 2) lo pasará a `Timbrada OK` al sellar.
- Saldo vencido = suma de pendientes de recibos anteriores (arrastre), piso en 0.
