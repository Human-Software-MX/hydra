import React, { createContext, useContext, useState, ReactNode } from 'react';

// Types
export type FactibilidadEstado = 'Pre-factibilidad' | 'En comité' | 'Aprobada' | 'Rechazada';
export type ConstruccionEstado = 'Planeación' | 'En proceso' | 'Finalizada';
export type TomaEstado = 'Disponible' | 'Asignada';
export type ContratoEstado =
  | 'Pendiente de alta'
  | 'Pendiente de toma'
  | 'Pendiente de zona'
  | 'Activo'
  | 'Suspendido'
  | 'Cancelado';
export type MedidorEstado = 'Activo' | 'Inactivo';
export type MedidorBodegaEstado = 'Disponible' | 'En reparación';

export interface MedidorBodega {
  id: string;
  serie: string;
  /** Zona no se asigna en inventario; solo al unir medidor con contrato. */
  zonaId?: string;
  estado: MedidorBodegaEstado;
}
export type LecturaEstado = 'Válida' | 'No válida' | 'Pendiente';
export type PreFacturaEstado = 'Pendiente' | 'Validada' | 'Aceptada';
export type TimbradoEstado = 'Timbrada OK' | 'Error PAC' | 'Pendiente';

export interface Factibilidad {
  id: string;
  predio: string;
  solicitante: string;
  direccion: string;
  estado: FactibilidadEstado;
  fecha: string;
  notas: string;
}

export interface Construccion {
  id: string;
  factibilidadId: string;
  nombre: string;
  ubicacion: string;
  estado: ConstruccionEstado;
  fecha: string;
}

export interface Toma {
  id: string;
  construccionId: string;
  ubicacion: string;
  tipo: 'Agua' | 'Saneamiento' | 'Alcantarillado';
  estado: TomaEstado;
}

export interface Administracion {
  id: string;
  nombre: string;
  zonaIds: string[];
}

export interface Zona {
  id: string;
  administracionId: string;
  nombre: string;
  distritoIds: string[];
}

export interface Distrito {
  id: string;
  zonaId: string;
  nombre: string;
}

/** Usuario actual (mock para accesos por administración/zona) */
export interface CurrentUser {
  id: string;
  name: string;
  administracionIds: string[];
  zonaIds: string[];
}

export interface Contrato {
  id: string;
  tomaId: string;
  tipoContrato: 'Agua' | 'Saneamiento' | 'Alcantarillado';
  tipoServicio: 'Doméstico' | 'Comercial' | 'Industrial';
  nombre: string;
  rfc: string;
  direccion: string;
  contacto: string;
  estado: ContratoEstado;
  fecha: string;
  medidorId?: string;
  rutaId?: string;
  zonaId?: string;
  /** Domiciliación bancaria activa */
  domiciliado?: boolean;
  /** Fecha prevista de reconexión (solo cuando estado es Suspendido por baja temporal) */
  fechaReconexionPrevista?: string;
}

/** Costo o cargo fijo asociado al contrato (ej. cargo por contrato, concepto fijo) */
export interface CostoContrato {
  id: string;
  contratoId: string;
  concepto: string;
  monto: number;
  periodo?: string;
}

export interface Medidor {
  id: string;
  contratoId: string;
  serie: string;
  estado: MedidorEstado;
  cobroDiferido: boolean;
  lecturaInicial: number;
}

export interface Ruta {
  id: string;
  zonaId: string;
  distritoId?: string;
  zona?: string; // display name, derivable from Zona
  sector: string;
  libreta: string;
  lecturista: string;
  contratoIds: string[];
}

export interface Lectura {
  id: string;
  contratoId: string;
  rutaId: string;
  lecturaAnterior: number;
  lecturaActual: number;
  consumo: number;
  estado: LecturaEstado;
  incidencia: string;
  fecha: string;
  periodo: string;
  /** Límite mínimo de consumo para la zona (m³) */
  lecturaMinZona?: number;
  /** Límite máximo de consumo para la zona (m³) */
  lecturaMaxZona?: number;
  /** Simulado mensual o mínimo de zona cuando la lectura no es válida */
  simuladoMensual?: number;
  /** Motivo de invalidación cuando estado es No válida */
  motivoInvalidacion?: string;
}

export interface Consumo {
  id: string;
  contratoId: string;
  lecturaId: string;
  tipo: 'Real' | 'Promedio histórico' | 'Mixto' | 'Consumo fijo';
  m3: number;
  periodo: string;
  confirmado: boolean;
}

export interface Tarifa {
  id: string;
  tipo: 'Doméstico' | 'Comercial' | 'Industrial';
  rangoMin: number;
  rangoMax: number;
  precioPorM3: number;
  cargoFijo: number;
}

export interface Descuento {
  id: string;
  nombre: string;
  tipo: 'Jubilado' | 'Pensionado' | 'Usuario cumplido' | 'Pago anticipado' | 'Extraordinario';
  porcentaje: number;
  activo: boolean;
}

export interface PreFactura {
  id: string;
  contratoId: string;
  periodo: string;
  consumoM3: number;
  subtotal: number;
  descuento: number;
  total: number;
  estado: PreFacturaEstado;
}

export interface Timbrado {
  id: string;
  preFacturaId: string;
  contratoId: string;
  uuid: string;
  estado: TimbradoEstado;
  error?: string;
  fecha: string;
}

/** Cuota de pago en parcialidades (contrato con pago diferido) */
export interface PagoParcialidad {
  id: string;
  contratoId: string;
  numero: number;
  monto: number;
  fechaVencimiento: string;
  estado: 'Pendiente' | 'Pagado';
}

export interface Recibo {
  id: string;
  timbradoId: string;
  contratoId: string;
  saldoVigente: number;
  saldoVencido: number;
  parcialidades: number;
  fechaVencimiento: string;
  impreso: boolean;
  mensajeIndividual?: string;
}

export type TipoPago =
  | 'Efectivo' | 'Transferencia' | 'Tarjeta'
  | 'SPEI' | 'OXXO' | 'CODI' | 'CAJERO' | 'CHATBOT' | 'WEB' | 'CAJAS POPULARES' | 'Link de pago';

export interface Pago {
  id: string;
  contratoId: string;
  monto: number;
  fecha: string;
  tipo: TipoPago;
  concepto: string;
  /** 'nativo' = aplicado en sistema; 'externo' = recaudación externa por conciliar */
  origen?: 'nativo' | 'externo';
}

/** Pago de recaudación externa (webservice) por conciliar */
export interface PagoExterno {
  id: string;
  referencia: string;
  monto: number;
  fecha: string;
  tipo: TipoPago;
  estado: 'pendiente_conciliar' | 'conciliado';
  contratoIdSugerido?: string;
  facturaIdSugerido?: string;
  concepto?: string;
}

/** Trámite asignado al contrato (domiciliación, cláusulas, estatus, etc.) */
export type TramiteTipo = 'Domiciliación' | 'Cláusulas del contrato' | 'Estatus de servicio' | 'Convenio' | 'Baja temporal' | 'Baja definitiva';
export interface TramiteAsignado {
  id: string;
  contratoId: string;
  tipo: TramiteTipo;
  estado: 'Pendiente' | 'En trámite' | 'Completado' | 'Rechazado';
  fechaAsignacion: string;
  fechaVencimiento?: string;
  observaciones?: string;
}

