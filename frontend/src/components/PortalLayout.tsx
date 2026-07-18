import { useEffect, useState, useCallback } from 'react';
import { Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { LogOut, Menu, X, ChevronDown } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getPortalContratos, type PortalContrato } from '@/api/portal';

export interface PortalContextValue {
  contratos: PortalContrato[];
  contratoId: string | null;
  setContratoId: (id: string) => void;
  loadingContratos: boolean;
}

const NAV_ITEMS = [
  { label: 'Inicio', tab: 'inicio' },
  { label: 'Trámites', tab: 'tramites-digitales' },
  { label: 'Consumo', tab: 'consumo' },
  { label: 'Facturas', tab: 'facturas' },
  { label: 'Recibos', tab: 'recibos' },
  { label: 'Pagar en línea', tab: 'pagar' },
  { label: 'Pagos', tab: 'metodos-pago' },
] as const;

const PortalLayout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [contratos, setContratos] = useState<PortalContrato[]>([]);
  const [loadingContratos, setLoadingContratos] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [contractDropdownOpen, setContractDropdownOpen] = useState(false);

  const contratoIdFromUrl = searchParams.get('contrato');
  const [contratoId, setContratoIdState] = useState<string | null>(contratoIdFromUrl);

  const activeTab = searchParams.get('tab') ?? 'inicio';

  useEffect(() => {
    setLoadingContratos(true);
    getPortalContratos()
      .then((data) => {
        setContratos(data);
        setContratoIdState((prev) => {
          const valid = prev && data.some((c) => c.id === prev) ? prev : (data[0]?.id ?? null);
          return valid;
        });
      })
      .catch(() => setContratos([]))
      .finally(() => setLoadingContratos(false));
  }, []);

  // Sync contratoId → URL
  useEffect(() => {
    if (!contratoId) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('contrato', contratoId);
        if (!next.get('tab')) next.set('tab', 'inicio');
        return next;
      },
      { replace: true }
    );
  }, [contratoId, setSearchParams]);

  const setContratoId = useCallback((id: string) => {
    setContratoIdState(id);
    setContractDropdownOpen(false);
  }, []);

  const navigateToTab = (tab: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', tab);
        return next;
      },
      { replace: true }
    );
    setMobileMenuOpen(false);
  };

  const handleLogout = () => {
    logout();
    navigate('/portal/login', { replace: true });
  };

  const selectedContrato = contratos.find((c) => c.id === contratoId);

  const contextValue: PortalContextValue = {
    contratos,
    contratoId,
    setContratoId,
    loadingContratos,
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Navbar */}
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16 gap-6">
            {/* Logo */}
            <button
              onClick={() => navigateToTab('inicio')}
              className="flex items-center gap-2 shrink-0 group"
            >
              <svg viewBox="0 0 24 24" className="h-7 w-7 fill-blue-600 shrink-0" aria-hidden>
                <polygon points="12,2 22,20 2,20" />
              </svg>
              <span className="text-base font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                CEA Querétaro
              </span>
            </button>

            {/* Nav links — desktop */}
            <nav className="hidden md:flex items-center gap-1 flex-1">
              {NAV_ITEMS.map(({ label, tab }) => (
                <button
                  key={tab}
                  onClick={() => navigateToTab(tab)}
                  className={`
                    relative px-3 py-5 text-sm font-medium transition-colors
                    ${activeTab === tab
                      ? 'text-blue-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-blue-600'
                      : 'text-gray-600 hover:text-gray-900'
                    }
                  `}
                >
                  {label}
                </button>
              ))}
            </nav>

            {/* Right side */}
            <div className="ml-auto flex items-center gap-3">
              {/* Contract selector */}
              {contratos.length > 0 && (
                <div className="relative hidden sm:block">
                  <button
                    onClick={() => setContractDropdownOpen((o) => !o)}
                    className="flex items-center gap-1.5 text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-gray-700 font-medium">
                      {selectedContrato
                        ? `${selectedContrato.id} — ${selectedContrato.tipoServicio}`
                        : 'Seleccionar contrato'}
                    </span>
                    <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden />
                  </button>
                  {contractDropdownOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setContractDropdownOpen(false)}
                      />
                      <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                        {contratos.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => setContratoId(c.id)}
                            className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                              c.id === contratoId
                                ? 'bg-blue-50 text-blue-700 font-medium'
                                : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {c.id} — {c.tipoServicio}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* User info */}
              {user && (
                <div className="hidden sm:flex items-center gap-2">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900 leading-none">{user.name}</p>
                  </div>
                  <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-blue-700">
                      {user.name?.charAt(0)?.toUpperCase() ?? 'U'}
                    </span>
                  </div>
                </div>
              )}

              {/* Logout */}
              <button
                onClick={handleLogout}
                title="Cerrar sesión"
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-600 transition-colors px-2 py-1 rounded-md hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Salir</span>
              </button>

              {/* Mobile menu button */}
              <button
                className="md:hidden p-2 rounded-md text-gray-500 hover:bg-gray-100"
                onClick={() => setMobileMenuOpen((o) => !o)}
                aria-label="Menú"
              >
                {mobileMenuOpen ? (
                  <X className="h-5 w-5" aria-hidden />
                ) : (
                  <Menu className="h-5 w-5" aria-hidden />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile nav */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white px-4 py-2">
            {/* Contract selector — mobile */}
            {contratos.length > 0 && (
              <div className="mb-2 pb-2 border-b border-gray-100">
                <p className="text-xs text-gray-400 mb-1">Contrato activo</p>
                <select
                  value={contratoId ?? ''}
                  onChange={(e) => setContratoId(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5"
                >
                  {contratos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id} — {c.tipoServicio}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {NAV_ITEMS.map(({ label, tab }) => (
              <button
                key={tab}
                onClick={() => navigateToTab(tab)}
                className={`block w-full text-left px-2 py-2.5 text-sm font-medium rounded-md ${
                  activeTab === tab
                    ? 'text-blue-600 bg-blue-50'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Page content */}
      <main className="flex-1">
        <Outlet context={contextValue} />
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-blue-600" aria-hidden>
                <polygon points="12,2 22,20 2,20" />
              </svg>
              <span className="text-sm text-gray-500">
                © 2026 CEA Querétaro. Todos los derechos reservados.
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <button className="hover:text-blue-600 transition-colors">Aviso de Privacidad</button>
              <button className="hover:text-blue-600 transition-colors">Términos y Condiciones</button>
              <button className="hover:text-blue-600 transition-colors">Contacto</button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default PortalLayout;
