import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const billingLogger = new Logger('BillingEngine');

export interface BillingLineItem {
  conceptoCobroId: string;
  nombre: string;
  tipo: string;
  cantidad: number;
  precioBase: number;
  precioProporcional: number;
  importe: number;
  ivaPct: number;
  ivaImporte: number;
  obligatorio: boolean;
  orden: number;
}

export interface BillingPreview {
  items: BillingLineItem[];
  subtotal: number;
  totalIva: number;
  total: number;
}

type VariablesFormulaJson = Prisma.JsonValue;

@Injectable()
export class BillingEngineService {
  constructor(private readonly prisma: PrismaService) {}

  async calcular(
    tipoContratacionId: string,
    variables: Record<string, string | number | boolean>,
  ): Promise<BillingPreview> {
    const rows = await this.prisma.conceptoCobroTipoContratacion.findMany({
      where: {
        tipoContratacionId,
        conceptoCobro: { activo: true },
      },
      include: { conceptoCobro: true },
      orderBy: { orden: 'asc' },
    });

    const items: BillingLineItem[] = [];
    let subtotalAcumulado = 0;

    for (const row of rows) {
      const c = row.conceptoCobro;
      const montoBase = decimalToNumber(c.montoBase);
      const ivaPct = decimalToNumber(c.ivaPct);

      let cantidad = 0;
      let precioBase = 0;
      let precioProporcional = 0;
      let importe = 0;

      const tipoNorm = (c.tipo ?? '').trim().toLowerCase();

      if (tipoNorm === 'fijo') {
        cantidad = 1;
        precioBase = montoBase;
        precioProporcional = 0;
        importe = montoBase;
      } else if (tipoNorm === 'variable') {
        const resolved = this.calcularVariable(
          c.formula,
          c.variablesFormula,
          montoBase,
          variables,
        );
        cantidad = resolved.cantidad;
        precioBase = resolved.precioBase;
        precioProporcional = resolved.precioProporcional;
        importe = resolved.importe;
      } else if (tipoNorm === 'porcentual') {
        cantidad = 1;
        precioBase = 0;
        precioProporcional = 0;
        const pct = montoBase;
        importe = subtotalAcumulado * (pct / 100);
        precioBase = importe;
      } else {
        cantidad = 1;
        precioBase = montoBase;
        precioProporcional = 0;
        importe = montoBase;
      }

      const ivaImporte = importe * (ivaPct / 100);

      items.push({
        conceptoCobroId: c.id,
        nombre: c.nombre,
        tipo: c.tipo,
        cantidad,
        precioBase,
        precioProporcional,
        importe,
        ivaPct,
        ivaImporte,
        obligatorio: row.obligatorio,
        orden: row.orden,
      });

      subtotalAcumulado += importe;
    }

    const subtotal = roundMoney(items.reduce((s, i) => s + i.importe, 0));
    const totalIva = roundMoney(items.reduce((s, i) => s + i.ivaImporte, 0));
    const total = roundMoney(subtotal + totalIva);

    return { items, subtotal, totalIva, total };
  }

  private calcularVariable(
    formula: string | null,
    variablesFormula: VariablesFormulaJson,
    montoBase: number,
    variables: Record<string, string | number | boolean>,
  ): {
    cantidad: number;
    precioBase: number;
    precioProporcional: number;
    importe: number;
  } {
    const hasFormula = formula != null && String(formula).trim() !== '';
    const hasVarFormula =
      variablesFormula != null &&
      variablesFormula !== '' &&
      !(typeof variablesFormula === 'object' && variablesFormula !== null && Object.keys(variablesFormula as object).length === 0);

    if (!hasFormula && !hasVarFormula) {
      return {
        cantidad: 1,
        precioBase: montoBase,
        precioProporcional: 0,
        importe: montoBase,
      };
    }

    const cantidad = resolveCantidadFromVariablesFormula(variablesFormula, variables);

    if (hasFormula) {
      const parsed = parseFormulaString(String(formula).trim(), cantidad, variables, montoBase);
      if (parsed.kind === 'components') {
        const imp = roundMoney(cantidad * parsed.precioProporcional + parsed.precioBase);
        return {
          cantidad,
          precioBase: parsed.precioBase,
          precioProporcional: parsed.precioProporcional,
          importe: imp,
        };
      }
      return {
        cantidad,
        precioBase: 0,
        precioProporcional: 0,
        importe: roundMoney(parsed.value),
      };
    }

    const imp = roundMoney(cantidad * montoBase);
    return {
      cantidad,
      precioBase: 0,
      precioProporcional: montoBase,
      importe: imp,
    };
  }
}