/** Cláusula del contrato (texto legal o condicional) */
export interface ClausulaContrato {
  id: string;
  contratoId: string;
  orden: number;
  titulo: string;
  texto: string;
}

/** Catálogo de tipos de ajuste a la facturación (por área/origen) */
export const TIPOS_AJUSTE_FACTURACION = [
  { id: 'actualizacion_datos', label: 'Actualización de datos', area: 'Facturación' },
  { id: 'atencion_publico', label: 'Atención al público', area: 'Atención a clientes' },
  { id: 'deuda', label: 'Deuda', area: 'Cartera' },
  { id: 'juridica', label: 'Jurídica', area: 'Jurídico' },
  { id: 'convenio', label: 'Convenio', area: 'Cartera' },
  { id: 'correccion_lectura', label: 'Corrección por lectura', area: 'Facturación' },
  { id: 'corte_reconexion', label: 'Corte / Reconexión', area: 'Operación' },
] as const;
export type TipoAjusteFacturacionId = (typeof TIPOS_AJUSTE_FACTURACION)[number]['id'];

/** Parámetros para aplicar un ajuste a una prefactura */
export interface AjusteFacturaParams {
  tipoAjusteId: TipoAjusteFacturacionId;
  preFacturaId: string;
  /** Nuevo consumo m³ (solo aplica en corrección por lectura / actualización datos) */
  consumoM3?: number;
  /** Descuento adicional (algunos tipos permiten descuento) */
  descuentoAdicional?: number;
  /** Motivo u observación del ajuste */
  observacion?: string;
}

/** Registro (kardex) de un ajuste aplicado a una prefactura */
export interface AjusteFacturaRegistro {
  id: string;
  preFacturaId: string;
  tipoAjusteId: TipoAjusteFacturacionId;
  tipoLabel: string;
  area: string;
  consumoAnterior?: number;
  consumoNuevo?: number;
  descuentoAplicado?: number;
  totalAnterior: number;
  totalNuevo: number;
  observacion?: string;
  /** ISO */
  fecha: string;
}

/** Área que gestiona el convenio */
export type ConvenioArea = 'Atención a clientes' | 'Cartera' | 'Jurídico' | 'Facturación';
export type ConvenioEstado = 'Vigente' | 'Cumplido' | 'Vencido' | 'Cancelado';

export interface Convenio {
  id: string;
  contratoId: string;
  tipo: string;
  area: ConvenioArea;
  importeTotal: number;
  pagosRealizados: number;
  fechaInicio: string;
  fechaVencimiento: string;
  estado: ConvenioEstado;
  numeroParcialidades: number;
  observaciones?: string;
}

/** Queja o aclaración registrada contra un contrato (historial) */
export type QuejaAclaracionTipo = 'Queja' | 'Aclaración';
export type QuejaCategoria = 'Facturación' | 'Servicio' | 'Medidor' | 'Lectura' | 'Corte/Reconexión' | 'Cobro' | 'Otro';
export type QuejaPrioridad = 'Baja' | 'Media' | 'Alta' | 'Urgente';
export type QuejaCanal = 'Ventanilla' | 'Teléfono' | 'Portal web' | 'Correo' | 'Redes sociales';
export type QuejaAreaAsignada = 'Atención a clientes' | 'Operación' | 'Facturación' | 'Jurídico' | 'Cartera';
export type SeguimientoTipo = 'nota' | 'cambio_estado' | 'reasignacion' | 'contacto_cliente';

export interface SeguimientoQueja {
  id: string;
  quejaId: string;
  fecha: string;
  nota: string;
  usuario: string;
  tipo: SeguimientoTipo;
}

export interface QuejaAclaracion {
  id: string;
  contratoId: string;
  fecha: string;
  tipo: QuejaAclaracionTipo;
  descripcion: string;
  estado: 'Registrada' | 'En atención' | 'Resuelta' | 'Cerrada';
  atendidoPor?: string;
  categoria?: QuejaCategoria;
  prioridad?: QuejaPrioridad;
  canal?: QuejaCanal;
  areaAsignada?: QuejaAreaAsignada;
  enlaceExterno?: string;
  motivoCierre?: string;
  seguimientos?: SeguimientoQueja[];
}

// Initial mock data
const initialFactibilidades: Factibilidad[] = [
  { id: 'F001', predio: 'Lote 23-A Juriquilla', solicitante: 'Carlos Mendoza', direccion: 'Av. Juriquilla 450', estado: 'Aprobada', fecha: '2025-01-15', notas: 'Zona con infraestructura disponible' },
  { id: 'F002', predio: 'Manzana 5 El Marqués', solicitante: 'María López', direccion: 'Calle Norte 120', estado: 'En comité', fecha: '2025-02-01', notas: 'Pendiente dictamen técnico' },
  { id: 'F003', predio: 'Parcela 8 Corregidora', solicitante: 'Roberto Sánchez', direccion: 'Blvd. Corregidora 890', estado: 'Pre-factibilidad', fecha: '2025-02-10', notas: '' },
  { id: 'F004', predio: 'Condominio Zibatá', solicitante: 'Inmobiliaria Norte SA', direccion: 'Circuito Zibatá 200', estado: 'Rechazada', fecha: '2024-12-05', notas: 'Sin capacidad en red' },
];

const initialConstrucciones: Construccion[] = [
  { id: 'C001', factibilidadId: 'F001', nombre: 'Red hidráulica Juriquilla Ph2', ubicacion: 'Juriquilla', estado: 'Finalizada', fecha: '2025-01-20' },
  { id: 'C002', factibilidadId: 'F001', nombre: 'Alcantarillado Juriquilla Ph2', ubicacion: 'Juriquilla', estado: 'En proceso', fecha: '2025-02-01' },
];

const initialTomas: Toma[] = [
  { id: 'T001', construccionId: 'C001', ubicacion: 'Juriquilla Lote 23-A #1', tipo: 'Agua', estado: 'Asignada' },
  { id: 'T002', construccionId: 'C001', ubicacion: 'Juriquilla Lote 23-A #2', tipo: 'Agua', estado: 'Disponible' },
  { id: 'T003', construccionId: 'C001', ubicacion: 'Juriquilla Lote 23-A #3', tipo: 'Saneamiento', estado: 'Disponible' },
  { id: 'T004', construccionId: 'C001', ubicacion: 'Juriquilla Lote 23-A #4', tipo: 'Alcantarillado', estado: 'Disponible' },
];

