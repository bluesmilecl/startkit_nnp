# Extender el starter

La forma recomendada de agregar funcionalidad de negocio es crear **módulos nuevos** con el
generador, que copia el módulo de referencia **Proyectos** (código real, compilado y probado en cada
commit) y lo adapta a tu entidad.

## Generar un módulo

```bash
pnpm starter generate module clientes --entity Customer --label "Clientes" --singular "Cliente"
pnpm starter generate module ordenes-compra --entity PurchaseOrder \
  --label "Órdenes de compra" --singular "Orden de compra" --gender f --icon ClipboardList
```

| Opción | Significado |
| --- | --- |
| `<clave>` | Plural en *kebab-case*: URL (`/admin/clientes`, `/api/clientes`), archivos y prefijo de permisos. Claves reservadas: `admin`, `ai`, `api`, `auth`, `rag`, `users`, `roles`, `permissions`, `settings`, `audit`, `projects`, `organizations`, `health`, `jobs`, `system`, `knowledge`, `profile`. |
| `--entity` | Entidad singular en *PascalCase* para el código (`Customer` → `CustomersService`, `CustomerStatus`). |
| `--entity-plural` | Plural de la entidad si no es entidad + "s". |
| `--label` / `--singular` | Textos visibles en plural y singular. |
| `--gender m\|f` | Ajusta los mensajes ("Nueva orden de compra", "creada"). |
| `--icon` | Ícono Lucide del menú (por defecto `FolderKanban`). |
| `--dry-run` / `--force` | Ver el plan sin escribir / sobrescribir archivos existentes. |

Sin opciones, el comando pregunta de forma interactiva.

**Crea:**

| Archivo | Contenido |
| --- | --- |
| `packages/contracts/src/<clave>.ts` | Esquemas Zod: entidad, estado, consulta (búsqueda, filtro, orden, paginación), crear y actualizar (con `version`). |
| `packages/db/src/schema/<clave>.ts` | Tabla con `organization_id`, nombre, descripción, estado, autor, `version`, fechas e índice. |
| `apps/api/src/modules/<clave>/*` | Módulo Nest: servicio (permisos, auditoría, nombre único, concurrencia optimista) y controlador con `@Endpoint`. |
| `apps/web/app/pages/admin/<clave>/index.vue` | Vista con `DataTable`, búsqueda y filtros sincronizados con la URL, hoja de edición validada con Zod, archivar/restaurar y eliminación con confirmación. |
| `tests/e2e/<clave>.spec.ts` | E2E: CRUD, conflicto 412 y rol de solo lectura. |

**Modifica:** exportaciones de contratos y tablas, registro del módulo en `app.module.ts`,
permisos `<clave_snake>.read` / `.manage` en el catálogo (por defecto: `admin` y `editor` ambos,
`viewer` solo lectura) y la entrada del menú lateral. Si no encuentra el punto de inserción de algún
archivo, lo informa como paso manual en vez de modificarlo a ciegas.

**Después:**

```bash
pnpm build:ts
pnpm db:generate            # migración de la nueva tabla (revisa el SQL)
pnpm db:migrate             # aplica la migración y sincroniza el catálogo de permisos
pnpm api:docs:generate && pnpm api:client:generate
```

Al migrar, los permisos nuevos se conceden a los roles de sistema existentes según los valores por
defecto (también en instalaciones que ya estaban en uso); los roles personalizados se ajustan en
`/admin/permissions`.

Luego ajusta columnas, validaciones y textos a tu dominio y ejecuta `pnpm test:e2e`.

## Recorrido por el módulo de referencia (Proyectos)

1. **Contrato** ([`packages/contracts/src/projects.ts`](../packages/contracts/src/projects.ts)):
   `Project`, `ProjectsQuery`, `ProjectsPage`, `CreateProjectInput`, `UpdateProjectInput` con
   `version` para concurrencia optimista. Los mensajes de validación están en español y la web los
   reutiliza.
2. **Tabla** ([`packages/db/src/schema/projects.ts`](../packages/db/src/schema/projects.ts)):
   siempre con `organization_id` para el aislamiento por organización.
3. **Servicio** ([`apps/api/src/modules/projects/projects.service.ts`](../apps/api/src/modules/projects/projects.service.ts)):
   `assertCan` en cada método, filtro por `actor.organizationId`, nombre único sin distinguir
   mayúsculas (409 con detalle de campo), `update` condicionado a la versión leída (412 si otra
   persona lo cambió) y `recordAudit` con antes/después.
4. **Controlador** ([`projects.controller.ts`](../apps/api/src/modules/projects/projects.controller.ts)):
   cada ruta con `@Endpoint` (operationId, permiso, esquemas y errores documentados).
5. **Vista** ([`apps/web/app/pages/admin/projects/index.vue`](../apps/web/app/pages/admin/projects/index.vue)):
   `definePageMeta({ permission: 'projects.read' })`, acciones visibles solo con
   `can('projects.manage')`, errores del servidor mostrados en el formulario.
6. **E2E** ([`tests/e2e/projects.spec.ts`](../tests/e2e/projects.spec.ts)): flujo completo,
   auditoría, concurrencia y permisos.

## Agregar un endpoint a mano