function decimalToNumber(v: Prisma.Decimal | null | undefined): number {
  if (v == null) return 0;
  return typeof v === 'number' ? v : v.toNumber();
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function getVariableNumber(
  variables: Record<string, string | number | boolean>,
  key: string,
): number {
  if (!(key in variables)) return 0;
  return coerceNumber(variables[key]);
}

function coerceNumber(v: string | number | boolean): number {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : 0;
  }
  if (typeof v === 'boolean') {
    return v ? 1 : 0;
  }
  const t = v.trim();
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function resolveCantidadFromVariablesFormula(
  variablesFormula: VariablesFormulaJson,
  variables: Record<string, string | number | boolean>,
): number {
  if (variablesFormula == null || variablesFormula === '') {
    return 0;
  }

  if (typeof variablesFormula === 'string') {
    return getVariableNumber(variables, variablesFormula);
  }

  if (typeof variablesFormula === 'number') {
    return Number.isFinite(variablesFormula) ? variablesFormula : 0;
  }

  if (Array.isArray(variablesFormula)) {
    let sum = 0;
    for (const el of variablesFormula) {
      if (typeof el === 'string') {
        sum += getVariableNumber(variables, el);
      } else if (typeof el === 'number' && Number.isFinite(el)) {
        sum += el;
      }
    }
    return sum;
  }

  if (typeof variablesFormula === 'object' && variablesFormula !== null) {
    const o = variablesFormula as Record<string, unknown>;

    if (typeof o.sum === 'string') {
      const keys = o.sum.split(/[,\s]+/).filter(Boolean);
      return keys.reduce((acc, k) => acc + getVariableNumber(variables, k), 0);
    }

    if (Array.isArray(o.sumKeys)) {
      let sum = 0;
      for (const k of o.sumKeys) {
        if (typeof k === 'string') sum += getVariableNumber(variables, k);
      }
      return sum;
    }

    if (Array.isArray(o.keys)) {
      let sum = 0;
      for (const k of o.keys) {
        if (typeof k === 'string') sum += getVariableNumber(variables, k);
      }
      return sum;
    }

    const cantidadKey =
      (typeof o.cantidad === 'string' && o.cantidad) ||
      (typeof o.variableCantidad === 'string' && o.variableCantidad) ||
      (typeof o.cantidadVar === 'string' && o.cantidadVar) ||
      (typeof o.variable === 'string' && o.variable);

    if (cantidadKey) {
      return getVariableNumber(variables, cantidadKey);
    }

    if (typeof o.cantidad === 'number' && Number.isFinite(o.cantidad)) {
      return o.cantidad;
    }
  }

  return 0;
}

type ParsedFormula =
  | { kind: 'components'; precioBase: number; precioProporcional: number }
  | { kind: 'value'; value: number };

function parseFormulaString(
  formula: string,
  cantidad: number,
  variables: Record<string, string | number | boolean>,
  montoBaseFallback: number,
): ParsedFormula {
  const trimmed = formula.trim();

  if (trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed) as Record<string, unknown>;
      const pb = pickNumber(j.precioBase ?? j.precio_base ?? j.base, montoBaseFallback);
      const pp = pickNumber(j.precioProporcional ?? j.precio_proporcional ?? j.proporcional ?? j.unitario, 0);
      if ('importe' in j || 'importeDirecto' in j) {
        const direct = pickNumber(j.importe ?? j.importeDirecto, NaN);
        if (Number.isFinite(direct)) {
          return { kind: 'value', value: direct };
        }
      }
      return { kind: 'components', precioBase: pb, precioProporcional: pp };
    } catch {
      // fall through to expression
    }
  }

  const kv = parseKeyValueFormula(trimmed);
  if (kv) {
    return {
      kind: 'components',
      precioBase: kv.precioBase,
      precioProporcional: kv.precioProporcional,
    };
  }

  const value = evaluateSimpleFormula(trimmed, cantidad, variables, montoBaseFallback);
  return { kind: 'value', value };
}