// Seed territorial — distritos alineados a hoja «Distrito» de catálogos de punto de servicio (SIGE legado).
const initialDistritos: Distrito[] = [
  { id: 'DIST01', zonaId: 'Z001', nombre: '01-DISTRITO NORORIENTE' },
  { id: 'DIST02', zonaId: 'Z001', nombre: '02-DISTRITO NORPONIENTE' },
  { id: 'DIST03', zonaId: 'Z001', nombre: '03-ZONA SURORIENTE' },
  { id: 'DIST04', zonaId: 'Z001', nombre: '04-ZONA SURPONIENTE' },
];
const initialZonas: Zona[] = [
  {
    id: 'Z001',
    administracionId: 'EXP-01',
    nombre: 'Norte',
    distritoIds: ['DIST01', 'DIST02', 'DIST03', 'DIST04'],
  },
  { id: 'Z002', administracionId: 'EXP-01', nombre: 'El Marqués', distritoIds: [] },
  { id: 'Z003', administracionId: 'EXP-01', nombre: 'Corregidora', distritoIds: [] },
  { id: 'Z004', administracionId: 'EXP-12', nombre: 'Zibatá', distritoIds: [] },
  { id: 'Z005', administracionId: 'EXP-12', nombre: 'Centro', distritoIds: [] },
];
const initialAdministraciones: Administracion[] = [
  { id: 'EXP-01', nombre: 'QUERÉTARO', zonaIds: ['Z001', 'Z002', 'Z003'] },
  { id: 'EXP-12', nombre: 'EL MARQUÉS', zonaIds: ['Z004', 'Z005'] },
];

const initialContratos: Contrato[] = [
  { id: 'CT001', tomaId: 'T001', tipoContrato: 'Agua', tipoServicio: 'Doméstico', nombre: 'Juan Pérez García', rfc: 'PEGJ800101XXX', direccion: 'Juriquilla Lote 23-A #1', contacto: '442-111-2233', estado: 'Activo', fecha: '2025-01-25', medidorId: 'M001', rutaId: 'R001', zonaId: 'Z001', domiciliado: true },
  { id: 'CT002', tomaId: 'T002', tipoContrato: 'Agua', tipoServicio: 'Doméstico', nombre: 'María López', rfc: 'LOM850202YYY', direccion: 'Juriquilla Lote 23-A #2', contacto: '442-222-3344', estado: 'Activo', fecha: '2025-01-26', medidorId: 'M002', rutaId: 'R001', zonaId: 'Z001', domiciliado: false },
  { id: 'CT003', tomaId: 'T003', tipoContrato: 'Saneamiento', tipoServicio: 'Comercial', nombre: 'Comercial Norte SA', rfc: 'NSA900101ZZZ', direccion: 'Juriquilla Lote 23-A #3', contacto: '442-333-4455', estado: 'Activo', fecha: '2025-01-27', medidorId: 'M003', rutaId: 'R002', zonaId: 'Z002', domiciliado: false },
];

const initialCostosContrato: CostoContrato[] = [
  { id: 'CC001', contratoId: 'CT001', concepto: 'Cargo fijo mensual', monto: 45, periodo: 'mensual' },
  { id: 'CC002', contratoId: 'CT001', concepto: 'Derecho de acometida (amort.)', monto: 0, periodo: 'mensual' },
  { id: 'CC003', contratoId: 'CT002', concepto: 'Cargo fijo mensual', monto: 45, periodo: 'mensual' },
  { id: 'CC004', contratoId: 'CT003', concepto: 'Cargo fijo mensual', monto: 120, periodo: 'mensual' },
];

const initialConvenios: Convenio[] = [
  { id: 'CONV001', contratoId: 'CT001', tipo: 'Diferido 6 meses', area: 'Cartera', importeTotal: 900, pagosRealizados: 300, fechaInicio: '2025-01-15', fechaVencimiento: '2025-07-15', estado: 'Vigente', numeroParcialidades: 6, observaciones: 'Convenio por regularización' },
  { id: 'CONV002', contratoId: 'CT002', tipo: 'Quita', area: 'Jurídico', importeTotal: 500, pagosRealizados: 500, fechaInicio: '2024-11-01', fechaVencimiento: '2025-01-31', estado: 'Cumplido', numeroParcialidades: 3 },
];

const initialQuejasAclaraciones: QuejaAclaracion[] = [
  {
    id: 'QA001',
    contratoId: 'CT001',
    fecha: '2025-01-20',
    tipo: 'Aclaración',
    descripcion: 'Consulta sobre importe del recibo diciembre 2024. El cliente menciona que el cobro fue mayor al esperado.',
    estado: 'Resuelta',
    atendidoPor: 'jgodinez',
    categoria: 'Facturación',
    prioridad: 'Media',
    canal: 'Ventanilla',
    areaAsignada: 'Atención a clientes',
    motivoCierre: 'Se explicó el desglose del recibo. Consumo real validado con lectura.',
    seguimientos: [
      {
        id: 'SQ001',
        quejaId: 'QA001',
        fecha: '2025-01-20T09:15:00',
        nota: 'Cliente se presentó en ventanilla consultando diferencia en recibo de diciembre.',
        usuario: 'jgodinez',
        tipo: 'nota',
      },
      {
        id: 'SQ002',
        quejaId: 'QA001',
        fecha: '2025-01-20T09:30:00',
        nota: 'Se revisó lectura y consumo. Consumo fue de 28m³ vs promedio de 18m³. Se explicó al cliente.',
        usuario: 'jgodinez',
        tipo: 'cambio_estado',
      },
      {
        id: 'SQ003',
        quejaId: 'QA001',
        fecha: '2025-01-20T09:45:00',
        nota: 'Cliente aceptó explicación. Se cierra la aclaración como resuelta.',
        usuario: 'jgodinez',
        tipo: 'contacto_cliente',
      },
    ],
  },
  {
    id: 'QA002',
    contratoId: 'CT001',
    fecha: '2025-02-01',
    tipo: 'Queja',
    descripcion: 'Demora en toma de lectura. El lecturista no se presentó en la fecha programada.',
    estado: 'En atención',
    atendidoPor: 'mlopez',
    categoria: 'Lectura',
    prioridad: 'Alta',
    canal: 'Teléfono',
    areaAsignada: 'Operación',
    seguimientos: [
      {
        id: 'SQ004',
        quejaId: 'QA002',
        fecha: '2025-02-01T11:00:00',
        nota: 'Cliente llama por teléfono reportando que el lecturista no se presentó en los últimos 2 meses.',
        usuario: 'mlopez',
        tipo: 'nota',
      },
      {
        id: 'SQ005',
        quejaId: 'QA002',
        fecha: '2025-02-01T11:30:00',
        nota: 'Se reasigna a área de Operación para verificar ruta R001 y programar visita urgente.',
        usuario: 'mlopez',
        tipo: 'reasignacion',
      },
    ],
  },
  {
    id: 'QA003',
    contratoId: 'CT002',
    fecha: '2025-01-15',
    tipo: 'Queja',
    descripcion: 'Baja presión de agua durante horas pico (7-9am y 7-9pm).',
    estado: 'Registrada',
    categoria: 'Servicio',
    prioridad: 'Media',
    canal: 'Portal web',
    areaAsignada: 'Operación',
    seguimientos: [
      {
        id: 'SQ006',
        quejaId: 'QA003',
        fecha: '2025-01-15T14:00:00',
        nota: 'Queja recibida vía portal web. Se registra y se notifica a operación.',
        usuario: 'sistema',
        tipo: 'nota',
      },
    ],
  },
];

const initialMedidoresBodega: MedidorBodega[] = [
  { id: 'MB001', serie: 'MED-2025-00010', zonaId: 'Z001', estado: 'Disponible' },
  { id: 'MB002', serie: 'MED-2025-00011', zonaId: 'Z001', estado: 'Disponible' },
  { id: 'MB003', serie: 'MED-2025-00012', zonaId: 'Z002', estado: 'En reparación' },
  { id: 'MB004', serie: 'MED-2025-00013', zonaId: 'Z001', estado: 'Disponible' },
];

