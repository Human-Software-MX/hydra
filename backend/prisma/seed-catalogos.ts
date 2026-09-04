/**
 * Semilla de datos de referencia (catálogos) — idempotente y segura en
 * cualquier entorno, incluida producción.
 *
 * Se ejecuta automáticamente en cada arranque de producción (`npm run
 * start:prod`) para que un despliegue nuevo tenga administraciones, distritos,
 * catálogos SAT/SIGE, tarifas y cláusulas sin intervención manual.
 *
 * NO contiene usuarios ni fixtures de demo: eso vive en prisma/seed.ts (dev).
 * El primer administrador se crea con `npm run bootstrap:admin`.
 *
 * Uso directo:
 *   ts-node prisma/seed-catalogos.ts        (desarrollo)
 *   node dist/prisma/seed-catalogos         (imagen de producción)
 */
import { Prisma, PrismaClient, CatalogoSatTipo } from '@prisma/client';
import { REGIMEN_FISCAL_SAT, SAT_VIGENCIA_INICIO, USO_CFDI_SAT } from './catalogo-sat-seed-data';
import { DISTRITOS_PUNTO_SERVICIO_SEED } from './seed-data/distritos-punto-servicio';
import * as fs from 'fs';
import * as path from 'path';
import {
  FALLBACK_ADMINISTRACIONES,
  importCatalogosTiposContratacion,
  linkHydraClausulasToAllTipos,
} from './catalogos-tipos-contratacion-import';
import { seedTarifasPeriodicas } from './tarifas-periodicas-import';
import { seedTarifasContratacion } from './tarifas-contratacion-import';
import { resolveDataFile } from './data-dir';

type ActividadSigeRow = { actipolid: number; actividad: string };

function loadCatalogoActividadSige(): ActividadSigeRow[] {
  return JSON.parse(fs.readFileSync(resolveDataFile('catalogo-actividad-sige.json'), 'utf8')) as ActividadSigeRow[];
}

type MunicipioQroSigeRow = {
  proid: number;
  procomid: number;
  claveINEGI: string;
  nombre: string;
  activo: boolean;
  fuente?: string;
};

function loadCatalogoMunicipiosQroSige(): MunicipioQroSigeRow[] {
  return JSON.parse(fs.readFileSync(resolveDataFile('catalogo-municipios-qro-sige.json'), 'utf8')) as MunicipioQroSigeRow[];
}

type LocalidadQroAgeemlSeedRow = {
  claveMunicipioINEGI: string;
  claveINEGI: string;
  nombre: string;
};

/** Generado con `npm run export:localidades-qro-json` desde AGEEML; se versiona en git (sin Excel en prod). */
function loadCatalogoLocalidadesQroAgeeml(): LocalidadQroAgeemlSeedRow[] {
  const file = resolveDataFile('catalogo-localidades-qro-ageeml.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')) as LocalidadQroAgeemlSeedRow[];
}

/** Administraciones (SIGE expid 1–13), zonas operativas y distritos. */
async function seedTerritorial(prisma: PrismaClient) {
  // Territorial: 13 administraciones (SIGE expid 1–13) y zonas de demo
  for (const a of FALLBACK_ADMINISTRACIONES) {
    await prisma.administracion.upsert({
      where: { id: a.id },
      update: { nombre: a.nombre },
      create: a,
    });
  }

  await prisma.zona.upsert({
    where: { id: 'Z001' },
    update: {},
    create: { id: 'Z001', administracionId: 'EXP-01', nombre: 'Norte' },
  });
  await prisma.zona.upsert({
    where: { id: 'Z002' },
    update: {},
    create: { id: 'Z002', administracionId: 'EXP-01', nombre: 'El Marqués' },
  });
  await prisma.zona.upsert({
    where: { id: 'Z003' },
    update: {},
    create: { id: 'Z003', administracionId: 'EXP-01', nombre: 'Corregidora' },
  });

  for (const d of DISTRITOS_PUNTO_SERVICIO_SEED) {
    await prisma.distrito.upsert({
      where: { id: d.id },
      update: { nombre: d.nombre, zonaId: d.zonaId },
      create: { id: d.id, zonaId: d.zonaId, nombre: d.nombre },
    });
  }
  console.log('Territorial sembrado: administraciones, zonas y distritos.');
}

async function seedCatalogoTramites(prisma: PrismaClient) {
  const tipos = [
    {
      tipo: 'Alta',
      descripcion: 'Alta de nuevo servicio de agua potable y/o saneamiento',
      tipoFirma: 'autografa',
      documentosRequeridos: [
        { nombre: 'Identificación oficial', requerido: true },
        { nombre: 'Comprobante de domicilio', requerido: true },
        { nombre: 'Escritura o título de propiedad', requerido: true },
        { nombre: 'CURP', requerido: false },
      ],
    },
    {
      tipo: 'Baja Temporal',
      descripcion: 'Suspensión temporal del servicio a solicitud del titular',
      tipoFirma: 'ambas',
      documentosRequeridos: [
        { nombre: 'Identificación oficial', requerido: true },
        { nombre: 'Solicitud de baja temporal', requerido: true },
        { nombre: 'Estado de cuenta sin adeudos', requerido: true },
      ],
    },
    {
      tipo: 'Baja Definitiva',
      descripcion: 'Cancelación definitiva del servicio',
      tipoFirma: 'autografa',
      documentosRequeridos: [
        { nombre: 'Identificación oficial', requerido: true },
        { nombre: 'Solicitud de baja definitiva', requerido: true },
        { nombre: 'Estado de cuenta sin adeudos', requerido: true },
        { nombre: 'Croquis de ubicación de toma', requerido: false },
      ],
    },
    {
      tipo: 'Cambio Propietario',
      descripcion: 'Cambio de titular del contrato de servicio',
      tipoFirma: 'autografa',
      documentosRequeridos: [
        { nombre: 'Identificación oficial del nuevo propietario', requerido: true },
        { nombre: 'Escritura o contrato de compra-venta', requerido: true },
        { nombre: 'Estado de cuenta sin adeudos', requerido: true },
        { nombre: 'Comprobante de domicilio del nuevo propietario', requerido: false },
      ],
    },
    {
      tipo: 'Reconexion',
      descripcion: 'Reconexión del servicio después de corte por adeudo u otro motivo',
      tipoFirma: 'ambas',
      documentosRequeridos: [
        { nombre: 'Comprobante de pago del adeudo', requerido: true },
        { nombre: 'Identificación oficial', requerido: false },
      ],
    },
    {
      tipo: 'CambioNombre',
      descripcion: 'Corrección o actualización del nombre en el contrato',
      tipoFirma: 'ambas',
      documentosRequeridos: [
        { nombre: 'Identificación oficial', requerido: true },
        { nombre: 'Acta de nacimiento o escritura (si aplica)', requerido: false },
      ],
    },
    {
      tipo: 'CambioTarifa',
      descripcion: 'Cambio de tarifa o tipo de servicio',
      tipoFirma: 'autografa',
      documentosRequeridos: [
        { nombre: 'Solicitud de cambio de tarifa', requerido: true },
        { nombre: 'Documentación que acredite nuevo uso', requerido: true },
      ],
    },
  ];

  for (const cat of tipos) {
    await prisma.catalogoTramite.upsert({
      where: { tipo: cat.tipo },
      update: { descripcion: cat.descripcion, tipoFirma: cat.tipoFirma, documentosRequeridos: cat.documentosRequeridos },
      create: {
        tipo: cat.tipo,
        descripcion: cat.descripcion,
        tipoFirma: cat.tipoFirma,
        documentosRequeridos: cat.documentosRequeridos,
      },
    });
  }
  console.log('Catálogo de trámites sembrado:', tipos.map(t => t.tipo).join(', '));
}

async function seedCatalogosOperativos(prisma: PrismaClient) {
  // Tipos de corte (T11 — CatalogoTipoCorte)
  const tiposCorte = [
    { codigo: 'DEUDA', descripcion: 'Corte por adeudo', impacto: 'suspensión_total', requiereCuadrilla: true },
    { codigo: 'BAJA_TEMP', descripcion: 'Baja temporal', impacto: 'suspensión_total', requiereCuadrilla: true },
    { codigo: 'ADMIN', descripcion: 'Corte administrativo', impacto: 'solo_registro', requiereCuadrilla: false },
    { codigo: 'FUGA', descripcion: 'Corte por fuga', impacto: 'suspensión_total', requiereCuadrilla: true },
  ];
  for (const tc of tiposCorte) {
    await prisma.catalogoTipoCorte.upsert({
      where: { codigo: tc.codigo },
      update: { descripcion: tc.descripcion, impacto: tc.impacto, requiereCuadrilla: tc.requiereCuadrilla },
      create: tc,
    });
  }
  console.log('Tipos de corte sembrados:', tiposCorte.map(t => t.codigo).join(', '));

  // Tipos de suministro (T11 — CatalogoTipoSuministro)
  const tiposSuministro = [
    { codigo: 'AGUA', descripcion: 'Agua potable' },
    { codigo: 'SANEAMIENTO', descripcion: 'Saneamiento' },
    { codigo: 'ALCANTARILLADO', descripcion: 'Alcantarillado' },
    { codigo: 'MIXTO', descripcion: 'Agua potable + Saneamiento' },
  ];
  for (const ts of tiposSuministro) {
    await prisma.catalogoTipoSuministro.upsert({
      where: { codigo: ts.codigo },
      update: { descripcion: ts.descripcion },
      create: ts,
    });
  }
  console.log('Tipos de suministro sembrados:', tiposSuministro.map(t => t.codigo).join(', '));

  // Estructuras técnicas (T11 — CatalogoEstructuraTecnica)
  const estructuras = [
    { codigo: 'DOM_IND', descripcion: 'Domiciliaria individual' },
    { codigo: 'DOM_COND', descripcion: 'Domiciliaria condominial' },
    { codigo: 'COM_IND', descripcion: 'Comercial individual' },
    { codigo: 'IND_PESADO', descripcion: 'Industrial pesado' },
    { codigo: 'GOB_PUB', descripcion: 'Gobierno / uso público' },
  ];
  for (const et of estructuras) {
    await prisma.catalogoEstructuraTecnica.upsert({
      where: { codigo: et.codigo },
      update: { descripcion: et.descripcion },
      create: et,
    });
  }
  console.log('Estructuras técnicas sembradas:', estructuras.map(e => e.codigo).join(', '));
}

