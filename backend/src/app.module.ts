import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  AppThrottlerGuard,
  LOGIN_THROTTLER_OPTIONS,
} from './modules/auth/app-throttler.guard';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { InternalGuard } from './modules/auth/internal.guard';
import { RolesGuard } from './modules/auth/roles.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ContratosModule } from './modules/contratos/contratos.module';
import { AuthModule } from './modules/auth/auth.module';
import { LecturasModule } from './modules/lecturas/lecturas.module';
import { ConsumosModule } from './modules/consumos/consumos.module';
import { PrefacturasModule } from './modules/prefacturas/prefacturas.module';
import { RecibosModule } from './modules/recibos/recibos.module';
import { TimbradosModule } from './modules/timbrados/timbrados.module';
import { PagosModule } from './modules/pagos/pagos.module';
import { QuejasModule } from './modules/quejas/quejas.module';
import { PortalModule } from './modules/portal/portal.module';
import { OrdenesModule } from './modules/ordenes/ordenes.module';
import { ContabilidadModule } from './modules/contabilidad/contabilidad.module';
import { GisModule } from './modules/gis/gis.module';
import { PersonasModule } from './modules/personas/personas.module';
import { TramitesModule } from './modules/tramites/tramites.module';
import { CajaModule } from './modules/caja/caja.module';
import { ConveniosModule } from './modules/convenios/convenios.module';
import { MonitoreoModule } from './modules/monitoreo/monitoreo.module';
import { ConciliacionesModule } from './modules/conciliaciones/conciliaciones.module';
import { AgoraModule } from './modules/agora/agora.module';
import { NotificacionesModule } from './modules/notificaciones/notificaciones.module';
import { SigeHydraModule } from './modules/sige-hydra/sige-hydra.module';
import { DomiciliosModule } from './modules/domicilios/domicilios.module';
import { PuntosServicioModule } from './modules/puntos-servicio/puntos-servicio.module';
import { TiposContratacionModule } from './modules/tipos-contratacion/tipos-contratacion.module';
import { TarifasModule } from './modules/tarifas/tarifas.module';
import { ProcesosContratacionModule } from './modules/procesos-contratacion/procesos-contratacion.module';
import { CatalogosOperativosModule } from './modules/catalogos-operativos/catalogos-operativos.module';
import { RutasModule } from './modules/rutas/rutas.module';
import { MedidoresModule } from './modules/medidores/medidores.module';
import { SolicitudesModule } from './modules/solicitudes/solicitudes.module';
import { FacturacionModule } from './modules/facturacion/facturacion.module';
import { BatchModule } from './modules/batch/batch.module';
import { RestriccionesModule } from './modules/restricciones/restricciones.module';
import { IndicadoresModule } from './modules/indicadores/indicadores.module';
import { VeeModule } from './modules/vee/vee.module';
import { BalanceModule } from './modules/balance/balance.module';
import { CarteraModule } from './modules/cartera/cartera.module';
import { MdmModule } from './modules/mdm/mdm.module';
import { MigracionModule } from './modules/migracion/migracion.module';
import { AuditoriaModule } from './modules/auditoria/auditoria.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { GemeloModule } from './modules/gemelo/gemelo.module';
import { ClimaModule } from './modules/clima/clima.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { SupraModule } from './modules/supra/supra.module';

@Module({
  imports: [
    // Cubo general: AppThrottlerGuard lo llavea por usuario autenticado y, si
    // la petición es anónima, por IP real (main.ts fija `trust proxy = 1`).
    // 300/min porque una oficina completa puede salir por una sola IP NAT.
    // El override estricto de credenciales vive en LOGIN_THROTTLER_OPTIONS.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }, LOGIN_THROTTLER_OPTIONS],
    }),
    PrismaModule,
    NotificacionesModule,
    ContratosModule,
    AuthModule,
    LecturasModule,
    ConsumosModule,
    PrefacturasModule,
    RecibosModule,
    TimbradosModule,
    PagosModule,
    QuejasModule,
    PortalModule,
    OrdenesModule,
    ContabilidadModule,
    GisModule,
    PersonasModule,
    TramitesModule,
    CajaModule,
    ConveniosModule,
    MonitoreoModule,
    ConciliacionesModule,
    AgoraModule,
    SigeHydraModule,
    DomiciliosModule,
    PuntosServicioModule,
    TiposContratacionModule,
    TarifasModule,
    ProcesosContratacionModule,
    CatalogosOperativosModule,
    RutasModule,
    MedidoresModule,
    SolicitudesModule,
    FacturacionModule,
    BatchModule,
    RestriccionesModule,
    IndicadoresModule,
    VeeModule,
    BalanceModule,
    CarteraModule,
    MdmModule,
    MigracionModule,
    AuditoriaModule,
    WebhooksModule,
    GemeloModule,
    ClimaModule,
    TenancyModule,
    SupraModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Cadena de guards globales. El orden del array es el orden de ejecución:
    //   1. AppThrottlerGuard — limita por usuario/IP antes de tocar la base de datos.
    //   2. JwtAuthGuard    — exige JWT válido salvo en rutas @Public().
    //   3. InternalGuard   — separa audiencias: CLIENTE sólo llega a @AllowPortal().
    //   4. RolesGuard      — aplica @Roles(...) donde esté declarado.
    // Toda la API queda cerrada por defecto: un controlador nuevo nace protegido.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: InternalGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
