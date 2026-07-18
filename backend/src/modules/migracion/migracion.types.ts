/**
 * Layouts de los archivos de exportación de Aquasis (CIS incumbente de TDS)
 * usados por el toolkit de migración hacia Hydra.
 *
 * IMPORTANTE — los nombres de columna aquí definidos son el layout "canónico"
 * que espera el toolkit. Como no existe un layout oficial publicado de Aquasis
 * (cada organismo exporta con variantes menores), cada columna admite ALIAS:
 * si el archivo del organismo trae otro encabezado, basta con agregarlo al
 * arreglo `alias` de la columna correspondiente en LAYOUTS_AQUASIS. Los
 * encabezados se normalizan (mayúsculas, sin acentos, espacios → "_") antes
 * de comparar, por lo que "Núm. Contrato", "NUM CONTRATO" y "num_contrato"
 * mapean igual.
 */

export type TipoArchivoMigracion =
  | 'padron' // padrón de tomas/contratos (archivo maestro)
  | 'personas' // titulares y personas relacionadas a cada contrato
  | 'medidores' // parque de medidores instalados
  | 'saldos' // saldos/adeudos vivos por documento al corte
  | 'pagos'; // histórico de pagos (típicamente 12-24 meses)

export const TIPOS_ARCHIVO_MIGRACION: TipoArchivoMigracion[] = [
  'padron',
  'personas',
  'medidores',
  'saldos',
  'pagos',
];

/** Marca con la que se identifica todo registro creado por la migración. */
export const SERIE_MIGRACION = 'MIG-AQS';
export const PREFIJO_CONCEPTO_PAGO_MIGRADO = 'Migración Aquasis';
export const PREFIJO_PUNTO_SERVICIO_MIGRADO = 'AQS-';

export type TipoDatoColumna = 'texto' | 'entero' | 'decimal' | 'fecha';

export interface ColumnaEsperada {
  /** Nombre canónico normalizado del encabezado. */
  nombre: string;
  /** Encabezados alternativos aceptados (ajustables por organismo). */
  alias?: string[];
  /** La columna debe existir en el archivo para poder importar. */
  requerida: boolean;
  /** El valor de la celda no puede venir vacío (solo aplica si la columna existe). */
  valorObligatorio?: boolean;
  tipo: TipoDatoColumna;
  descripcion: string;
}