async function seedCatalogosContratacion(prisma: PrismaClient) {
  // Tipos de contratación: prisma/data/catalogos-tipos-contratacion-sige.json (o Excel en dev) en importCatalogosTiposContratacion.

  // Conceptos de cobro (T13)
  const conceptosCobro = [
    { codigo: 'AGUA', nombre: 'Servicio de agua', tipo: 'variable' },
    { codigo: 'SANEAMIENTO', nombre: 'Saneamiento', tipo: 'porcentual' },
    { codigo: 'ALCANTARILLADO', nombre: 'Alcantarillado', tipo: 'fijo' },
    { codigo: 'CONTRATACION', nombre: 'Cargo por contratación', tipo: 'fijo' },
    { codigo: 'RECONEXION', nombre: 'Cargo por reconexión', tipo: 'fijo' },
  ];
  for (const cc of conceptosCobro) {
    await prisma.conceptoCobro.upsert({
      where: { codigo: cc.codigo },
      update: { nombre: cc.nombre, tipo: cc.tipo },
      create: cc,
    });
  }
  console.log('Conceptos de cobro sembrados:', conceptosCobro.map(c => c.codigo).join(', '));

  // ── Cláusulas contractuales Hydra (texto legal real) ─────────────────────
  await seedClausulasHydra(prisma);
}

async function seedCatalogosActividadRelacionPS(prisma: PrismaClient) {
  // ─── Actividades: catálogo operativo SIGE (hoja «Actividad», actipolid + texto) ─
  const sigeRows = loadCatalogoActividadSige();
  const actividades = sigeRows.map((r) => {
    const key = `ACTIPOL_${r.actipolid}`;
    return {
      id: key,
      codigo: key,
      descripcion: r.actividad,
      grupoId: null,
    };
  });
  for (const a of actividades) {
    await (prisma as any).catalogoActividad.upsert({
      where: { codigo: a.codigo },
      update: { descripcion: a.descripcion, grupoId: a.grupoId, activo: true },
      create: { ...a, activo: true },
    });
  }
  const deactivated = await (prisma as any).catalogoActividad.updateMany({
    where: { NOT: { codigo: { startsWith: 'ACTIPOL_' } } },
    data: { activo: false },
  });
  console.log(
    'Actividades sembradas:',
    actividades.length,
    '| actividades no-SIGE desactivadas:',
    deactivated.count,
  );

  // ─── Categorías de Contrato (21 categorías CIG2018) ─────────────────────────
  const categorias = [
    { id: 'CAT01', codigo: 'DOM_A', descripcion: 'Doméstico A (0–10 m³)' },
    { id: 'CAT02', codigo: 'DOM_B', descripcion: 'Doméstico B (11–20 m³)' },
    { id: 'CAT03', codigo: 'DOM_C', descripcion: 'Doméstico C (21–30 m³)' },
    { id: 'CAT04', codigo: 'DOM_D', descripcion: 'Doméstico D (>30 m³)' },
    { id: 'CAT05', codigo: 'COM_PEQ', descripcion: 'Comercial pequeño' },
    { id: 'CAT06', codigo: 'COM_MED', descripcion: 'Comercial mediano' },
    { id: 'CAT07', codigo: 'COM_GDE', descripcion: 'Comercial grande' },
    { id: 'CAT08', codigo: 'IND_PEQ', descripcion: 'Industrial pequeño' },
    { id: 'CAT09', codigo: 'IND_MED', descripcion: 'Industrial mediano' },
    { id: 'CAT10', codigo: 'IND_GDE', descripcion: 'Industrial grande' },
    { id: 'CAT11', codigo: 'GOB_FED', descripcion: 'Gobierno federal' },
    { id: 'CAT12', codigo: 'GOB_ESTATAL', descripcion: 'Gobierno estatal' },
    { id: 'CAT13', codigo: 'GOB_MPAL', descripcion: 'Gobierno municipal' },
    { id: 'CAT14', codigo: 'SERV_PUB', descripcion: 'Servicio público (escuelas, hospitales)' },
    { id: 'CAT15', codigo: 'SOCIAL', descripcion: 'Interés social (vivienda / subsidio)' },
    { id: 'CAT16', codigo: 'RELIG', descripcion: 'Religioso / sin fines de lucro' },
    { id: 'CAT17', codigo: 'AGRO', descripcion: 'Agropecuario / riego' },
    { id: 'CAT18', codigo: 'CONST_PROV', descripcion: 'Construcción provisional' },
    { id: 'CAT19', codigo: 'MIXTO', descripcion: 'Uso mixto' },
    { id: 'CAT20', codigo: 'CONDOM', descripcion: 'Condominial / medidor maestro' },
    { id: 'CAT21', codigo: 'ESPECIAL', descripcion: 'Tarifa especial / convenio' },
  ];
  for (const c of categorias) {
    await (prisma as any).catalogoCategoria.upsert({
      where: { codigo: c.codigo },
      update: { descripcion: c.descripcion },
      create: c,
    });
  }
  console.log('Categorías de contrato sembradas:', categorias.length);

  // ─── Tipos de Relación Padre-Hijo PS (P10 – 6 tipos CIG2018) ────────────────
  const tiposRelacionPS = [
    {
      id: 'TRP01',
      codigo: 'CONDOM_MAESTRO',
      descripcion: 'Medidor maestro condominial',
      metodo: 'proporcional',
      reparteConsumo: true,
    },
    {
      id: 'TRP02',
      codigo: 'CONDOM_INDIVIDUAL',
      descripcion: 'Unidad condominial individual',
      metodo: 'individual',
      reparteConsumo: false,
    },
    {
      id: 'TRP03',
      codigo: 'SUBMEDICION',
      descripcion: 'Sub-medición (toma derivada)',
      metodo: 'diferencia',
      reparteConsumo: true,
    },
    {
      id: 'TRP04',
      codigo: 'RIEGO_COMUN',
      descripcion: 'Área común de riego / jardín',
      metodo: 'porcentual',
      reparteConsumo: true,
    },
    {
      id: 'TRP05',
      codigo: 'USO_MIX_PADRE',
      descripcion: 'Planta baja comercial (padre mixto)',
      metodo: 'individual',
      reparteConsumo: false,
    },
    {
      id: 'TRP06',
      codigo: 'USO_MIX_HIJO',
      descripcion: 'Piso habitacional (hijo mixto)',
      metodo: 'individual',
      reparteConsumo: false,
    },
  ];
  for (const t of tiposRelacionPS) {
    await (prisma as any).catalogoTipoRelacionPS.upsert({
      where: { codigo: t.codigo },
      update: { descripcion: t.descripcion, metodo: t.metodo, reparteConsumo: t.reparteConsumo },
      create: t,
    });
  }
  console.log('Tipos de relación padre-hijo PS sembrados:', tiposRelacionPS.length);
}

async function seedTarifas(prisma: PrismaClient) {
  const vigenciaDesde = new Date('2026-01-01');

  const tarifas = [
    // AGUA doméstica — escalonada
    { id: 'TAR01', codigo: 'AGUA-DOM-R1', nombre: 'Agua doméstica rango 1 (0-10 m³)', tipoServicio: 'AGUA', tipoCalculo: 'escalonado', rangoMinM3: 0, rangoMaxM3: 10, precioUnitario: 8.50, cuotaFija: null, ivaPct: 16 },
    { id: 'TAR02', codigo: 'AGUA-DOM-R2', nombre: 'Agua doméstica rango 2 (11-20 m³)', tipoServicio: 'AGUA', tipoCalculo: 'escalonado', rangoMinM3: 10, rangoMaxM3: 20, precioUnitario: 12.80, cuotaFija: null, ivaPct: 16 },
    { id: 'TAR03', codigo: 'AGUA-DOM-R3', nombre: 'Agua doméstica rango 3 (21-30 m³)', tipoServicio: 'AGUA', tipoCalculo: 'escalonado', rangoMinM3: 20, rangoMaxM3: 30, precioUnitario: 18.40, cuotaFija: null, ivaPct: 16 },
    { id: 'TAR04', codigo: 'AGUA-DOM-R4', nombre: 'Agua doméstica rango 4 (>30 m³)', tipoServicio: 'AGUA', tipoCalculo: 'escalonado', rangoMinM3: 30, rangoMaxM3: null, precioUnitario: 26.90, cuotaFija: null, ivaPct: 16 },
    // SANEAMIENTO — cargo fijo
    { id: 'TAR05', codigo: 'SAN-FIJO', nombre: 'Saneamiento cargo fijo mensual', tipoServicio: 'SANEAMIENTO', tipoCalculo: 'fijo', rangoMinM3: null, rangoMaxM3: null, precioUnitario: null, cuotaFija: 45.00, ivaPct: 16 },
    // ALCANTARILLADO — variable
    { id: 'TAR06', codigo: 'ALC-VAR', nombre: 'Alcantarillado variable por m³', tipoServicio: 'ALCANTARILLADO', tipoCalculo: 'variable', rangoMinM3: 0, rangoMaxM3: null, precioUnitario: 4.20, cuotaFija: null, ivaPct: 16 },
  ];

  for (const t of tarifas) {
    await prisma.tarifa.upsert({
      where: { id: t.id },
      update: { precioUnitario: t.precioUnitario, cuotaFija: t.cuotaFija, activo: true },
      create: {
        id: t.id,
        codigo: t.codigo,
        nombre: t.nombre,
        tipoServicio: t.tipoServicio,
        tipoCalculo: t.tipoCalculo,
        rangoMinM3: t.rangoMinM3,
        rangoMaxM3: t.rangoMaxM3,
        precioUnitario: t.precioUnitario,
        cuotaFija: t.cuotaFija,
        ivaPct: t.ivaPct,
        vigenciaDesde,
      },
    });
  }
  console.log('Tarifas sembradas:', tarifas.length);
}

