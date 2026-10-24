import type { Component } from 'vue';
import {
  Activity,
  Bot,
  Boxes,
  Building2,
  ChartColumn,
  Cpu,
  Database,
  DollarSign,
  FileSearch,
  FileText,
  FlaskConical,
  FolderKanban,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Mail,
  Palette,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
  Stethoscope,
  Users,
  Wallet,
} from '@lucide/vue';

export interface NavItem {
  title: string;
  to: string;
  icon: Component;
  permission?: string | string[];
  feature?: 'ai' | 'rag' | 'organizations';
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/** Single navigation definition: the sidebar shows only entries allowed for the actor. */
export const NAVIGATION: NavSection[] = [
  {
    title: 'General',
    items: [
      { title: 'Inicio', to: '/admin', icon: LayoutDashboard },
      { title: 'Proyectos', to: '/admin/projects', icon: FolderKanban, permission: 'projects.read' },
    ],
  },
  {
    title: 'Acceso',
    items: [
      { title: 'Usuarios', to: '/admin/users', icon: Users, permission: 'users.read' },
      { title: 'Invitaciones', to: '/admin/invitations', icon: Mail, permission: 'users.invite' },
      { title: 'Roles', to: '/admin/roles', icon: ShieldCheck, permission: 'roles.read' },
      { title: 'Permisos', to: '/admin/permissions', icon: KeyRound, permission: ['permissions.read', 'roles.read'] },
      { title: 'Organizaciones', to: '/admin/organizations', icon: Building2, permission: 'organizations.read', feature: 'organizations' },
    ],
  },
  {
    title: 'Inteligencia artificial',
    items: [
      { title: 'Conexiones', to: '/admin/ai/connections', icon: Plug, permission: 'ai.providers.manage', feature: 'ai' },
      { title: 'Modelos', to: '/admin/ai/models', icon: Cpu, permission: 'ai.models.manage', feature: 'ai' },
      { title: 'Tarifas', to: '/admin/ai/prices', icon: DollarSign, permission: 'ai.models.manage', feature: 'ai' },
      { title: 'Agentes', to: '/admin/ai/agents', icon: Bot, permission: 'ai.agents.manage', feature: 'ai' },
      { title: 'Laboratorio', to: '/admin/ai/lab', icon: FlaskConical, permission: 'ai.lab.use', feature: 'ai' },
      { title: 'Uso y costos', to: '/admin/ai/usage', icon: ChartColumn, permission: 'ai.usage.read', feature: 'ai' },
      { title: 'Presupuestos', to: '/admin/ai/budgets', icon: Wallet, permission: 'ai.budgets.manage', feature: 'ai' },
    ],
  },
  {
    title: 'Conocimiento',
    items: [
      { title: 'Conexiones RAG', to: '/admin/knowledge/connections', icon: Database, permission: 'rag.collections.manage', feature: 'rag' },
      { title: 'Colecciones', to: '/admin/knowledge/collections', icon: Boxes, permission: 'rag.collections.read', feature: 'rag' },
      { title: 'Documentos', to: '/admin/knowledge/documents', icon: FileText, permission: 'rag.documents.read', feature: 'rag' },
      { title: 'Trabajos', to: '/admin/knowledge/jobs', icon: ListChecks, permission: 'rag.jobs.manage', feature: 'rag' },
      { title: 'Laboratorio de búsqueda', to: '/admin/knowledge/search', icon: FileSearch, permission: 'rag.playground.use', feature: 'rag' },
      { title: 'Analítica', to: '/admin/knowledge/analytics', icon: Activity, permission: 'rag.analytics.read', feature: 'rag' },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { title: 'Configuración', to: '/admin/settings', icon: Settings, permission: 'settings.read' },
      { title: 'Auditoría', to: '/admin/audit', icon: ScrollText, permission: 'audit.read' },
      { title: 'Diagnósticos', to: '/admin/diagnostics', icon: Stethoscope, permission: 'system.diagnostics' },
      { title: 'Componentes UI', to: '/admin/components', icon: Palette },
      { title: 'API (Swagger)', to: '/api/docs', icon: Gauge, permission: 'api.docs' },
    ],
  },
];

export function visibleNavigation(can: (p: string | string[]) => boolean, features: Record<string, boolean>): NavSection[] {
  return NAVIGATION.map((s) => ({
    ...s,
    items: s.items.filter((i) => (!i.permission || can(i.permission)) && (!i.feature || features[i.feature])),
  })).filter((s) => s.items.length);
}

export function breadcrumbFor(path: string): { title: string; to: string }[] {
  const all = NAVIGATION.flatMap((s) => s.items);
  const match = all.filter((i) => i.to !== '/admin' && (path === i.to || path.startsWith(`${i.to}/`))).sort((a, b) => b.to.length - a.to.length)[0];
  const crumbs = [{ title: 'Inicio', to: '/admin' }];
  if (match) crumbs.push({ title: match.title, to: match.to });
  return crumbs;
}
