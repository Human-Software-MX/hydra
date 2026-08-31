import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AnalisisArchivo,
  ColumnaEsperada,
  ErrorFila,
  LAYOUTS_AQUASIS,
  PREFIJO_CONCEPTO_PAGO_MIGRADO,
  PREFIJO_PUNTO_SERVICIO_MIGRADO,
  ReporteValidacion,
  ResultadoImportacion,
  SERIE_MIGRACION,
  TIPOS_ARCHIVO_MIGRACION,
  TipoArchivoMigracion,
} from './migracion.types';

/**
 * Toolkit de migración desde Aquasis (CIS incumbente) hacia Hydra.
 *
 * Flujo recomendado por archivo:
 *   1. POST /migracion/analizar   → verifica que el layout del archivo se
 *      reconoce (columnas presentes/faltantes/no mapeadas) sin tocar la BD.
 *   2. POST /migracion/validar    → dry-run de validación fila por fila
 *      (requeridos, formatos, RFC SAT, referencias cruzadas) sin escribir.
 *   3. POST /migracion/importar { dryRun: true }  → simula el import y
 *      reporta cuántos registros se crearían/actualizarían/omitirían.
 *   4. POST /migracion/importar { dryRun: false } → import real, idempotente,
 *      en lotes de 500 con transacción por lote y reporte de rechazos.
 *   5. GET  /migracion/conciliacion → totales post-import para el acta de
 *      migración que firma el organismo.
 *
 * Orden recomendado de archivos: padron → personas → medidores → saldos → pagos
 * (todos los archivos posteriores referencian el contrato por NUM_CONTRATO).
 *
 * Idempotencia (clave natural por tipo):
 *   - padron:    Contrato.ceaNumContrato (+ PuntoServicio.codigo "AQS-<num>")
 *   - personas:  Persona por RFC válido no genérico (o nombre completo) +
 *                RolPersonaContrato único por (persona, contrato, rol)
 *   - medidores: Medidor.contratoId (relación 1:1 contrato↔medidor en Hydra)
 *   - saldos:    Timbrado (serie MIG-AQS, folio = DOCUMENTO Aquasis)
 *   - pagos:     Pago.concepto "Migración Aquasis folio <FOLIO_PAGO>"
 */
@Injectable()
export class MigracionService {
  private readonly logger = new Logger(MigracionService.name);
  private static readonly TAMANO_LOTE = 500;