async function seedCatalogosMedidor(prisma: PrismaClient) {
  const marcas = [
    { id: 'MRC01', codigo: 'ELSTER', nombre: 'Elster / Honeywell' },
    { id: 'MRC02', codigo: 'SENSUS', nombre: 'Sensus / Xylem' },
    { id: 'MRC03', codigo: 'ITRON', nombre: 'Itron' },
    { id: 'MRC04', codigo: 'BADGER', nombre: 'Badger Meter' },
    { id: 'MRC05', codigo: 'ZENNER', nombre: 'Zenner' },
    { id: 'MRC06', codigo: 'DIEHL', nombre: 'Diehl Metering' },
    { id: 'MRC07', codigo: 'ARAD', nombre: 'Arad Group' },
    { id: 'MRC08', codigo: 'KAMSTRUP', nombre: 'Kamstrup' },
    { id: 'MRC09', codigo: 'MASTER_METER', nombre: 'Master Meter' },
    { id: 'MRC10', codigo: 'LAO', nombre: 'LAO Industria' },
  ];
  for (const m of marcas) {
    await prisma.catalogoMarcaMedidor.upsert({
      where: { codigo: m.codigo },
      update: { nombre: m.nombre },
      create: m,
    });
  }

  const modelos = [
    { id: 'MOD01', marcaId: 'MRC01', codigo: 'V100', nombre: 'V100 Volumétrico' },
    { id: 'MOD02', marcaId: 'MRC01', codigo: 'S150', nombre: 'S150 Chorro único' },
    { id: 'MOD03', marcaId: 'MRC02', codigo: 'MEITWIN', nombre: 'MeiTwin' },
    { id: 'MOD04', marcaId: 'MRC02', codigo: 'IPERL', nombre: 'iPERL Ultrasónico' },
    { id: 'MOD05', marcaId: 'MRC03', codigo: 'FLODIS', nombre: 'Flodis Chorro único' },
    { id: 'MOD06', marcaId: 'MRC03', codigo: 'AQUADIS', nombre: 'Aquadis+ Volumétrico' },
    { id: 'MOD07', marcaId: 'MRC04', codigo: 'M25', nombre: 'M25 Industrial' },
    { id: 'MOD08', marcaId: 'MRC05', codigo: 'MTKD', nombre: 'MTK-D Doméstico' },
    { id: 'MOD09', marcaId: 'MRC10', codigo: 'LAO_DOM', nombre: 'Doméstico estándar' },
    { id: 'MOD10', marcaId: 'MRC10', codigo: 'LAO_IND', nombre: 'Industrial tipo Woltman' },
  ];
  for (const m of modelos) {
    await prisma.catalogoModeloMedidor.upsert({
      where: { codigo: m.codigo },
      update: { nombre: m.nombre, marcaId: m.marcaId },
      create: m,
    });
  }

  const calibres = [
    { id: 'CAL01', codigo: '1/2"', descripcion: 'Media pulgada (13 mm)', diametroMm: 13 },
    { id: 'CAL02', codigo: '3/4"', descripcion: 'Tres cuartos de pulgada (19 mm)', diametroMm: 19 },
    { id: 'CAL03', codigo: '1"', descripcion: 'Una pulgada (25 mm)', diametroMm: 25 },
    { id: 'CAL04', codigo: '1-1/2"', descripcion: 'Pulgada y media (38 mm)', diametroMm: 38 },
    { id: 'CAL05', codigo: '2"', descripcion: 'Dos pulgadas (50 mm)', diametroMm: 50 },
    { id: 'CAL06', codigo: '3"', descripcion: 'Tres pulgadas (75 mm)', diametroMm: 75 },
    { id: 'CAL07', codigo: '4"', descripcion: 'Cuatro pulgadas (100 mm)', diametroMm: 100 },
    { id: 'CAL08', codigo: '6"', descripcion: 'Seis pulgadas (150 mm)', diametroMm: 150 },
  ];
  for (const c of calibres) {
    await prisma.catalogoCalibre.upsert({
      where: { codigo: c.codigo },
      update: { descripcion: c.descripcion },
      create: c,
    });
  }

  const emplazamientos = [
    { id: 'EMP01', codigo: 'INTERIOR', descripcion: 'Interior del predio' },
    { id: 'EMP02', codigo: 'BANQUETA', descripcion: 'En banqueta / acera' },
    { id: 'EMP03', codigo: 'PARED_EXT', descripcion: 'Pared exterior' },
    { id: 'EMP04', codigo: 'CAJA_REGISTRO', descripcion: 'Caja de registro subterránea' },
    { id: 'EMP05', codigo: 'CUARTO_MAQ', descripcion: 'Cuarto de máquinas' },
    { id: 'EMP06', codigo: 'SOTANO', descripcion: 'Sótano' },
  ];
  for (const e of emplazamientos) {
    await prisma.catalogoEmplazamiento.upsert({
      where: { codigo: e.codigo },
      update: { descripcion: e.descripcion },
      create: e,
    });
  }

  const tiposContador = [
    { id: 'TC01', codigo: 'VOLUMETRICO', descripcion: 'Volumétrico (pistón oscilante)' },
    { id: 'TC02', codigo: 'CHORRO_UNICO', descripcion: 'Chorro único (velocidad)' },
    { id: 'TC03', codigo: 'CHORRO_MULTIPLE', descripcion: 'Chorro múltiple' },
    { id: 'TC04', codigo: 'WOLTMAN', descripcion: 'Woltman (turbina axial)' },
    { id: 'TC05', codigo: 'ULTRASONICO', descripcion: 'Ultrasónico' },
    { id: 'TC06', codigo: 'ELECTROMAG', descripcion: 'Electromagnético' },
    { id: 'TC07', codigo: 'PROPORCIONAL', descripcion: 'Proporcional / combinado' },
  ];
  for (const tc of tiposContador) {
    await prisma.catalogoTipoContador.upsert({
      where: { codigo: tc.codigo },
      update: { descripcion: tc.descripcion },
      create: tc,
    });
  }

  console.log(
    `Catálogos de medidores sembrados: ${marcas.length} marcas, ${modelos.length} modelos, ${calibres.length} calibres, ${emplazamientos.length} emplazamientos, ${tiposContador.length} tipos`,
  );
}

