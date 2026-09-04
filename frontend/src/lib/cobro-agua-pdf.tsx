/**
 * Plantilla PDF "Detalle del cobro del agua" — formato CEA Querétaro.
 *
 * Secciones:
 *  1. Encabezado con datos del contrato (folio, nombre, domicilio, etc.)
 *  2. Tabla mensual: Año | Mes | Unidades | M3 | Agua | Alcantarillado |
 *                    Saneamiento | Serv. periodo | Serv. vencidos | Recargos | Total
 *  3. Fila de totales
 *  4. Resumen: Concepto | Importe | IVA | Total
 *
 * Orientación: LANDSCAPE para dar espacio a las 11 columnas.
 */
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { SolicitudRecord } from '@/types/solicitudes';
import {
  calcularCargoPeriodo,
  resolveAdministracion,
  resolveTipoTarifa,
  RECARGO_MENSUAL,
} from '@/lib/tarifas';

const MESES_ES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface FilaCobro {
  anio: number;
  mes: string;
  unidadesServidas: number;
  consumoM3: number;
  agua: number;
  alcantarillado: number;
  saneamiento: number;
  serviciosPeriodo: number;
  serviciosVencidos: number;
  recargos: number;
  totalPeriodo: number;
}

export interface CobroAguaPdfProps {
  record: SolicitudRecord;
  administracionNombre?: string;   // nombre legible (para mostrar)
  administracionCatalogo?: string; // nombre exacto en catálogo CSV (para lookup)
  tipoContratacionNombre?: string;
  tipoTarifa?: string;    // nombre exacto en catálogo CSV; si omite se resuelve desde tipoContratacionNombre
  tipoServicio?: string;  // texto a mostrar en el encabezado
  tarifa?: string;
  tipo?: string;          // 'Individual', 'General', etc.
  consumoM3?: number;     // m3 TOTAL (todas las unidades)
  unidadesServidas?: number;
  periodoInicio?: Date;
  periodoFin?: Date;      // si se da, calcula meses automáticamente
  meses?: number;         // alternativa a periodoFin
  // Qué conceptos aplican (por defecto todos true)
  aplicaAgua?: boolean;
  aplicaAlcantarillado?: boolean;
  aplicaSaneamiento?: boolean;
  filas?: FilaCobro[];    // si se proporcionan, se usan directamente
  /** Reglas %% de alc/san desde BD (getReglasPorcentuales); fallback 10/12 %% si no llegan. */
  reglasPct?: { alcantarillado: number; saneamiento: number } | null;
}

// ── Motor de cálculo ──────────────────────────────────────────────────────────

function generarFilas(
  m3Total: number,       // consumo TOTAL (todas las unidades)
  unidades: number,
  administracion: string,
  tipoTarifa: string,
  periodoInicio: Date,
  numMeses: number,
  aplicaAgua: boolean,
  aplicaAlcantarillado: boolean,
  aplicaSaneamiento: boolean,
): FilaCobro[] {
  const filas: FilaCobro[] = [];
  let serviciosVencidos = 0;

  // consumo por unidad (para mostrar en tabla y para lookup)
  const consumoPorUnidad = m3Total / (unidades || 1);
  const consumoRedondeado = consumoPorUnidad % 1 > 0.50
    ? Math.ceil(consumoPorUnidad)
    : Math.floor(consumoPorUnidad);

  for (let i = 0; i < numMeses; i++) {
    const fecha = new Date(periodoInicio.getFullYear(), periodoInicio.getMonth() + i, 1);

    // calcularCargoPeriodo divide internamente m3Total / unidades
    const cargo = calcularCargoPeriodo(administracion, tipoTarifa, m3Total, unidades);
    const aguaBase          = cargo?.agua          ?? m3Total * 36.77;
    // Reglas % desde BD (junta CEA); los literales quedan solo como fallback offline.
    const alcantarilladoBase = aguaBase * (reglasPct?.alcantarillado ?? 0.10);
    const saneamientoBase   = aguaBase * (reglasPct?.saneamiento ?? 0.12);

    // Solo sumar los conceptos que aplican
    const agua          = aplicaAgua            ? aguaBase          : 0;
    const alcantarillado = aplicaAlcantarillado ? alcantarilladoBase : 0;
    const saneamiento   = aplicaSaneamiento     ? saneamientoBase   : 0;

    const serviciosPeriodo = agua + alcantarillado + saneamiento;
    // Recargo = saldo vencido acumulado × 0.01470
    const recargos         = i === 0 ? 0 : serviciosVencidos * RECARGO_MENSUAL;
    const totalPeriodo     = serviciosPeriodo + recargos;

    filas.push({
      anio: fecha.getFullYear(),
      mes: MESES_ES[fecha.getMonth()],
      unidadesServidas: unidades,
      consumoM3: consumoRedondeado, // m3 por unidad (para mostrar en tabla)
      agua,
      alcantarillado,
      saneamiento,
      serviciosPeriodo,
      serviciosVencidos,
      recargos,
      totalPeriodo,
    });

    serviciosVencidos = serviciosPeriodo;
  }

  return filas;
}

