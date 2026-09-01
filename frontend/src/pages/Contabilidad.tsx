import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { Button } from '@/components/ui/button';
import { PieChart, FileText, Send, TrendingUp, AlertCircle } from 'lucide-react';
import { toast } from '@/components/ui/sonner';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }).format(value);

const Contabilidad = () => {
  const { pagos, preFacturas, timbrados } = useData();
  const [generandoPolizas, setGenerandoPolizas] = useState(false);
  const [enviandoSap, setEnviandoSap] = useState(false);

  const totalFacturado = preFacturas.filter(pf => pf.estado === 'Aceptada').reduce((s, pf) => s + pf.total, 0);
  const totalCobrado = pagos.reduce((s, p) => s + p.monto, 0);
  const totalTimbrado = timbrados.filter(t => t.estado === 'Timbrada OK').length;
  const erroresTimbrado = timbrados.filter(t => t.estado === 'Error PAC').length;
  const carteraPorCobrar = Math.max(0, totalFacturado - totalCobrado);
  const porcentajeCobro = totalFacturado > 0 ? (totalCobrado / totalFacturado) * 100 : 0;

  const handleGenerarPolizas = async () => {
    setGenerandoPolizas(true);
    await new Promise(r => setTimeout(r, 1200));
    setGenerandoPolizas(false);
    toast.success('Pólizas generadas (simulado)', { description: 'Periodo actual procesado correctamente.' });
  };

  const handleEnviarSap = async () => {
    setEnviandoSap(true);
    await new Promise(r => setTimeout(r, 1500));
    setEnviandoSap(false);
    toast.success('Enviado a SAP (simulado)', { description: 'Información contable sincronizada.' });
  };

  const handleReporte = (nombre: string) => {
    toast.info(`Reporte "${nombre}"`, { description: 'Funcionalidad en desarrollo.' });
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Contabilidad</h1>
          <p className="text-sm text-muted-foreground">Resumen contable, pólizas y envío a SAP</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <Link to="/app/prefacturacion" className="widget-card text-center hover:shadow-md transition-shadow">
          <PieChart className="h-8 w-8 mx-auto mb-2 text-primary" aria-hidden />
          <p className="text-2xl font-bold tabular-nums">{formatCurrency(totalFacturado)}</p>
          <p className="text-sm text-muted-foreground">Total facturado</p>
        </Link>
        <Link to="/app/pagos" className="widget-card text-center hover:shadow-md transition-shadow">
          <FileText className="h-8 w-8 mx-auto mb-2 text-success" aria-hidden />
          <p className="text-2xl font-bold tabular-nums">{formatCurrency(totalCobrado)}</p>
          <p className="text-sm text-muted-foreground">Total cobrado</p>
        </Link>
        <Link to="/app/timbrado" className="widget-card text-center hover:shadow-md transition-shadow">
          <Send className="h-8 w-8 mx-auto mb-2 text-[#007BFF]" aria-hidden />
          <p className="text-2xl font-bold tabular-nums">{totalTimbrado}</p>
          <p className="text-sm text-muted-foreground">CFDIs timbrados</p>
        </Link>
        <div className="widget-card text-center">
          <TrendingUp className="h-8 w-8 mx-auto mb-2 text-muted-foreground" aria-hidden />
          <p className="text-2xl font-bold tabular-nums">{formatCurrency(carteraPorCobrar)}</p>
          <p className="text-sm text-muted-foreground">Cartera por cobrar</p>
          {totalFacturado > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {porcentajeCobro.toFixed(0)}% cobrado
            </p>
          )}
        </div>
      </div>

      {erroresTimbrado > 0 && (
        <Link
          to="/app/timbrado"
          className="mb-6 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive hover:bg-destructive/10 transition-colors"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{erroresTimbrado} CFDIs con error de timbrado — revisar</span>
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="widget-card" aria-labelledby="polizas-heading">
          <h3 id="polizas-heading" className="section-title">Generación de pólizas</h3>
          <p className="text-sm text-muted-foreground mb-4">Genera pólizas contables del periodo actual</p>
          <Button
            variant="outline"
            onClick={handleGenerarPolizas}
            disabled={generandoPolizas}
            aria-busy={generandoPolizas}
          >
            {generandoPolizas ? 'Generando…' : 'Generar pólizas (simulado)'}
          </Button>
        </section>

        <section className="widget-card" aria-labelledby="sap-heading">
          <h3 id="sap-heading" className="section-title">Envío a SAP</h3>
          <p className="text-sm text-muted-foreground mb-4">Envía la información contable al sistema SAP</p>
          <Button
            variant="outline"
            onClick={handleEnviarSap}
            disabled={enviandoSap}
            aria-busy={enviandoSap}
          >
            {enviandoSap ? 'Enviando…' : 'Enviar a SAP (simulado)'}
          </Button>
        </section>
      </div>

      <section className="mt-6 widget-card" aria-labelledby="reportes-heading">
        <h3 id="reportes-heading" className="section-title">Reportes</h3>
        <div className="flex gap-3 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => handleReporte('Ingresos')}>
            Reporte de ingresos
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleReporte('Cartera vencida')}>
            Reporte de cartera vencida
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleReporte('Facturación')}>
            Reporte de facturación
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleReporte('Cobranza')}>
            Reporte de cobranza
          </Button>
        </div>
      </section>
    </div>
  );
};

export default Contabilidad;
