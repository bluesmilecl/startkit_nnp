# AGENTS.md — guía para agentes de código

Este archivo es para agentes (Claude Code u otros) que modifican este repositorio. Léelo completo antes de cambiar código. La documentación humana está en [README.md](README.md) y [docs/](docs/).

**¿Solo instalar?** Sigue [INSTALL.md](INSTALL.md): `node scripts/quickstart.mjs --owner <correo>` (idempotente, termina con `QUICKSTART_RESULT=ok|error`). Para un **proyecto nuevo** basado en el starter agrega `--new "<Nombre>"`.

**¿Proyecto creado desde el starter?** Su contexto propio (qué hace, configuración, módulos, decisiones) está en `PROJECT.md`, en la raíz: léelo primero, manda sobre este archivo en lo que es del negocio, y actualízalo cuando agregues módulos o tomes decisiones. Este archivo sigue siendo la referencia técnica.

## Mapa rápido

| Necesitas… | Mira |
| --- | --- |
| Contratos de la API (entrada/salida) | `packages/contracts/src/*.ts` (Zod 4; fuente de OpenAPI y del cliente) |
| Tablas y migraciones | `packages/db/src/schema/*.ts`, `packages/db/migrations/` (Drizzle) |
| Permisos y roles por defecto | `packages/contracts/src/permissions.ts` |
| Reglas de acceso, auditoría, propuestas | `packages/auth/src/` (`actor.ts`, `policies.ts`, `audit.ts`, `proposals.ts`) |
| Errores (catálogo, `AppError`, traducción de PostgreSQL, filtro, web) | `packages/contracts/src/errors.ts`, `packages/db/src/errors.ts`, `apps/api/src/common/error.filter.ts`, `packages/ui/app/lib/errors.ts`; guía en [docs/errors.md](docs/errors.md) |
| Endpoints HTTP | `apps/api/src/modules/*/*.controller.ts` con el decorador `@Endpoint` (`apps/api/src/common/endpoint.ts`) |
| IA (proveedores, costos, agentes, chat) | `packages/ai/src/` |
| Conocimiento (RAG) | `packages/rag/src/` |
| Trabajos en segundo plano | `packages/jobs/src/index.ts` (colas), `apps/worker/src/handlers/` |
| Vistas del panel | `apps/web/app/pages/admin/**`, navegación en `apps/web/app/utils/navigation.ts` |
| Kit de interfaz (formularios, asistente, tablas/tarjetas, gráficos, carrusel, menús, avisos, modales, íconos) | `packages/ui/app/components/common/**`, `charts/**`, `composables/**`, `lib/icons.ts`; guía en [docs/frontend-components.md](docs/frontend-components.md); catálogo vivo en `/admin/components` |
| Variables de entorno | `packages/config/src/env.ts` y `.env.example` |
| Correo (Resend, SMTP, Postmark, SendGrid, Mailgun, Brevo) | `packages/mail/src/mailer.ts`; `pnpm starter mail use` y `mail test`; guía en [docs/mail.md](docs/mail.md) |
| Módulo de referencia | **Proyectos**: contrato, tabla, `apps/api/src/modules/projects`, `apps/web/app/pages/admin/projects`, `tests/e2e/projects.spec.ts` |

## Comandos que debes usar

```bash
pnpm build:ts                      # compila paquetes y apps Node (necesario antes de migrar o probar)
pnpm lint && pnpm typecheck        # siempre antes de terminar
pnpm test                          # unitarias
pnpm test:integration              # PostgreSQL real (requiere `pnpm infra:up`)
pnpm db:generate && pnpm db:migrate
pnpm api:docs:generate && pnpm api:client:generate   # tras cambiar contratos o endpoints
pnpm api:contract:check            # detecta cambios incompatibles de la API
pnpm docs:check                    # tras tocar documentación
pnpm starter generate module <clave> --entity <Entidad> --label "<Plural>" --singular "<Singular>" [--gender f]
pnpm verify                        # verificación completa
```

