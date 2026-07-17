import { lazy, Suspense } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { DataProvider } from '@/context/DataContext';
import { AuthProvider } from '@/context/AuthContext';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { INTERNAL_ROLES, PORTAL_ROLES } from '@/context/AuthContext';

// Layouts
import AppLayout from '@/components/AppLayout';
import PortalLayout from '@/components/PortalLayout';

// Auth pages (small, eager)
import Login from '@/pages/auth/Login';
import PortalLogin from '@/pages/portal/PortalLogin';

// Internal pages (lazy)
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Factibilidades = lazy(() => import('@/pages/Factibilidades'));
const Construcciones = lazy(() => import('@/pages/Construcciones'));
const PuntosServicio = lazy(() => import('@/pages/PuntosServicio'));
const Contratos = lazy(() => import('@/pages/Contratos'));
const Medidores = lazy(() => import('@/pages/Medidores'));
const Rutas = lazy(() => import('@/pages/Rutas'));
const Lecturas = lazy(() => import('@/pages/Lecturas'));
const Consumos = lazy(() => import('@/pages/Consumos'));
const Tarifas = lazy(() => import('@/pages/Tarifas'));
const Simulador = lazy(() => import('@/pages/Simulador'));
const PreFacturacion = lazy(() => import('@/pages/PreFacturacion'));
const AjustesFacturacion = lazy(() => import('@/pages/AjustesFacturacion'));
const TimbradoPage = lazy(() => import('@/pages/TimbradoPage'));
const Recibos = lazy(() => import('@/pages/Recibos'));
const Convenios = lazy(() => import('@/pages/Convenios'));
const Pagos = lazy(() => import('@/pages/Pagos'));
const Contabilidad = lazy(() => import('@/pages/Contabilidad'));
const AtencionClientes = lazy(() => import('@/pages/AtencionClientes'));
const Monitoreo = lazy(() => import('@/pages/Monitoreo'));
const Indicadores = lazy(() => import('@/pages/Indicadores'));
const Catalogos = lazy(() => import('@/pages/Catalogos'));
const CatalogosContrato = lazy(() => import('@/pages/CatalogosContrato'));
const Administraciones = lazy(() => import('@/pages/Administraciones'));
const TiposContratacion = lazy(() => import('@/pages/TiposContratacion'));
const VariablesContratacion = lazy(() => import('@/pages/VariablesContratacion'));
const SolicitudServicio = lazy(() => import('@/pages/SolicitudServicio'));
const Solicitudes = lazy(() => import('@/pages/Solicitudes'));

// Portal + public pages (lazy)
const PortalCliente = lazy(() => import('@/pages/PortalCliente'));
const TramitesDigitales = lazy(() => import('@/pages/TramitesDigitales'));
const TramiteBajaDefinitiva = lazy(() => import('@/pages/portal/TramiteBajaDefinitiva'));
const TramiteBajaTemporal = lazy(() => import('@/pages/portal/TramiteBajaTemporal'));
const TramiteCambioPropietario = lazy(() => import('@/pages/portal/TramiteCambioPropietario'));

// Misc
import NotFound from '@/pages/NotFound';

const queryClient = new QueryClient();

/** Full-page spinner used as Suspense fallback */
const PageLoader = () => (
  <div className="flex min-h-screen items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <DataProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* ── Root redirect ── */}
                <Route path="/" element={<RootRedirect />} />

                {/* ── Auth pages ── */}
                <Route path="/login" element={<Login />} />
                <Route path="/portal/login" element={<PortalLogin />} />

                {/* ── Internal app (/app/*) ── */}
                <Route
                  element={
                    <ProtectedRoute
                      allowedRoles={INTERNAL_ROLES}
                      redirectTo="/login"
                    />
                  }
                >
                  <Route element={<AppLayout />}>
                    <Route path="/app" element={<Dashboard />} />
                    <Route path="/app/dashboard" element={<Dashboard />} />
                    <Route path="/app/factibilidades" element={<Factibilidades />} />
                    <Route path="/app/construcciones" element={<Construcciones />} />
<Route path="/app/puntos-servicio" element={<PuntosServicio />} />
                    <Route path="/app/solicitudes" element={<Solicitudes />} />
                    <Route path="/app/solicitudes/nueva" element={<SolicitudServicio />} />
                    <Route path="/app/solicitudes/:id/editar" element={<SolicitudServicio />} />
                    <Route path="/app/contratos" element={<Contratos />} />
                    <Route path="/app/medidores" element={<Medidores />} />
                    <Route path="/app/rutas" element={<Rutas />} />
                    <Route path="/app/lecturas" element={<Lecturas />} />
                    <Route path="/app/consumos" element={<Consumos />} />
                    <Route path="/app/tarifas" element={<Tarifas />} />
                    <Route path="/app/simulador" element={<Simulador />} />
                    <Route path="/app/prefacturacion" element={<PreFacturacion />} />
                    <Route path="/app/ajustes-facturacion" element={<AjustesFacturacion />} />
                    <Route path="/app/timbrado" element={<TimbradoPage />} />
                    <Route path="/app/recibos" element={<Recibos />} />
                    <Route path="/app/convenios" element={<Convenios />} />
                    <Route path="/app/pagos" element={<Pagos />} />
                    <Route path="/app/contabilidad" element={<Contabilidad />} />
                    <Route path="/app/atencion-clientes" element={<AtencionClientes />} />
                    <Route path="/app/monitoreo" element={<Monitoreo />} />
                    <Route path="/app/indicadores" element={<Indicadores />} />
                    <Route path="/app/administraciones" element={<Administraciones />} />
                    <Route path="/app/catalogos" element={<Catalogos />} />
                    <Route path="/app/catalogos-contrato" element={<CatalogosContrato />} />
                    <Route path="/app/catalogos-sat" element={<Catalogos />} />
                    <Route path="/app/tipos-contratacion" element={<TiposContratacion />} />
                    <Route path="/app/variables-contratacion" element={<VariablesContratacion />} />
                  </Route>
                </Route>

                {/* ── Portal de Clientes (/portal/*) ── */}
                <Route
                  element={
                    <ProtectedRoute
                      allowedRoles={PORTAL_ROLES}
                      redirectTo="/portal/login"
                    />
                  }
                >
                  <Route element={<PortalLayout />}>
                    <Route path="/portal" element={<PortalCliente />} />
                    <Route path="/portal/tramites/baja-definitiva" element={<TramiteBajaDefinitiva />} />
                    <Route path="/portal/tramites/baja-temporal" element={<TramiteBajaTemporal />} />
                    <Route path="/portal/tramites/cambio-propietario" element={<TramiteCambioPropietario />} />
                  </Route>
                </Route>

                {/* ── Trámites Digitales — public, no auth ── */}
                <Route path="/tramites-digitales" element={<TramitesDigitales />} />

                {/* ── 404 ── */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AuthProvider>
        </BrowserRouter>
      </DataProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

/**
 * Redirect from "/" based on auth state.
 * Reads the token directly (no context needed) to avoid a flash.
 */
const RootRedirect = () => {
  const token = localStorage.getItem('ctcf_access_token');
  if (token) {
    try {
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(base64)) as { role?: string; exp?: number };
      const isValid = typeof payload.exp === 'number' && Date.now() / 1000 < payload.exp;
      if (isValid) {
        if (payload.role === 'CLIENTE') return <Navigate to="/portal" replace />;
        return <Navigate to="/app" replace />;
      }
    } catch {
      // invalid token — fall through to login
    }
    localStorage.removeItem('ctcf_access_token');
  }
  return <Navigate to="/login" replace />;
};

export default App;