const initialMedidores: Medidor[] = [
  { id: 'M001', contratoId: 'CT001', serie: 'MED-2025-00001', estado: 'Activo', cobroDiferido: false, lecturaInicial: 0 },
  { id: 'M002', contratoId: 'CT002', serie: 'MED-2025-00002', estado: 'Activo', cobroDiferido: false, lecturaInicial: 10 },
  { id: 'M003', contratoId: 'CT003', serie: 'MED-2025-00003', estado: 'Activo', cobroDiferido: false, lecturaInicial: 0 },
];

const initialRutas: Ruta[] = [
  { id: 'R001', zonaId: 'Z001', sector: 'Juriquilla', libreta: 'LIB-001', lecturista: 'Pedro Ramírez', contratoIds: ['CT001', 'CT002'] },
  { id: 'R002', zonaId: 'Z002', sector: 'El Marqués', libreta: 'LIB-002', lecturista: 'Ana García', contratoIds: ['CT003'] },
];

/**
 * PRNG determinista (mulberry32).
 *
 * El dataset demo se genera al evaluar el módulo, así que con `Math.random()`
 * cada recarga producía importes y consumos distintos para los MISMOS ids
 * (PF001, CO001, …). Eso rompe cualquier registro que sí persiste —el kardex de
 * ajustes vive en el servidor— y hace que lo mostrado en pantalla no coincida
 * con el "antes/después" ya registrado. Con semilla fija el demo es reproducible.
 */