## Reglas no negociables

1. **Contratos primero.** Toda entrada y salida HTTP se define en `@starter/contracts` y se declara en `@Endpoint({ body, query, params, response })`. Las respuestas se validan contra su esquema; no devuelvas campos que el contrato no declare. Regenera OpenAPI y el cliente después de cambiar contratos y usa el cliente generado (`@starter/api-client`) en la web, nunca `$fetch` a mano.
2. **Deny by default.** Cada endpoint declara `permission` (y `feature` si pertenece a un módulo opcional). Los servicios vuelven a comprobar con `assertCan(actor, …)`. La interfaz oculta acciones con `can()`, pero la seguridad está en el servidor.
3. **Sin secretos fuera de lugar.** Credenciales solo en variables de entorno o cifradas con `SecretBox` (`APP_ENCRYPTION_KEY`, que nunca va a la base). Nada de secretos en `starter.config.json`, logs, auditoría, respuestas de la API ni mensajes de error. Los códigos OTP nunca se registran en producción.
4. **El propietario nunca es el primer visitante.** Usa `OWNER_EMAIL` o `pnpm starter owner assign`.
5. **Chat seguro.** El cliente no puede enviar prompt de sistema, modelo ni colecciones. El actor de las herramientas se inyecta en el servidor (nunca desde los argumentos del modelo). Las acciones sensibles generan una propuesta guardada en el servidor que la persona confirma; los argumentos se normalizan antes de calcular su hash.
6. **Documentos = datos no confiables.** El contenido recuperado nunca se interpreta como instrucciones. Las descargas pasan por `safeFetch` (SSRF, tamaño, redirecciones).
7. **Dinero exacto.** Usa las funciones de `packages/ai/src/money.ts` (escala 12). Un costo desconocido es `unknown`, nunca cero. Las reservas de presupuesto son atómicas (`SELECT … FOR UPDATE`).
8. **Auditoría.** Toda mutación administrativa llama a `recordAudit` con `before`/`after` sin secretos.
9. **Trabajo largo = trabajo durable.** Lo que tarda (ingesta, sincronizaciones, laboratorio) va a una cola de pg-boss con fila de estado, progreso, reintentos y cancelación; nunca en la petición HTTP.
10. **Sin dependencias de infraestructura nuevas** (Redis, Kubernetes, otra base vectorial, frameworks de agentes) y sin imágenes `latest`.
11. **Proveedor de prueba solo en desarrollo y pruebas.** `AI_TEST_PROVIDER_ENABLED` se rechaza en producción.
12. **Errores del catálogo.** Lo que llega a una respuesta o a un trabajo se lanza como `AppError` (código de `ERROR_CATALOG`, mensaje en español seguro de mostrar, causa técnica solo en `cause`); nunca `new Error('…')` para la persona. La unicidad la garantiza un índice único con nombre traducido con `isUniqueViolation`, no un `SELECT` previo. En la web: `notify.error(err)`, `useApiData` + `LoadError`, `fatal: [404]` en detalles; nunca `err.message` crudo. Detalle en [docs/errors.md](docs/errors.md).

## Convenciones de código