// ── Paleta / Estilos ──────────────────────────────────────────────────────────

const GRAY_BG = '#e8e8e8';
const BORDER  = '#aaaaaa';
const DARK    = '#111111';
const MUTED   = '#555555';
const ACCENT  = '#1d4ed8';

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 7,
    color: DARK,
    paddingTop: 20,
    paddingBottom: 32,
    paddingHorizontal: 20,
  },
  // ── Encabezado ────────────────────────────────────────────────────────────
  headerSection: { marginBottom: 10 },
  headerGrid: { flexDirection: 'row', gap: 16 },
  headerCol: { flex: 1 },
  headerLine: { flexDirection: 'row', marginBottom: 2 },
  hLabel: { fontSize: 7, color: MUTED, width: 72 },
  hValue: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', flex: 1 },
  orgName: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: ACCENT, marginBottom: 2 },
  orgSub: { fontSize: 6.5, color: MUTED, marginBottom: 8 },
  // ── Tabla mensual ─────────────────────────────────────────────────────────
  tableWrap: { marginTop: 8 },
  tHeaderRow: { flexDirection: 'row', backgroundColor: GRAY_BG },
  tRow: { flexDirection: 'row' },
  tRowAlt: { flexDirection: 'row', backgroundColor: '#f9fafb' },
  tTotalRow: { flexDirection: 'row', backgroundColor: '#eef0f4' },
  th: {
    fontSize: 6,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    paddingVertical: 3,
    paddingHorizontal: 2,
    borderWidth: 0.5,
    borderColor: BORDER,
    color: DARK,
  },
  td: {
    fontSize: 6.5,
    paddingVertical: 2.5,
    paddingHorizontal: 2,
    borderWidth: 0.5,
    borderColor: BORDER,
  },
  tdR: {
    fontSize: 6.5,
    textAlign: 'right',
    paddingVertical: 2.5,
    paddingHorizontal: 2,
    borderWidth: 0.5,
    borderColor: BORDER,
  },
  // ── Tabla resumen ─────────────────────────────────────────────────────────
  summaryWrap: { marginTop: 12, flexDirection: 'row', justifyContent: 'flex-end' },
  summaryTable: { width: 280 },
  sHeaderRow: { flexDirection: 'row', backgroundColor: GRAY_BG },
  sRow: { flexDirection: 'row' },
  sRowAlt: { flexDirection: 'row', backgroundColor: '#f9fafb' },
  sTotalRow: { flexDirection: 'row', backgroundColor: '#eef0f4' },
  sth: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderWidth: 0.5,
    borderColor: BORDER,
  },
  std: {
    fontSize: 7,
    paddingVertical: 2.5,
    paddingHorizontal: 4,
    borderWidth: 0.5,
    borderColor: BORDER,
  },
  stdR: {
    fontSize: 7,
    textAlign: 'right',
    paddingVertical: 2.5,
    paddingHorizontal: 4,
    borderWidth: 0.5,
    borderColor: BORDER,
  },
  // ── Footer ────────────────────────────────────────────────────────────────
  footer: {
    position: 'absolute',
    bottom: 12,
    left: 20,
    right: 20,
    borderTopWidth: 0.5,
    borderColor: '#cccccc',
    paddingTop: 3,
  },
  footerText: { fontSize: 6, color: '#aaaaaa', textAlign: 'center' },
});

