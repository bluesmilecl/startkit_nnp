---
name: extend-starter
description: Agrega módulos de negocio, endpoints, permisos, vistas, herramientas del chat y trabajos al Starter Kit siguiendo sus contratos y reglas de seguridad. Úsala cuando pidan crear un CRUD, una pantalla nueva, un permiso o una integración dentro del starter.
---

# Extender el starter

Lee primero `AGENTS.md` (reglas no negociables y definición de terminado).

## Módulo de negocio completo (recomendado)

```bash
pnpm starter generate module clientes --entity Customer --label "Clientes" --singular "Cliente"
# nombres femeninos ajustan los mensajes: --gender f ; icono Lucide: --icon Contact
pnpm starter generate module ordenes-compra --entity PurchaseOrder --label "Órdenes de compra" --singular "Orden de compra" --gender f --dry-run
```

Genera desde el módulo de referencia **Proyectos**: contrato Zod, tabla Drizzle, módulo Nest (controlador + servicio con auditoría, concurrencia optimista y paginación en el servidor), vista con DataTable, prueba E2E; además agrega permisos `<clave>.read/.manage`, los asigna a los roles por defecto y crea la entrada del menú. Nunca sobrescribe archivos sin `--force`.

Después:

```bash
pnpm build:ts
pnpm db:generate && pnpm db:migrate
pnpm api:docs:generate && pnpm api:client:generate
pnpm typecheck && pnpm test:e2e tests/e2e/<clave>.spec.ts
```

Luego ajusta columnas en `packages/db/src/schema/<clave>.ts`, el contrato en `packages/contracts/src/<clave>.ts` y la vista.

## Endpoint nuevo en un módulo existente

1. Define entrada/salida en `packages/contracts/src/…` con `.meta({ id })` para nombrarlos en OpenAPI.
2. En el controlador: `@Endpoint({ operationId, summary, permission, feature?, body/query/params, response: { status?, schema }, errors: [...] })` y `@ZBody()/@ZQuery()/@ZParams()`.
3. En el servicio: `assertCan(actor, 'permiso')`, filtra siempre por `actor.organizationId`, registra `recordAudit` en mutaciones.
4. Regenera OpenAPI/cliente y usa la función generada en la web (`unwrap(miOperacion({ client: useApi(), ... }))`).
5. Prueba: integración (servicio) y E2E (permiso denegado devuelve 403).

## Permisos

Agrega la clave en `PERMISSIONS` y en `SYSTEM_ROLE_PERMISSIONS` (`packages/contracts/src/permissions.ts`). Se sincroniza al arrancar la API. En la web usa `definePageMeta({ permission })`, `useCan()` y `permission` en `navigation.ts`.

## Herramienta para el chat

1. Declárala en `ADMIN_TOOLS` (`packages/contracts/src/agents.ts`) con `label`, `permission` y `proposal`.
2. Implementa en `packages/ai/src/chat/admin-tools.ts`. Con `proposal: false` (lecturas y cambios menores reversibles) se ejecuta directo con el actor inyectado. Con `proposal: true` (desactivar, eliminar, cambiar roles o permisos) crea una propuesta guardada en el servidor (`ProposalsService`) que la persona confirma en la tarjeta del chat; el servidor revalida permisos y el hash de los argumentos al confirmar.
3. Habilítala en la configuración del agente (pestaña Herramientas) y publica una versión.
4. Nunca tomes el actor, la organización ni el rol desde los argumentos del modelo.

## Trabajo en segundo plano

Cola y política en `packages/jobs/src/index.ts`; manejador en `apps/worker/src/handlers/`; guarda estado/progreso en una tabla si la persona debe verlo; usa reintentos y cancelación en puntos seguros.

## Vistas

Componentes de `packages/ui` (catálogo en `/admin/components`). `<ClientOnly>` para `Select` con datos asíncronos, sin `Badge` dentro de `<p>`, textos en español, accesibilidad (labels, `aria-*`).