function crearRandom(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tarifa aplicable a un consumo. Única fuente de verdad del cálculo: la usan el
 * seed de prefacturas, `calcularTarifa` del contexto y los ajustes de facturación.
 *
 * El rango aplicable es el más alto que el consumo ya alcanzó (`rangoMin <= m3`),
 * nunca uno de otro tipo de servicio. Exigir además `m3 <= rangoMax` dejaría sin
 * tarifa a los consumos que caen ENTRE rangos —los rangos están definidos sobre
 * enteros (0-10, 11-30, 31-999), así que 10.5 m³ no cae en ninguno— y a los que
 * superan el último; esos consumos terminaban cobrándose al precio del rango más
 * alto (10.5 m³ domésticos a $22.00/m³ en vez de $8.50/m³).
 *
 * Un consumo negativo no puede facturarse: se trata como 0 (solo cargo fijo).
 */
function calcularTarifaCon(tarifas: Tarifa[], tipoServicio: string, m3: number) {
  const tipo = tipoServicio === 'Doméstico' ? 'Doméstico' : tipoServicio === 'Comercial' ? 'Comercial' : 'Industrial';
  const delTipo = tarifas.filter(t => t.tipo === tipo).sort((a, b) => a.rangoMin - b.rangoMin);
  const consumo = Math.max(0, m3);
  const alcanzados = delTipo.filter(t => consumo >= t.rangoMin);
  const tarifa = alcanzados[alcanzados.length - 1] ?? delTipo[0] ?? tarifas[0];
  const subtotal = consumo * tarifa.precioPorM3;
  return { subtotal, cargoFijo: tarifa.cargoFijo, total: subtotal + tarifa.cargoFijo };
}

// Seed lecturas: muchas lecturas con mix válidas/no válidas y datos de validación (Fase 5)
function generateSeedLecturas(): Lectura[] {
  const rnd = crearRandom(0x1ec7);
  const out: Lectura[] = [];
  const contratosRutas: { contratoId: string; rutaId: string }[] = [
    { contratoId: 'CT001', rutaId: 'R001' },
    { contratoId: 'CT002', rutaId: 'R001' },
    { contratoId: 'CT003', rutaId: 'R002' },
  ];
  const minZona = 0;
  const maxZona = 200;
  const prevByContrato: Record<string, number> = { CT001: 0, CT002: 10, CT003: 0 };
  let id = 1;
  for (let year = 2024; year <= 2025; year++) {
    for (let month = 1; month <= 12; month++) {
      if (year === 2025 && month > 2) break;
      const periodo = `${year}-${String(month).padStart(2, '0')}`;
      const fecha = `${year}-${String(month).padStart(2, '0')}-15`;
      for (const { contratoId, rutaId } of contratosRutas) {
        const prev = prevByContrato[contratoId];
        const consumo = Math.floor(rnd() * 80) + 5;
        const actual = prev + consumo;
        const fueraMin = consumo < 0;
        const fueraMax = consumo > maxZona;
        const noValida = rnd() < 0.25 || fueraMin || fueraMax;
        const estado: LecturaEstado = noValida ? 'No válida' : (rnd() < 0.1 ? 'Pendiente' : 'Válida');
        const motivo = noValida ? (fueraMax ? 'Excede máximo zona' : fueraMin ? 'Bajo mínimo' : 'Fuera de rango') : undefined;
        out.push({
          id: `L${String(id).padStart(3, '0')}`,
          contratoId,
          rutaId,
          lecturaAnterior: prev,
          lecturaActual: actual,
          consumo,
          estado,
          incidencia: motivo || '',
          fecha,
          periodo,
          lecturaMinZona: minZona,
          lecturaMaxZona: maxZona,
          simuladoMensual: noValida ? Math.min(consumo, 50) : undefined,
          motivoInvalidacion: motivo,
        });
        prevByContrato[contratoId] = actual;
        id++;
      }
    }
  }
  return out;
}
const initialLecturas: Lectura[] = generateSeedLecturas();

// Seed consumos: a partir de lecturas y periodos (Fase 7)
function generateSeedConsumos(): Consumo[] {
  const rnd = crearRandom(0xc0f5);
  const out: Consumo[] = [];
  const periodos = ['2024-06', '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12', '2025-01', '2025-02'];
  const contratos = ['CT001', 'CT002', 'CT003'];
  let id = 1;
  for (const periodo of periodos) {
    for (const contratoId of contratos) {
      const m3 = Math.floor(rnd() * 35) + 8;
      const tipo = rnd() < 0.7 ? 'Real' : (rnd() < 0.5 ? 'Promedio histórico' : 'Mixto');
      out.push({
        id: `CO${String(id).padStart(3, '0')}`,
        contratoId,
        lecturaId: '',
        tipo: tipo as 'Real' | 'Promedio histórico' | 'Mixto' | 'Consumo fijo',
        m3,
        periodo,
        confirmado: rnd() < 0.85,
      });
      id++;
    }
  }
  return out;
}
const initialConsumos: Consumo[] = generateSeedConsumos();

const initialTarifas: Tarifa[] = [
  { id: 'TAR001', tipo: 'Doméstico', rangoMin: 0, rangoMax: 10, precioPorM3: 8.50, cargoFijo: 45 },
  { id: 'TAR002', tipo: 'Doméstico', rangoMin: 11, rangoMax: 30, precioPorM3: 14.20, cargoFijo: 45 },
  { id: 'TAR003', tipo: 'Doméstico', rangoMin: 31, rangoMax: 999, precioPorM3: 22.00, cargoFijo: 45 },
  { id: 'TAR004', tipo: 'Comercial', rangoMin: 0, rangoMax: 20, precioPorM3: 18.50, cargoFijo: 120 },
  { id: 'TAR005', tipo: 'Comercial', rangoMin: 21, rangoMax: 999, precioPorM3: 28.00, cargoFijo: 120 },
  { id: 'TAR006', tipo: 'Industrial', rangoMin: 0, rangoMax: 999, precioPorM3: 35.00, cargoFijo: 250 },
];

const initialDescuentos: Descuento[] = [
  { id: 'D001', nombre: 'Jubilado / Pensionado', tipo: 'Jubilado', porcentaje: 50, activo: true },
  { id: 'D002', nombre: 'Usuario cumplido', tipo: 'Usuario cumplido', porcentaje: 10, activo: true },
  { id: 'D003', nombre: 'Pago anticipado', tipo: 'Pago anticipado', porcentaje: 5, activo: true },
];

// Seed facturas: PreFacturas + Timbrados + Recibos (Fase 7)
function generateSeedFacturas(): { preFacturas: PreFactura[]; timbrados: Timbrado[]; recibos: Recibo[] } {
  const rnd = crearRandom(0xfac7);
  const preFacturas: PreFactura[] = [];
  const timbrados: Timbrado[] = [];
  const recibos: Recibo[] = [];
  const contratos = ['CT001', 'CT002', 'CT003'];
  const periodos = ['2024-10', '2024-11', '2024-12', '2025-01'];
  let pfId = 1;
  let tmId = 1;
  let rbId = 1;
  for (const periodo of periodos) {
    for (const contratoId of contratos) {
      const consumoM3 = Math.floor(rnd() * 30) + 10;
      // Mismo cálculo que `calcularTarifa`: si el seed usara una fórmula propia,
      // el primer ajuste "movería" el importe sin que cambie el consumo.
      const tipoServicio = initialContratos.find(c => c.id === contratoId)?.tipoServicio ?? 'Doméstico';
      const { subtotal, total } = calcularTarifaCon(initialTarifas, tipoServicio, consumoM3);
      const estado: PreFacturaEstado = pfId % 3 === 0 ? 'Pendiente' : (pfId % 3 === 1 ? 'Validada' : 'Aceptada');
      const pf = {
        id: `PF${String(pfId).padStart(3, '0')}`,
        contratoId,
        periodo,
        consumoM3,
        subtotal,
        descuento: 0,
        total,
        estado,
      };
      preFacturas.push(pf);
      if (estado === 'Aceptada') {
        const tId = `TM${String(tmId).padStart(3, '0')}`;
        const uuid = `UUID-${Date.now()}-${tmId}`;
        timbrados.push({
          id: tId,
          preFacturaId: pf.id,
          contratoId,
          uuid,
          estado: 'Timbrada OK',
          fecha: `${periodo}-28`,
        });
        const nextMonth = (Number(periodo.slice(5)) % 12) + 1;
        const nextYear = nextMonth === 1 ? Number(periodo.slice(0, 4)) + 1 : Number(periodo.slice(0, 4));
        recibos.push({
          id: `RB${String(rbId).padStart(3, '0')}`,
          timbradoId: tId,
          contratoId,
          saldoVigente: total,
          saldoVencido: rbId % 3 === 0 ? Math.floor(total * 0.3) : 0,
          parcialidades: 0,
          fechaVencimiento: `${nextYear}-${String(nextMonth).padStart(2, '0')}-15`,
          impreso: rbId % 2 === 0,
        });
        tmId++;
        rbId++;
      }
      pfId++;
    }
  }
  return { preFacturas, timbrados, recibos };
}
const seedFacturas = generateSeedFacturas();
const initialPreFacturas: PreFactura[] = seedFacturas.preFacturas;
const initialTimbrados: Timbrado[] = seedFacturas.timbrados;
const initialRecibos: Recibo[] = seedFacturas.recibos;

const initialPagosParcialidad: PagoParcialidad[] = [
  { id: 'PP001', contratoId: 'CT001', numero: 1, monto: 150, fechaVencimiento: '2025-03-15', estado: 'Pendiente' },
  { id: 'PP002', contratoId: 'CT001', numero: 2, monto: 150, fechaVencimiento: '2025-04-15', estado: 'Pendiente' },
  { id: 'PP003', contratoId: 'CT001', numero: 3, monto: 150, fechaVencimiento: '2025-05-15', estado: 'Pendiente' },
  { id: 'PP004', contratoId: 'CT002', numero: 1, monto: 200, fechaVencimiento: '2025-03-20', estado: 'Pagado' },
  { id: 'PP005', contratoId: 'CT002', numero: 2, monto: 200, fechaVencimiento: '2025-04-20', estado: 'Pendiente' },
];

const initialPagosExternos: PagoExterno[] = [
  { id: 'EX001', referencia: 'REF-OXXO-2025-001', monto: 450, fecha: '2025-02-10', tipo: 'OXXO', estado: 'pendiente_conciliar', contratoIdSugerido: 'CT001', concepto: 'Pago OXXO' },
  { id: 'EX002', referencia: 'REF-SPEI-2025-002', monto: 320, fecha: '2025-02-11', tipo: 'SPEI', estado: 'pendiente_conciliar', contratoIdSugerido: 'CT002', concepto: 'Transferencia' },
  { id: 'EX003', referencia: 'REF-WEB-2025-003', monto: 180, fecha: '2025-02-12', tipo: 'WEB', estado: 'pendiente_conciliar', concepto: 'Pago web sin asignar' },
  { id: 'EX004', referencia: 'REF-CODI-2025-004', monto: 275, fecha: '2025-02-13', tipo: 'CODI', estado: 'conciliado', contratoIdSugerido: 'CT003' },
];

const initialPagos: Pago[] = [
  { id: 'P001', contratoId: 'CT001', monto: 172.00, fecha: '2025-01-30', tipo: 'Efectivo', concepto: 'Pago servicio enero 2025', origen: 'nativo' },
  { id: 'P002', contratoId: 'CT001', monto: 250, fecha: '2025-02-05', tipo: 'Link de pago', concepto: 'Pago en línea', origen: 'nativo' },
];

const initialTramitesAsignados: TramiteAsignado[] = [
  { id: 'TR001', contratoId: 'CT001', tipo: 'Domiciliación', estado: 'Completado', fechaAsignacion: '2024-06-01', observaciones: 'Cuenta vinculada' },
  { id: 'TR002', contratoId: 'CT001', tipo: 'Cláusulas del contrato', estado: 'Completado', fechaAsignacion: '2024-06-01' },
  { id: 'TR003', contratoId: 'CT001', tipo: 'Estatus de servicio', estado: 'Completado', fechaAsignacion: '2025-01-25' },
  { id: 'TR004', contratoId: 'CT002', tipo: 'Domiciliación', estado: 'Pendiente', fechaAsignacion: '2025-01-26' },
  { id: 'TR005', contratoId: 'CT002', tipo: 'Cláusulas del contrato', estado: 'Completado', fechaAsignacion: '2025-01-26' },
  { id: 'TR006', contratoId: 'CT003', tipo: 'Domiciliación', estado: 'En trámite', fechaAsignacion: '2025-02-01', fechaVencimiento: '2025-03-01' },
];

const initialClausulasContrato: ClausulaContrato[] = [
  { id: 'CL001', contratoId: 'CT001', orden: 1, titulo: 'Objeto del contrato', texto: 'El presente contrato tiene por objeto la prestación del servicio de agua potable y saneamiento en los términos establecidos por la normativa vigente.' },
  { id: 'CL002', contratoId: 'CT001', orden: 2, titulo: 'Obligaciones del usuario', texto: 'El usuario se obliga al pago puntual de las tarifas y al uso responsable del servicio. Cualquier alteración no autorizada del medidor dará lugar a la aplicación de sanciones.' },
  { id: 'CL003', contratoId: 'CT001', orden: 3, titulo: 'Suspensión del servicio', texto: 'El organismo podrá suspender el servicio por falta de pago, después del periodo de gracia establecido, sin perjuicio del cobro de adeudos y recargos.' },
  { id: 'CL004', contratoId: 'CT002', orden: 1, titulo: 'Objeto del contrato', texto: 'Prestación del servicio de agua potable conforme a la normativa vigente.' },
  { id: 'CL005', contratoId: 'CT003', orden: 1, titulo: 'Objeto del contrato', texto: 'Servicio comercial de agua y saneamiento bajo tarifa industrial.' },
];

interface DataContextType {
  factibilidades: Factibilidad[];
  construcciones: Construccion[];
  tomas: Toma[];
  contratos: Contrato[];
  medidores: Medidor[];
  rutas: Ruta[];
  lecturas: Lectura[];
  consumos: Consumo[];
  tarifas: Tarifa[];
  descuentos: Descuento[];
  preFacturas: PreFactura[];
  timbrados: Timbrado[];
  recibos: Recibo[];
  pagos: Pago[];
  tramitesAsignados: TramiteAsignado[];
  clausulasContrato: ClausulaContrato[];
  costosContrato: CostoContrato[];
  convenios: Convenio[];
  addConvenio: (c: Omit<Convenio, 'id'>) => void;
  updateConvenio: (id: string, updates: Partial<Convenio>) => void;
  quejasAclaraciones: QuejaAclaracion[];
  addQuejaAclaracion: (q: Omit<QuejaAclaracion, 'id'>) => void;
  updateQuejaAclaracion: (id: string, updates: Partial<QuejaAclaracion>) => void;
  addSeguimientoQueja: (quejaId: string, s: Omit<SeguimientoQueja, 'id' | 'quejaId'>) => void;
  administraciones: Administracion[];
  zonas: Zona[];
  distritos: Distrito[];
  medidoresBodega: MedidorBodega[];
  currentUser: CurrentUser | null;
  setCurrentUser: (u: CurrentUser | null) => void;
  allowedZonaIds: string[] | null;
  /** Mensaje global para recibos de impresión (antes de enviar a timbrar) */
  mensajeGlobalRecibos: string;
  setMensajeGlobalRecibos: (msg: string) => void;
  pagosParcialidad: PagoParcialidad[];
  addPagoParcialidad: (p: Omit<PagoParcialidad, 'id'>) => void;
  updatePagoParcialidad: (id: string, updates: Partial<PagoParcialidad>) => void;
  pagosExternos: PagoExterno[];
  addPagoExterno: (p: Omit<PagoExterno, 'id'>) => void;
  updatePagoExterno: (id: string, updates: Partial<PagoExterno>) => void;
  conciliarPagoExterno: (id: string, contratoId: string) => void;
  // Actions
  addFactibilidad: (f: Omit<Factibilidad, 'id'>) => void;
  updateFactibilidad: (id: string, updates: Partial<Factibilidad>) => void;
  addConstruccion: (c: Omit<Construccion, 'id'>) => void;
  updateConstruccion: (id: string, updates: Partial<Construccion>) => void;
  addToma: (t: Omit<Toma, 'id'>) => void;
  updateToma: (id: string, updates: Partial<Toma>) => void;
  addContrato: (c: Omit<Contrato, 'id'>) => void;
  updateContrato: (id: string, updates: Partial<Contrato>) => void;
  addMedidor: (m: Omit<Medidor, 'id'>) => void;
  updateMedidor: (id: string, updates: Partial<Medidor>) => void;
  addMedidorBodega: (m: Omit<MedidorBodega, 'id'>) => void;
  updateMedidorBodega: (id: string, updates: Partial<MedidorBodega>) => void;
  removeMedidorBodega: (id: string) => void;
  assignMedidorFromBodega: (medidorBodegaId: string, contratoId: string, lecturaInicial: number, zonaId: string) => void;
  addRuta: (r: Omit<Ruta, 'id'>) => void;
  updateRuta: (id: string, updates: Partial<Ruta>) => void;
  moveContratoToRuta: (contratoId: string, rutaId: string | null) => void;
  addLectura: (l: Omit<Lectura, 'id'>) => void;
  updateLectura: (id: string, updates: Partial<Lectura>) => void;
  addConsumo: (c: Omit<Consumo, 'id'>) => void;
  updateConsumo: (id: string, updates: Partial<Consumo>) => void;
  addPreFactura: (p: Omit<PreFactura, 'id'>) => void;
  updatePreFactura: (id: string, updates: Partial<PreFactura>) => void;
  addTimbrado: (t: Omit<Timbrado, 'id'>) => void;
  updateTimbrado: (id: string, updates: Partial<Timbrado>) => void;
  addRecibo: (r: Omit<Recibo, 'id'>) => void;
  updateRecibo: (id: string, updates: Partial<Recibo>) => void;
  addPago: (p: Omit<Pago, 'id'>) => void;
  addAdministracion: (a: Omit<Administracion, 'id'>) => void;
  updateAdministracion: (id: string, updates: Partial<Administracion>) => void;
  addZona: (z: Omit<Zona, 'id'>) => void;
  updateZona: (id: string, updates: Partial<Zona>) => void;
  addDistrito: (d: Omit<Distrito, 'id'>) => void;
  updateDistrito: (id: string, updates: Partial<Distrito>) => void;
  calcularTarifa: (tipoServicio: string, m3: number) => { subtotal: number; cargoFijo: number; total: number };
  /**
   * Aplica un ajuste a una prefactura según el tipo de ajuste (algoritmo por tipo).
   * Devuelve el registro de kardex resultante (única fuente de verdad de los
   * importes antes/después) o `null` si el ajuste no procede.
   */
  aplicarAjusteFactura: (params: AjusteFacturaParams) => AjusteFacturaRegistro | null;
  /** Kardex de ajustes aplicados a prefacturas */
  ajustesFactura: AjusteFacturaRegistro[];
}

const DataContext = createContext<DataContextType | undefined>(undefined);

let counter = 100;
const genId = (prefix: string) => `${prefix}${String(++counter).padStart(3, '0')}`;

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const [factibilidades, setFactibilidades] = useState(initialFactibilidades);
  const [construcciones, setConstrucciones] = useState(initialConstrucciones);
  const [tomas, setTomas] = useState(initialTomas);
  const [contratos, setContratos] = useState(initialContratos);
  const [medidores, setMedidores] = useState(initialMedidores);
  const [medidoresBodega, setMedidoresBodega] = useState(initialMedidoresBodega);
  const [rutas, setRutas] = useState(initialRutas);
  const [lecturas, setLecturas] = useState(initialLecturas);
  const [consumos, setConsumos] = useState(initialConsumos);
  const [tarifas] = useState(initialTarifas);
  const [descuentos] = useState(initialDescuentos);
  const [preFacturas, setPreFacturas] = useState(initialPreFacturas);
  const [ajustesFactura, setAjustesFactura] = useState<AjusteFacturaRegistro[]>([]);
  const [timbrados, setTimbrados] = useState(initialTimbrados);
  const [recibos, setRecibos] = useState(initialRecibos);
  const [pagos, setPagos] = useState(initialPagos);
  const [administraciones, setAdministraciones] = useState(initialAdministraciones);
  const [zonas, setZonas] = useState(initialZonas);
  const [distritos, setDistritos] = useState(initialDistritos);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  /** Solo aplica filtro por zona cuando hay al menos una zona; `[]` no debe ocultar todo el catálogo. */
  const allowedZonaIds =
    currentUser?.zonaIds != null && currentUser.zonaIds.length > 0
      ? currentUser.zonaIds
      : null;
  const [mensajeGlobalRecibos, setMensajeGlobalRecibos] = useState('');
  const [pagosParcialidad, setPagosParcialidad] = useState(initialPagosParcialidad);
  const [pagosExternos, setPagosExternos] = useState(initialPagosExternos);
  const [tramitesAsignados] = useState(initialTramitesAsignados);
  const [clausulasContrato] = useState(initialClausulasContrato);
  const [costosContrato] = useState(initialCostosContrato);
  const [convenios, setConvenios] = useState(initialConvenios);
  const addConvenio = (c: Omit<Convenio, 'id'>) => setConvenios(prev => [...prev, { ...c, id: genId('CONV') }]);
  const updateConvenio = (id: string, updates: Partial<Convenio>) => setConvenios(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  const [quejasAclaraciones, setQuejasAclaraciones] = useState(initialQuejasAclaraciones);
  const addQuejaAclaracion = (q: Omit<QuejaAclaracion, 'id'>) =>
    setQuejasAclaraciones(prev => [...prev, { ...q, id: genId('QA'), seguimientos: q.seguimientos ?? [] }]);
  const updateQuejaAclaracion = (id: string, updates: Partial<QuejaAclaracion>) =>
    setQuejasAclaraciones(prev => prev.map(q => q.id === id ? { ...q, ...updates } : q));
  const addSeguimientoQueja = (quejaId: string, s: Omit<SeguimientoQueja, 'id' | 'quejaId'>) =>
    setQuejasAclaraciones(prev => prev.map(q =>
      q.id === quejaId
        ? { ...q, seguimientos: [...(q.seguimientos ?? []), { ...s, id: genId('SQ'), quejaId }] }
        : q
    ));

  const addFactibilidad = (f: Omit<Factibilidad, 'id'>) => setFactibilidades(prev => [...prev, { ...f, id: genId('F') }]);
  const updateFactibilidad = (id: string, updates: Partial<Factibilidad>) => setFactibilidades(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));

  const addConstruccion = (c: Omit<Construccion, 'id'>) => setConstrucciones(prev => [...prev, { ...c, id: genId('C') }]);
  const updateConstruccion = (id: string, updates: Partial<Construccion>) => setConstrucciones(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));

  const addToma = (t: Omit<Toma, 'id'>) => setTomas(prev => [...prev, { ...t, id: genId('T') }]);
  const updateToma = (id: string, updates: Partial<Toma>) => setTomas(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));

  const addContrato = (c: Omit<Contrato, 'id'>) => {
    const id = genId('CT');
    setContratos(prev => [...prev, { ...c, id }]);
    if (c.tomaId) updateToma(c.tomaId, { estado: 'Asignada' });
  };
  const updateContrato = (id: string, updates: Partial<Contrato>) => setContratos(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));

  const addMedidor = (m: Omit<Medidor, 'id'>) => {
    const id = genId('M');
    setMedidores(prev => [...prev, { ...m, id }]);
    updateContrato(m.contratoId, { estado: 'Activo', medidorId: id });
  };
  const updateMedidor = (id: string, updates: Partial<Medidor>) => setMedidores(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));

  const addMedidorBodega = (m: Omit<MedidorBodega, 'id'>) => setMedidoresBodega(prev => [...prev, { ...m, id: genId('MB') }]);
  const updateMedidorBodega = (id: string, updates: Partial<MedidorBodega>) => setMedidoresBodega(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  const removeMedidorBodega = (id: string) => setMedidoresBodega(prev => prev.filter(m => m.id !== id));
  const assignMedidorFromBodega = (medidorBodegaId: string, contratoId: string, lecturaInicial: number, zonaId: string) => {
    const mb = medidoresBodega.find(m => m.id === medidorBodegaId);
    if (!mb || mb.estado !== 'Disponible') return;
    addMedidor({ contratoId, serie: mb.serie, estado: 'Activo', cobroDiferido: false, lecturaInicial });
    updateContrato(contratoId, { zonaId });
    removeMedidorBodega(medidorBodegaId);
  };

  const addRuta = (r: Omit<Ruta, 'id'>) => {
    const id = genId('R');
    setRutas(prev => [...prev, { ...r, id }]);
    const zonaId = r.zonaId;
    r.contratoIds.forEach(cid => updateContrato(cid, { rutaId: id, zonaId }));
  };
  const updateRuta = (id: string, updates: Partial<Ruta>) => setRutas(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));

  const moveContratoToRuta = (contratoId: string, rutaId: string | null) => {
    const contrato = contratos.find(c => c.id === contratoId);
    if (!contrato) return;
    const prevRutaId = contrato.rutaId;
    // Una sola actualización de rutas: quitar de la anterior y añadir a la nueva (evita duplicados por batching)
    setRutas(prev =>
      prev.map(r => {
        if (prevRutaId && r.id === prevRutaId)
          return { ...r, contratoIds: r.contratoIds.filter(cid => cid !== contratoId) };
        if (rutaId && r.id === rutaId)
          return { ...r, contratoIds: r.contratoIds.includes(contratoId) ? r.contratoIds : [...r.contratoIds, contratoId] };
        return r;
      })
    );
    if (rutaId) {
      const ruta = rutas.find(r => r.id === rutaId);
      if (ruta) updateContrato(contratoId, { rutaId, zonaId: ruta.zonaId });
    } else {
      updateContrato(contratoId, { rutaId: undefined, zonaId: undefined });
    }
  };

  const addAdministracion = (a: Omit<Administracion, 'id'>) => setAdministraciones(prev => [...prev, { ...a, id: genId('ADM') }]);
  const updateAdministracion = (id: string, updates: Partial<Administracion>) => setAdministraciones(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  const addZona = (z: Omit<Zona, 'id'>) => setZonas(prev => [...prev, { ...z, id: genId('Z') }]);
  const updateZona = (id: string, updates: Partial<Zona>) => setZonas(prev => prev.map(z => z.id === id ? { ...z, ...updates } : z));
  const addDistrito = (d: Omit<Distrito, 'id'>) => setDistritos(prev => [...prev, { ...d, id: genId('DIST') }]);
  const updateDistrito = (id: string, updates: Partial<Distrito>) => setDistritos(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));

  const addLectura = (l: Omit<Lectura, 'id'>) => setLecturas(prev => [...prev, { ...l, id: genId('L') }]);
  const updateLectura = (id: string, updates: Partial<Lectura>) => setLecturas(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));

  const addConsumo = (c: Omit<Consumo, 'id'>) => setConsumos(prev => [...prev, { ...c, id: genId('CO') }]);
  const updateConsumo = (id: string, updates: Partial<Consumo>) => setConsumos(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));

  const addPreFactura = (p: Omit<PreFactura, 'id'>) => setPreFacturas(prev => [...prev, { ...p, id: genId('PF') }]);
  const updatePreFactura = (id: string, updates: Partial<PreFactura>) => setPreFacturas(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));

  const addTimbrado = (t: Omit<Timbrado, 'id'>) => setTimbrados(prev => [...prev, { ...t, id: genId('TM') }]);
  const updateTimbrado = (id: string, updates: Partial<Timbrado>) => setTimbrados(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));

  const addRecibo = (r: Omit<Recibo, 'id'>) => setRecibos(prev => [...prev, { ...r, id: genId('RB') }]);
  const updateRecibo = (id: string, updates: Partial<Recibo>) => setRecibos(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));

  const addPagoParcialidad = (p: Omit<PagoParcialidad, 'id'>) => setPagosParcialidad(prev => [...prev, { ...p, id: genId('PP') }]);
  const updatePagoParcialidad = (id: string, updates: Partial<PagoParcialidad>) => setPagosParcialidad(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));

  const addPago = (p: Omit<Pago, 'id'>) => setPagos(prev => [...prev, { ...p, id: genId('P'), origen: p.origen ?? 'nativo' }]);
  const addPagoExterno = (p: Omit<PagoExterno, 'id'>) => setPagosExternos(prev => [...prev, { ...p, id: genId('EX') }]);
  const updatePagoExterno = (id: string, updates: Partial<PagoExterno>) => setPagosExternos(prev => prev.map(pe => pe.id === id ? { ...pe, ...updates } : pe));
  const conciliarPagoExterno = (id: string, contratoId: string) => {
    const pe = pagosExternos.find(x => x.id === id);
    if (!pe || pe.estado === 'conciliado') return;
    addPago({ contratoId, monto: pe.monto, fecha: pe.fecha, tipo: pe.tipo, concepto: pe.concepto || `Conciliado ${pe.referencia}`, origen: 'externo' });
    updatePagoExterno(id, { estado: 'conciliado', contratoIdSugerido: contratoId });
  };

  const calcularTarifa = (tipoServicio: string, m3: number) => calcularTarifaCon(tarifas, tipoServicio, m3);

  const aplicarAjusteFactura = (params: AjusteFacturaParams): AjusteFacturaRegistro | null => {
    const pf = preFacturas.find(p => p.id === params.preFacturaId);
    if (!pf) return null;
    const contrato = contratos.find(c => c.id === pf.contratoId);
    if (!contrato) return null;
    const tipo = params.tipoAjusteId;
    const meta = TIPOS_AJUSTE_FACTURACION.find(t => t.id === tipo);
    /** Agrega la entrada de kardex del ajuste aplicado y la devuelve */
    const registrarAjuste = (
      cambios: Pick<AjusteFacturaRegistro, 'totalAnterior' | 'totalNuevo'> & Partial<AjusteFacturaRegistro>
    ): AjusteFacturaRegistro => {
      const registro: AjusteFacturaRegistro = {
        id: genId('AJF'),
        preFacturaId: params.preFacturaId,
        tipoAjusteId: tipo,
        tipoLabel: meta?.label ?? tipo,
        area: meta?.area ?? '',
        observacion: params.observacion,
        fecha: new Date().toISOString(),
        ...cambios,
      };
      setAjustesFactura(prev => [...prev, registro]);
      return registro;
    };
    if (tipo === 'actualizacion_datos' || tipo === 'correccion_lectura') {
      if (params.consumoM3 != null) {
        const { subtotal, cargoFijo, total } = calcularTarifa(contrato.tipoServicio, params.consumoM3);
        const nuevoTotal = Math.max(0, subtotal + cargoFijo - pf.descuento);
        setPreFacturas(prev =>
          prev.map(p =>
            p.id === params.preFacturaId
              ? { ...p, consumoM3: params.consumoM3!, subtotal, total: nuevoTotal, descuento: p.descuento }
              : p
          )
        );
        return registrarAjuste({
          consumoAnterior: pf.consumoM3,
          consumoNuevo: params.consumoM3,
          totalAnterior: pf.total,
          totalNuevo: nuevoTotal,
        });
      }
    }
    if (tipo === 'deuda' || tipo === 'juridica' || tipo === 'convenio' || tipo === 'atencion_publico') {
      // El descuento no puede exceder el saldo: acumular el solicitado y topar el
      // total en 0 por separado dejaba `descuento` describiendo una rebaja que
      // nunca se aplicó, y el siguiente ajuste de consumo la volvía a restar.
      const solicitado = Math.max(0, params.descuentoAdicional ?? 0);
      const descuentoAplicado = Math.min(solicitado, pf.total);
      const nuevoDescuento = pf.descuento + descuentoAplicado;
      const nuevoTotal = pf.total - descuentoAplicado;
      setPreFacturas(prev =>
        prev.map(p =>
          p.id === params.preFacturaId ? { ...p, descuento: nuevoDescuento, total: nuevoTotal } : p
        )
      );
      return registrarAjuste({
        descuentoAplicado,
        totalAnterior: pf.total,
        totalNuevo: nuevoTotal,
      });
    }
    if (tipo === 'corte_reconexion') {
      // Solo registro; no cambia importes por defecto
      return registrarAjuste({ totalAnterior: pf.total, totalNuevo: pf.total });
    }
    return null;
  };

  return (
    <DataContext.Provider value={{
      factibilidades, construcciones, tomas, contratos, medidores, rutas, lecturas, consumos, tarifas, descuentos, preFacturas, timbrados, recibos, pagos,
      tramitesAsignados, clausulasContrato, costosContrato, convenios, addConvenio, updateConvenio,
      quejasAclaraciones, addQuejaAclaracion, updateQuejaAclaracion, addSeguimientoQueja,
      administraciones, zonas, distritos,
      currentUser, setCurrentUser, allowedZonaIds, mensajeGlobalRecibos, setMensajeGlobalRecibos,
      pagosParcialidad, addPagoParcialidad, updatePagoParcialidad,
      pagosExternos, addPagoExterno, updatePagoExterno, conciliarPagoExterno,
      medidoresBodega, addMedidorBodega, updateMedidorBodega, removeMedidorBodega, assignMedidorFromBodega,
      addFactibilidad, updateFactibilidad, addConstruccion, updateConstruccion, addToma, updateToma,
      addContrato, updateContrato, addMedidor, updateMedidor, addRuta, updateRuta, moveContratoToRuta,
      addLectura, updateLectura, addConsumo, updateConsumo, addPreFactura, updatePreFactura,
      addTimbrado, updateTimbrado, addRecibo, updateRecibo, addPago, calcularTarifa,
      aplicarAjusteFactura, ajustesFactura,
      addAdministracion, updateAdministracion, addZona, updateZona, addDistrito, updateDistrito,
    }}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
};
