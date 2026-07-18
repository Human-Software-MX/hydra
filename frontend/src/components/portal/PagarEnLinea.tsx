import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  Landmark,
  Loader2,
  PlayCircle,
  Store,
} from 'lucide-react';
import { getPortalSaldos } from '@/api/portal';
import {
  crearIntentoPagoPortal,
  getIntentosPagoPortal,
  simularPagoIntentoPortal,
  type IntentoPagoCreadoDto,
  type MetodoPagoPasarela,
} from '@/api/pasarelas';
import { useToast } from '@/components/ui/use-toast';

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
}

function fmtFechaHora(s?: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Agrupa dígitos de 4 en 4 (líneas de captura / referencias largas). */
function grupos4(s: string) {
  return s.replace(/(.{4})/g, '$1 ').trim();
}

const METODOS: Array<{ value: MetodoPagoPasarela; label: string; desc: string; icon: typeof Landmark }> = [
  { value: 'spei', label: 'SPEI', desc: 'Transferencia bancaria', icon: Landmark },
  { value: 'oxxo', label: 'OXXO', desc: 'Pago en tienda', icon: Store },
  { value: 'tarjeta', label: 'Tarjeta', desc: 'Crédito o débito', icon: CreditCard },
];

const ESTADO_INTENTO: Record<string, string> = {
  pendiente: 'bg-yellow-100 text-yellow-700',
  pagado: 'bg-green-100 text-green-700',
  expirado: 'bg-gray-100 text-gray-500',
  cancelado: 'bg-red-100 text-red-700',
  fallido: 'bg-red-100 text-red-700',
};

function CopiableRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const { toast } = useToast();
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(value.replace(/\s/g, ''));
      toast({ title: 'Copiado al portapapeles', description: label });
    } catch {
      toast({ title: 'No se pudo copiar', variant: 'destructive' });
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
        <p className={`text-sm text-gray-800 break-all ${mono ? 'font-mono' : ''}`}>{value}</p>
      </div>
      <button
        onClick={copiar}
        title={`Copiar ${label.toLowerCase()}`}
        className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
      >
        <Copy className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

// ─── Componente principal ───────────────────────────────────────────────────

const PagarEnLinea = ({ contratoId }: { contratoId: string }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [monto, setMonto] = useState('');
  const [montoTouched, setMontoTouched] = useState(false);
  const [metodo, setMetodo] = useState<MetodoPagoPasarela>('spei');
  const [resultado, setResultado] = useState<IntentoPagoCreadoDto | null>(null);

  const saldosQ = useQuery({
    queryKey: ['portal-saldos', contratoId],
    queryFn: () => getPortalSaldos(contratoId),
  });

  const intentosQ = useQuery({
    queryKey: ['portal-intentos-pago', contratoId],
    queryFn: () => getIntentosPagoPortal(contratoId),
  });

  const saldoTotal = saldosQ.data?.total ?? 0;

  // Monto default = saldo total (mientras el usuario no lo haya editado)
  useEffect(() => {
    if (!montoTouched && saldosQ.data) {
      setMonto(saldosQ.data.total > 0 ? saldosQ.data.total.toFixed(2) : '');
    }
  }, [saldosQ.data, montoTouched]);

  // Reset al cambiar de contrato
  useEffect(() => {
    setResultado(null);
    setMontoTouched(false);
    setMetodo('spei');
  }, [contratoId]);

  const montoNum = Number(monto);
  const montoValido = Number.isFinite(montoNum) && montoNum > 0 && montoNum <= saldoTotal + 0.005;

  const crearMut = useMutation({
    mutationFn: () => crearIntentoPagoPortal(contratoId, { monto: montoNum, metodo }),
    onSuccess: (r) => {
      setResultado(r);
      toast({ title: 'Referencia de pago generada', description: `Método: ${r.metodo.toUpperCase()}` });
      queryClient.invalidateQueries({ queryKey: ['portal-intentos-pago', contratoId] });
    },
    onError: (e: Error) =>
      toast({ title: 'No se pudo generar el pago', description: e.message, variant: 'destructive' }),
  });

  const simularMut = useMutation({
    mutationFn: (intentoId: string) => simularPagoIntentoPortal(contratoId, intentoId),
    onSuccess: () => {
      toast({
        title: 'Pago confirmado (simulación)',
        description: 'El pago fue aplicado a tu contrato.',
      });
      setResultado(null);
      setMontoTouched(false);
      queryClient.invalidateQueries({ queryKey: ['portal-intentos-pago', contratoId] });
      queryClient.invalidateQueries({ queryKey: ['portal-saldos', contratoId] });
    },
    onError: (e: Error) =>
      toast({ title: 'No se pudo simular el pago', description: e.message, variant: 'destructive' }),
  });

  const intentos = intentosQ.data ?? [];
  const datos = resultado?.datos;

  const resumenSaldos = useMemo(
    () => [
      { label: 'Saldo vencido', value: saldosQ.data?.vencido ?? 0, color: 'text-red-600' },
      { label: 'Saldo vigente', value: saldosQ.data?.vigente ?? 0, color: 'text-green-600' },
      { label: 'Total a pagar', value: saldoTotal, color: 'text-gray-900' },
    ],
    [saldosQ.data, saldoTotal],
  );

  return (
    <div className="space-y-6">
      {/* Saldos */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {resumenSaldos.map(({ label, value, color }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">{label}</p>
            <p className={`text-2xl font-bold tabular-nums ${color}`}>
              {saldosQ.isLoading ? '…' : fmt(value)}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">MXN</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        {/* Formulario de pago */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Banknote className="h-5 w-5 text-blue-600" aria-hidden />
            <div>
              <h2 className="text-base font-semibold text-gray-900">Generar pago</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Elige monto y método; te daremos la referencia para pagar.
              </p>
            </div>
          </div>
          <div className="p-5 space-y-5">
            {saldoTotal <= 0 && !saldosQ.isLoading ? (
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" aria-hidden />
                <p className="text-sm text-green-700">
                  Tu contrato está al corriente. No hay saldo pendiente por pagar.
                </p>
              </div>
            ) : (
              <>
                {/* Monto */}
                <div>
                  <label htmlFor="monto-pago" className="block text-sm font-medium text-gray-700 mb-1">
                    Monto a pagar (MXN)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="monto-pago"
                      type="number"
                      min={0.01}
                      step="0.01"
                      max={saldoTotal}
                      value={monto}
                      onChange={(e) => {
                        setMonto(e.target.value);
                        setMontoTouched(true);
                      }}
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2.5 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      onClick={() => {
                        setMonto(saldoTotal.toFixed(2));
                        setMontoTouched(true);
                      }}
                      className="text-xs font-semibold text-blue-600 border border-blue-200 rounded-lg px-3 py-2.5 hover:bg-blue-50 transition-colors"
                    >
                      Saldo total
                    </button>
                  </div>
                  {monto !== '' && !montoValido && (
                    <p className="text-xs text-red-600 mt-1">
                      El monto debe ser mayor a cero y no exceder el saldo ({fmt(saldoTotal)}).
                    </p>
                  )}
                </div>

                {/* Método */}
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Método de pago</p>
                  <div className="grid grid-cols-3 gap-2">
                    {METODOS.map(({ value, label, desc, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => setMetodo(value)}
                        className={`border rounded-xl p-3 text-center transition-colors ${
                          metodo === value
                            ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <Icon
                          className={`h-5 w-5 mx-auto mb-1 ${metodo === value ? 'text-blue-600' : 'text-gray-400'}`}
                          aria-hidden
                        />
                        <p className="text-sm font-semibold text-gray-800">{label}</p>
                        <p className="text-[11px] text-gray-400">{desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => crearMut.mutate()}
                  disabled={!montoValido || crearMut.isPending}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {crearMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Banknote className="h-4 w-4" aria-hidden />
                  )}
                  {crearMut.isPending ? 'Generando…' : `Generar referencia de pago${montoValido ? ` por ${fmt(montoNum)}` : ''}`}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Resultado del intento creado */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-base font-semibold text-gray-900">Instrucciones de pago</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {resultado
                ? `Referencia generada por ${fmt(Number(resultado.monto))}`
                : 'Genera una referencia para ver aquí las instrucciones.'}
            </p>
          </div>
          <div className="p-5">
            {!resultado ? (
              <div className="py-10 text-center">
                <div className="h-12 w-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Banknote className="h-6 w-6 text-gray-400" aria-hidden />
                </div>
                <p className="text-sm text-gray-500">Aún no has generado una referencia de pago.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {resultado.metodo === 'spei' && (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">
                      Realiza una transferencia SPEI desde tu banca en línea con estos datos:
                    </p>
                    <CopiableRow label="CLABE" value={grupos4(datos?.clabe ?? '')} />
                    <CopiableRow label="Referencia" value={resultado.referencia} />
                    {datos?.banco && <CopiableRow label="Banco" value={datos.banco} mono={false} />}
                    {datos?.beneficiario && (
                      <CopiableRow label="Beneficiario" value={datos.beneficiario} mono={false} />
                    )}
                    {datos?.conceptoPago && (
                      <CopiableRow label="Concepto" value={datos.conceptoPago} mono={false} />
                    )}
                  </div>
                )}
                {resultado.metodo === 'oxxo' && (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">
                      Presenta esta línea de captura en cualquier tienda OXXO:
                    </p>
                    <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-4 text-center mb-2">
                      <p className="text-xl font-mono font-bold tracking-widest text-gray-900">
                        {grupos4(datos?.lineaCaptura ?? resultado.referencia)}
                      </p>
                    </div>
                    <CopiableRow label="Línea de captura" value={datos?.lineaCaptura ?? resultado.referencia} />
                    {datos?.comision && <p className="text-xs text-gray-400 mt-2">{datos.comision}</p>}
                  </div>
                )}
                {resultado.metodo === 'tarjeta' && (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-600">
                      Completa el pago con tarjeta en la página segura de la pasarela:
                    </p>
                    {resultado.urlPago ? (
                      <a
                        href={resultado.urlPago}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden />
                        Ir a la página de pago
                      </a>
                    ) : (
                      <p className="text-sm text-gray-400">No se recibió URL de pago.</p>
                    )}
                    <CopiableRow label="Referencia del cargo" value={resultado.referencia} />
                  </div>
                )}
                <div className="flex items-center justify-between text-xs text-gray-400 pt-2">
                  <span>Monto: <span className="font-semibold text-gray-600">{fmt(Number(resultado.monto))}</span></span>
                  <span>Vence: {fmtFechaHora(resultado.expiraEn)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Intentos previos */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            Pagos en línea generados{intentos.length > 0 ? ` (${intentos.length})` : ''}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Referencias generadas y su estado. Las pendientes se confirman al recibir el pago.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Fecha</th>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Método</th>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Referencia</th>
              <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Monto</th>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Estado</th>
              <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {intentosQ.isLoading ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-gray-400 text-sm">
                  Cargando intentos de pago…
                </td>
              </tr>
            ) : intentos.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-gray-400 text-sm">
                  No has generado pagos en línea para este contrato.
                </td>
              </tr>
            ) : (
              intentos.map((i) => (
                <tr key={i.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5 text-gray-600 tabular-nums">{fmtFechaHora(i.createdAt)}</td>
                  <td className="px-5 py-3.5 font-semibold text-gray-800 uppercase">{i.metodo}</td>
                  <td className="px-5 py-3.5 font-mono text-xs text-gray-600 max-w-[200px] truncate" title={i.referencia}>
                    {i.referencia}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums font-semibold text-gray-800">
                    {fmt(Number(i.monto))}
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${ESTADO_INTENTO[i.estado] ?? 'bg-gray-100 text-gray-600'}`}
                    >
                      {i.estado}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {i.estado === 'pendiente' && (
                      <button
                        onClick={() => simularMut.mutate(i.id)}
                        disabled={simularMut.isPending}
                        title="Modo demo: confirma el pago como si la pasarela hubiera notificado"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 border border-blue-200 rounded-lg px-2.5 py-1.5 hover:bg-blue-50 transition-colors disabled:opacity-50"
                      >
                        {simularMut.isPending && simularMut.variables === i.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <PlayCircle className="h-3.5 w-3.5" aria-hidden />
                        )}
                        Simular pago
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PagarEnLinea;
