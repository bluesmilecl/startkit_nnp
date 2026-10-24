# Instalación

## Requisitos

| Herramienta | Versión |
| --- | --- |
| Node.js | 24 LTS (`.node-version` fija 24.22.1; `engines.node` exige `>=24.11.0`) |
| pnpm | la de `packageManager` en `package.json` (12.15.0). Actívala con `corepack enable`. |
| Docker + Compose v2 | Para PostgreSQL/pgvector y Mailpit locales y para las imágenes de producción. |
| PostgreSQL | 18 con la extensión **pgvector 0.8+** si usarás conocimiento (RAG) interno. |

## Opción A: instalador (`create-ecortes-app`)

```bash
pnpm create ecortes-app mi-app          # interactivo
# o, desde una copia del starter:
pnpm starter create ../mi-app --from .
```

El instalador:

1. Copia la plantilla (carpeta local o repositorio git; por defecto el repositorio del starter,
   configurable con `--from` o la variable `STARTER_TEMPLATE`) **sin** `.git`, `node_modules`,
   compilados, datos locales ni archivos `.env`.
2. Genera `.env` desde `.env.example` con **secretos únicos** (`BETTER_AUTH_SECRET`,
   `APP_ENCRYPTION_KEY`, contraseñas de PostgreSQL) y permisos `600`.
3. Escribe `starter.config.json` (configuración exportable **sin secretos**, validada con el
   esquema de `@starter/config`) y renombra el paquete.
4. Inicializa git (`git init` + `git add`; el primer commit lo haces tú) y ejecuta `pnpm install`.

Opciones (`pnpm starter --help`):

| Opción | Descripción |
| --- | --- |
| `--from <dir\|git>` / `--ref <rama>` | Plantilla y rama/etiqueta a clonar. |
| `--name`, `--owner <correo>` | Nombre visible y correo del propietario inicial. |
| `--modules ai,rag,organizations` | Módulos activos (`rag` requiere `ai`). |
| `--db docker\|external` / `--database-url` | PostgreSQL en Docker o externo. |
| `--mail smtp\|resend\|log` | Transporte de correo (`log` solo en desarrollo). |
| `--yes`, `--no-install`, `--no-git` | Modo no interactivo y pasos opcionales. |

## Opción B: manual

```bash
cp .env.example .env
# Genera secretos propios:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"     # BETTER_AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # APP_ENCRYPTION_KEY
pnpm install
```

Completa en `.env` al menos `BETTER_AUTH_SECRET` (≥ 32 caracteres), `APP_ENCRYPTION_KEY` (32 bytes
en base64), `OWNER_EMAIL`, `POSTGRES_PASSWORD` y `POSTGRES_APP_PASSWORD`. El contrato completo de
variables está en [`packages/config/src/env.ts`](../packages/config/src/env.ts).

## Primer arranque en desarrollo

```bash
pnpm infra:up          # PostgreSQL 18 + pgvector y Mailpit en Docker (lee el .env de la raíz)
pnpm build:ts          # compila los paquetes TypeScript
pnpm db:migrate        # migraciones, cola de trabajos, datos base y propietario inicial
pnpm starter doctor    # diagnóstico de solo lectura
pnpm dev               # tsc --watch + API + worker + Nuxt (http://localhost:3000)
```

- Mailpit queda en <http://localhost:8025>: ahí llegan los códigos OTP (`pnpm infra:up` también
  publica su SMTP en `127.0.0.1:1025`, el `SMTP_URL` por defecto).
- `pnpm dev` ejecuta la API y el worker con `node --watch` sobre los compilados y Nuxt en modo
  desarrollo; Nitro reenvía `/api` a la API.
- Para detener la infraestructura: `pnpm infra:down`.

### Primer ingreso: propietario

Nunca se convierte en administrador "la primera persona que entra". El propietario se define de
forma confiable:

