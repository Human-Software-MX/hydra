import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Percent } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { hasApi } from '@/api/client';
import { fetchAdministraciones } from '@/api/catalogos';
import {
  fetchActualizaciones,
  fetchCategoriasTarifa,
  fetchServiciosTarifa,
  fetchTarifasVigentes,
  type FiltroTarifas,
  type TarifaVigenteDto,
} from '@/api/tarifas';
import { PageHeader } from '@/components/PageHeader';
import { KpiCard } from '@/components/KpiCard';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActualizacionMasivaDialog } from '@/components/tarifas/ActualizacionMasivaDialog';
import { ActualizacionesTab } from '@/components/tarifas/ActualizacionesTab';
import { ConfiguracionFiscalTab } from '@/components/tarifas/ConfiguracionFiscalTab';
import { KardexGlobalTab } from '@/components/tarifas/KardexGlobalTab';
import { SimuladorTarifas } from '@/components/tarifas/SimuladorTarifas';
import { TarifaActualizarDialog } from '@/components/tarifas/TarifaActualizarDialog';
import { TarifaKardexSheet } from '@/components/tarifas/TarifaKardexSheet';
import { TarifasVigentesTable } from '@/components/tarifas/TarifasVigentesTable';
import { etiquetaSeccion, fmtFecha, fmtPct } from '@/components/tarifas/format';

/** La página abre en periódicas: es el catálogo que se consulta a diario. */
const FILTRO_INICIAL: FiltroTarifas = { seccion: 'PERIODICA' };