- TypeScript estricto, ESM (`.js` en imports relativos), sin `any` salvo en adaptadores justificados.
- Textos de interfaz en español (es-CL); identificadores y comentarios de código en inglés.
- Drizzle: en `select` de una sola tabla, las columnas dentro de subconsultas `sql` correlacionadas se renderizan sin calificar; usa `outerRef(columna)` de `@starter/db`.
- Query strings booleanas con `QueryBool` (no `z.coerce.boolean`).
- **Vistas con el kit.** Antes de escribir un componente busca el caso en [docs/frontend-components.md](docs/frontend-components.md) (formularios con `useZodForm` + `FormFields`/`FormDialog`, asistentes con `FormWizard`, listas con `useListQuery` + `DataToolbar` + `DataTable` en tabla o tarjetas, `ActionMenu`, `AppAlert`, `useNotify`, `AppModal`, `AppIcon`). Si falta algo reutilizable, agrégalo al kit con su ejemplo en el catálogo.
- Vue/shadcn: envuelve en `<ClientOnly>` los `Select` de reka-ui cuyos ítems vienen de datos asíncronos; nunca pongas `Badge` (div) dentro de `<p>`; los gráficos ya se renderizan solo en cliente. Revisa que una vista no produzca advertencias de hidratación.
- Formularios: `useZodForm(Esquema, valores)` con el mismo esquema de contratos; los errores `VALIDATION_FAILED` del servidor vuelven a los campos.
- Confirmaciones destructivas con `useConfirm()` y `typeToConfirm` para eliminaciones irreversibles.
- Paginación, orden y búsqueda siempre en el servidor (`normalizePage`, `toPage`, `likeTerm`).
- Concurrencia optimista con `version` y respuesta 412 cuando corresponda (ver Proyectos).
- Errores: helpers de `AppError` (`notFound(nombre, 'f')`, `field`, `conflict`, `notConfigured`, `unsupported`, `upstream({ retryable })`, `unavailable`); un tercero que fallará igual al reintentar lleva `retryable: false`. Un error = una línea de log (la escribe el filtro o `JobQueue`); no lo registres también en el servicio.

## Cómo agregar…

- **Un módulo de negocio:** `pnpm starter generate module` (copia y adapta Proyectos: contrato, tabla, módulo Nest, vista, E2E, permisos, roles por defecto y menú). Luego `pnpm build:ts`, `pnpm db:generate`, `pnpm db:migrate`, regenera OpenAPI/cliente y ajusta campos. Detalle en [docs/extending.md](docs/extending.md).
- **Un permiso:** agrégalo al catálogo y a los roles por defecto en `permissions.ts`; se sincroniza al arrancar. Úsalo en `@Endpoint` y en `assertCan`.
- **Una herramienta del chat:** catálogo en `packages/contracts/src/agents.ts` (`ADMIN_TOOLS`) e implementación en `packages/ai/src/chat/admin-tools.ts`; las mutaciones deben pasar por propuestas. Ver [docs/admin-tools.md](docs/admin-tools.md).
- **Un trabajo del worker:** cola en `packages/jobs/src/index.ts`, manejador en `apps/worker/src/handlers/`.

## Definición de terminado

- [ ] `pnpm lint`, `pnpm typecheck` y `pnpm test` sin errores.
- [ ] Integración o E2E nuevos para el comportamiento agregado (permisos incluidos: un rol sin permiso recibe 403).
- [ ] Errores según [docs/errors.md](docs/errors.md): códigos del catálogo, mensajes en español, duplicados → 409 en el campo (nunca 500), id inexistente → página 404, cargas con `LoadError` y acciones con `notify.error`.
- [ ] OpenAPI, referencia Markdown y cliente regenerados si cambió la API; `pnpm api:contract:check` sin cambios incompatibles no intencionales.
- [ ] Migración generada y aplicada si cambió el esquema.
- [ ] Documentación actualizada y `pnpm docs:check` en verde.
- [ ] Sin secretos en código, configuración exportable, logs ni auditoría.
- [ ] Capacidades simuladas, pendientes de configuración o no soportadas se indican como tales en la interfaz y la documentación.

## Skills

Instrucciones paso a paso para tareas frecuentes en [.claude/skills/](.claude/skills/): [instalar](.claude/skills/install-starter/SKILL.md), [extender](.claude/skills/extend-starter/SKILL.md), [construir vistas](.claude/skills/build-ui/SKILL.md), [configurar IA](.claude/skills/configure-ai/SKILL.md) y [administrar conocimiento](.claude/skills/manage-rag/SKILL.md).