- Con `OWNER_EMAIL` en `.env`, `pnpm db:migrate` (o el servicio `migrate` de Docker) crea una
  **invitación de propietario** (o asigna el rol si el usuario ya existe y no hay propietarios).
  Al ingresar con el código OTP enviado a ese correo, la persona recibe el rol `owner` y pasa por
  el **onboarding** (su nombre, nombre y color de la aplicación, zona horaria y quién puede crear
  cuentas).
- Si no se configuró, o hay que recuperar el acceso, desde el servidor:
  `pnpm starter owner assign persona@empresa.cl` (con `--additional` para sumar otro propietario;
  pide confirmación o `--yes`; queda auditado como acción del sistema).

## Verificación y operación con la CLI

```bash
pnpm starter doctor            # entorno, configuración, base, migraciones, propietario, correo, IA, RAG
pnpm starter config validate   # starter.config.json: esquema y ausencia de secretos
pnpm test && pnpm test:integration
```

Otros comandos de `pnpm starter`: `ai sync` (catálogo de modelos y tarifas), `rag doctor`,
`rag reindex <colección> [--wait]`, `generate module <clave>` (ver [extending.md](extending.md)),
`docs check`, `owner assign <correo>` y `secrets reencrypt [--dry-run] [--yes]` (re-cifra las
credenciales guardadas tras rotar `APP_ENCRYPTION_KEY`; ver [upgrades.md](upgrades.md)).

`starter.config.example.json` (raíz) muestra todas las opciones de `starter.config.json`; el
esquema JSON versionado para editores y CI está en `docs/schemas/starter.config.schema.json`
(generado por `scripts/schemas.mjs`).

`pnpm verify` ejecuta la batería completa (instalación congelada, compilación, lint, tipos, pruebas,
contratos, manifiesto, documentación, variantes de Compose, build web e integración) y escribe
`verify-report.md`.

## Base de datos externa

1. Crea la base en PostgreSQL 18. Si usarás conocimiento interno, pgvector debe estar disponible
   en el servidor: la extensión se crea al **activar** el almacén interno desde
   `/admin/knowledge/connections` (conexión administrada y rol con privilegios) o a mano con
   `CREATE EXTENSION vector;`. Las migraciones no la crean.
2. Define `DATABASE_URL` (rol de la aplicación, solo DML) y, si el rol de la aplicación no puede
   hacer DDL, `DATABASE_MIGRATION_URL` (rol propietario del esquema). `DATABASE_SSL` admite
   `disable`, `require` o `verify-full`.
3. Ejecuta `pnpm db:migrate`: si ambas URL usan roles distintos, la migración concede DML al rol de
   ejecución.
4. Con un rol de ejecución sin DDL y conocimiento interno, la **API y el worker** también necesitan
   `DATABASE_MIGRATION_URL`: la activación del almacén y los índices HNSW por perfil de embeddings
   se crean por esa conexión.

## Producción con Docker

```bash
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.production.yaml \
  --profile edge up -d
```

- Imágenes `api`, `worker` y `web` construidas desde `docker/*.Dockerfile` (multi-etapa, usuario
  `node`, `HEALTHCHECK`, sin dependencias de desarrollo). El flujo de *release* publica imágenes con
  digest inmutable en GHCR.
- El servicio `migrate` corre una vez antes de `api` y `worker`.
- `compose.production.yaml` fuerza `NODE_ENV=production`, `AI_TEST_PROVIDER_ENABLED=false`,
  sistema de archivos de solo lectura, `no-new-privileges`, límites de recursos y rotación de logs.
- Con `--profile edge` y `SITE_ADDRESS=app.tu-dominio.cl`, Caddy obtiene HTTPS automáticamente. Si
  usas tu propio ingress, enruta `/api` → `api:3001` y `/` → `web:3000` en el **mismo origen**.
- Requisitos del entorno en producción (validados al arrancar): `MAIL_TRANSPORT` distinto de `log`,
  proveedor de prueba desactivado, `RESEND_API_KEY` si usas Resend, `S3_BUCKET` si usas S3.

Detalle de perfiles y servicios en [docker.md](docker.md). Problemas frecuentes en
[troubleshooting.md](troubleshooting.md).