function pickNumber(v: unknown, defaultVal: number): number {
  if (v == null) return defaultVal;
  if (typeof v === 'number') return Number.isFinite(v) ? v : defaultVal;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : defaultVal;
  }
  return defaultVal;
}

function parseKeyValueFormula(s: string): { precioBase: number; precioProporcional: number } | null {
  if (!/[;=|]/.test(s) && !/precio/i.test(s)) {
    return null;
  }
  const parts = s.split(/[;|]/).map((p) => p.trim()).filter(Boolean);
  let precioBase = 0;
  let precioProporcional = 0;
  let found = false;

  for (const p of parts) {
    const m = p.match(/^(precioBase|precio_proporcional|precioProporcional|base|proporcional)\s*[:=]\s*(-?[\d.]+)/i);
    if (m) {
      found = true;
      const val = Number(m[2]);
      const key = m[1].toLowerCase();
      if (key.includes('proporcional') || key === 'proporcional') {
        precioProporcional = Number.isFinite(val) ? val : 0;
      } else {
        precioBase = Number.isFinite(val) ? val : 0;
      }
    }
  }

  return found ? { precioBase, precioProporcional } : null;
}

function evaluateSimpleFormula(
  expr: string,
  cantidad: number,
  variables: Record<string, string | number | boolean>,
  montoBaseFallback: number,
): number {
  let e = expr.replace(/\bcantidad\b/gi, String(cantidad));
  e = e.replace(/\bmontoBase\b/gi, String(montoBaseFallback));

  const varKeyRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
  const reserved = new Set(['true', 'false', 'null', 'Math', 'cantidad', 'montoBase']);
  e = e.replace(varKeyRegex, (match, name: string) => {
    if (reserved.has(name)) return match;
    if (name in variables) {
      return String(coerceNumber(variables[name as keyof typeof variables] as string | number | boolean));
    }
    return '0';
  });

  return safeEvalArithmetic(e);
}

/**
 * Evalúa una expresión aritmética de tarifa ya con variables sustituidas.
 *
 * B3: antes hacía `catch { return 0 }`, lo que facturaba CERO ante cualquier
 * error de parseo (silenciosamente). Ahora lanza un error descriptivo (incluye
 * la expresión ofensiva) y lo registra: los llamadores NO deben convertirlo en
 * un cargo de cero — deben propagar el fallo para que se revise la tarifa.
 */
export function safeEvalArithmetic(expression: string): number {
  const sanitized = expression.replace(/[^-+*/().\d\s]/g, '');
  if (sanitized.trim() === '') {
    const msg = `Expresión de tarifa inválida (vacía tras sanitizar): "${expression}"`;
    billingLogger.error(msg);
    throw new Error(msg);
  }
  let n: number;
  try {
    const fn = new Function(`"use strict"; return (${sanitized});`) as () => number;
    n = fn();
  } catch (err: unknown) {
    const detalle = err instanceof Error ? err.message : String(err);
    const msg = `Expresión de tarifa inválida: "${expression}" (sanitizada: "${sanitized}")`;
    billingLogger.error(`${msg} — ${detalle}`);
    throw new Error(msg);
  }
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    const msg = `Expresión de tarifa produjo un resultado no numérico: "${expression}" => ${String(n)}`;
    billingLogger.error(msg);
    throw new Error(msg);
  }
  return roundMoney(n);
}
