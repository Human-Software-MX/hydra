import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Droplets,
  Grid3X3,
  HelpCircle,
  LogOut,
  Search,
  Settings,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { groupRoutesBySection, routesForRole, type AppRouteConfig } from '@/config/routes';

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Usuario',
  ADMIN: 'Administrador',
  OPERADOR: 'Operador Central',
  LECTURISTA: 'Lecturista',
  ATENCION_CLIENTES: 'Atención Clientes',
  CLIENTE: 'Cliente',
};

/** Grupos que se muestran como ítems sueltos (sin header colapsable) */
const STANDALONE_GROUPS = ['General'];

const OPEN_GROUPS_KEY = 'hydra.sidebar.openGroups';

function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}

function routePath(item: AppRouteConfig) {
  return item.path === 'tramites-digitales-admin' ? '/tramites-digitales' : `/app/${item.path}`;
}

function loadOpenGroups(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function NavItem({ item }: { item: AppRouteConfig }) {
  return (
    <NavLink
      to={routePath(item)}
      end={item.path === 'dashboard'}
      className={({ isActive }) =>
        `flex items-center gap-3 pl-3 pr-2 py-2.5 rounded-xl text-[11px] font-semibold uppercase tracking-[0.08em] mb-0.5 transition-colors ${
          isActive
            ? 'bg-[#007BFF]/[0.08] text-[#007BFF]'
            : 'text-slate-500 hover:bg-slate-100/80 hover:text-slate-800'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <item.icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.6} />
          <span className="flex-1 truncate" title={item.label}>
            {item.label}
          </span>
          {isActive && <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-60" strokeWidth={2} />}
        </>
      )}
    </NavLink>
  );
}

const AppLayout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const visibleRoutes = user ? routesForRole(user.role) : [];
  const navGroups = groupRoutesBySection(visibleRoutes);
  const looseItems = navGroups
    .filter((g) => STANDALONE_GROUPS.includes(g.label))
    .flatMap((g) => g.items);
  const collapsibleGroups = navGroups.filter((g) => !STANDALONE_GROUPS.includes(g.label));

  const roleLabel = user ? (ROLE_LABELS[user.role] ?? user.role) : '';
  const userInitials = user?.name ? initials(user.name) : 'U';

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(loadOpenGroups);

  // Abre automáticamente el grupo que contiene la ruta activa
  useEffect(() => {
    const active = collapsibleGroups.find((g) =>
      g.items.some((i) => {
        const p = routePath(i);
        return location.pathname === p || location.pathname.startsWith(`${p}/`);
      }),
    );
    if (active) {
      setOpenGroups((prev) => (prev[active.label] ? prev : { ...prev, [active.label]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, user?.role]);

  useEffect(() => {
    localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(openGroups));
  }, [openGroups]);

  const toggleGroup = (label: string) =>
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className="w-64 flex-shrink-0 flex flex-col bg-white border-r border-slate-200/70">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 pt-5 pb-3">
          <div className="w-9 h-9 rounded-xl bg-[#007BFF] flex items-center justify-center shrink-0 shadow-sm shadow-[#007BFF]/25">
            <Droplets className="w-[18px] h-[18px] text-white" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <p className="text-slate-900 text-[14px] font-bold leading-tight truncate">
              CEA Querétaro
            </p>
            <p className="text-slate-400 text-[9px] uppercase tracking-[0.16em]">
              Water Management
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav flex-1 overflow-y-auto px-3 py-3" aria-label="Navegación principal">
          {/* Ítems sueltos (General) */}
          {looseItems.length > 0 && (
            <div className="mb-2">
              {looseItems.map((item) => (
                <NavItem key={item.path} item={item} />
              ))}
            </div>
          )}

          {/* Grupos colapsables */}
          {collapsibleGroups.map((group) => {
            const open = Boolean(openGroups[group.label]);
            const contentId = `sidebar-group-${group.label.replace(/\s+/g, '-').toLowerCase()}`;
            return (
              <div key={group.label} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={open}
                  aria-controls={contentId}
                  className={`flex w-full items-center justify-between pl-3 pr-2.5 py-2.5 rounded-lg text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors ${
                    open
                      ? 'text-[#007BFF]'
                      : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100/60'
                  }`}
                >
                  <span className="truncate" title={group.label}>
                    {group.label}
                  </span>
                  {open ? (
                    <ChevronDown className="w-4 h-4 shrink-0 opacity-70" strokeWidth={1.8} />
                  ) : (
                    <ChevronRight className="w-4 h-4 shrink-0 opacity-70" strokeWidth={1.8} />
                  )}
                </button>
                {open && (
                  <div id={contentId} className="pb-1">
                    {group.items.map((item) => (
                      <NavItem key={item.path} item={item} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Bottom: usuario + acciones */}
        <div className="px-5 pt-4 pb-4 border-t border-slate-200/70">
          <p className="text-slate-900 text-[15px] font-semibold leading-tight truncate">
            {user?.name ?? '—'}
          </p>
          <p className="text-slate-400 text-[12px] truncate mb-3">{roleLabel}</p>

          <button className="flex items-center gap-3 w-full py-2 text-[13px] text-slate-500 hover:text-slate-800 transition-colors">
            <HelpCircle className="w-[18px] h-[18px] shrink-0" strokeWidth={1.6} />
            Soporte
          </button>
          <button className="flex items-center justify-between w-full py-2 text-[13px] text-slate-500 hover:text-slate-800 transition-colors">
            <span className="flex items-center gap-3">
              <Settings className="w-[18px] h-[18px] shrink-0" strokeWidth={1.6} />
              Configuración
            </span>
            <ChevronRight className="w-4 h-4 shrink-0 opacity-60" strokeWidth={1.8} />
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full py-2 text-[13px] text-slate-500 hover:text-red-600 transition-colors"
          >
            <LogOut className="w-[18px] h-[18px] shrink-0" strokeWidth={1.6} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="h-14 bg-white border-b border-border/60 flex items-center gap-4 px-6 shrink-0">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              className="w-full pl-9 pr-4 py-2 text-sm bg-muted/50 rounded-lg border border-transparent focus:bg-white focus:border-[#007BFF]/40 focus:ring-2 focus:ring-[#007BFF]/20 outline-none placeholder:text-muted-foreground transition-all"
              placeholder="Buscar expedientes o predios..."
            />
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-0.5 ml-auto">
            <button className="relative p-2 rounded-lg hover:bg-muted transition-colors">
              <Bell className="w-5 h-5 text-muted-foreground" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white" />
            </button>
            <button className="p-2 rounded-lg hover:bg-muted transition-colors">
              <HelpCircle className="w-5 h-5 text-muted-foreground" />
            </button>
            <button className="p-2 rounded-lg hover:bg-muted transition-colors">
              <Grid3X3 className="w-5 h-5 text-muted-foreground" />
            </button>

            {/* User chip */}
            <div className="ml-3 flex items-center gap-2.5 pl-3 border-l border-border">
              <div className="text-right leading-tight">
                <p className="text-[13px] font-semibold text-foreground">{user?.name ?? '—'}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  {roleLabel}
                </p>
              </div>
              <div className="w-8 h-8 rounded-full bg-[#4A6278] flex items-center justify-center text-white text-[12px] font-bold shrink-0">
                {userInitials}
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-8 py-6 animate-fade-in">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
