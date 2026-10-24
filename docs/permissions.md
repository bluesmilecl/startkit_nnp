# Roles y permisos

## Principios

- **Catálogo = operaciones implementadas.** Cada clave de
  [`packages/contracts/src/permissions.ts`](../packages/contracts/src/permissions.ts) la exige al
  menos una operación del servidor. El catálogo se sincroniza con la tabla `permissions` en cada
  migración (`pnpm db:migrate`): las claves nuevas se insertan y las eliminadas quedan como
  obsoletas (no conceden nada).
- **El servidor decide.** `AccessGuard` verifica el `permission` declarado en `@Endpoint` y los
  servicios vuelven a comprobar con `assertCan`. Algunas lecturas aceptan cualquiera de varios
  permisos y lo resuelve el servicio (p. ej. la lista de tarifas: `ai.models.manage` o
  `ai.usage.read`). La interfaz solo **oculta** botones y rutas
  (`definePageMeta({ permission })`, `useCan()`); una solicitud fabricada sin permiso recibe 403 y,
  si es de escritura, queda auditada como `denied`.
- **Los permisos se leen en cada solicitud** (sin caché): un cambio de rol surte efecto de
  inmediato, también en el chat.

## Roles de sistema

| Rol | Clave | Rango | Descripción |
| --- | --- | --- | --- |
| Propietario | `owner` | 100 | Control total; siempre tiene el catálogo completo (inmutable). |
| Administrador | `admin` | 80 | Usuarios, configuración, IA y conocimiento (sin proveedores IA ni organizaciones). |
| Editor | `editor` | 50 | Contenido y conocimiento. |
| Lector | `viewer` | 10 | Lectura y chat. |

Cómo se sincronizan los permisos por defecto (`syncAccessCatalog`, ejecutado por
`pnpm db:migrate` y el servicio `migrate`):

- Al crear los roles de sistema (primera migración) reciben sus permisos por defecto.
- Una clave **nueva** (de una versión nueva del starter o de un módulo generado) se concede a los
  roles de sistema existentes según `SYSTEM_ROLE_PERMISSIONS`.
- Las claves que **ya existían** conservan lo que los administradores configuraron en
  `/admin/permissions`: una actualización nunca revierte tus ajustes.
- El propietario siempre tiene el catálogo completo. Los roles personalizados no reciben permisos
  automáticamente.

## Catálogo

| Permiso | Grupo | Descripción | owner | admin | editor | viewer |
| --- | --- | --- | --- | --- | --- | --- |
| `users.read` | users | Ver usuarios | ✔ | ✔ | ✔ | — |
| `users.create` | users | Crear usuarios | ✔ | ✔ | — | — |
| `users.invite` | users | Invitar usuarios por correo | ✔ | ✔ | — | — |
| `users.update` | users | Editar datos de usuarios | ✔ | ✔ | — | — |
| `users.disable` | users | Desactivar y reactivar usuarios, revocar sesiones | ✔ | ✔ | — | — |
| `users.delete` | users | Eliminar usuarios **(sensible)** | ✔ | ✔ | — | — |
| `roles.read` | roles | Ver roles y asignaciones | ✔ | ✔ | ✔ | — |
| `roles.manage` | roles | Crear, editar y asignar roles **(sensible)** | ✔ | ✔ | — | — |
| `permissions.read` | roles | Ver catálogo de permisos | ✔ | ✔ | ✔ | — |
| `permissions.manage` | roles | Cambiar permisos de roles **(sensible)** | ✔ | ✔ | — | — |
| `organizations.read` | organizations | Ver organizaciones | ✔ | ✔ | — | — |
| `organizations.manage` | organizations | Administrar organizaciones y membresías **(sensible)** | ✔ | — | — | — |
| `settings.read` | settings | Ver configuración | ✔ | ✔ | ✔ | — |
| `settings.update` | settings | Cambiar configuración | ✔ | ✔ | — | — |
| `audit.read` | audit | Ver auditoría | ✔ | ✔ | — | — |
| `system.diagnostics` | system | Ver diagnósticos, versiones y salud del sistema | ✔ | ✔ | — | — |
| `api.docs` | system | Ver la documentación OpenAPI protegida | ✔ | ✔ | — | — |
| `ai.chat` | ai | Usar el chat de IA | ✔ | ✔ | ✔ | ✔ |
| `ai.providers.manage` | ai | Administrar conexiones de proveedores IA **(sensible)** | ✔ | — | — | — |
| `ai.models.manage` | ai | Administrar catálogo de modelos y tarifas (ver tarifas también con `ai.usage.read`) | ✔ | ✔ | — | — |
| `ai.agents.manage` | ai | Configurar y publicar agentes | ✔ | ✔ | — | — |
| `ai.usage.read` | ai | Ver consumo y costos de IA | ✔ | ✔ | ✔ | — |
| `ai.budgets.manage` | ai | Administrar presupuestos de IA | ✔ | ✔ | — | — |
| `ai.lab.use` | ai | Usar el laboratorio y recomendador de modelos | ✔ | ✔ | — | — |
| `rag.collections.read` | rag | Ver colecciones de conocimiento | ✔ | ✔ | ✔ | ✔ |
| `rag.collections.manage` | rag | Administrar colecciones y conexiones RAG | ✔ | ✔ | — | — |
| `rag.sources.manage` | rag | Administrar fuentes de conocimiento | ✔ | ✔ | ✔ | — |
| `rag.documents.read` | rag | Ver documentos y fragmentos autorizados | ✔ | ✔ | ✔ | ✔ |
| `rag.documents.delete` | rag | Eliminar documentos | ✔ | ✔ | ✔ | — |
| `rag.jobs.manage` | rag | Gestionar trabajos de indexación | ✔ | ✔ | ✔ | — |
| `rag.playground.use` | rag | Usar el laboratorio de búsqueda | ✔ | ✔ | ✔ | — |
| `rag.analytics.read` | rag | Ver analítica de conocimiento | ✔ | ✔ | ✔ | — |
| `mail.read` | mail | Ver configuración, plantillas, automatizaciones y envíos de correo | ✔ | ✔ | — | — |
| `mail.manage` | mail | Configurar el proveedor de correo, plantillas y automatizaciones **(sensible)** | ✔ | ✔ | — | — |
| `projects.read` | projects | Ver proyectos | ✔ | ✔ | ✔ | ✔ |
| `projects.manage` | projects | Crear y editar proyectos | ✔ | ✔ | ✔ | — |