```ts
@Get(':id/resumen')
@Endpoint({
  operationId: 'clientes_resumen',                // único; da nombre a la función del cliente
  summary: 'Resumen del cliente',
  permission: 'clientes.read',                     // obligatorio salvo rutas públicas
  feature: 'ai',                                   // opcional: módulo requerido
  params: IdParams,
  response: { schema: ClienteResumen },
  errors: [404],
})
resumen(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
  return this.service.resumen(actor, p.id);        // el servicio vuelve a comprobar con assertCan
}
```

- Entradas con `@ZBody()`, `@ZQuery()`, `@ZParams()` (validación Zod → 422 con detalle por campo).
- Errores con `AppError` del catálogo (`notFound`, `field`, `conflict`, `precondition`, `forbidden`,
  `validation`); el filtro global los convierte al esquema `ErrorResponse`. La unicidad del nombre
  la garantiza el índice `projects_org_name_uq` (su violación se traduce con `isUniqueViolation`
  a un error en el campo) y la vista usa `useApiData` + `LoadError`. Estándar completo en
  [errors.md](errors.md).
- Una ruta sin `@Endpoint` se rechaza siempre (denegar por defecto).
- Regenera artefactos: `pnpm api:docs:generate` y `pnpm api:client:generate`. CI verifica que
  estén al día y `pnpm api:contract:check` avisa si rompiste el contrato.

## Agregar permisos

1. Agrega la clave en `PERMISSIONS` de
   [`packages/contracts/src/permissions.ts`](../packages/contracts/src/permissions.ts) (grupo,
   descripción en español y `sensitive: true` si solo un propietario debe concederla).
2. Exígela en al menos una operación (`@Endpoint` + `assertCan`). No agregues permisos sin
   operación.
3. Inclúyela en `SYSTEM_ROLE_PERMISSIONS` para los roles de sistema que deban tenerla.
4. `pnpm build:ts && pnpm db:migrate` sincroniza el catálogo: la clave nueva se concede a los roles
   de sistema según esos valores por defecto (también en instalaciones existentes). Los roles
   personalizados se ajustan en `/admin/permissions`.

## Páginas y navegación

- Crea la página en `apps/web/app/pages/admin/...` con `definePageMeta({ permission, feature })`.
- Agrega la entrada en [`apps/web/app/utils/navigation.ts`](../apps/web/app/utils/navigation.ts)
  (`title`, `to`, `icon`, `permission`, `feature`); la barra lateral la oculta si no corresponde.
- Construye la vista con el [kit de interfaz](frontend-components.md): `useListQuery` + `DataToolbar` +
  `DataTable` (tabla o tarjetas) para listas, `FormFields`/`FormDialog` sobre el contrato Zod para
  formularios, `FormWizard` para altas por pasos, `ActionMenu`, `AppAlert`, `useNotify` e íconos
  semánticos (`AppIcon`). La página de Proyectos es el ejemplo completo y la skill
  [construir vistas](../.claude/skills/build-ui/SKILL.md) resume las recetas.

## Herramientas del chat

Las herramientas administrativas viven en
[`packages/ai/src/chat/admin-tools.ts`](../packages/ai/src/chat/admin-tools.ts):

1. Declara la herramienta en `ADMIN_TOOLS` (`packages/contracts/src/agents.ts`) con etiqueta,
   permiso y si requiere **propuesta**.
2. Impleméntala en `buildAdminTools` con `tool({ description, inputSchema, execute: run('clave', ...) })`.
   El actor viene del contexto del servidor, **nunca** de los argumentos del modelo; usa los mismos
   servicios de dominio que la API.
3. Para cambios sensibles, devuelve una propuesta con `propose('accion', args, toolCallId)` y
   registra su ejecutor (`ProposalExecutor` con `preview`, `currentVersion` y `execute`) en
   [`packages/auth/src/admin-executors.ts`](../packages/auth/src/admin-executors.ts). La persona
   confirma desde la tarjeta; la confirmación está ligada al actor, a los argumentos normalizados,
   a la versión del recurso, a la expiración y a un solo uso.
4. Habilítala por agente en `/admin/ai/agents` (pestaña de herramientas) y publica una versión.

Más detalle en [admin-tools.md](admin-tools.md) y [agents-and-chat.md](agents-and-chat.md).

## Trabajos en segundo plano

1. Declara la cola en `QUEUES` y su política (reintentos, espera, expiración, `singleton`/`stately`)
   en `DEFINITIONS` de [`packages/jobs/src/index.ts`](../packages/jobs/src/index.ts); si es
   periódica, agrégala a `SCHEDULES` (cron UTC; se ejecuta una vez aunque haya varias réplicas).
2. Encola desde la API inyectando `JOBS` (`JobQueue.send(cola, datos, { idempotencyKey })`) y
   responde `202` con `JobAccepted` si el cliente debe seguir el avance.
3. Registra el *handler* en el worker (`apps/worker/src/handlers/*`) con `ctx.jobs.work(cola, fn,
   { concurrency })`. Debe ser idempotente: pg-boss reintenta con espera exponencial.
4. Para limpieza periódica usa `onMaintenance(hook)`.
5. `pnpm db:migrate` crea o actualiza las colas.

## Verificación

```bash
pnpm build:ts && pnpm lint && pnpm typecheck && pnpm test
pnpm test:integration
pnpm verify
```