const Tarifas = () => {
  const useApi = hasApi();
  const { tarifas: ctxTarifas } = useData();

  const [tab, setTab] = useState('vigentes');
  const [filtro, setFiltro] = useState<FiltroTarifas>(FILTRO_INICIAL);
  const [masivaAbierta, setMasivaAbierta] = useState(false);
  const [tarifaAActualizar, setTarifaAActualizar] = useState<TarifaVigenteDto | null>(null);
  const [kardex, setKardex] = useState<{ id: string; resumen: TarifaVigenteDto | null } | null>(null);
  const [loteExpandido, setLoteExpandido] = useState<string | null>(null);

  /** `buscar` se filtra en cliente, así que no forma parte de la petición ni de la clave. */
  const filtroServidor = useMemo<FiltroTarifas>(
    () => ({
      administracionId: filtro.administracionId,
      categoriaId: filtro.categoriaId,
      claseTarifaId: filtro.claseTarifaId,
      tipoServicio: filtro.tipoServicio,
      concepto: filtro.concepto,
      seccion: filtro.seccion,
    }),
    [
      filtro.administracionId,
      filtro.categoriaId,
      filtro.claseTarifaId,
      filtro.tipoServicio,
      filtro.concepto,
      filtro.seccion,
    ],
  );

  const { data: tarifas = [], isLoading: cargandoTarifas } = useQuery({
    queryKey: ['tarifas-vigentes', filtroServidor],
    queryFn: () => fetchTarifasVigentes(filtroServidor),
    enabled: useApi,
  });

  const { data: servicios = [] } = useQuery({
    queryKey: ['tarifas-servicios'],
    queryFn: fetchServiciosTarifa,
    enabled: useApi,
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ['tarifas-categorias'],
    queryFn: fetchCategoriasTarifa,
    enabled: useApi,
  });

  const { data: administraciones = [] } = useQuery({
    queryKey: ['catalogos-operativos', 'administraciones'],
    queryFn: fetchAdministraciones,
    enabled: useApi,
    staleTime: 60 * 60 * 1000,
  });

  const { data: actualizaciones = [] } = useQuery({
    queryKey: ['tarifas-actualizaciones'],
    queryFn: () => fetchActualizaciones(),
    enabled: useApi,
  });

  /** La sección es el eje del listado, no un filtro más: no cuenta para "con los filtros aplicados". */
  const { seccion, ...filtrosDetalle } = filtroServidor;
  const hayFiltros = Object.values(filtrosDetalle).some(Boolean);
  /** Sin backend la página conserva el conteo del dataset demo (DataContext). */
  const totalVigentes = useApi ? tarifas.length : ctxTarifas.length;
  const exentas = tarifas.filter((t) => t.ivaPct === 0).length;
  const noObjeto = tarifas.filter((t) => t.ivaNoObjeto).length;
  const pctExentas = tarifas.length > 0 ? Math.round((exentas / tarifas.length) * 100) : 0;
  const totalClases = categorias.reduce((acc, c) => acc + c.clases.length, 0);
  const ultimaAct = actualizaciones[0];

  /** Limpiar no cambia de sección: es la vista elegida, no un filtro. */
  const limpiarFiltros = () => setFiltro((f) => ({ seccion: f.seccion }));

  const abrirLote = (actualizacionId: string) => {
    setKardex(null);
    setLoteExpandido(actualizacionId);
    setTab('actualizaciones');
  };

  return (
    <div>
      <PageHeader
        title="Tarifas"
        subtitle="Catálogo vigente, actualizaciones y Kardex"
        breadcrumbs={[{ label: 'Facturación', href: '#' }, { label: 'Tarifas' }]}
        actions={
          <Button
            onClick={() => setMasivaAbierta(true)}
            className="bg-[#007BFF] text-white hover:bg-blue-600"
          >
            <Percent className="mr-1.5 h-4 w-4" /> Actualización masiva %
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Tarifas vigentes"
          value={totalVigentes}
          sub={`${etiquetaSeccion(seccion)} · ${
            hayFiltros ? 'con los filtros aplicados' : 'versiones vigentes hoy'
          }`}
        />
        <KpiCard
          label="Exentas de IVA"
          value={exentas}
          sub={`${pctExentas} % del catálogo listado${noObjeto > 0 ? ` · ${noObjeto} no objeto` : ''}`}
          accent="success"
        />
        <KpiCard
          label="Categorías / clases"
          value={`${categorias.length} · ${totalClases}`}
          sub="Clasificación fiscal"
        />
        <KpiCard
          label="Última actualización"
          value={ultimaAct ? fmtFecha(ultimaAct.fechaAplicacion) : '—'}
          valueClassName={ultimaAct ? 'text-2xl xl:text-3xl' : undefined}
          sub={
            ultimaAct
              ? `${ultimaAct.porcentaje != null ? `${fmtPct(ultimaAct.porcentaje)} · ` : ''}${ultimaAct.descripcion}`
              : 'Sin actualizaciones'
          }
          accent={ultimaAct ? 'primary' : 'default'}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="vigentes">Tarifas vigentes</TabsTrigger>
          <TabsTrigger value="kardex">Kardex</TabsTrigger>
          <TabsTrigger value="actualizaciones">Actualizaciones</TabsTrigger>
          <TabsTrigger value="fiscal">Configuración fiscal</TabsTrigger>
          <TabsTrigger value="simulador">Simulador</TabsTrigger>
        </TabsList>

        <TabsContent value="vigentes">
          <TarifasVigentesTable
            tarifas={tarifas}
            isLoading={cargandoTarifas}
            useApi={useApi}
            filtro={filtro}
            onFiltroChange={setFiltro}
            onLimpiarFiltros={limpiarFiltros}
            administraciones={administraciones}
            categorias={categorias}
            servicios={servicios}
            onActualizar={setTarifaAActualizar}
            onKardex={(t) => setKardex({ id: t.id, resumen: t })}
          />
        </TabsContent>

        <TabsContent value="kardex">
          <KardexGlobalTab useApi={useApi} onVerKardex={(id) => setKardex({ id, resumen: null })} />
        </TabsContent>

        <TabsContent value="actualizaciones">
          <ActualizacionesTab
            useApi={useApi}
            administraciones={administraciones}
            categorias={categorias}
            expandidoId={loteExpandido}
            onToggleExpandido={(id) => setLoteExpandido((prev) => (prev === id ? null : id))}
          />
        </TabsContent>

        <TabsContent value="fiscal">
          <ConfiguracionFiscalTab useApi={useApi} />
        </TabsContent>

        <TabsContent value="simulador">
          <SimuladorTarifas
            useApi={useApi}
            administraciones={administraciones}
            categorias={categorias}
            servicios={servicios}
          />
        </TabsContent>
      </Tabs>

      <ActualizacionMasivaDialog
        open={masivaAbierta}
        onOpenChange={setMasivaAbierta}
        filtroInicial={filtroServidor}
        administraciones={administraciones}
        categorias={categorias}
        servicios={servicios}
        onAplicada={() => setTab('actualizaciones')}
      />

      <TarifaActualizarDialog
        tarifa={tarifaAActualizar}
        open={Boolean(tarifaAActualizar)}
        onOpenChange={(o) => !o && setTarifaAActualizar(null)}
      />

      <TarifaKardexSheet
        tarifaId={kardex?.id ?? null}
        tarifaResumen={kardex?.resumen ?? null}
        open={Boolean(kardex)}
        onOpenChange={(o) => !o && setKardex(null)}
        onVerLote={abrirLote}
      />
    </div>
  );
};

export default Tarifas;
