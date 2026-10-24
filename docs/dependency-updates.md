# Actualización de dependencias

## Política

- **Versiones exactas** en todos los `package.json` (`rangeStrategy: pin`) y lockfile congelado en
  CI (`pnpm install --frozen-lockfile`). Las imágenes de contenedor también usan versiones fijas.
- **Madurez mínima**: Renovate espera 3 días desde la publicación (`minimumReleaseAge`). pnpm
  también aplica su política de antigüedad mínima de versiones; las excepciones aprobadas quedan
  listadas en `minimumReleaseAgeExclude` de `pnpm-workspace.yaml`.
- **Scripts de instalación bloqueados** salvo la lista `allowBuilds` de `pnpm-workspace.yaml`
  (esbuild, sharp, @tailwindcss/oxide…); el *postinstall* de telemetría de `swagger-ui-dist`
  está explícitamente prohibido.
- **Node.js** se mantiene en la línea LTS activa (`.node-version`, `engines`, Dockerfiles); la
  versión *Current* se prueba pero nunca se propone automáticamente.

## Renovate ([`renovate.json`](../renovate.json))

| Regla | Detalle |
| --- | --- |
| Calendario | Antes de las 06:00 (America/Santiago); mantenimiento del lockfile los lunes; máx. 8 PR abiertos y 4 por hora. |
| Grupos | `nestjs`, `ai sdk` (`ai` y `@ai-sdk/*` se mueven juntos), `nuxt`, `better auth`, `database` (drizzle, pg, pg-boss), `tailwind`, `ui kit` (shadcn-nuxt, reka-ui, unovis…), `lint`, `test tooling`, `openapi client generator`, `postgres images`, `node lts`. |
| Automerge | Parches y menores (y *pin*/*digest*) se fusionan solos **solo si todos los checks requeridos pasan**. |
| Revisión manual | Mayores (etiqueta `needs-migration-plan`), Better Auth, Drizzle, pg-boss, helmet, zod e imágenes de PostgreSQL nunca se fusionan automáticamente. |
| Seguridad | Alertas de vulnerabilidad sin espera de madurez, con prioridad y etiqueta `security`; OSV activado. |
| Regex propios | `.node-version` y la versión de pnpm instalada en los Dockerfiles. |
| Ignorados | `packages/ui/app/components/ui/**` (componentes shadcn vendorizados). |

## Qué valida CI en cada actualización

`.github/workflows/ci.yml`:

1. `pnpm build:ts`, `pnpm lint`, typecheck de la web y `pnpm test`.
2. `pnpm api:docs:generate -- --check`: el OpenAPI y `docs/api-reference.md` coinciden con la API.
3. Cliente generado al día y compilando.
4. `pnpm api:contract:check`: cambios incompatibles de la API frente a `origin/main`
   (`ALLOW_BREAKING=1` solo para una versión mayor planificada).
5. `node scripts/manifest.mjs --check` y `pnpm docs:check`.
6. Integración con PostgreSQL + pgvector y Mailpit (`pnpm db:migrate`, `pnpm test:integration`).

El flujo `e2e-cross-browser.yml` corre semanalmente (y antes de cada *release*) las pruebas
`@critical` en Firefox y WebKit contra el stack Docker.

## Manifiesto del stack

`starter.manifest.json` registra las versiones exactas de los paquetes clave (Nuxt, Vue, NestJS,
AI SDK, Better Auth, Drizzle, pg-boss, Zod, Tailwind, shadcn-nuxt, reka-ui, Unovis, TypeScript,
Vitest, Playwright, generador OpenAPI), la política de Node, PostgreSQL/pgvector y las imágenes de
terceros. Se genera con `node scripts/manifest.mjs` y CI falla si quedó desactualizado. Los
esquemas JSON de `docs/schemas/` (`starter.config.schema.json`, desde el esquema Zod de
`@starter/config`, y `starter.manifest.schema.json`) se regeneran con `node scripts/schemas.mjs`
tras `pnpm build:ts`; `pnpm verify` comprueba que estén al día (`--check`). El worker
consulta a diario las últimas versiones publicadas de esos paquetes (solo informativo; nunca
instala nada) y las muestra en `/admin/diagnostics`.

## Recetas

### Paquete de la aplicación

```bash
pnpm update <paquete>@<versión> --filter <workspace>
pnpm build:ts && pnpm lint && pnpm typecheck && pnpm test
node scripts/manifest.mjs            # si es un paquete rastreado
```

### AI SDK

Actualiza `ai` y todos los `@ai-sdk/*` (incluido `@ai-sdk/vue`) **en la misma versión mayor**. La
guía [agents-and-chat.md](agents-and-chat.md) declara la versión mayor instalada y `pnpm docs:check`
falla si no coincide.

### Drizzle / esquema

Tras cambiar el esquema: `pnpm db:generate` (crea una migración nueva en
`packages/db/migrations`), revisa el SQL y ejecuta `pnpm db:migrate`. Nunca edites migraciones ya
publicadas.

### Componentes shadcn-vue

Los componentes viven en `packages/ui/app/components/ui` (código del proyecto). Para actualizarlos:

```bash
pnpm --filter @starter/ui shadcn:diff            # qué componentes difieren del registro
pnpm --filter @starter/ui shadcn:sync button     # sobrescribe los indicados
```

Revisa a mano las diferencias antes de sobrescribir: puede haber ajustes locales. El componente
`form` del registro se excluye (usa zod 3); el starter usa `field` + `useZodForm` con zod 4.

### Node.js

Cambia `.node-version`, `engines.node` y `ARG NODE_IMAGE` de los tres Dockerfiles en el mismo PR;
regenera el manifiesto.

Ver [upgrades.md](upgrades.md) para actualizar un proyecto derivado del starter.