  /** RFC genéricos SAT (público en general / extranjeros) — no deduplican personas. */
  private static readonly RFC_GENERICOS = ['XAXX010101000', 'XEXX010101000'];
  /** Regex SAT: 3-4 letras (con Ñ y &), fecha AAMMDD válida, homoclave. */
  private static readonly RFC_REGEX =
    /^([A-ZÑ&]{3,4})(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])([A-Z\d]{2})([A\d])$/;

  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Análisis de layout (no escribe nada)
  // ───────────────────────────────────────────────────────────────────────────

  analizarArchivo(buffer: Buffer, tipoArchivo: string): AnalisisArchivo {
    const tipo = this.tipoValido(tipoArchivo);
    const layout = LAYOUTS_AQUASIS[tipo];
    const { hoja, filas, columnasNoMapeadas, columnasPresentes } = this.leerArchivo(buffer, tipo);

    const columnasEsperadas = layout.columnas.map((c) => ({
      nombre: c.nombre,
      requerida: c.requerida,
      presente: columnasPresentes.has(c.nombre),
    }));
    const columnasFaltantes = columnasEsperadas
      .filter((c) => c.requerida && !c.presente)
      .map((c) => c.nombre);

    return {
      tipoArchivo: tipo,
      hoja,
      totalFilas: filas.length,
      columnasEsperadas,
      columnasFaltantes,
      columnasNoMapeadas,
      preview: filas.slice(0, 10),
      listoParaValidar: columnasFaltantes.length === 0 && filas.length > 0,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Validación dry-run (no escribe nada)
  // ───────────────────────────────────────────────────────────────────────────

  async validar(buffer: Buffer, tipoArchivo: string): Promise<ReporteValidacion> {
    const tipo = this.tipoValido(tipoArchivo);
    const { filas, columnasPresentes } = this.leerArchivo(buffer, tipo);

    const conError: ErrorFila[] = [];
    const advertencias: ErrorFila[] = [];

    const faltantes = LAYOUTS_AQUASIS[tipo].columnas
      .filter((c) => c.requerida && !columnasPresentes.has(c.nombre))
      .map((c) => c.nombre);
    for (const col of faltantes) {
      conError.push({ fila: 0, campo: col, error: 'Columna requerida ausente en el archivo' });
    }
    if (faltantes.length > 0) {
      return { tipoArchivo: tipo, totalFilas: filas.length, validas: 0, conError, advertencias };
    }

    const refs = await this.cargarReferencias(tipo);
    const clavesVistas = new Set<string>();

    filas.forEach((fila, i) => {
      const numFila = i + 1;
      const { errores, avisos } = this.validarFila(tipo, fila, refs, clavesVistas, columnasPresentes);
      errores.forEach((e) => conError.push({ fila: numFila, ...e }));
      avisos.forEach((a) => advertencias.push({ fila: numFila, ...a }));
    });

    const filasConError = new Set(conError.map((e) => e.fila));
    return {
      tipoArchivo: tipo,
      totalFilas: filas.length,
      validas: filas.length - filasConError.size,
      conError,
      advertencias,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Importación por lotes (idempotente, con LogProceso)
  // ───────────────────────────────────────────────────────────────────────────

  async importar(
    buffer: Buffer,
    tipoArchivo: string,
    opciones: { dryRun?: boolean } = {},
  ): Promise<ResultadoImportacion> {
    const tipo = this.tipoValido(tipoArchivo);
    const dryRun = opciones.dryRun ?? false;

    return this.conLog(`importar:${tipo}${dryRun ? ':dry-run' : ''}`, async () => {
      const { filas, columnasPresentes } = this.leerArchivo(buffer, tipo);

      const faltantes = LAYOUTS_AQUASIS[tipo].columnas
        .filter((c) => c.requerida && !columnasPresentes.has(c.nombre))
        .map((c) => c.nombre);
      if (faltantes.length > 0) {
        throw new BadRequestException(
          `El archivo no tiene las columnas requeridas: ${faltantes.join(', ')}`,
        );
      }

      const refs = await this.cargarReferencias(tipo);
      const clavesVistas = new Set<string>();

      const rechazos: ErrorFila[] = [];
      const advertencias: ErrorFila[] = [];
      let creados = 0;
      let actualizados = 0;
      let omitidos = 0;

      // Pre-validación: las filas inválidas se rechazan ANTES del lote para
      // que un error de datos no aborte la transacción de las filas buenas.
      const pendientes: Array<{ numFila: number; fila: Record<string, unknown> }> = [];
      filas.forEach((fila, i) => {
        const numFila = i + 1;
        const { errores, avisos } = this.validarFila(tipo, fila, refs, clavesVistas, columnasPresentes);
        avisos.forEach((a) => advertencias.push({ fila: numFila, ...a }));
        if (errores.length > 0) {
          errores.forEach((e) => rechazos.push({ fila: numFila, ...e }));
        } else {
          pendientes.push({ numFila, fila });
        }
      });

      for (let inicio = 0; inicio < pendientes.length; inicio += MigracionService.TAMANO_LOTE) {
        const lote = pendientes.slice(inicio, inicio + MigracionService.TAMANO_LOTE);
        const resultados = await this.procesarLote(tipo, lote, refs, dryRun, rechazos);
        creados += resultados.creados;
        actualizados += resultados.actualizados;
        omitidos += resultados.omitidos;
      }

      const procesadas = creados + actualizados + omitidos;
      return {
        tipoArchivo: tipo,
        dryRun,
        totalFilas: filas.length,
        procesadas,
        creados,
        actualizados,
        omitidos,
        rechazos: rechazos.slice(0, 500),
        advertencias: advertencias.slice(0, 500),
        registros: procesadas,
        errores: rechazos.length,
      };
    });
  }

  /**
   * Procesa un lote dentro de una transacción. Si la transacción falla por una
   * fila (violación no anticipada por la pre-validación), se reintenta el lote
   * fila por fila SIN transacción, de modo que solo la fila culpable termine en
   * rechazos y el resto del lote sí se importe.
   */
  private async procesarLote(
    tipo: TipoArchivoMigracion,
    lote: Array<{ numFila: number; fila: Record<string, unknown> }>,
    refs: Referencias,
    dryRun: boolean,
    rechazos: ErrorFila[],
  ): Promise<{ creados: number; actualizados: number; omitidos: number }> {
    const conteo = { creados: 0, actualizados: 0, omitidos: 0 };
    const acumular = (r: ResultadoFila) => {
      if (r === 'creado') conteo.creados++;
      else if (r === 'actualizado') conteo.actualizados++;
      else conteo.omitidos++;
    };

    if (dryRun) {
      // Simulación: mismas lecturas y decisiones, cero escrituras.
      for (const { numFila, fila } of lote) {
        try {
          acumular(await this.procesarFila(this.prisma, tipo, fila, refs, true));
        } catch (e: any) {
          rechazos.push({ fila: numFila, campo: '*', error: e?.message ?? 'Error en simulación' });
        }
      }
      return conteo;
    }

    try {
      const resultados = await this.prisma.$transaction(async (tx) => {
        const res: ResultadoFila[] = [];
        for (const { fila } of lote) {
          res.push(await this.procesarFila(tx, tipo, fila, refs, false));
        }
        return res;
      });
      resultados.forEach(acumular);
      return conteo;
    } catch (e: any) {
      this.logger.warn(
        `Lote de ${lote.length} filas (${tipo}) falló en transacción, reintentando fila por fila: ${e?.message}`,
      );
      // Fallback fila por fila: cada fila con su propio try/catch, así una
      // fila mala no arrastra a las demás del lote.
      for (const { numFila, fila } of lote) {
        try {
          acumular(await this.procesarFila(this.prisma, tipo, fila, refs, false));
        } catch (err: any) {
          rechazos.push({ fila: numFila, campo: '*', error: err?.message ?? 'Error al importar la fila' });
        }
      }
      return conteo;
    }
  }

  private async procesarFila(
    db: Db,
    tipo: TipoArchivoMigracion,
    fila: Record<string, unknown>,
    refs: Referencias,
    dryRun: boolean,
  ): Promise<ResultadoFila> {
    switch (tipo) {
      case 'padron':
        return this.importarFilaPadron(db, fila, refs, dryRun);
      case 'personas':
        return this.importarFilaPersona(db, fila, refs, dryRun);
      case 'medidores':
        return this.importarFilaMedidor(db, fila, refs, dryRun);
      case 'saldos':
        return this.importarFilaSaldo(db, fila, refs, dryRun);
      case 'pagos':
        return this.importarFilaPago(db, fila, refs, dryRun);
    }
  }

  // ─── padron: Aquasis Toma/Contrato → Contrato + Domicilio + PuntoServicio ──

  private async importarFilaPadron(
    db: Db,
    fila: Record<string, unknown>,
    refs: Referencias,
    dryRun: boolean,
  ): Promise<ResultadoFila> {
    // Mapeo Aquasis → Hydra:
    //   NUM_CONTRATO   → Contrato.ceaNumContrato (clave natural del upsert)
    //   NOMBRE         → Contrato.nombre
    //   RFC            → Contrato.rfc (RFC genérico SAT si viene vacío)
    //   TIPO_SERVICIO  → Contrato.tipoServicio
    //   TARIFA         → Contrato.tipoContrato (clave Aquasis referencial;
    //                    la homologación a tarifas Hydra es un paso posterior)
    //   ESTADO_TOMA    → Contrato.estado (Activo/Cortado/Baja homologados)
    //   FECHA_ALTA     → Contrato.fecha (ISO yyyy-mm-dd)
    //   CALLE/NUM_*    → Domicilio.calle/numExterior/numInterior
    //   POBID          → Domicilio.localidadINEGIId vía aquasisPobid
    //   BARRID         → Domicilio.coloniaINEGIId vía aquasisBarrId
    //   GPS_LAT/LNG    → Domicilio.gpsLat/gpsLng
    //   (se crea PuntoServicio codigo "AQS-<num>" ligado al domicilio)
    const numContrato = this.texto(fila.NUM_CONTRATO) as string;
    const clave = this.normalizarNumContrato(numContrato);
    const existente = refs.contratos.get(clave);

    const rfc = this.texto(fila.RFC)?.toUpperCase() ?? null;
    const telefono = this.texto(fila.TELEFONO);
    const email = this.texto(fila.EMAIL);
    const calle = this.texto(fila.CALLE) ?? '';
    const numExterior = this.texto(fila.NUM_EXTERIOR);
    const numInterior = this.texto(fila.NUM_INTERIOR);
    const colonia = refs.colonias.get(this.entero(fila.BARRID) ?? -1);
    const localidad = refs.localidades.get(this.entero(fila.POBID) ?? -1);

    const datosContrato = {
      nombre: this.texto(fila.NOMBRE) ?? '',
      rfc: rfc && MigracionService.RFC_REGEX.test(rfc) ? rfc : 'XAXX010101000',
      tipoServicio: this.texto(fila.TIPO_SERVICIO) ?? 'Doméstico',
      tipoContrato: this.texto(fila.TARIFA) ?? 'MIGRADO_AQUASIS',
      estado: this.homologarEstadoToma(this.texto(fila.ESTADO_TOMA)),
      contacto: telefono ?? email ?? '',
      direccion: [calle, numExterior, numInterior ? `Int. ${numInterior}` : null, colonia?.nombre]
        .filter(Boolean)
        .join(' '),
      unidadesServidas: this.entero(fila.UNIDADES_SERVIDAS),
      observaciones: this.texto(fila.OBSERVACIONES),
    };

    if (dryRun) return existente ? 'actualizado' : 'creado';

    // Domicilio: se crea uno nuevo solo cuando el contrato aún no tiene;
    // colonia→localidad ya viene resuelta por los catálogos Aquasis nativos.
    const crearDomicilio = () =>
      db.domicilio.create({
        data: {
          calle,
          numExterior,
          numInterior,
          codigoPostal: this.texto(fila.CODIGO_POSTAL),
          coloniaINEGIId: colonia?.id ?? null,
          localidadINEGIId: localidad?.id ?? colonia?.localidadId ?? null,
          municipioINEGIId: localidad?.municipioId ?? null,
          gpsLat: this.decimal(fila.GPS_LAT),
          gpsLng: this.decimal(fila.GPS_LNG),
          direccionConcatenada: datosContrato.direccion,
          validadoINEGI: Boolean(colonia),
        },
        select: { id: true },
      });

    if (existente) {
      let domicilioId = existente.domicilioId;
      if (!domicilioId) domicilioId = (await crearDomicilio()).id;
      await db.contrato.update({
        where: { id: existente.id },
        data: { ...datosContrato, domicilioId },
      });
      existente.domicilioId = domicilioId;
      return 'actualizado';
    }

    const domicilio = await crearDomicilio();
    // Punto de servicio idempotente por codigo "AQS-<numContrato>".
    const puntoServicio = await db.puntoServicio.upsert({
      where: { codigo: `${PREFIJO_PUNTO_SERVICIO_MIGRADO}${clave}` },
      update: { domicilioId: domicilio.id },
      create: {
        codigo: `${PREFIJO_PUNTO_SERVICIO_MIGRADO}${clave}`,
        domicilioId: domicilio.id,
        gpsLat: this.decimal(fila.GPS_LAT),
        gpsLng: this.decimal(fila.GPS_LNG),
        estado: 'Activo',
      },
      select: { id: true },
    });

    const creado = await db.contrato.create({
      data: {
        ...datosContrato,
        ceaNumContrato: numContrato.trim(),
        fecha: this.fechaISO(fila.FECHA_ALTA) ?? new Date().toISOString().slice(0, 10),
        domicilioId: domicilio.id,
        puntoServicioId: puntoServicio.id,
      },
      select: { id: true, domicilioId: true },
    });
    refs.contratos.set(clave, { id: creado.id, domicilioId: creado.domicilioId });
    return 'creado';
  }

  // ─── personas: titulares Aquasis → Persona + RolPersonaContrato ────────────

  private async importarFilaPersona(
    db: Db,
    fila: Record<string, unknown>,
    refs: Referencias,
    dryRun: boolean,
  ): Promise<ResultadoFila> {
    // Mapeo Aquasis → Hydra:
    //   NUM_CONTRATO → RolPersonaContrato.contratoId (vía ceaNumContrato)
    //   NOMBRE/APELLIDO_* → Persona (deduplicada por RFC válido no genérico,
    //                       en su defecto por nombre completo exacto)
    //   ROL → RolPersonaContrato.rol (default PROPIETARIO; único por
    //         persona+contrato+rol, lo que hace el reproceso idempotente)
    const contrato = refs.contratos.get(
      this.normalizarNumContrato(this.texto(fila.NUM_CONTRATO) ?? ''),
    )!;
    const rfc = this.texto(fila.RFC)?.toUpperCase() ?? null;
    const nombre = this.texto(fila.NOMBRE) ?? '';
    const apellidoPaterno = this.texto(fila.APELLIDO_PATERNO);
    const apellidoMaterno = this.texto(fila.APELLIDO_MATERNO);
    const rol = (this.texto(fila.ROL) ?? 'PROPIETARIO').toUpperCase();

    const rfcDeduplicable =
      rfc !== null &&
      MigracionService.RFC_REGEX.test(rfc) &&
      !MigracionService.RFC_GENERICOS.includes(rfc);

    let persona = rfcDeduplicable
      ? await db.persona.findFirst({ where: { rfc }, select: { id: true } })
      : await db.persona.findFirst({
          where: { nombre, apellidoPaterno, apellidoMaterno },
          select: { id: true },
        });

    const personaExistia = Boolean(persona);
    if (dryRun) {
      if (!personaExistia) return 'creado';
      const rolExiste = await db.rolPersonaContrato.findFirst({
        where: { personaId: persona!.id, contratoId: contrato.id, rol },
        select: { id: true },
      });
      return rolExiste ? 'omitido' : 'actualizado';
    }

    if (!persona) {
      persona = await db.persona.create({
        data: {
          nombre,
          apellidoPaterno,
          apellidoMaterno,
          rfc,
          curp: this.texto(fila.CURP)?.toUpperCase() ?? null,
          tipo: this.homologarTipoPersona(this.texto(fila.TIPO_PERSONA)),
          razonSocial: this.texto(fila.RAZON_SOCIAL),
          email: this.texto(fila.EMAIL),
          telefono: this.texto(fila.TELEFONO),
        },
        select: { id: true },
      });
    }

    const rolPrevio = await db.rolPersonaContrato.findUnique({
      where: {
        personaId_contratoId_rol: { personaId: persona.id, contratoId: contrato.id, rol },
      },
      select: { id: true },
    });
    if (rolPrevio) return 'omitido';

    await db.rolPersonaContrato.create({
      data: { personaId: persona.id, contratoId: contrato.id, rol },
    });
    return personaExistia ? 'actualizado' : 'creado';
  }

  // ─── medidores: parque instalado Aquasis → Medidor ─────────────────────────

  private async importarFilaMedidor(
    db: Db,
    fila: Record<string, unknown>,
    refs: Referencias,
    dryRun: boolean,
  ): Promise<ResultadoFila> {
    // Mapeo Aquasis → Hydra:
    //   NUM_CONTRATO   → Medidor.contratoId (1:1 en Hydra; clave del upsert)
    //   SERIE          → Medidor.serie
    //   LECTURA_ACTUAL → Medidor.lecturaInicial (la última lectura Aquasis es
    //                    el punto de partida de la facturación en Hydra)
    //   DIGITOS        → Medidor.digitos
    //   FECHA_INSTALACION → Medidor.fechaInstalacion
    //   MARCA/MODELO   → NO se resuelven a CatalogoMarcaMedidor/Modelo aquí;
    //                    la homologación de catálogos de aparato es un paso
    //                    posterior asistido (los valores quedan en el archivo).
    const contrato = refs.contratos.get(
      this.normalizarNumContrato(this.texto(fila.NUM_CONTRATO) ?? ''),
    )!;
    const serie = this.texto(fila.SERIE) as string;

    if (dryRun) {
      const existe = await db.medidor.findUnique({
        where: { contratoId: contrato.id },
        select: { id: true },
      });
      return existe ? 'actualizado' : 'creado';
    }

    const datos = {
      serie: serie.trim(),
      estado: this.texto(fila.ESTADO) ?? 'Instalado',
      lecturaInicial: this.entero(fila.LECTURA_ACTUAL) ?? 0,
      digitos: this.entero(fila.DIGITOS),
      fechaInstalacion: this.fecha(fila.FECHA_INSTALACION),
    };
    const previo = await db.medidor.findUnique({
      where: { contratoId: contrato.id },
      select: { id: true },
    });
    await db.medidor.upsert({
      where: { contratoId: contrato.id },
      update: datos,
      create: { contratoId: contrato.id, ...datos },
    });
    return previo ? 'actualizado' : 'creado';
  }

  // ─── saldos: adeudos vivos Aquasis → Timbrado (serie MIG-AQS) + Recibo ─────

  private async importarFilaSaldo(
    db: Db,
    fila: Record<string, unknown>,
    refs: Referencias,
    dryRun: boolean,
  ): Promise<ResultadoFila> {
    // Mapeo Aquasis → Hydra:
    //   DOCUMENTO      → Timbrado.folio con serie MIG-AQS (clave de
    //                    idempotencia: un documento Aquasis = un Timbrado)
    //   TOTAL/IVA      → Timbrado.total/iva (subtotal = total - iva). No es un
    //                    CFDI real: estado "Migrado Aquasis", uuid vacío. El
    //                    Timbrado existe porque Recibo.timbradoId es requerido
    //                    y así el adeudo migrado entra al ciclo de cobranza.
    //   SALDO_VIGENTE/ VENCIDO → Recibo.saldoVigente/saldoVencido. Si ninguno
    //                    viene, TODO el total se asume vencido (es rezago).
    //   FECHA_VENCIMIENTO → Recibo.fechaVencimiento
    const contrato = refs.contratos.get(
      this.normalizarNumContrato(this.texto(fila.NUM_CONTRATO) ?? ''),
    )!;
    const documento = this.texto(fila.DOCUMENTO) as string;

    const existente = await db.timbrado.findFirst({
      where: { serie: SERIE_MIGRACION, folio: documento },
      select: { id: true },
    });
    if (existente) return 'omitido';
    if (dryRun) return 'creado';

    const total = this.decimal(fila.TOTAL) ?? 0;
    const iva = this.decimal(fila.IVA) ?? 0;
    let saldoVigente = this.decimal(fila.SALDO_VIGENTE);
    let saldoVencido = this.decimal(fila.SALDO_VENCIDO);
    if (saldoVigente === null && saldoVencido === null) {
      saldoVigente = 0;
      saldoVencido = total;
    }
    const fechaEmision = this.fechaISO(fila.FECHA_EMISION) ?? new Date().toISOString().slice(0, 10);
    const fechaVencimiento = this.fechaISO(fila.FECHA_VENCIMIENTO) ?? fechaEmision;

    const timbrado = await db.timbrado.create({
      data: {
        contratoId: contrato.id,
        estado: 'Migrado Aquasis',
        periodo: this.texto(fila.PERIODO) ?? 'MIGRACION',
        subtotal: total - iva,
        iva,
        total,
        fechaEmision,
        fechaVencimiento,
        serie: SERIE_MIGRACION,
        folio: documento,
      },
      select: { id: true },
    });
    await db.recibo.create({
      data: {
        contratoId: contrato.id,
        timbradoId: timbrado.id,
        saldoVigente: saldoVigente ?? 0,
        saldoVencido: saldoVencido ?? 0,
        fechaVencimiento,
      },
    });
    return 'creado';
  }

  // ─── pagos: histórico Aquasis → Pago (origen externo) ──────────────────────

  private async importarFilaPago(
    db: Db,
    fila: Record<string, unknown>,
    refs: Referencias,
    dryRun: boolean,
  ): Promise<ResultadoFila> {
    // Mapeo Aquasis → Hydra:
    //   FOLIO_PAGO → queda embebido en Pago.concepto con el prefijo
    //                "Migración Aquasis folio <folio>" (clave de idempotencia;
    //                Pago no tiene folio externo propio en el esquema actual)
    //   FECHA_PAGO → Pago.fecha (ISO yyyy-mm-dd)
    //   MONTO      → Pago.monto
    //   FORMA_PAGO → Pago.tipo homologado (Efectivo/Tarjeta/Transferencia…)
    //   CAJA       → Pago.oficina
    //   Los pagos migrados NO se aplican contra recibos (reciboId null): son
    //   histórico de consulta; los adeudos vivos ya vienen netos en "saldos".
    const contrato = refs.contratos.get(
      this.normalizarNumContrato(this.texto(fila.NUM_CONTRATO) ?? ''),
    )!;
    const folio = this.texto(fila.FOLIO_PAGO) as string;
    const conceptoBase = `${PREFIJO_CONCEPTO_PAGO_MIGRADO} folio ${folio.trim()}`;
    const conceptoOriginal = this.texto(fila.CONCEPTO);
    const concepto = conceptoOriginal ? `${conceptoBase} — ${conceptoOriginal}` : conceptoBase;

    // El sufijo " — " delimita el folio, así "folio 12" no matchea "folio 123".
    const existente = await db.pago.findFirst({
      where: {
        contratoId: contrato.id,
        OR: [{ concepto: conceptoBase }, { concepto: { startsWith: `${conceptoBase} — ` } }],
      },
      select: { id: true },
    });
    if (existente) return 'omitido';
    if (dryRun) return 'creado';

    await db.pago.create({
      data: {
        contratoId: contrato.id,
        monto: this.decimal(fila.MONTO) ?? 0,
        fecha: this.fechaISO(fila.FECHA_PAGO) ?? new Date().toISOString().slice(0, 10),
        tipo: this.homologarFormaPago(this.texto(fila.FORMA_PAGO)),
        concepto,
        origen: 'externo',
        oficina: this.texto(fila.CAJA),
      },
    });
    return 'creado';
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Conciliación post-import (el reporte del acta de migración)
  // ───────────────────────────────────────────────────────────────────────────

  async reporteConciliacion() {
    const [
      contratosPorEstado,
      contratosMigrados,
      contratosMigradosSinDomicilio,
      contratosMigradosSinMedidor,
      contratosMigradosSinTitular,
      timbradosMigrados,
      recibosMigrados,
      pagosMigrados,
      ultimasEjecuciones,
    ] = await Promise.all([
      this.prisma.contrato.groupBy({
        by: ['estado'],
        where: { ceaNumContrato: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.contrato.count({ where: { ceaNumContrato: { not: null } } }),
      this.prisma.contrato.count({
        where: { ceaNumContrato: { not: null }, domicilioId: null },
      }),
      this.prisma.contrato.count({
        where: { ceaNumContrato: { not: null }, medidor: null },
      }),
      this.prisma.contrato.count({
        where: { ceaNumContrato: { not: null }, personas: { none: {} } },
      }),
      this.prisma.timbrado.aggregate({
        where: { serie: SERIE_MIGRACION },
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.prisma.recibo.aggregate({
        where: { timbrado: { serie: SERIE_MIGRACION } },
        _count: { _all: true },
        _sum: { saldoVigente: true, saldoVencido: true },
      }),
      this.prisma.pago.aggregate({
        where: { concepto: { startsWith: PREFIJO_CONCEPTO_PAGO_MIGRADO } },
        _count: { _all: true },
        _sum: { monto: true },
      }),
      this.prisma.logProceso.findMany({
        where: { tipo: 'migracion' },
        orderBy: { inicio: 'desc' },
        take: 10,
        select: {
          id: true,
          subTipo: true,
          estado: true,
          inicio: true,
          fin: true,
          registros: true,
          errores: true,
        },
      }),
    ]);

    const totalDocumentos = Number(timbradosMigrados._sum.total ?? 0);
    const totalSaldosRecibos =
      Number(recibosMigrados._sum.saldoVigente ?? 0) +
      Number(recibosMigrados._sum.saldoVencido ?? 0);

    return {
      generadoEn: new Date().toISOString(),
      contratos: {
        totalMigrados: contratosMigrados,
        porEstado: contratosPorEstado.map((g) => ({ estado: g.estado, total: g._count._all })),
        sinDomicilio: contratosMigradosSinDomicilio,
        sinMedidor: contratosMigradosSinMedidor,
        sinTitular: contratosMigradosSinTitular,
      },
      saldos: {
        documentosImportados: timbradosMigrados._count._all,
        totalImportado: totalDocumentos,
        recibosCreados: recibosMigrados._count._all,
        saldoVigente: Number(recibosMigrados._sum.saldoVigente ?? 0),
        saldoVencido: Number(recibosMigrados._sum.saldoVencido ?? 0),
        // Descuadre documentos vs recibos: debe ser 0 para firmar el acta.
        diferencia: Number((totalDocumentos - totalSaldosRecibos).toFixed(2)),
      },
      pagosHistoricos: {
        importados: pagosMigrados._count._all,
        montoTotal: Number(pagosMigrados._sum.monto ?? 0),
      },
      ultimasEjecuciones,
    };
  }

  async logs(limit = 50) {
    return this.prisma.logProceso.findMany({
      where: { tipo: 'migracion' },
      orderBy: { inicio: 'desc' },
      take: limit,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Lectura y normalización del archivo (XLSX o CSV vía xlsx)
  // ───────────────────────────────────────────────────────────────────────────

  private leerArchivo(
    buffer: Buffer,
    tipo: TipoArchivoMigracion,
  ): {
    hoja: string;
    filas: Array<Record<string, unknown>>;
    columnasPresentes: Set<string>;
    columnasNoMapeadas: string[];
  } {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    } catch {
      throw new BadRequestException('No se pudo leer el archivo: se espera XLSX o CSV');
    }
    const nombreHoja = workbook.SheetNames[0];
    if (!nombreHoja) throw new BadRequestException('El archivo no contiene hojas de datos');
    const hoja = workbook.Sheets[nombreHoja];
    const crudas = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja, {
      defval: null,
      raw: true,
    });

    // Mapa encabezado-normalizado → nombre canónico (nombre + alias del layout).
    const canonico = new Map<string, string>();
    for (const col of LAYOUTS_AQUASIS[tipo].columnas) {
      canonico.set(this.normalizarHeader(col.nombre), col.nombre);
      for (const alias of col.alias ?? []) {
        canonico.set(this.normalizarHeader(alias), col.nombre);
      }
    }

    const columnasPresentes = new Set<string>();
    const noMapeadas = new Set<string>();
    const filas = crudas.map((cruda) => {
      const fila: Record<string, unknown> = {};
      for (const [header, valor] of Object.entries(cruda)) {
        const nombre = canonico.get(this.normalizarHeader(header));
        if (nombre) {
          fila[nombre] = valor;
          columnasPresentes.add(nombre);
        } else {
          noMapeadas.add(header);
        }
      }
      return fila;
    });

    return { hoja: nombreHoja, filas, columnasPresentes, columnasNoMapeadas: [...noMapeadas] };
  }

  private normalizarHeader(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Validación por fila
  // ───────────────────────────────────────────────────────────────────────────

  private validarFila(
    tipo: TipoArchivoMigracion,
    fila: Record<string, unknown>,
    refs: Referencias,
    clavesVistas: Set<string>,
    columnasPresentes: Set<string>,
  ): { errores: Array<Omit<ErrorFila, 'fila'>>; avisos: Array<Omit<ErrorFila, 'fila'>> } {
    const errores: Array<Omit<ErrorFila, 'fila'>> = [];
    const avisos: Array<Omit<ErrorFila, 'fila'>> = [];
    const layout = LAYOUTS_AQUASIS[tipo];

    // Requeridos y formatos por columna.
    for (const col of layout.columnas) {
      if (!columnasPresentes.has(col.nombre)) continue;
      const valor = fila[col.nombre];
      const vacio = valor === null || valor === undefined || String(valor).trim() === '';
      if (vacio) {
        if (col.valorObligatorio) {
          errores.push({ campo: col.nombre, error: 'Valor requerido ausente' });
        }
        continue;
      }
      if (!this.tipoDatoValido(col, valor)) {
        errores.push({
          campo: col.nombre,
          error: `Formato inválido para tipo ${col.tipo}: "${String(valor)}"`,
        });
      }
    }

    // RFC con regex SAT (solo si viene informado; vacío se sustituye por genérico).
    const rfc = this.texto(fila.RFC)?.toUpperCase();
    if (rfc && !MigracionService.RFC_REGEX.test(rfc)) {
      if (tipo === 'personas' || tipo === 'padron') {
        errores.push({ campo: 'RFC', error: `RFC no cumple el formato SAT: "${rfc}"` });
      }
    }

    // Duplicados de clave natural dentro del mismo archivo.
    const claveNatural = this.texto(fila[layout.claveNatural]);
    if (claveNatural && tipo !== 'personas') {
      const clave =
        layout.claveNatural === 'NUM_CONTRATO'
          ? this.normalizarNumContrato(claveNatural)
          : claveNatural.toUpperCase();
      if (clavesVistas.has(clave)) {
        errores.push({
          campo: layout.claveNatural,
          error: `Clave duplicada dentro del archivo: "${claveNatural}"`,
        });
      } else {
        clavesVistas.add(clave);
      }
    }

    // Referencias cruzadas.
    const numContrato = this.texto(fila.NUM_CONTRATO);
    const claveContrato = numContrato ? this.normalizarNumContrato(numContrato) : null;
    if (tipo === 'padron') {
      const pobid = this.entero(fila.POBID);
      const barrid = this.entero(fila.BARRID);
      const localidad = pobid !== null ? refs.localidades.get(pobid) : undefined;
      const colonia = barrid !== null ? refs.colonias.get(barrid) : undefined;
      if (pobid !== null && !localidad) {
        errores.push({ campo: 'POBID', error: `Localidad Aquasis ${pobid} no existe en el catálogo` });
      }
      if (barrid !== null && !colonia) {
        errores.push({ campo: 'BARRID', error: `Colonia Aquasis ${barrid} no existe en el catálogo` });
      }
      if (localidad && colonia && colonia.localidadId !== localidad.id) {
        avisos.push({
          campo: 'BARRID',
          error: `La colonia ${barrid} no pertenece a la localidad ${pobid}; se usa la localidad de la colonia`,
        });
      }
      if (claveContrato && refs.contratos.has(claveContrato)) {
        avisos.push({
          campo: 'NUM_CONTRATO',
          error: `El contrato ${numContrato} ya existe (ceaNumContrato); se actualizará`,
        });
      }
    } else if (claveContrato && !refs.contratos.has(claveContrato)) {
      errores.push({
        campo: 'NUM_CONTRATO',
        error: `El contrato Aquasis "${numContrato}" no existe en Hydra; importa primero el padrón`,
      });
    }

    // Reglas de negocio por tipo.
    if (tipo === 'saldos') {
      const total = this.decimal(fila.TOTAL);
      if (total !== null && total < 0) {
        errores.push({ campo: 'TOTAL', error: 'El total del documento no puede ser negativo' });
      }
      const vigente = this.decimal(fila.SALDO_VIGENTE) ?? 0;
      const vencido = this.decimal(fila.SALDO_VENCIDO) ?? 0;
      if (total !== null && (vigente !== 0 || vencido !== 0) && Math.abs(vigente + vencido - total) > 0.01) {
        avisos.push({
          campo: 'TOTAL',
          error: `Vigente + vencido (${(vigente + vencido).toFixed(2)}) no cuadra con el total (${total.toFixed(2)})`,
        });
      }
    }
    if (tipo === 'pagos') {
      const monto = this.decimal(fila.MONTO);
      if (monto !== null && monto <= 0) {
        errores.push({ campo: 'MONTO', error: 'El monto del pago debe ser mayor que cero' });
      }
      const fecha = this.fecha(fila.FECHA_PAGO);
      if (fecha && fecha.getTime() > Date.now()) {
        avisos.push({ campo: 'FECHA_PAGO', error: 'Fecha de pago en el futuro' });
      }
    }

    return { errores, avisos };
  }

  private tipoDatoValido(col: ColumnaEsperada, valor: unknown): boolean {
    switch (col.tipo) {
      case 'entero':
        return this.entero(valor) !== null;
      case 'decimal':
        return this.decimal(valor) !== null;
      case 'fecha':
        return this.fecha(valor) !== null;
      default:
        return true;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Referencias cruzadas precargadas (una sola consulta por catálogo)
  // ───────────────────────────────────────────────────────────────────────────

  private async cargarReferencias(tipo: TipoArchivoMigracion): Promise<Referencias> {
    const refs: Referencias = {
      contratos: new Map(),
      localidades: new Map(),
      colonias: new Map(),
    };

    const contratos = await this.prisma.contrato.findMany({
      where: { ceaNumContrato: { not: null } },
      select: { id: true, ceaNumContrato: true, domicilioId: true },
    });
    for (const c of contratos) {
      refs.contratos.set(this.normalizarNumContrato(c.ceaNumContrato as string), {
        id: c.id,
        domicilioId: c.domicilioId,
      });
    }

    if (tipo === 'padron') {
      const [localidades, colonias] = await Promise.all([
        this.prisma.catalogoLocalidadINEGI.findMany({
          select: { id: true, aquasisPobid: true, municipioId: true },
        }),
        this.prisma.catalogoColoniaINEGI.findMany({
          select: { id: true, aquasisBarrId: true, localidadId: true, nombre: true },
        }),
      ]);
      for (const l of localidades) {
        refs.localidades.set(l.aquasisPobid, { id: l.id, municipioId: l.municipioId });
      }
      for (const c of colonias) {
        refs.colonias.set(c.aquasisBarrId, {
          id: c.id,
          localidadId: c.localidadId,
          nombre: c.nombre,
        });
      }
    }

    return refs;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Bitácora LogProceso (patrón conLog, copiado local de batch.service.ts)
  // ───────────────────────────────────────────────────────────────────────────

  private async conLog<T extends { registros?: number; errores?: number }>(
    subTipo: string,
    fn: () => Promise<T & Record<string, unknown>>,
  ): Promise<T> {
    const log = await this.prisma.logProceso.create({
      data: { tipo: 'migracion', subTipo, estado: 'Iniciado' },
    });
    const inicio = Date.now();
    try {
      const resultado = await fn();
      await this.prisma.logProceso.update({
        where: { id: log.id },
        data: {
          estado: 'Completado',
          fin: new Date(),
          duracionMs: Date.now() - inicio,
          registros: resultado.registros ?? 0,
          errores: resultado.errores ?? 0,
          detalle: JSON.parse(JSON.stringify(resultado)),
        },
      });
      return resultado;
    } catch (e: any) {
      await this.prisma.logProceso.update({
        where: { id: log.id },
        data: {
          estado: 'Error',
          fin: new Date(),
          duracionMs: Date.now() - inicio,
          errores: 1,
          errorMsg: e?.message ?? 'Error',
        },
      });
      throw e;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers de conversión y homologación
  // ───────────────────────────────────────────────────────────────────────────

  private tipoValido(tipoArchivo: string): TipoArchivoMigracion {
    const tipo = (tipoArchivo ?? '').toLowerCase().trim() as TipoArchivoMigracion;
    if (!TIPOS_ARCHIVO_MIGRACION.includes(tipo)) {
      throw new BadRequestException(
        `tipoArchivo inválido: "${tipoArchivo}". Valores: ${TIPOS_ARCHIVO_MIGRACION.join(', ')}`,
      );
    }
    return tipo;
  }

  /** Aquasis exporta números de cuenta con ceros a la izquierda: se normalizan para comparar. */
  private normalizarNumContrato(s: string): string {
    return s.trim().toUpperCase().replace(/^0+(?=.)/, '');
  }

  private texto(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  }

  private entero(v: unknown): number | null {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }

  private decimal(v: unknown): number | null {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  /** Acepta Date (cellDates), serial de Excel, dd/mm/yyyy, yyyy-mm-dd. */
  private fecha(v: unknown): Date | null {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === 'number') {
      // Serial de Excel (días desde 1899-12-30).
      const ms = Math.round((v - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : d;
    }
    const s = String(v).trim();
    const ddmmyyyy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (ddmmyyyy) {
      const d = new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}T00:00:00`);
      return isNaN(d.getTime()) ? null : d;
    }
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  private fechaISO(v: unknown): string | null {
    const d = this.fecha(v);
    if (!d) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Estatus de toma Aquasis → Contrato.estado Hydra. */
  private homologarEstadoToma(estado: string | null): string {
    const e = (estado ?? '').toUpperCase();
    if (/CORT|SUSP|RESTR/.test(e)) return 'Cortado';
    if (/BAJA|CANCEL/.test(e)) return 'Baja';
    if (e === '' || /ACTIV|VIGEN|NORMAL/.test(e)) return 'Activo';
    return estado as string; // estatus no homologado: se conserva el original
  }

  private homologarTipoPersona(tipo: string | null): string {
    const t = (tipo ?? '').toUpperCase();
    return /MORAL|EMPRESA|JURIDIC/.test(t) ? 'Moral' : 'Fisica';
  }

  /** Forma de pago Aquasis → Pago.tipo Hydra (valores legacy del esquema). */
  private homologarFormaPago(forma: string | null): string {
    const f = (forma ?? '').toUpperCase();
    if (/TARJETA|TDC|TDD|CREDITO|DEBITO/.test(f)) return 'Tarjeta';
    if (/TRANSFER|SPEI|DEPOSITO/.test(f)) return 'Transferencia';
    if (/OXXO/.test(f)) return 'OXXO';
    if (/CODI/.test(f)) return 'CoDi';
    if (/WEB|LINEA|INTERNET/.test(f)) return 'WEB';
    return 'Efectivo';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos internos
// ─────────────────────────────────────────────────────────────────────────────

/** Cliente Prisma usable dentro o fuera de una transacción. */
type Db = Prisma.TransactionClient | PrismaService;

type ResultadoFila = 'creado' | 'actualizado' | 'omitido';

interface Referencias {
  /** ceaNumContrato normalizado → contrato Hydra. */
  contratos: Map<string, { id: string; domicilioId: string | null }>;
  /** aquasisPobid → localidad. */
  localidades: Map<number, { id: string; municipioId: string }>;
  /** aquasisBarrId → colonia. */
  colonias: Map<number, { id: string; localidadId: string; nombre: string }>;
}
