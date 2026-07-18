import type { UserRole } from '@/context/AuthContext';
import {
  LayoutDashboard,
  FileCheck,
  Building2,
  MapPin,
  FileText,
  Gauge,
  Route,
  BookOpen,
  BarChart3,
  Calculator,
  FileSearch,
  SlidersHorizontal,
  Stamp,
  Printer,
  CreditCard,
  PieChart,
  Headphones,
  ClipboardList,
  Handshake,
  Activity,
  Database,
  Settings2,
  ClipboardPlus,
  Scale,
  Landmark,
  NotebookTabs,
  Braces,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface AppRouteConfig {
  path: string;
  label: string;
  icon: LucideIcon;
  allowedRoles: UserRole[];
  group: string;
}

/** All internal /app/* routes with role permissions and sidebar metadata */
export const APP_ROUTES: AppRouteConfig[] = [
  // General
  {
    path: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'LECTURISTA', 'ATENCION_CLIENTES'],
    group: 'General',
  },
  // Infraestructura
  {
    path: 'factibilidades',
    label: 'Factibilidades',
    icon: FileCheck,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'OPERADOR'],
    group: 'Infraestructura',
  },
  {
    path: 'construcciones',
    label: 'Construcción',
    icon: Building2,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'OPERADOR'],
    group: 'Infraestructura',
  },
  {
    path: 'puntos-servicio',
    label: 'Puntos de servicio',
    icon: MapPin,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES'],
    group: 'Infraestructura',
  },
  // Servicios
  {
    path: 'solicitudes',
    label: 'Solicitudes',
    icon: ClipboardPlus,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES'],
    group: 'Servicios',
  },
  {
    path: 'contratos',
    label: 'Contratos',
    icon: FileText,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES'],
    group: 'Servicios',
  },
  {
    path: 'medidores',
    label: 'Medidores',
    icon: Gauge,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'OPERADOR'],
    group: 'Servicios',
  },
  {
    path: 'rutas',
    label: 'Rutas',
    icon: Route,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'LECTURISTA'],
    group: 'Servicios',
  },
  {
    path: 'lecturas',
    label: 'Lecturas',
    icon: BookOpen,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'LECTURISTA'],
    group: 'Servicios',
  },
  // Facturación
  {
    path: 'consumos',
    label: 'Consumos',
    icon: BarChart3,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'OPERADOR'],
    group: 'Facturación',
  },
  {
    path: 'tarifas',
    label: 'Tarifas',
    icon: Calculator,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
    group: 'Facturación',
  },
  {
    path: 'simulador',
    label: 'Simulador',
    icon: FileSearch,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
    group: 'Facturación',
  },
  {
    path: 'prefacturacion',
    label: 'Pre-Facturación',
    icon: FileSearch,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
    group: 'Facturación',
  },
  {
    path: 'ajustes-facturacion',
    label: 'Ajustes facturación',
    icon: SlidersHorizontal,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
    group: 'Facturación',
  },
  {
    path: 'timbrado',
    label: 'Timbrado',
    icon: Stamp,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
    group: 'Facturación',
  },
  {
    path: 'recibos',
    label: 'Recibos',
    icon: Printer,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ATENCION_CLIENTES'],
    group: 'Facturación',
  },
  // Finanzas
  {
    path: 'pagos',
    label: 'Pagos',
    icon: CreditCard,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ATENCION_CLIENTES'],
    group: 'Finanzas',
  },
  {
    path: 'convenios',
    label: 'Convenios',
    icon: Handshake,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ATENCION_CLIENTES'],
    group: 'Finanzas',
  },
  {
    path: 'cartera',
    label: 'Cartera y cobranza',
    icon: Wallet,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES'],
    group: 'Finanzas',
  },
  {
    path: 'contabilidad',
    label: 'Contabilidad',
    icon: PieChart,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
    group: 'Finanzas',
  },
  // Atención al Cliente
  {
    path: 'atencion-clientes',
    label: 'Atención a clientes',
    icon: Headphones,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ATENCION_CLIENTES'],
    group: 'Atención al Cliente',
  },
  {
    path: 'tramites-digitales-admin',
    label: 'Trámites Digitales',
    icon: ClipboardList,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'ATENCION_CLIENTES'],
    group: 'Atención al Cliente',
  },
  // Operaciones
  {
    path: 'indicadores',
    label: 'Indicadores PIGOO',
    icon: PieChart,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
    group: 'Operaciones',
  },
  {
    path: 'monitoreo',
    label: 'Monitoreo',
    icon: Activity,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
    group: 'Operaciones',
  },
  // Configuración
  {
    path: 'administraciones',
    label: 'Administraciones (SIGE)',
    icon: Landmark,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
    group: 'Configuración',
  },
  {
    path: 'catalogos',
    label: 'Catálogos CIG2018',
    icon: Database,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
    group: 'Configuración',
  },
  {
    path: 'catalogos-contrato',
    label: 'Catálogos del contrato',
    icon: NotebookTabs,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
    group: 'Configuración',
  },
  {
    path: 'catalogos-sat',
    label: 'Catálogos SAT (CFDI)',
    icon: Scale,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
    group: 'Configuración',
  },
  {
    path: 'tipos-contratacion',
    label: 'Tipos de contratación',
    icon: Settings2,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
    group: 'Configuración',
  },
  {
    path: 'variables-contratacion',
    label: 'Variables de contratación',
    icon: Braces,
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
    group: 'Configuración',
  },
];

/** Group route configs by their group label for sidebar rendering */
export function groupRoutesBySection(
  routes: AppRouteConfig[],
): { label: string; items: AppRouteConfig[] }[] {
  const map = new Map<string, AppRouteConfig[]>();
  for (const route of routes) {
    const existing = map.get(route.group) ?? [];
    existing.push(route);
    map.set(route.group, existing);
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
}

/** Filter routes visible to a specific role */
export function routesForRole(role: UserRole): AppRouteConfig[] {
  return APP_ROUTES.filter((r) => r.allowedRoles.includes(role));
}