Las herramientas administrativas del chat usan estos mismos permisos (ver
[admin-tools.md](admin-tools.md)). Los permisos del conocimiento se combinan con las ACL de
colección y de documento (ver [rag.md](rag.md)).

## Reglas de gestión ([`policies.ts`](../packages/auth/src/policies.ts))

- **Jerarquía**: solo puedes gestionar roles de rango **menor** al tuyo y usuarios cuyo rango
  máximo sea menor al tuyo. El rol `owner` y otros propietarios solo los gestiona un propietario.
- **Delegación**: solo puedes conceder permisos que tienes; los permisos **sensibles** solo los
  concede un propietario; no se admiten claves que no existan en el catálogo.
- **Autoprotección**: no puedes desactivarte, eliminarte ni cambiar tus propios roles desde estas
  operaciones.
- **Último propietario**: no se puede desactivar, eliminar ni quitar el rol al último propietario
  activo (412).
- **Concurrencia**: la matriz de permisos envía la versión del rol; si cambió entre tanto, responde
  412 y no aplica nada.
- Los roles de sistema no se eliminan; un rol con usuarios asignados tampoco (409).

## Roles personalizados

`/admin/roles` (permiso `roles.manage`; asignar permisos al crear también requiere
`permissions.manage`): clave, nombre, descripción, **rango** (1–99, por defecto 40) y alcance.
`/admin/permissions` muestra la matriz rol × permiso con confirmación y diferencias antes de guardar.

## Alcance: plataforma u organización

- Con `FEATURE_ORGANIZATIONS=false` todos los roles son de **plataforma** y aplican en la
  organización por defecto.
- Con organizaciones activas, un rol puede ser de **organización**: sus permisos aplican solo en la
  organización donde se asignó. Los permisos efectivos son la unión de los roles de plataforma y los
  de la organización activa; sin membresía en la organización activa solo aplican los de plataforma.
  Algunas vistas globales (p. ej. auditoría de la instalación) exigen el permiso a nivel de
  plataforma.

## En la interfaz

- `definePageMeta({ permission: 'x' | ['x', 'y'], feature: 'ai' | 'rag' | 'organizations' })` en
  cada página; el middleware `auth.global.ts` redirige a `/forbidden` si falta.
- `useCan()('permiso')` para mostrar u ocultar acciones; la barra lateral
  ([`apps/web/app/utils/navigation.ts`](../apps/web/app/utils/navigation.ts)) solo muestra las
  entradas permitidas.
- Nunca confíes en la interfaz para seguridad: agrega siempre `permission` en `@Endpoint` y
  `assertCan` en el servicio (ver [extending.md](extending.md)).