async function seedFormasPagoOficinas(prisma: PrismaClient) {
  const formasPago = [
    { id: 'FP01', codigo: 'EFECTIVO', nombre: 'Efectivo en caja', tipoRecaudacion: 'CAJA', aceptaEfectivo: true },
    { id: 'FP02', codigo: 'CHEQUE', nombre: 'Cheque', tipoRecaudacion: 'CAJA', aceptaCheque: true },
    { id: 'FP03', codigo: 'TARJETA_DEB', nombre: 'Tarjeta de débito', tipoRecaudacion: 'CAJA', aceptaTarjeta: true },
    { id: 'FP04', codigo: 'TARJETA_CRED', nombre: 'Tarjeta de crédito', tipoRecaudacion: 'CAJA', aceptaTarjeta: true },
    { id: 'FP05', codigo: 'SPEI', nombre: 'Transferencia SPEI', tipoRecaudacion: 'BANCO', aceptaTransf: true, requiereReferencia: true },
    { id: 'FP06', codigo: 'DOMICILIACION', nombre: 'Domiciliación bancaria', tipoRecaudacion: 'DOMICILIACION', aceptaTransf: true, requiereReferencia: true },
    { id: 'FP07', codigo: 'OXXO', nombre: 'Pago en OXXO', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
    { id: 'FP08', codigo: 'BANORTE', nombre: 'Pago en Banorte', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
    { id: 'FP09', codigo: 'BBVA', nombre: 'Pago en BBVA', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
    { id: 'FP10', codigo: 'SANTANDER', nombre: 'Pago en Santander', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
    { id: 'FP11', codigo: 'BANAMEX', nombre: 'Pago en Citibanamex', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
    { id: 'FP12', codigo: 'SCOTIABANK', nombre: 'Pago en Scotiabank', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
    { id: 'FP13', codigo: 'HSBC', nombre: 'Pago en HSBC', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
    { id: 'FP14', codigo: 'BAJIO', nombre: 'Pago en BanBajío', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
    { id: 'FP15', codigo: 'AFIRME', nombre: 'Pago en Afirme', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
    { id: 'FP16', codigo: 'SORIANA', nombre: 'Pago en Soriana', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
    { id: 'FP17', codigo: 'ELEKTRA', nombre: 'Pago en Elektra', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
    { id: 'FP18', codigo: 'CODI', nombre: 'CoDi', tipoRecaudacion: 'WEB', aceptaTransf: true },
    { id: 'FP19', codigo: 'WEB_PORTAL', nombre: 'Pago en portal web', tipoRecaudacion: 'WEB', aceptaTarjeta: true },
    { id: 'FP20', codigo: 'AMEX', nombre: 'American Express', tipoRecaudacion: 'EXTERNO', aceptaTarjeta: true, requiereReferencia: true },
    { id: 'FP21', codigo: 'REGALII', nombre: 'Regalii', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
    { id: 'FP22', codigo: 'SUPERQ', nombre: 'Super Q', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
    { id: 'FP23', codigo: 'BIMBONET', nombre: 'Bimbonet', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
    { id: 'FP24', codigo: 'CAJA_FLORENCIA', nombre: 'Caja Florencia', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
    { id: 'FP25', codigo: 'CAJA_GONZALEZ', nombre: 'Caja González', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
    { id: 'FP26', codigo: 'CAJA_INMACULADA', nombre: 'Caja Inmaculada', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
    { id: 'FP27', codigo: 'MUNICIPIO_QRO', nombre: 'Municipio de Querétaro', tipoRecaudacion: 'EXTERNO', requiereReferencia: true },
  ];
  for (const fp of formasPago) {
    await prisma.formaPago.upsert({
      where: { codigo: fp.codigo },
      update: { nombre: fp.nombre },
      create: {
        id: fp.id,
        codigo: fp.codigo,
        nombre: fp.nombre,
        tipoRecaudacion: fp.tipoRecaudacion,
        aceptaEfectivo: fp.aceptaEfectivo ?? false,
        aceptaCheque: fp.aceptaCheque ?? false,
        aceptaTarjeta: fp.aceptaTarjeta ?? false,
        aceptaTransf: fp.aceptaTransf ?? false,
        requiereReferencia: fp.requiereReferencia ?? false,
      },
    });
  }
  console.log('Formas de pago sembradas:', formasPago.length);

  const tiposOficina = [
    { id: 'TOF01', codigo: 'CENTRAL', descripcion: 'Oficina central' },
    { id: 'TOF02', codigo: 'MODULO', descripcion: 'Módulo de atención' },
    { id: 'TOF03', codigo: 'SUCURSAL', descripcion: 'Sucursal' },
    { id: 'TOF04', codigo: 'CAJA_EXT', descripcion: 'Punto de recaudación externo' },
  ];
  for (const to of tiposOficina) {
    await prisma.tipoOficina.upsert({
      where: { codigo: to.codigo },
      update: { descripcion: to.descripcion },
      create: to,
    });
  }

  const oficinas = [
    { id: 'OF01', codigo: 'CEA_CENTRAL', nombre: 'Oficina Central CEA', administracionId: 'EXP-01', tipoOficinaId: 'TOF01', direccion: 'Blvd. Bernardo Quintana 100, Querétaro' },
    { id: 'OF02', codigo: 'CEA_NORTE', nombre: 'Módulo Norte', administracionId: 'EXP-01', tipoOficinaId: 'TOF02', direccion: 'Av. Constituyentes 200, Querétaro' },
    { id: 'OF03', codigo: 'CEA_SUR', nombre: 'Módulo Sur', administracionId: 'EXP-01', tipoOficinaId: 'TOF02', direccion: 'Av. 5 de Febrero 1500, Querétaro' },
    { id: 'OF04', codigo: 'CEA_MARQUES', nombre: 'Sucursal El Marqués', administracionId: 'EXP-01', tipoOficinaId: 'TOF03', direccion: 'Centro El Marqués' },
  ];
  for (const of_ of oficinas) {
    await prisma.oficina.upsert({
      where: { codigo: of_.codigo },
      update: { nombre: of_.nombre },
      create: of_,
    });
  }
  console.log('Oficinas sembradas:', oficinas.length);
}

async function seedSectoresClasesVariables(prisma: PrismaClient) {
  const sectores = [
    { id: 'SH01', codigo: 'SEC_CENTRO', nombre: 'Centro', administracionId: 'EXP-01' },
    { id: 'SH02', codigo: 'SEC_NORTE', nombre: 'Norte', administracionId: 'EXP-01' },
    { id: 'SH03', codigo: 'SEC_SUR', nombre: 'Sur', administracionId: 'EXP-01' },
    { id: 'SH04', codigo: 'SEC_PONIENTE', nombre: 'Poniente', administracionId: 'EXP-01' },
    { id: 'SH05', codigo: 'SEC_ORIENTE', nombre: 'Oriente', administracionId: 'EXP-01' },
    { id: 'SH06', codigo: 'SEC_MARQUES', nombre: 'El Marqués', administracionId: 'EXP-01' },
    { id: 'SH07', codigo: 'SEC_CORREGIDORA', nombre: 'Corregidora', administracionId: 'EXP-01' },
  ];
  for (const s of sectores) {
    await prisma.sectorHidraulico.upsert({
      where: { codigo: s.codigo },
      update: { nombre: s.nombre },
      create: s,
    });
  }
  console.log('Sectores hidráulicos sembrados:', sectores.length);

  const clases = [
    { id: 'CLC01', codigo: 'AN', descripcion: 'Alta nueva' },
    { id: 'CLC02', codigo: 'CN', descripcion: 'Cambio de nombre / titular' },
    { id: 'CLC03', codigo: 'PB', descripcion: 'Proceso de baja' },
    { id: 'CLC04', codigo: 'BJ', descripcion: 'Baja definitiva' },
    { id: 'CLC05', codigo: 'CT', descripcion: 'Cambio de tipo' },
    { id: 'CLC06', codigo: 'RX', descripcion: 'Reconexión' },
    { id: 'CLC07', codigo: 'BT', descripcion: 'Baja temporal' },
  ];
  for (const c of clases) {
    await prisma.claseContrato.upsert({
      where: { codigo: c.codigo },
      update: { descripcion: c.descripcion },
      create: c,
    });
  }
  console.log('Clases de contrato sembradas:', clases.length);

  const tiposVia = [
    { id: 'TV01', codigo: 'CALLE', descripcion: 'Calle', abreviatura: 'C.' },
    { id: 'TV02', codigo: 'AVENIDA', descripcion: 'Avenida', abreviatura: 'Av.' },
    { id: 'TV03', codigo: 'BOULEVARD', descripcion: 'Boulevard', abreviatura: 'Blvd.' },
    { id: 'TV04', codigo: 'CALZADA', descripcion: 'Calzada', abreviatura: 'Czda.' },
    { id: 'TV05', codigo: 'CERRADA', descripcion: 'Cerrada', abreviatura: 'Cerr.' },
    { id: 'TV06', codigo: 'PRIVADA', descripcion: 'Privada', abreviatura: 'Priv.' },
    { id: 'TV07', codigo: 'ANDADOR', descripcion: 'Andador', abreviatura: 'And.' },
    { id: 'TV08', codigo: 'PROLONGACION', descripcion: 'Prolongación', abreviatura: 'Prol.' },
    { id: 'TV09', codigo: 'CIRCUITO', descripcion: 'Circuito', abreviatura: 'Cto.' },
    { id: 'TV10', codigo: 'CAMINO', descripcion: 'Camino', abreviatura: 'Cam.' },
    { id: 'TV11', codigo: 'CARRETERA', descripcion: 'Carretera', abreviatura: 'Carr.' },
    { id: 'TV12', codigo: 'PASEO', descripcion: 'Paseo', abreviatura: 'Pso.' },
    { id: 'TV13', codigo: 'RETORNO', descripcion: 'Retorno', abreviatura: 'Ret.' },
  ];
  for (const tv of tiposVia) {
    await prisma.tipoVia.upsert({
      where: { codigo: tv.codigo },
      update: { descripcion: tv.descripcion },
      create: tv,
    });
  }
  console.log('Tipos de vía sembrados:', tiposVia.length);

  const tiposVariable = [
    { id: 'TVAR01', codigo: 'DISTANCIA_RED', nombre: 'Distancia a red principal', tipoDato: 'NUMERO', unidad: 'metros' },
    { id: 'TVAR02', codigo: 'DIAMETRO_TOMA', nombre: 'Diámetro de toma', tipoDato: 'LISTA', valoresPosibles: ['1/2"', '3/4"', '1"', '1-1/2"', '2"'] },
    { id: 'TVAR03', codigo: 'PROFUNDIDAD_TOMA', nombre: 'Profundidad de toma', tipoDato: 'NUMERO', unidad: 'metros' },
    { id: 'TVAR04', codigo: 'SUPERFICIE', nombre: 'Superficie del predio', tipoDato: 'NUMERO', unidad: 'm²' },
    { id: 'TVAR05', codigo: 'NUM_DEPARTAMENTOS', nombre: 'Número de departamentos', tipoDato: 'NUMERO' },
    { id: 'TVAR06', codigo: 'TIPO_DESCARGA', nombre: 'Tipo de descarga', tipoDato: 'LISTA', valoresPosibles: ['DOMESTICA', 'INDUSTRIAL', 'MIXTA'] },
    { id: 'TVAR07', codigo: 'GIRO_ACTIVIDAD', nombre: 'Giro de actividad', tipoDato: 'TEXTO' },
    { id: 'TVAR08', codigo: 'REQUIERE_FACTIBILIDAD', nombre: 'Requiere dictamen de factibilidad', tipoDato: 'BOOLEANO' },
    { id: 'TVAR09', codigo: 'PRESION_DISPONIBLE', nombre: 'Presión disponible en red', tipoDato: 'NUMERO', unidad: 'kg/cm²' },
    { id: 'TVAR10', codigo: 'MATERIAL_TUBERIA', nombre: 'Material de tubería', tipoDato: 'LISTA', valoresPosibles: ['PVC', 'CPVC', 'PEAD', 'COBRE', 'GALVANIZADO', 'ACERO'] },
  ];
  for (const tv of tiposVariable) {
    await prisma.tipoVariable.upsert({
      where: { codigo: tv.codigo },
      update: { nombre: tv.nombre },
      create: {
        id: tv.id,
        codigo: tv.codigo,
        nombre: tv.nombre,
        tipoDato: tv.tipoDato,
        unidad: tv.unidad ?? null,
        valoresPosibles: tv.valoresPosibles ?? Prisma.DbNull,
      },
    });
  }
  console.log('Tipos de variable sembrados:', tiposVariable.length);
}

async function seedInegiQueretaro(prisma: PrismaClient) {
  // Localidades y colonias ya NO se seedan aquí — están en la migration SQL
  // 20260427000000_aquasis_localidades_colonias (datos Aquasis, 3595 loc / 3815 col)
  const estado = await prisma.catalogoEstadoINEGI.upsert({
    where: { claveINEGI: '22' },
    update: {},
    create: { claveINEGI: '22', nombre: 'Querétaro', activo: true },
  });

  const municipiosQro = loadCatalogoMunicipiosQroSige();
  for (const row of municipiosQro) {
    await prisma.catalogoMunicipioINEGI.upsert({
      where: { claveINEGI: row.claveINEGI },
      update: { nombre: row.nombre, activo: row.activo, estadoId: estado.id },
      create: {
        estadoId: estado.id,
        claveINEGI: row.claveINEGI,
        nombre: row.nombre,
        activo: row.activo,
      },
    });
  }

  console.log(
    'INEGI Querétaro: 1 estado,',
    municipiosQro.length,
    'municipios. Localidades y colonias cargadas vía migration SQL (Aquasis).',
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Cláusulas Hydra + Plantilla completa
// ═══════════════════════════════════════════════════════════════════════════

async function seedClausulasHydra(prisma: PrismaClient) {
  const clausulas: { codigo: string; titulo: string; contenido: string; orden: number }[] = [
    {
      codigo: 'HYDRA_01_PRIMERA',
      titulo: 'PRIMERA — Objeto del contrato',
      orden: 1,
      contenido:
        'PRIMERA: Este contrato tiene por objeto establecer las disposiciones generales que regulan la prestación de los servicios integrales de agua potable, sin detrimento a lo dispuesto en la Ley que Regula la Prestación de los Servicios de Agua Potable, Alcantarillado y Saneamiento del Estado de Querétaro, así como las disposiciones normativas aplicables que se encuentren vigentes.',
    },
    {
      codigo: 'HYDRA_02_SEGUNDA',
      titulo: 'SEGUNDA — Obligación de suministro',
      orden: 2,
      contenido:
        'SEGUNDA: "LA COMISIÓN", se obliga a suministrar a "EL USUARIO" de los Servicios Integrales de Agua Potable, en el domicilio antes señalado en los términos de lo dispuesto en la Ley que Regula la Prestación de los Servicios de Agua Potable, Alcantarillado y Saneamiento del Estado de Querétaro.',
    },
    {
      codigo: 'HYDRA_03_TERCERA',
      titulo: 'TERCERA — Uso racional del agua',
      orden: 3,
      contenido:
        'TERCERA.- Es obligación de "EL USUARIO" hacer uso del Agua exclusivamente para el fin contratado, comprometiéndose a utilizarla racionalmente; esto es, teniendo en cuenta que el agua es un líquido vital, que tiene un alto costo la infraestructura que se requiere y que existe escasez del líquido y rezago en grupos sociales considerables.',
    },
    {
      codigo: 'HYDRA_04_CUARTA',
      titulo: 'CUARTA — Obligación de pago',
      orden: 4,
      contenido:
        'CUARTA.- Por la prestación de los servicios que dispone la Ley que Regula la Prestación de los Servicios de Agua Potable, Alcantarillado y Saneamiento del Estado de Querétaro, "EL USUARIO" está obligado al pago de los servicios que fijan los precios aprobados por "LA COMISIÓN", así como las contribuciones que deberán aportar los beneficiados por la realización de las obras que requieran.',
    },
    {
      codigo: 'HYDRA_05_QUINTA',
      titulo: 'QUINTA — Fijación de precios',
      orden: 5,
      contenido:
        'QUINTA.- Los precios para el cobro de los servicios se fijarán tomando en consideración los costos de construcción, operación, administración, mantenimiento, sustitución y conservación, el volumen de agua consumido y el uso autorizado y, en su caso, el volumen de agua residual descargado conforme el gasto máximo instantáneo o el determinado conforme el medidor volumétrico instalado por "LA COMISIÓN" para tal efecto.',
    },
    {
      codigo: 'HYDRA_06_SEXTA',
      titulo: 'SEXTA — Determinación presuntiva',
      orden: 6,
      contenido:
        'SEXTA.- "LA COMISIÓN" podrá determinar presuntivamente el pago de los Servicios Integrales de Agua Potable, de conformidad con lo dispuesto en la Ley que Regula la Prestación de los Servicios de Agua Potable, Alcantarillado y Saneamiento del Estado de Querétaro, el "USUARIO" está obligado al pago de los servicios públicos con base en los precios autorizados, incluso para el caso de que su consumo sea de cero m3.',
    },
    {
      codigo: 'HYDRA_07_SEPTIMA',
      titulo: 'SÉPTIMA — Emisión de recibos y pago',
      orden: 7,
      contenido:
        'SÉPTIMA.- "LA COMISIÓN" emitirá dentro de los treinta días naturales siguientes al de la prestación de los servicios correspondientes, o bien en el periodo que para tal efecto determine, el recibo que contenga el nombre del usuario, el domicilio, el o los servicios proporcionados, el período de prestación, el volumen utilizado, el precio aplicable, la fecha límite para realizar el pago y el monto a pagar; mismo que se entregará al menos con ocho días de anticipación a la fecha límite de pago en el domicilio donde se presta el servicio. "EL USUARIO" se obliga a pasar a las oficinas de "LA COMISIÓN" a recoger el duplicado de la factura cuando por cualquier circunstancia no tenga factura en su domicilio dentro de los periodos usuales en los que hace su pago.\n\n"EL USUARIO" estará obligado al pago del monto total amparado en el recibo respectivo, incluyendo los adeudos que por algún motivo no hubiesen sido cubiertos.\n\nEn caso de que por cualquier causa imputable a "EL USUARIO", no se pagara el importe señalado en el recibo correspondiente dentro del plazo otorgado, por única vez y cobrando los recargos correspondientes en términos de las disposiciones fiscales aplicables, en el recibo siguiente se le desglosará el concepto de adeudo anterior.\n\n"EL USUARIO" estará obligado al pago del monto total amparado en el recibo respectivo, incluyendo el adeudo referido.\n\n"LA COMISIÓN" está facultada para limitar la prestación de los servicios cuando por causa imputable a "EL USUARIO" no se hayan pagado plena y oportunamente los recibos correspondientes. El pago parcial del monto adeudado no será motivo para dejar de aplicar lo dispuesto en el presente párrafo.\n\nInvariablemente, los pagos se realizarán en los lugares que para tal efecto indique el propio recibo, en el entendido que esta condición no podrá ser esgrimida como causal para justificar la omisión del pago respectivo.',
    },
    {
      codigo: 'HYDRA_08_OCTAVA',
      titulo: 'OCTAVA — Limitación de servicio por adeudo',
      orden: 8,
      contenido:
        'OCTAVA.- "LA COMISIÓN" y "EL USUARIO" convienen expresamente, en que la primera podrá limitar el servicio cuando por causa imputable a "EL USUARIO" no se hayan pagado los recibos correspondientes a dos o más meses consecutivos. En caso de que el recibo no sea pagado por causas imputables a "LA COMISIÓN" dentro del plazo correspondiente, no procederá el cobro de recargo ni la supresión o limitación de los servicios.',
    },
    {
      codigo: 'HYDRA_09_NOVENA',
      titulo: 'NOVENA — Facultad de cobro',
      orden: 9,
      contenido:
        'NOVENA.- "LA COMISIÓN", dentro de su ámbito de competencia, tendrá facultades para realizar el cobro de los precios, determinar los adeudos a su favor, por la prestación de los servicios públicos a su cargo y para proceder a su cobro podrán aplicarse supletoriamente las disposiciones contenidas en el Código Fiscal del Estado de Querétaro que regulan el procedimiento administrativo de ejecución.\n\n"LA COMISIÓN" será quien realice la determinación, liquidación y ejecución del cobro de los precios.',
    },
    {
      codigo: 'HYDRA_10_DECIMA',
      titulo: 'DÉCIMA — Cambio de propietario',
      orden: 10,
      contenido:
        'DÉCIMA.- "EL USUARIO" tendrá la obligación de informar a "LA COMISIÓN" el cambio de propietario, de giro comercial o industrial o la baja de estos últimos, dentro de los 30 días siguientes a la fecha en que suceda, a efecto de pagar los adeudos pendientes y se inscribirá el nuevo Usuario en el padrón correspondiente. En caso de que "EL USUARIO" no cumpla con esta obligación, será responsable solidaria y mancomunadamente con "EL USUARIO" anterior, por los adeudos pendientes, así como de los que se continúen causando.',
    },
    {
      codigo: 'HYDRA_11_DECIMA_PRIMERA',
      titulo: 'DÉCIMA PRIMERA — Instalación de tomas y medidores',
      orden: 11,
      contenido:
        'DÉCIMA PRIMERA.- Las tomas deberán instalarse frente al acceso de los predios, giros o establecimientos, y los aparatos medidores en el lugar visible que defina "LA COMISIÓN", de tal forma que facilite las lecturas, pruebas de funcionamiento y posible cambio de aparato. "EL USUARIO" se obliga a permitir al personal de "LA COMISIÓN" quien deberá identificarse de forma previa, el acceso a los lugares del inmueble donde están colocadas las tuberías, accesorios, medidor y aparato de consumo para la práctica de inspecciones de las instalaciones hidráulicas.',
    },
    {
      codigo: 'HYDRA_12_DECIMA_SEGUNDA',
      titulo: 'DÉCIMA SEGUNDA — Verificación de instalación',
      orden: 12,
      contenido:
        'DÉCIMA SEGUNDA.- "LA COMISIÓN" verificará antes de otorgar el suministro, si la instalación hidráulica de "EL USUARIO" reúne las condiciones de uso y funcionamiento establecidas para el efecto y que dicha instalación cumple con las disposiciones técnicas en vigor. Si la verificación o revisión, arroja resultados satisfactorios, "LA COMISIÓN" podrá iniciar el suministro dando aviso a "EL USUARIO". En caso contrario, éste realizará las reparaciones materiales necesarias para la conexión de sus servicios y sólo se iniciará con el suministro, hasta que dicha instalación cumpla con las disposiciones técnicas en vigor, debiendo "EL USUARIO" cubrir el importe de su excedente resultante en el primer recibo de consumo de sus servicios.',
    },
    {
      codigo: 'HYDRA_13_DECIMA_TERCERA',
      titulo: 'DÉCIMA TERCERA — Modificaciones al predio',
      orden: 13,
      contenido:
        'DÉCIMA TERCERA.- Cualquier modificación que se pretenda hacer en el predio, giro o establecimiento, que afecte al Sistema de Agua Potable, queda sujeto a la autorización de "LA COMISIÓN", de acuerdo con las condiciones que ésta determine. Queda prohibida la instalación de equipos de succión directa en la tubería de los predios conectados al sistema.',
    },
    {
      codigo: 'HYDRA_14_DECIMA_CUARTA',
      titulo: 'DÉCIMA CUARTA — Prohibición de operación por usuario',
      orden: 14,
      contenido:
        'DÉCIMA CUARTA.- En ningún caso "EL USUARIO" o persona extraña a "LA COMISIÓN" podrá operar por sí mismo el cambio del sistema, instalación, supresión o conexión para los servicios integrales de Agua Potable.',
    },
    {
      codigo: 'HYDRA_15_DECIMA_QUINTA',
      titulo: 'DÉCIMA QUINTA — Dispositivos de medición',
      orden: 15,
      contenido:
        'DÉCIMA QUINTA.- Las Modificaciones o implementación de accesorios y/o dispositivos de medición, aplicados a las tomas de los predios, quedan sujetas a la autorización y aplicación invariablemente por parte de "LA COMISIÓN", considerando las características particulares del predio, modernización de los sistemas, eficientización aplicando avances tecnológicos, normativas vigentes o cualesquiera situaciones que afecten en beneficio de un mejor servicio el sistema de Agua Potable, la medición del servicio o actividades intrínsecas actuales, quedan sujetas a la autorización y aplicación invariablemente por parte de "LA COMISIÓN".',
    },
    {
      codigo: 'HYDRA_16_DECIMA_SEXTA',
      titulo: 'DÉCIMA SEXTA — Instalación y retiro de medidores',
      orden: 16,
      contenido:
        'DÉCIMA SEXTA.- Los medidores, accesorios y los dispositivos de medición que permitan leer y registrar los consumos y elevar la eficiencia en medición serán instalados y retirados únicamente por personal designado por "LA COMISIÓN".',
    },
    {
      codigo: 'HYDRA_17_DECIMA_SEPTIMA',
      titulo: 'DÉCIMA SÉPTIMA — Conservación del sitio de medición',
      orden: 17,
      contenido:
        'DÉCIMA SÉPTIMA.- Es obligación de "EL USUARIO", mantener en condiciones aceptables el lugar en el que se instalen los medidores, accesorios y/o dispositivos de medición, con objeto de evitar actos de vandalismos y demás, que aceleren el normal desgaste de aquellos bienes; sin contravenir las demás obligaciones que se establecen las leyes vigentes.',
    },
    {
      codigo: 'HYDRA_18_DECIMA_OCTAVA',
      titulo: 'DÉCIMA OCTAVA — Responsabilidad del usuario sobre el medidor',
      orden: 18,
      contenido:
        'DÉCIMA OCTAVA.- Al instalarse el aparato medidor y cualquier accesorio y/o dispositivo de medición, será responsabilidad de "EL USUARIO" el cuidado y buen funcionamiento del mismo. En caso de alteración o daño intencional, o por negligencia de "EL USUARIO" el aparato o accesorio no funcione, aquel cubrirá el costo del retiro, reparación o sustitución y de la colocación del aparato medidor o de cualquier accesorio instalado para la medición de los consumos, independientemente de otras sanciones a las que se hiciera acreedor.',
    },
    {
      codigo: 'HYDRA_19_DECIMA_NOVENA',
      titulo: 'DÉCIMA NOVENA — Vida útil y facturación de bienes',
      orden: 19,
      contenido:
        'DÉCIMA NOVENA.- Los medidores serán reemplazados transcurrida su vida útil de 5 años, pero los accesorios y/o dispositivos de medición, podrán ser reemplazados de conformidad con los términos de las descripciones de tipo, características y vida útil de los mismos, el precio de dichos bienes serán cargados en la factura siguiente de "EL USUARIO" a la fecha de la sustitución o implementación de aquellos.',
    },
    {
      codigo: 'HYDRA_20_VIGESIMA',
      titulo: 'VIGÉSIMA — Control de accesorios y precios',
      orden: 20,
      contenido:
        'VIGÉSIMA.- "LA COMISIÓN" llevará un control de la totalidad de accesorios y/o dispositivos de medición que se instalen en el predio; así como vigilar que el precio de los bienes y la forma de pago sean aplicados de la manera menos gravosa posible en beneficio de "EL USUARIO".',
    },
    {
      codigo: 'HYDRA_21_VIGESIMA_PRIMERA',
      titulo: 'VIGÉSIMA PRIMERA — Pago sin medidor',
      orden: 21,
      contenido:
        'VIGÉSIMA PRIMERA.- Cuando no exista aparato medidor, "EL USUARIO" deberá pagar los precios aprobados por "LA COMISIÓN", de acuerdo a las cuotas promedio de la zona, aun y cuando su consumo mensual expresado en metros cúbicos sea inferior a esos volúmenes.',
    },
    {
      codigo: 'HYDRA_22_VIGESIMA_SEGUNDA',
      titulo: 'VIGÉSIMA SEGUNDA — Suspensión o limitación del agua',
      orden: 22,
      contenido:
        'VIGÉSIMA SEGUNDA.- "LA COMISIÓN" podrá suspender o limitar el suministro de agua por las siguientes causas:\n\na. Por la falta de pago puntual de "EL USUARIO" por el agua consumida.\nb. Porque la instalación hidráulica interior de "EL USUARIO" muestre fugas o se encuentre en condiciones peligrosas.\nc. Para efectuar reparaciones o modificaciones a la red de distribución general.\nd. En los demás casos previstos en la normatividad aplicable.',
    },
    {
      codigo: 'HYDRA_23_VIGESIMA_TERCERA',
      titulo: 'VIGÉSIMA TERCERA — Suspensión o limitación del alcantarillado',
      orden: 23,
      contenido:
        'VIGÉSIMA TERCERA.- "LA COMISIÓN" podrá suspender o limitar el servicio de alcantarillado en los siguientes casos:\n\ni. Cuando en el inmueble respectivo no exista construcción que implique la utilización de dicho servicio.\nii. Cuando no se cumpla plena y oportunamente con los requisitos y obligaciones en materia de descargas.\niii. Cuando no se cumpla en forma plena y continua con la normatividad aplicable o condiciones particulares de descarga autorizadas.\niv. Cuando no se cubran los derechos por conceptos de la prestación del servicio de alcantarillado o los necesarios para que "LA COMISIÓN" realice el saneamiento correspondiente de las aguas residuales vertidas.\nv. En los demás casos previstos en la normatividad aplicable.',
    },
    {
      codigo: 'HYDRA_24_VIGESIMA_CUARTA',
      titulo: 'VIGÉSIMA CUARTA — Rescisión del contrato',
      orden: 24,
      contenido:
        'VIGÉSIMA CUARTA.- "LA COMISIÓN" podrá rescindir el presente contrato por el incumplimiento de sus obligaciones estipuladas en el presente contrato, y por contravenir alguna de las disposiciones estipuladas en la Ley que Regula la Prestación de los Servicios de Agua Potable, Alcantarillado y Saneamiento del Estado de Querétaro.',
    },
    {
      codigo: 'HYDRA_25_VIGESIMA_QUINTA',
      titulo: 'VIGÉSIMA QUINTA — Cesión de derechos',
      orden: 25,
      contenido:
        'VIGÉSIMA QUINTA.- Los derechos y obligaciones de este contrato no podrán ser transmitidos a otra persona en todo o en parte, sin autorización de "LA COMISIÓN" y previo pago de los derechos correspondientes.',
    },
    {
      codigo: 'HYDRA_26_VIGESIMA_SEXTA',
      titulo: 'VIGÉSIMA SEXTA — Pago y conexión',
      orden: 26,
      contenido:
        'VIGÉSIMA SEXTA.- "EL USUARIO" pagará a "LA COMISIÓN" por los servicios, conforme al precio oficial vigente. Una vez efectuado dicho pago, se hará la conexión correspondiente para iniciar el suministro en su predio.',
    },
    {
      codigo: 'HYDRA_27_VIGESIMA_SEPTIMA',
      titulo: 'VIGÉSIMA SÉPTIMA — Jurisdicción',
      orden: 27,
      contenido:
        'VIGÉSIMA SÉPTIMA.- "LAS PARTES" convienen desde ahora en someter cualquier controversia de índole legal que se suscite con motivo de la interpretación o cumplimiento de las estipulaciones contenidas en este contrato, a los tribunales competentes de la Ciudad de Santiago de Querétaro Qro., y renunciar a cualquier otra jurisdicción que les corresponda en razón de su domicilio presente o futuro.',
    },
    {
      codigo: 'HYDRA_28_VIGESIMA_OCTAVA',
      titulo: 'VIGÉSIMA OCTAVA — Lectura del medidor',
      orden: 28,
      contenido:
        'VIGÉSIMA OCTAVA.- La lectura del servicio medido, para determinar el consumo de agua de "EL USUARIO", se hará por periodos mensuales, "EL USUARIO" se obliga a mantener el medidor en la parte exterior del límite frontal del predio, para facilitar al empleado la lectura del servicio medido.\n\nEn caso de que por razones de modificación de la construcción se implique la remoción del aparato medidor, "EL USUARIO" estará obligado a dar aviso oportuno a "LA COMISIÓN".',
    },
    {
      codigo: 'HYDRA_29_VIGESIMA_NOVENA',
      titulo: 'VIGÉSIMA NOVENA — Veracidad de datos',
      orden: 29,
      contenido:
        'VIGÉSIMA NOVENA.- "EL USUARIO" bajo protesta de decir verdad, declara que los datos proporcionados para la integración y suscripción del presente contrato son fidedignos, en caso de haber proporcionado algún dato falso se hará acreedor a las sanciones que le corresponden, en términos de la Legislación vigente aplicable.',
    },
    {
      codigo: 'HYDRA_30_TRIGESIMA',
      titulo: 'TRIGÉSIMA — Fuerza mayor y estiaje',
      orden: 30,
      contenido:
        'TRIGÉSIMA.- Las partes acuerdan que la Comisión Estatal de Aguas proporcionará el servicio de agua potable con regularidad salvo en las épocas de estiaje, en caso de contingencia, sustitución de redes, fallas en los pozos, por lo que el usuario acepta que las condiciones de las fuentes de abastecimiento podrían variar y no responsabiliza a la Comisión por causas de fuerza mayor, contingencias o casos fortuitos.',
    },
    {
      codigo: 'HYDRA_31_TRIGESIMA_PRIMERA',
      titulo: 'TRIGÉSIMA PRIMERA — No acredita propiedad',
      orden: 31,
      contenido:
        'TRIGÉSIMA PRIMERA.- El presente contrato no constituye, bajo ninguna circunstancia, una acreditación legal de propiedad, ni genera derecho de propiedad alguno a favor de ninguna de las partes sobre el bien inmueble o mueble al que hace referencia, sirve principalmente como evidencia de pago por un servicio, no como título de propiedad.',
    },
  ];

  for (const cl of clausulas) {
    await prisma.clausulaContractual.upsert({
      where: { codigo: cl.codigo },
      update: { titulo: cl.titulo, contenido: cl.contenido },
      create: { codigo: cl.codigo, titulo: cl.titulo, contenido: cl.contenido, version: '1.0' },
    });
  }
  console.log(`Cláusulas Hydra sembradas: ${clausulas.length}`);
}

async function seedCatalogoSat(prisma: PrismaClient) {
  for (let i = 0; i < REGIMEN_FISCAL_SAT.length; i++) {
    const r = REGIMEN_FISCAL_SAT[i];
    await prisma.catalogoSat.upsert({
      where: {
        tipo_clave: {
          tipo: CatalogoSatTipo.REGIMEN_FISCAL,
          clave: r.clave,
        },
      },
      update: {
        descripcion: r.descripcion,
        aplicaFisica: r.aplicaFisica,
        aplicaMoral: r.aplicaMoral,
        vigenciaInicio: SAT_VIGENCIA_INICIO,
        vigenciaFin: null,
        orden: i,
        activo: true,
      },
      create: {
        tipo: CatalogoSatTipo.REGIMEN_FISCAL,
        clave: r.clave,
        descripcion: r.descripcion,
        aplicaFisica: r.aplicaFisica,
        aplicaMoral: r.aplicaMoral,
        vigenciaInicio: SAT_VIGENCIA_INICIO,
        orden: i,
        activo: true,
      },
    });
  }
  for (let i = 0; i < USO_CFDI_SAT.length; i++) {
    const u = USO_CFDI_SAT[i];
    await prisma.catalogoSat.upsert({
      where: {
        tipo_clave: {
          tipo: CatalogoSatTipo.USO_CFDI,
          clave: u.clave,
        },
      },
      update: {
        descripcion: u.descripcion,
        aplicaFisica: u.aplicaFisica,
        aplicaMoral: u.aplicaMoral,
        vigenciaInicio: SAT_VIGENCIA_INICIO,
        vigenciaFin: null,
        regimenesReceptorPermitidos: u.regimenesReceptorPermitidos,
        orden: i,
        activo: true,
      },
      create: {
        tipo: CatalogoSatTipo.USO_CFDI,
        clave: u.clave,
        descripcion: u.descripcion,
        aplicaFisica: u.aplicaFisica,
        aplicaMoral: u.aplicaMoral,
        vigenciaInicio: SAT_VIGENCIA_INICIO,
        regimenesReceptorPermitidos: u.regimenesReceptorPermitidos,
        orden: i,
        activo: true,
      },
    });
  }
  console.log(
    `Catálogo SAT sembrado: ${REGIMEN_FISCAL_SAT.length} régimen(es) fiscal(es), ${USO_CFDI_SAT.length} uso(s) CFDI`,
  );
}

async function seedPlantillaHydra(prisma: PrismaClient) {
  const contenido = `CONTRATO DE PRESTACIÓN DE SERVICIOS INTEGRALES DE AGUA POTABLE, QUE CELEBRAN LA COMISIÓN ESTATAL DE AGUAS, CON DOMICILIO EN {{direccionComision}}, A QUIEN EN EL CUERPO DE ESTE CONTRATO SE LE DENOMINARÁ "LA COMISIÓN", Y {{nombre}}, CON DOMICILIO EN {{direccion}}, C.P. {{codigoPostal}}, A QUIEN SE LE DENOMINARÁ "EL USUARIO".

El presente Contrato se sujetará a las siguientes

CLÁUSULAS

PRIMERA: Este contrato tiene por objeto establecer las disposiciones generales que regulan la prestación de los servicios integrales de agua potable, sin detrimento a lo dispuesto en la Ley que Regula la Prestación de los Servicios de Agua Potable, Alcantarillado y Saneamiento del Estado de Querétaro, así como las disposiciones normativas aplicables que se encuentren vigentes.

SEGUNDA: "LA COMISIÓN", se obliga a suministrar a "EL USUARIO" de los Servicios Integrales de Agua Potable, en el domicilio antes señalado en los términos de lo dispuesto en la Ley que Regula la Prestación de los Servicios de Agua Potable, Alcantarillado y Saneamiento del Estado de Querétaro.

TERCERA.- Es obligación de "EL USUARIO" hacer uso del Agua exclusivamente para el fin contratado, comprometiéndose a utilizarla racionalmente; esto es, teniendo en cuenta que el agua es un líquido vital, que tiene un alto costo la infraestructura que se requiere y que existe escasez del líquido y rezago en grupos sociales considerables.

CUARTA.- Por la prestación de los servicios que dispone la Ley que Regula la Prestación de los Servicios de Agua Potable, Alcantarillado y Saneamiento del Estado de Querétaro, "EL USUARIO" está obligado al pago de los servicios que fijan los precios aprobados por "LA COMISIÓN", así como las contribuciones que deberán aportar los beneficiados por la realización de las obras que requieran.

QUINTA.- Los precios para el cobro de los servicios se fijarán tomando en consideración los costos de construcción, operación, administración, mantenimiento, sustitución y conservación, el volumen de agua consumido y el uso autorizado y, en su caso, el volumen de agua residual descargado conforme el gasto máximo instantáneo o el determinado conforme el medidor volumétrico instalado por "LA COMISIÓN" para tal efecto.

SEXTA.- "LA COMISIÓN" podrá determinar presuntivamente el pago de los Servicios Integrales de Agua Potable, de conformidad con lo dispuesto en la Ley que Regula la Prestación de los Servicios de Agua Potable, Alcantarillado y Saneamiento del Estado de Querétaro, el "USUARIO" está obligado al pago de los servicios públicos con base en los precios autorizados, incluso para el caso de que su consumo sea de cero m3.

SÉPTIMA.- "LA COMISIÓN" emitirá dentro de los treinta días naturales siguientes al de la prestación de los servicios correspondientes, o bien en el periodo que para tal efecto determine, el recibo que contenga el nombre del usuario, el domicilio, el o los servicios proporcionados, el período de prestación, el volumen utilizado, el precio aplicable, la fecha límite para realizar el pago y el monto a pagar; mismo que se entregará al menos con ocho días de anticipación a la fecha límite de pago en el domicilio donde se presta el servicio. "EL USUARIO" se obliga a pasar a las oficinas de "LA COMISIÓN" a recoger el duplicado de la factura cuando por cualquier circunstancia no tenga factura en su domicilio dentro de los periodos usuales en los que hace su pago.

"EL USUARIO" estará obligado al pago del monto total amparado en el recibo respectivo, incluyendo los adeudos que por algún motivo no hubiesen sido cubiertos.

En caso de que por cualquier causa imputable a "EL USUARIO", no se pagara el importe señalado en el recibo correspondiente dentro del plazo otorgado, por única vez y cobrando los recargos correspondientes en términos de las disposiciones fiscales aplicables, en el recibo siguiente se le desglosará el concepto de adeudo anterior.

"EL USUARIO" estará obligado al pago del monto total amparado en el recibo respectivo, incluyendo el adeudo referido.

"LA COMISIÓN" está facultada para limitar la prestación de los servicios cuando por causa imputable a "EL USUARIO" no se hayan pagado plena y oportunamente los recibos correspondientes. El pago parcial del monto adeudado no será motivo para dejar de aplicar lo dispuesto en el presente párrafo.

Invariablemente, los pagos se realizarán en los lugares que para tal efecto indique el propio recibo, en el entendido que esta condición no podrá ser esgrimida como causal para justificar la omisión del pago respectivo.

OCTAVA.- "LA COMISIÓN" y "EL USUARIO" convienen expresamente, en que la primera podrá limitar el servicio cuando por causa imputable a "EL USUARIO" no se hayan pagado los recibos correspondientes a dos o más meses consecutivos. En caso de que el recibo no sea pagado por causas imputables a "LA COMISIÓN" dentro del plazo correspondiente, no procederá el cobro de recargo ni la supresión o limitación de los servicios.

NOVENA.- "LA COMISIÓN", dentro de su ámbito de competencia, tendrá facultades para realizar el cobro de los precios, determinar los adeudos a su favor, por la prestación de los servicios públicos a su cargo y para proceder a su cobro podrán aplicarse supletoriamente las disposiciones contenidas en el Código Fiscal del Estado de Querétaro que regulan el procedimiento administrativo de ejecución.

"LA COMISIÓN" será quien realice la determinación, liquidación y ejecución del cobro de los precios.

DÉCIMA.- "EL USUARIO" tendrá la obligación de informar a "LA COMISIÓN" el cambio de propietario, de giro comercial o industrial o la baja de estos últimos, dentro de los 30 días siguientes a la fecha en que suceda, a efecto de pagar los adeudos pendientes y se inscribirá el nuevo Usuario en el padrón correspondiente. En caso de que "EL USUARIO" no cumpla con esta obligación, será responsable solidaria y mancomunadamente con "EL USUARIO" anterior, por los adeudos pendientes, así como de los que se continúen causando.

DÉCIMA PRIMERA.- Las tomas deberán instalarse frente al acceso de los predios, giros o establecimientos, y los aparatos medidores en el lugar visible que defina "LA COMISIÓN", de tal forma que facilite las lecturas, pruebas de funcionamiento y posible cambio de aparato. "EL USUARIO" se obliga a permitir al personal de "LA COMISIÓN" quien deberá identificarse de forma previa, el acceso a los lugares del inmueble donde están colocadas las tuberías, accesorios, medidor y aparato de consumo para la práctica de inspecciones de las instalaciones hidráulicas.

DÉCIMA SEGUNDA.- "LA COMISIÓN" verificará antes de otorgar el suministro, si la instalación hidráulica de "EL USUARIO" reúne las condiciones de uso y funcionamiento establecidas para el efecto y que dicha instalación cumple con las disposiciones técnicas en vigor. Si la verificación o revisión, arroja resultados satisfactorios, "LA COMISIÓN" podrá iniciar el suministro dando aviso a "EL USUARIO". En caso contrario, éste realizará las reparaciones materiales necesarias para la conexión de sus servicios y sólo se iniciará con el suministro, hasta que dicha instalación cumpla con las disposiciones técnicas en vigor, debiendo "EL USUARIO" cubrir el importe de su excedente resultante en el primer recibo de consumo de sus servicios.

DÉCIMA TERCERA.- Cualquier modificación que se pretenda hacer en el predio, giro o establecimiento, que afecte al Sistema de Agua Potable, queda sujeto a la autorización de "LA COMISIÓN", de acuerdo con las condiciones que ésta determine. Queda prohibida la instalación de equipos de succión directa en la tubería de los predios conectados al sistema.

DÉCIMA CUARTA.- En ningún caso "EL USUARIO" o persona extraña a "LA COMISIÓN" podrá operar por sí mismo el cambio del sistema, instalación, supresión o conexión para los servicios integrales de Agua Potable.

DÉCIMA QUINTA.- Las Modificaciones o implementación de accesorios y/o dispositivos de medición, aplicados a las tomas de los predios, quedan sujetas a la autorización y aplicación invariablemente por parte de "LA COMISIÓN", considerando las características particulares del predio, modernización de los sistemas, eficientización aplicando avances tecnológicos, normativas vigentes o cualesquiera situaciones que afecten en beneficio de un mejor servicio el sistema de Agua Potable, la medición del servicio o la calidad del agua suministrada.

[Cláusulas DÉCIMA SEXTA a VIGÉSIMA SEXTA — pendientes de escaneo completo del documento original Hydra.]

VIGÉSIMA SÉPTIMA.- "LAS PARTES" convienen desde ahora en someter cualquier controversia de índole legal que se suscite con motivo de la interpretación o cumplimiento de las estipulaciones contenidas en este contrato, a los tribunales competentes de la Ciudad de Santiago de Querétaro Qro., y renunciar a cualquier otra jurisdicción que les corresponda en razón de su domicilio presente o futuro.

VIGÉSIMA OCTAVA.- La lectura del servicio medido, para determinar el consumo de agua de "EL USUARIO", se hará por periodos mensuales, "EL USUARIO" se obliga a mantener el medidor en la parte exterior del límite frontal del predio, para facilitar al empleado la lectura del servicio medido.

En caso de que por razones de modificación de la construcción se implique la remoción del aparato medidor, "EL USUARIO" estará obligado a dar aviso oportuno a "LA COMISIÓN".

VIGÉSIMA NOVENA.- "EL USUARIO" bajo protesta de decir verdad, declara que los datos proporcionados para la integración y suscripción del presente contrato son fidedignos, en caso de haber proporcionado algún dato falso se hará acreedor a las sanciones que le corresponden, en términos de la Legislación vigente aplicable.

TRIGÉSIMA.- Las partes acuerdan que la Comisión Estatal de Aguas proporcionará el servicio de agua potable con regularidad salvo en las épocas de estiaje, en caso de contingencia, sustitución de redes, fallas en los pozos, por lo que el usuario acepta que las condiciones de las fuentes de abastecimiento podrían variar y no responsabiliza a la Comisión por causas de fuerza mayor, contingencias o casos fortuitos.

TRIGÉSIMA PRIMERA.- El presente contrato no constituye, bajo ninguna circunstancia, una acreditación legal de propiedad, ni genera derecho de propiedad alguno a favor de ninguna de las partes sobre el bien inmueble o mueble al que hace referencia, sirve principalmente como evidencia de pago por un servicio, no como título de propiedad.`;

  const variables: Record<string, string> = {
    nombre: 'Nombre del titular / usuario',
    direccion: 'Dirección del titular',
    codigoPostal: 'Código postal del titular',
    rfc: 'RFC del titular',
    direccionComision: 'Dirección de la oficina CEA',
    fecha: 'Fecha del contrato',
    contacto: 'Teléfono / email del titular',
    razonSocial: 'Razón social (persona moral)',
    regimenFiscal: 'Régimen fiscal',
  };

  await prisma.plantillaContrato.upsert({
    where: { id: 'PLANTILLA_HYDRA_CEA_V1' },
    update: { contenido, variables: variables as unknown as Prisma.InputJsonValue, nombre: 'Contrato CEA — Servicios Integrales de Agua Potable (Hydra)', version: '1.0' },
    create: {
      id: 'PLANTILLA_HYDRA_CEA_V1',
      nombre: 'Contrato CEA — Servicios Integrales de Agua Potable (Hydra)',
      version: '1.0',
      contenido,
      variables: variables as unknown as Prisma.InputJsonValue,
      activo: true,
    },
  });
  console.log('Plantilla Hydra CEA V1 sembrada');
}

/**
 * Orden importa: territorial antes que cualquier catálogo con FK a zona o
 * administración. Todo el conjunto es upsert, así que repetirlo es inocuo.
 */
export async function seedCatalogos(prisma: PrismaClient): Promise<void> {
  await seedTerritorial(prisma);
  await seedCatalogoTramites(prisma);
  await seedCatalogosOperativos(prisma);
  await seedCatalogosContratacion(prisma);
  await seedCatalogosActividadRelacionPS(prisma);
  await seedCatalogoSat(prisma);
  await seedTarifas(prisma);
  await seedCatalogosMedidor(prisma);
  await seedFormasPagoOficinas(prisma);
  await seedSectoresClasesVariables(prisma);
  await importCatalogosTiposContratacion(prisma, { removeLegacyStubTipos: true });
  await seedTarifasPeriodicas(prisma);
  await seedTarifasContratacion(prisma);
  await linkHydraClausulasToAllTipos(prisma);
  await seedInegiQueretaro(prisma);
  await seedPlantillaHydra(prisma);
}

// Ejecución directa (start:prod / `npm run seed:catalogos`); al importarse
// desde prisma/seed.ts este bloque no corre y se reutiliza el mismo cliente.
if (require.main === module) {
  const prisma = new PrismaClient();
  seedCatalogos(prisma)
    .then(() => console.log('Catálogos de referencia sembrados.'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