export interface LayoutArchivo {
  descripcion: string;
  /** Columna que actúa como clave natural para el upsert idempotente. */
  claveNatural: string;
  columnas: ColumnaEsperada[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Layouts por tipo de archivo
// ─────────────────────────────────────────────────────────────────────────────

export const LAYOUTS_AQUASIS: Record<TipoArchivoMigracion, LayoutArchivo> = {
  // Padrón de tomas/contratos — el archivo maestro de la migración.
  // En Aquasis es la unión Contrato + Toma + Dirección del punto de suministro.
  padron: {
    descripcion: 'Padrón de tomas/contratos Aquasis (archivo maestro)',
    claveNatural: 'NUM_CONTRATO',
    columnas: [
      { nombre: 'NUM_CONTRATO', alias: ['CONTRATO', 'NO_CONTRATO', 'CUENTA', 'NUM_CUENTA'], requerida: true, valorObligatorio: true, tipo: 'texto', descripcion: 'Número de contrato/cuenta Aquasis → Contrato.ceaNumContrato' },
      { nombre: 'NOMBRE', alias: ['NOMBRE_TITULAR', 'TITULAR'], requerida: true, valorObligatorio: true, tipo: 'texto', descripcion: 'Nombre completo del titular → Contrato.nombre' },
      { nombre: 'RFC', alias: ['RFC_TITULAR'], requerida: false, tipo: 'texto', descripcion: 'RFC del titular → Contrato.rfc (XAXX010101000 si viene vacío)' },
      { nombre: 'TIPO_SERVICIO', alias: ['SERVICIO', 'USO', 'GIRO'], requerida: true, valorObligatorio: true, tipo: 'texto', descripcion: 'Uso/giro de la toma (Doméstico, Comercial, Industrial…) → Contrato.tipoServicio' },
      { nombre: 'TARIFA', alias: ['CLAVE_TARIFA', 'TIPO_TARIFA'], requerida: false, tipo: 'texto', descripcion: 'Clave de tarifa Aquasis → Contrato.tipoContrato (referencial hasta homologar tarifas)' },
      { nombre: 'ESTADO_TOMA', alias: ['ESTATUS', 'ESTADO', 'SITUACION'], requerida: false, tipo: 'texto', descripcion: 'Estatus de la toma (Activo, Cortado, Baja…) → Contrato.estado' },
      { nombre: 'FECHA_ALTA', alias: ['FECHA_CONTRATO', 'FECHA_INSTALACION'], requerida: false, tipo: 'fecha', descripcion: 'Fecha de alta del contrato → Contrato.fecha' },
      { nombre: 'CALLE', alias: ['DIRECCION', 'DOMICILIO'], requerida: true, valorObligatorio: true, tipo: 'texto', descripcion: 'Calle del predio → Domicilio.calle' },
      { nombre: 'NUM_EXTERIOR', alias: ['NO_EXT', 'NUM_EXT', 'NUMERO'], requerida: false, tipo: 'texto', descripcion: 'Número exterior → Domicilio.numExterior' },
      { nombre: 'NUM_INTERIOR', alias: ['NO_INT', 'NUM_INT'], requerida: false, tipo: 'texto', descripcion: 'Número interior → Domicilio.numInterior' },
      { nombre: 'POBID', alias: ['POBLACION_ID', 'ID_POBLACION', 'CLAVE_POBLACION'], requerida: true, valorObligatorio: true, tipo: 'entero', descripcion: 'ID de población Aquasis → CatalogoLocalidadINEGI.aquasisPobid' },
      { nombre: 'BARRID', alias: ['COLONIA_ID', 'ID_COLONIA', 'BARRIO_ID', 'CLAVE_COLONIA'], requerida: true, valorObligatorio: true, tipo: 'entero', descripcion: 'ID de colonia/barrio Aquasis → CatalogoColoniaINEGI.aquasisBarrId' },
      { nombre: 'CODIGO_POSTAL', alias: ['CP'], requerida: false, tipo: 'texto', descripcion: 'Código postal → Domicilio.codigoPostal' },
      { nombre: 'GPS_LAT', alias: ['LATITUD', 'LAT'], requerida: false, tipo: 'decimal', descripcion: 'Latitud del predio → Domicilio.gpsLat' },
      { nombre: 'GPS_LNG', alias: ['LONGITUD', 'LNG', 'LON'], requerida: false, tipo: 'decimal', descripcion: 'Longitud del predio → Domicilio.gpsLng' },
      { nombre: 'TELEFONO', alias: ['TEL', 'CELULAR'], requerida: false, tipo: 'texto', descripcion: 'Teléfono de contacto → Contrato.contacto' },
      { nombre: 'EMAIL', alias: ['CORREO', 'CORREO_ELECTRONICO'], requerida: false, tipo: 'texto', descripcion: 'Correo de contacto → Contrato.contacto (si no hay teléfono)' },
      { nombre: 'UNIDADES_SERVIDAS', alias: ['UNIDADES', 'NUM_UNIDADES'], requerida: false, tipo: 'entero', descripcion: 'Unidades servidas por la toma → Contrato.unidadesServidas' },
      { nombre: 'OBSERVACIONES', alias: ['NOTAS', 'COMENTARIOS'], requerida: false, tipo: 'texto', descripcion: 'Notas libres de la toma → Contrato.observaciones' },
    ],
  },

  // Personas/titulares — en Aquasis la relación persona↔contrato con su rol.
  personas: {
    descripcion: 'Personas y titulares relacionados a contratos Aquasis',
    claveNatural: 'NUM_CONTRATO',
    columnas: [
      { nombre: 'NUM_CONTRATO', alias: ['CONTRATO', 'NO_CONTRATO', 'CUENTA'], requerida: true, valorObligatorio: true, tipo: 'texto', descripcion: 'Contrato Aquasis al que se asocia la persona' },
      { nombre: 'NOMBRE', alias: ['NOMBRES'], requerida: true, valorObligatorio: true, tipo: 'texto', descripcion: 'Nombre(s) → Persona.nombre' },
      { nombre: 'APELLIDO_PATERNO', alias: ['PATERNO', 'AP_PATERNO'], requerida: false, tipo: 'texto', descripcion: 'Apellido paterno → Persona.apellidoPaterno' },
      { nombre: 'APELLIDO_MATERNO', alias: ['MATERNO', 'AP_MATERNO'], requerida: false, tipo: 'texto', descripcion: 'Apellido materno → Persona.apellidoMaterno' },
      { nombre: 'RFC', requerida: false, tipo: 'texto', descripcion: 'RFC → Persona.rfc (también clave de deduplicación si es válido y no genérico)' },
      { nombre: 'CURP', requerida: false, tipo: 'texto', descripcion: 'CURP → Persona.curp' },
      { nombre: 'TIPO_PERSONA', alias: ['TIPO'], requerida: false, tipo: 'texto', descripcion: 'Física/Moral → Persona.tipo (default Física)' },
      { nombre: 'RAZON_SOCIAL', requerida: false, tipo: 'texto', descripcion: 'Razón social (personas morales) → Persona.razonSocial' },
      { nombre: 'EMAIL', alias: ['CORREO'], requerida: false, tipo: 'texto', descripcion: 'Correo → Persona.email' },
      { nombre: 'TELEFONO', alias: ['TEL'], requerida: false, tipo: 'texto', descripcion: 'Teléfono → Persona.telefono' },
      { nombre: 'ROL', alias: ['TIPO_RELACION', 'RELACION'], requerida: false, tipo: 'texto', descripcion: 'Rol respecto al contrato (PROPIETARIO/FISCAL/CONTACTO) → RolPersonaContrato.rol (default PROPIETARIO)' },
    ],
  },

  // Medidores instalados — en Aquasis el aparato ligado a la toma.
  medidores: {
    descripcion: 'Parque de medidores instalados Aquasis',
    claveNatural: 'SERIE',
    columnas: [
      { nombre: 'NUM_CONTRATO', alias: ['CONTRATO', 'NO_CONTRATO', 'CUENTA'], requerida: true, valorObligatorio: true, tipo: 'texto', descripcion: 'Contrato Aquasis dueño del medidor (Medidor↔Contrato es 1:1 en Hydra)' },
      { nombre: 'SERIE', alias: ['NO_SERIE', 'NUMERO_SERIE', 'SERIE_MEDIDOR'], requerida: true, valorObligatorio: true, tipo: 'texto', descripcion: 'Serie del aparato → Medidor.serie' },
      { nombre: 'MARCA', requerida: false, tipo: 'texto', descripcion: 'Marca (texto libre; la homologación a CatalogoMarcaMedidor es un paso posterior)' },
      { nombre: 'MODELO', requerida: false, tipo: 'texto', descripcion: 'Modelo (texto libre; homologación posterior)' },
      { nombre: 'DIGITOS', alias: ['NUM_DIGITOS'], requerida: false, tipo: 'entero', descripcion: 'Dígitos de la carátula → Medidor.digitos' },
      { nombre: 'LECTURA_ACTUAL', alias: ['ULTIMA_LECTURA', 'LECTURA'], requerida: false, tipo: 'entero', descripcion: 'Última lectura conocida → Medidor.lecturaInicial (punto de partida en Hydra)' },
      { nombre: 'FECHA_INSTALACION', alias: ['FECHA_INST'], requerida: false, tipo: 'fecha', descripcion: 'Fecha de instalación → Medidor.fechaInstalacion' },
      { nombre: 'ESTADO', alias: ['ESTATUS', 'SITUACION'], requerida: false, tipo: 'texto', descripcion: 'Estado del aparato → Medidor.estado (default Instalado)' },
    ],
  },

  // Saldos/adeudos al corte — cada fila es un documento de adeudo vivo.
  saldos: {
    descripcion: 'Saldos y adeudos vivos por documento al corte de migración',
    claveNatural: 'DOCUMENTO',
    columnas: [
      { nombre: 'NUM_CONTRATO', alias: ['CONTRATO', 'NO_CONTRATO', 'CUENTA'], requerida: true, valorObligatorio: true, tipo: 'texto', descripcion: 'Contrato Aquasis del adeudo' },
      { nombre: 'DOCUMENTO', alias: ['FOLIO', 'NO_DOCUMENTO', 'FOLIO_DOCUMENTO', 'REFERENCIA'], requerida: true, valorObligatorio: true, tipo: 'texto', descripcion: 'Folio del documento Aquasis → Timbrado.folio (serie MIG-AQS); clave de idempotencia' },
      { nombre: 'PERIODO', alias: ['PERIODO_FACTURACION', 'MES'], requerida: false, tipo: 'texto', descripcion: 'Periodo facturado (YYYY-MM) → Timbrado.periodo (default MIGRACION)' },
      { nombre: 'SALDO_VIGENTE', alias: ['VIGENTE', 'IMPORTE_VIGENTE'], requerida: false, tipo: 'decimal', descripcion: 'Adeudo no vencido → Recibo.saldoVigente' },
      { nombre: 'SALDO_VENCIDO', alias: ['VENCIDO', 'IMPORTE_VENCIDO', 'REZAGO'], requerida: false, tipo: 'decimal', descripcion: 'Adeudo vencido/rezago → Recibo.saldoVencido' },
      { nombre: 'TOTAL', alias: ['IMPORTE_TOTAL', 'IMPORTE', 'SALDO_TOTAL'], requerida: true, valorObligatorio: true, tipo: 'decimal', descripcion: 'Total del documento → Timbrado.total (si no vienen vigente/vencido, todo se asume vencido)' },
      { nombre: 'IVA', requerida: false, tipo: 'decimal', descripcion: 'IVA del documento → Timbrado.iva (default 0; el agua doméstica es exenta)' },
      { nombre: 'FECHA_EMISION', alias: ['FECHA_DOCUMENTO', 'FECHA'], requerida: false, tipo: 'fecha', descripcion: 'Fecha de emisión → Timbrado.fechaEmision' },
      { nombre: 'FECHA_VENCIMIENTO', alias: ['VENCIMIENTO', 'FECHA_VENC'], requerida: false, tipo: 'fecha', descripcion: 'Fecha de vencimiento → Recibo.fechaVencimiento' },
    ],
  },

  // Histórico de pagos — típicamente los últimos 12-24 meses para consulta.
  pagos: {
    descripcion: 'Histórico de pagos Aquasis',
    claveNatural: 'FOLIO_PAGO',
    columnas: [
      { nombre: 'NUM_CONTRATO', alias: ['CONTRATO', 'NO_CONTRATO', 'CUENTA'], requerida: true, valorObligatorio: true, tipo: 'texto', descripcion: 'Contrato Aquasis que pagó' },
      { nombre: 'FOLIO_PAGO', alias: ['FOLIO', 'NO_RECIBO', 'FOLIO_RECIBO', 'REFERENCIA'], requerida: true, valorObligatorio: true, tipo: 'texto', descripcion: 'Folio del pago en Aquasis; clave de idempotencia (queda en Pago.concepto)' },
      { nombre: 'FECHA_PAGO', alias: ['FECHA'], requerida: true, valorObligatorio: true, tipo: 'fecha', descripcion: 'Fecha del pago → Pago.fecha' },
      { nombre: 'MONTO', alias: ['IMPORTE', 'TOTAL'], requerida: true, valorObligatorio: true, tipo: 'decimal', descripcion: 'Monto pagado → Pago.monto' },
      { nombre: 'FORMA_PAGO', alias: ['TIPO_PAGO', 'MEDIO_PAGO'], requerida: false, tipo: 'texto', descripcion: 'Forma de pago Aquasis → Pago.tipo (default Efectivo)' },
      { nombre: 'CAJA', alias: ['OFICINA', 'SUCURSAL'], requerida: false, tipo: 'texto', descripcion: 'Caja/oficina recaudadora → Pago.oficina' },
      { nombre: 'CONCEPTO', alias: ['DESCRIPCION'], requerida: false, tipo: 'texto', descripcion: 'Concepto original (se anexa al concepto de migración)' },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Reportes que devuelve el servicio
// ─────────────────────────────────────────────────────────────────────────────

export interface ErrorFila {
  /** Número de fila del archivo (1 = primera fila de datos, sin contar encabezado). */
  fila: number;
  campo: string;
  error: string;
}

export interface AnalisisArchivo {
  tipoArchivo: TipoArchivoMigracion;
  hoja: string;
  totalFilas: number;
  columnasEsperadas: Array<{ nombre: string; requerida: boolean; presente: boolean }>;
  /** Columnas requeridas por el layout que no vienen en el archivo. */
  columnasFaltantes: string[];
  /** Columnas del archivo que ningún nombre/alias del layout reconoce. */
  columnasNoMapeadas: string[];
  /** Primeras 10 filas ya normalizadas a nombres canónicos. */
  preview: Array<Record<string, unknown>>;
  listoParaValidar: boolean;
}

export interface ReporteValidacion {
  tipoArchivo: TipoArchivoMigracion;
  totalFilas: number;
  validas: number;
  conError: ErrorFila[];
  advertencias: ErrorFila[];
}

export interface ResultadoImportacion {
  tipoArchivo: TipoArchivoMigracion;
  dryRun: boolean;
  totalFilas: number;
  procesadas: number;
  creados: number;
  actualizados: number;
  omitidos: number;
  rechazos: ErrorFila[];
  advertencias: ErrorFila[];
  /** Campos que consume el patrón conLog (LogProceso). */
  registros: number;
  errores: number;
}