// ── Componente ─────────────────────────────────────────────────────────────────

export function CobroAguaPdfDocument({
  record,
  administracionNombre,
  administracionCatalogo,
  tipoContratacionNombre,
  tipoTarifa: tipoTarifaProp,
  tipoServicio,
  tarifa,
  tipo,
  consumoM3: consumoM3Prop,
  unidadesServidas: unidadesServidasProp,
  periodoInicio: periodoInicioProp,
  periodoFin: periodoFinProp,
  meses: mesesProp,
  aplicaAgua = true,
  aplicaAlcantarillado = true,
  aplicaSaneamiento = true,
  filas: filasProp,

  reglasPct,}: CobroAguaPdfProps) {
  const fd = record.formData;
  const vars = fd.variablesCapturadas ?? {};
  const fechaDoc = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // Resolver parámetros desde props o variablesCapturadas
  const consumoM3 = consumoM3Prop
    ?? (parseFloat(vars.consumoM3 ?? vars.consumo_m3 ?? vars.m3 ?? '15') || 15);

  const unidades = unidadesServidasProp
    ?? (parseInt(vars.unidadesServicio ?? vars.unidades ?? '1', 10) || 1);

  const periodoInicio = periodoInicioProp ?? new Date();

  // Calcular meses desde periodoFin si se proporcionó
  const rawMeses = mesesProp ?? (() => {
    if (periodoFinProp) {
      const diffAnios = periodoFinProp.getFullYear() - periodoInicio.getFullYear();
      const diffMeses = periodoFinProp.getMonth() - periodoInicio.getMonth();
      return Math.max(1, diffAnios * 12 + diffMeses + 1);
    }
    return parseInt(vars.meses ?? vars.numeroPeriodos ?? '6', 10) || 6;
  })();

  // Resolver administración y tipo de tarifa para lookup en catálogo CSV
  const adminCatalogo = administracionCatalogo
    ?? resolveAdministracion(administracionNombre)
    ?? 'QUERÉTARO';
  const tipoTarifaResuelto = tipoTarifaProp
    ?? resolveTipoTarifa(tipoContratacionNombre, adminCatalogo)
    ?? 'DOMÉSTICA MEDIO';

  const filas: FilaCobro[] = filasProp ?? generarFilas(
    consumoM3, unidades, adminCatalogo, tipoTarifaResuelto,
    periodoInicio, rawMeses,
    aplicaAgua, aplicaAlcantarillado, aplicaSaneamiento,
  );

  // Totales
  const totAgua          = filas.reduce((s, f) => s + f.agua, 0);
  const totAlcantarillado = filas.reduce((s, f) => s + f.alcantarillado, 0);
  const totSaneamiento   = filas.reduce((s, f) => s + f.saneamiento, 0);
  const totRecargos      = filas.reduce((s, f) => s + f.recargos, 0);
  const totGlobal        = filas.reduce((s, f) => s + f.totalPeriodo, 0);

  const nombre = fd.propTipoPersona === 'moral'
    ? (fd.propRazonSocial || record.propNombreCompleto)
    : ([fd.propPaterno, fd.propMaterno, fd.propNombre].filter(Boolean).join(' ') || record.propNombreCompleto);

  const domicilio = (() => {
    const p = fd.predioDir;
    const parts = [p?.calle, p?.numExterior ? `#${p.numExterior}` : undefined, p?.municipioINEGIId].filter(Boolean);
    return parts.length ? parts.join(', ') : record.predioResumen;
  })();

  const resumenConceptos: { label: string; importe: number }[] = [
    { label: 'Agua', importe: totAgua },
    { label: 'Alcantarillado', importe: totAlcantarillado },
    { label: 'Saneamiento', importe: totSaneamiento },
    { label: 'Recargos', importe: totRecargos },
  ];

  return (
    <Document title={`Detalle del cobro de agua — ${record.folio}`} author="CEA Querétaro">
      <Page size="LETTER" orientation="landscape" style={s.page}>

        {/* ── Encabezado ────────────────────────────────────────────── */}
        <View style={s.headerSection}>
          <Text style={s.orgName}>CEA Querétaro</Text>
          <Text style={s.orgSub}>Comisión Estatal del Agua — Detalle del cobro del agua</Text>
          <View style={s.headerGrid}>
            {/* Columna izquierda */}
            <View style={s.headerCol}>
              <View style={s.headerLine}>
                <Text style={s.hLabel}>Folio:</Text>
                <Text style={s.hValue}>{record.folio}</Text>
              </View>
              <View style={s.headerLine}>
                <Text style={s.hLabel}>Nombre:</Text>
                <Text style={s.hValue}>{nombre || '—'}</Text>
              </View>
              <View style={s.headerLine}>
                <Text style={s.hLabel}>Domicilio:</Text>
                <Text style={s.hValue}>{domicilio || '—'}</Text>
              </View>
              <View style={s.headerLine}>
                <Text style={s.hLabel}>Administración:</Text>
                <Text style={s.hValue}>{administracionNombre || '—'}</Text>
              </View>
              <View style={s.headerLine}>
                <Text style={s.hLabel}>Tipo de uso:</Text>
                <Text style={s.hValue}>{tipoServicio || tipoContratacionNombre || '—'}</Text>
              </View>
              <View style={s.headerLine}>
                <Text style={s.hLabel}>Tarifa:</Text>
                <Text style={s.hValue}>{tarifa || tipoContratacionNombre || '—'}</Text>
              </View>
            </View>
            {/* Columna derecha */}
            <View style={s.headerCol}>
              <View style={s.headerLine}>
                <Text style={s.hLabel}>Fecha:</Text>
                <Text style={s.hValue}>{fechaDoc}</Text>
              </View>
              <View style={s.headerLine}>
                <Text style={s.hLabel}>Consumo M3:</Text>
                <Text style={s.hValue}>{consumoM3}</Text>
              </View>
              <View style={s.headerLine}>
                <Text style={s.hLabel}>Unidades servidas:</Text>
                <Text style={s.hValue}>{unidades}</Text>
              </View>
              <View style={s.headerLine}>
                <Text style={s.hLabel}>Tipo:</Text>
                <Text style={s.hValue}>{tipo || '—'}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── Tabla mensual ──────────────────────────────────────────── */}
        <View style={s.tableWrap}>
          {/* Cabecera */}
          <View style={s.tHeaderRow}>
            <Text style={[s.th, { flex: 0.5 }]}>Año</Text>
            <Text style={[s.th, { flex: 0.5 }]}>Mes</Text>
            <Text style={[s.th, { flex: 0.65 }]}>Uds. Servidas</Text>
            <Text style={[s.th, { flex: 0.6 }]}>Consumo M3</Text>
            <Text style={[s.th, { flex: 1 }]}>Agua</Text>
            <Text style={[s.th, { flex: 1 }]}>Alcantarillado</Text>
            <Text style={[s.th, { flex: 1 }]}>Saneamiento</Text>
            <Text style={[s.th, { flex: 1 }]}>Serv. del periodo</Text>
            <Text style={[s.th, { flex: 1 }]}>Serv. Vencidos</Text>
            <Text style={[s.th, { flex: 1 }]}>Recargos</Text>
            <Text style={[s.th, { flex: 1 }]}>Total Periodo</Text>
          </View>
          {/* Filas */}
          {filas.map((f, i) => {
            const rowStyle = i % 2 === 0 ? s.tRow : s.tRowAlt;
            return (
              <View key={`${f.anio}-${f.mes}`} style={rowStyle}>
                <Text style={[s.tdR, { flex: 0.5 }]}>{f.anio}</Text>
                <Text style={[s.td, { flex: 0.5 }]}>{f.mes}</Text>
                <Text style={[s.tdR, { flex: 0.65 }]}>{f.unidadesServidas}</Text>
                <Text style={[s.tdR, { flex: 0.6 }]}>{f.consumoM3}</Text>
                <Text style={[s.tdR, { flex: 1 }]}>{MXN.format(f.agua)}</Text>
                <Text style={[s.tdR, { flex: 1 }]}>{MXN.format(f.alcantarillado)}</Text>
                <Text style={[s.tdR, { flex: 1 }]}>{MXN.format(f.saneamiento)}</Text>
                <Text style={[s.tdR, { flex: 1 }]}>{MXN.format(f.serviciosPeriodo)}</Text>
                <Text style={[s.tdR, { flex: 1 }]}>{f.serviciosVencidos > 0 ? MXN.format(f.serviciosVencidos) : '$ —'}</Text>
                <Text style={[s.tdR, { flex: 1 }]}>{f.recargos > 0 ? MXN.format(f.recargos) : '$ —'}</Text>
                <Text style={[s.tdR, { flex: 1, fontFamily: 'Helvetica-Bold' }]}>{MXN.format(f.totalPeriodo)}</Text>
              </View>
            );
          })}
          {/* Fila de totales */}
          <View style={s.tTotalRow}>
            <Text style={[s.td, { flex: 0.5 + 0.5 + 0.65 + 0.6, fontFamily: 'Helvetica-Bold', textAlign: 'right' }]}> </Text>
            <Text style={[s.tdR, { flex: 1, fontFamily: 'Helvetica-Bold' }]}>{MXN.format(totAgua)}</Text>
            <Text style={[s.tdR, { flex: 1, fontFamily: 'Helvetica-Bold' }]}>{MXN.format(totAlcantarillado)}</Text>
            <Text style={[s.tdR, { flex: 1, fontFamily: 'Helvetica-Bold' }]}>{MXN.format(totSaneamiento)}</Text>
            <Text style={[s.tdR, { flex: 1 }]}> </Text>
            <Text style={[s.tdR, { flex: 1 }]}> </Text>
            <Text style={[s.tdR, { flex: 1, fontFamily: 'Helvetica-Bold' }]}>{MXN.format(totRecargos)}</Text>
            <Text style={[s.tdR, { flex: 1, fontFamily: 'Helvetica-Bold', color: ACCENT }]}>{MXN.format(totGlobal)}</Text>
          </View>
        </View>

        {/* ── Tabla resumen ──────────────────────────────────────────── */}
        <View style={s.summaryWrap}>
          <View style={s.summaryTable}>
            {/* Header */}
            <View style={s.sHeaderRow}>
              <Text style={[s.sth, { flex: 2 }]}>Concepto</Text>
              <Text style={[s.sth, { flex: 1.2 }]}>Importe</Text>
              <Text style={[s.sth, { flex: 0.8 }]}>IVA</Text>
              <Text style={[s.sth, { flex: 1.2 }]}>Total</Text>
            </View>
            {resumenConceptos.map((c, i) => {
              const rowStyle = i % 2 === 0 ? s.sRow : s.sRowAlt;
              return (
                <View key={c.label} style={rowStyle}>
                  <Text style={[s.std, { flex: 2 }]}>{c.label}</Text>
                  <Text style={[s.stdR, { flex: 1.2 }]}>{MXN.format(c.importe)}</Text>
                  <Text style={[s.stdR, { flex: 0.8, color: MUTED }]}>$ —</Text>
                  <Text style={[s.stdR, { flex: 1.2 }]}>{MXN.format(c.importe)}</Text>
                </View>
              );
            })}
            {/* Total final */}
            <View style={s.sTotalRow}>
              <Text style={[s.std, { flex: 2, fontFamily: 'Helvetica-Bold' }]}>Total</Text>
              <Text style={[s.stdR, { flex: 1.2, fontFamily: 'Helvetica-Bold' }]}>{MXN.format(totGlobal)}</Text>
              <Text style={[s.stdR, { flex: 0.8, color: MUTED }]}>$ —</Text>
              <Text style={[s.stdR, { flex: 1.2, fontFamily: 'Helvetica-Bold', color: ACCENT }]}>{MXN.format(totGlobal)}</Text>
            </View>
          </View>
        </View>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <View style={s.footer}>
          <Text style={s.footerText}>
            CEA Querétaro — Sistema de Gestión de Agua Potable | Folio {record.folio} | Generado el {fechaDoc}
          </Text>
        </View>

      </Page>
    </Document>
  );
}
