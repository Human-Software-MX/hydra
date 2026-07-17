import { Module } from '@nestjs/common';
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

@Module({
  imports: [
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
