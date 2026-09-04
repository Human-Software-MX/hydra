import type { SolicitudState } from '@/types/solicitudes';

/**
 * OCR best-effort sobre identificaciones oficiales (INE/IFE) en el navegador.
 *
 * Usa tesseract.js con import dinámico para no engordar el bundle inicial:
 * el motor (~ MBs de wasm + traineddata) solo se descarga la primera vez que
 * el usuario adjunta una imagen de identificación. Todo es tolerante a fallos:
 * cualquier error o timeout devuelve null y el flujo de captura sigue igual.
 */

export interface DatosExtraidos {
  curp?: string;
  rfc?: string;
  /** Nombre tal como se leyó (crudo), cuando no se pudo separar en partes. */
  nombreCompleto?: string;
  paterno?: string;
  materno?: string;
  nombres?: string;
}

const TIPOS_IMAGEN = /^image\/(jpeg|png|webp)$/i;
const TIMEOUT_OCR_MS = 30_000;

/** ¿El archivo es candidato a OCR? (solo imágenes; PDFs quedan fuera del MVP) */
export function esImagenParaOcr(file: File): boolean {
  return TIPOS_IMAGEN.test(file.type);
}

function conTimeout<T>(p: Promise<T>, ms: number, etiqueta: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout ${etiqueta}`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Token exacto (evita confundir el prefijo de una CURP con un RFC):
const CURP_RE = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;
const RFC_FISICA_RE = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;

const STOP_NOMBRE =
  /DOMICILIO|CLAVE|CURP|FECHA|SEXO|ELECTOR|NACIMIENTO|REGISTRO|SECCION|SECCIÓN|VIGENCIA|EMISION|EMISIÓN|LOCALIDAD|MUNICIPIO|ESTADO|CREDENCIAL|VOTAR|INSTITUTO|MEXICO|MÉXICO/;

function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** ¿La línea parece parte de un nombre? (solo letras mayúsculas y espacios) */
function esLineaNombre(linea: string): boolean {
  if (!linea || linea.length < 2 || linea.length > 45) return false;
  if (STOP_NOMBRE.test(sinAcentos(linea))) return false;
  return /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ\s.]*$/.test(linea);
}

/**
 * Extrae CURP / RFC / nombre del texto reconocido. Best effort:
 * - CURP y RFC se buscan como tokens exactos (una CURP nunca cuenta como RFC;
 *   el RFC solo se reporta si aparece por separado en el documento).
 * - Nombre: bloque de líneas en mayúsculas después de la palabra NOMBRE.
 *   Formato INE típico: línea 1 paterno, línea 2 materno, línea 3 nombres.
 *   Si el bloque no es separable así, solo se devuelve nombreCompleto crudo.
 */
export function parsearTextoIdentificacion(texto: string): DatosExtraidos | null {
  const out: DatosExtraidos = {};
  const upper = texto.toUpperCase();

  // CURP / RFC por tokens exactos
  for (const token of upper.split(/[^A-ZÑ&0-9]+/)) {
    if (!out.curp && token.length === 18 && CURP_RE.test(token)) out.curp = token;
    else if (!out.rfc && token.length === 13 && RFC_FISICA_RE.test(token)) out.rfc = token;
  }

  // Bloque de nombre después de la etiqueta NOMBRE
  const lineas = upper.split(/\r?\n/).map((l) => l.trim());
  const idxNombre = lineas.findIndex((l) => /\bNOMBRE\b/.test(sinAcentos(l)));
  if (idxNombre >= 0) {
    // Caso "NOMBRE GARCIA RAMIREZ MARIA" en la misma línea
    const enLinea = lineas[idxNombre].replace(/.*\bNOMBRE\b[:\s]*/, '').trim();
    const bloque: string[] = [];
    if (esLineaNombre(enLinea)) bloque.push(enLinea);
    for (let i = idxNombre + 1; i < lineas.length && bloque.length < 3; i++) {
      const l = lineas[i];
      if (!l) continue;
      if (!esLineaNombre(l)) break;
      bloque.push(l);
    }
    if (bloque.length === 3) {
      // INE típico: paterno / materno / nombres
      [out.paterno, out.materno, out.nombres] = bloque;
      out.nombreCompleto = bloque.join(' ');
    } else if (bloque.length > 0) {
      out.nombreCompleto = bloque.join(' ');
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

type TesseractWorker = { recognize: (img: File) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> };

/**
 * OCR sobre una imagen de identificación. Devuelve null si el archivo no es
 * imagen, si el OCR falla o si no se pudo extraer ningún dato. Nunca lanza.
 */
export async function extraerDatosIdentificacion(file: File): Promise<DatosExtraidos | null> {
  if (!esImagenParaOcr(file)) return null;
  let worker: TesseractWorker | null = null;
  let terminado = false;
  const terminar = () => {
    if (worker && !terminado) {
      terminado = true;
      void worker.terminate().catch(() => {});
    }
  };
  const tarea = (async () => {
    const { createWorker } = await import('tesseract.js');
    try {
      worker = (await createWorker('spa')) as TesseractWorker;
    } catch {
      // La descarga del traineddata 'spa' puede fallar (red/CDN); 'eng'
      // sigue leyendo mayúsculas, CURP y RFC razonablemente bien.
      worker = (await createWorker('eng')) as TesseractWorker;
    }
    const { data } = await worker.recognize(file);
    return parsearTextoIdentificacion(data.text);
  })();
  // Si el timeout gana la carrera, la tarea sigue viva: terminar el worker
  // cuando la tarea concluya (tarde) para no dejar wasm residente.
  void tarea.then(terminar, terminar);
  try {
    return await conTimeout(tarea, TIMEOUT_OCR_MS, 'OCR identificación');
  } catch {
    return null;
  } finally {
    terminar();
  }
}

/**
 * Calcula el parche a aplicar sobre el propietario de una solicitud a partir
 * de los datos extraídos por OCR. SOLO llena campos vacíos — nunca pisa lo que
 * ya capturó la ventanilla. Devuelve null si no hay nada que llenar.
 */
export function patchPropietarioDesdeIdentificacion(
  form: Pick<SolicitudState, 'propTipoPersona' | 'propPaterno' | 'propMaterno' | 'propNombre' | 'propRfc'>,
  d: DatosExtraidos,
): { patch: Partial<SolicitudState>; llenado: string[] } | null {
  const patch: Partial<SolicitudState> = {};
  const llenado: string[] = [];

  if (d.rfc && !form.propRfc.trim()) {
    patch.propRfc = d.rfc;
    llenado.push('RFC');
  }

  const nombresVacios = !form.propPaterno.trim() && !form.propMaterno.trim() && !form.propNombre.trim();
  if (form.propTipoPersona === 'fisica' && nombresVacios && d.paterno && d.nombres) {
    patch.propPaterno = d.paterno;
    patch.propMaterno = d.materno ?? '';
    patch.propNombre = d.nombres;
    llenado.push('nombre del propietario');
  }

  return llenado.length > 0 ? { patch, llenado } : null;
}
