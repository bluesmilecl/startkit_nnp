/**
 * Catalog of implemented permissions. Every key must be enforced by at least one server
 * operation. `pnpm db:migrate` synchronizes it to the `permissions` table: new keys receive the
 * default grants of the system roles below; keys that already existed keep the matrix that
 * administrators configured. Modules add their keys here (`pnpm starter generate module` does it).
 */
export const PERMISSIONS = {
  'users.read': { group: 'users', description: 'Ver usuarios' },
  'users.create': { group: 'users', description: 'Crear usuarios' },
  'users.invite': { group: 'users', description: 'Invitar usuarios por correo' },
  'users.update': { group: 'users', description: 'Editar datos de usuarios' },
  'users.disable': { group: 'users', description: 'Desactivar y reactivar usuarios, revocar sesiones' },
  'users.delete': { group: 'users', description: 'Eliminar usuarios', sensitive: true },
  'roles.read': { group: 'roles', description: 'Ver roles y asignaciones' },
  'roles.manage': { group: 'roles', description: 'Crear, editar y asignar roles', sensitive: true },
  'permissions.read': { group: 'roles', description: 'Ver catálogo de permisos' },
  'permissions.manage': { group: 'roles', description: 'Cambiar permisos de roles', sensitive: true },
  'organizations.read': { group: 'organizations', description: 'Ver organizaciones' },
  'organizations.manage': { group: 'organizations', description: 'Administrar organizaciones y membresías', sensitive: true },
  'settings.read': { group: 'settings', description: 'Ver configuración' },
  'settings.update': { group: 'settings', description: 'Cambiar configuración' },
  'audit.read': { group: 'audit', description: 'Ver auditoría' },
  'system.diagnostics': { group: 'system', description: 'Ver diagnósticos, versiones y salud del sistema' },
  'api.docs': { group: 'system', description: 'Ver la documentación OpenAPI protegida' },
  'ai.chat': { group: 'ai', description: 'Usar el chat de IA' },
  'ai.providers.manage': { group: 'ai', description: 'Administrar conexiones de proveedores IA', sensitive: true },
  'ai.models.manage': { group: 'ai', description: 'Administrar catálogo de modelos y tarifas' },
  'ai.agents.manage': { group: 'ai', description: 'Configurar y publicar agentes' },
  'ai.usage.read': { group: 'ai', description: 'Ver consumo y costos de IA' },
  'ai.budgets.manage': { group: 'ai', description: 'Administrar presupuestos de IA' },
  'ai.lab.use': { group: 'ai', description: 'Usar el laboratorio y recomendador de modelos' },
  'rag.collections.read': { group: 'rag', description: 'Ver colecciones de conocimiento' },
  'rag.collections.manage': { group: 'rag', description: 'Administrar colecciones y conexiones RAG' },
  'rag.sources.manage': { group: 'rag', description: 'Administrar fuentes de conocimiento' },
  'rag.documents.read': { group: 'rag', description: 'Ver documentos y fragmentos autorizados' },
  'rag.documents.delete': { group: 'rag', description: 'Eliminar documentos' },
  'rag.jobs.manage': { group: 'rag', description: 'Gestionar trabajos de indexación' },
  'rag.playground.use': { group: 'rag', description: 'Usar el laboratorio de búsqueda' },
  'rag.analytics.read': { group: 'rag', description: 'Ver analítica de conocimiento' },
  'projects.read': { group: 'projects', description: 'Ver proyectos' },
  'projects.manage': { group: 'projects', description: 'Crear y editar proyectos' },
} as const satisfies Record<string, { group: string; description: string; sensitive?: boolean }>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.hasOwn(PERMISSIONS, value);
}

export const SYSTEM_ROLES = {
  owner: { name: 'Propietario', rank: 100, description: 'Control total de la instalación' },
  admin: { name: 'Administrador', rank: 80, description: 'Administra usuarios, configuración, IA y conocimiento' },
  editor: { name: 'Editor', rank: 50, description: 'Gestiona contenido y conocimiento' },
  viewer: { name: 'Lector', rank: 10, description: 'Acceso de lectura y chat' },
} as const;
export type SystemRoleKey = keyof typeof SYSTEM_ROLES;

const all = PERMISSION_KEYS;
const without = (...keys: PermissionKey[]) => all.filter((k) => !keys.includes(k));

/** Default permissions of system roles (owner permissions are immutable = all). */
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleKey, PermissionKey[]> = {
  owner: all,
  admin: without('ai.providers.manage', 'organizations.manage'),
  editor: [
    'users.read',
    'roles.read',
    'permissions.read',
    'settings.read',
    'ai.chat',
    'ai.usage.read',
    'rag.collections.read',
    'rag.sources.manage',
    'rag.documents.read',
    'rag.documents.delete',
    'rag.jobs.manage',
    'rag.playground.use',
    'rag.analytics.read',
    'projects.read',
    'projects.manage',
  ],
  viewer: ['ai.chat', 'rag.collections.read', 'rag.documents.read', 'projects.read'],
};
