# Docker

## Imágenes

| Imagen | Dockerfile | Puerto | Salud | Contenido |
| --- | --- | --- | --- | --- |
| `${STARTER_IMAGE_PREFIX:-starter}/api:${STARTER_VERSION:-local}` | `docker/api.Dockerfile` | 3001 | `GET /api/health/live` | API NestJS; también ejecuta `migrate` y el doble de pruebas `retrieval-test`. |
| `…/worker:…` | `docker/worker.Dockerfile` | 3002 | `GET /health/live` | Worker pg-boss. |
| `…/web:…` | `docker/web.Dockerfile` | 3000 | `GET /login` | Nuxt compilado (`.output/server/index.mjs`). |

Todas son multi-etapa: descargan con el lockfile congelado (pnpm `fetch`) e instalan sin red,
compilan, y la etapa final contiene solo el paquete desplegado (pnpm `deploy --prod`), corre como
usuario `node` y declara `HEALTHCHECK`. La imagen base se fija con
`ARG NODE_IMAGE=node:24.22.1-trixie-slim` (nunca `latest`).

### Construir en redes restringidas (proxy corporativo)

```bash
docker build --network host \
  --build-arg NODE_IMAGE=mirror.gcr.io/library/node:24.22.1-trixie-slim \
  --build-arg HTTPS_PROXY=$HTTPS_PROXY \
  --secret id=extra_ca,src=/ruta/ca.pem \
  -f docker/api.Dockerfile -t starter/api:local .
```

El certificado se monta como *secret* de BuildKit durante la instalación y **nunca** queda en una
capa de la imagen. `scripts/e2e-stack.mjs` acepta los mismos argumentos en `E2E_BUILD_ARGS`.

## Archivos Compose

| Archivo | Uso |
| --- | --- |
| [`docker/compose.yaml`](../docker/compose.yaml) | Base: servicios, perfiles, redes (`internal`, `public`) y volúmenes. |
| [`docker/compose.dev.yaml`](../docker/compose.dev.yaml) | Desarrollo/evaluación local: publica puertos en `127.0.0.1`, apunta las URL a los servicios Compose, proxy siempre activo en `:8080`, servicio `retrieval-test`. |
| [`docker/compose.production.yaml`](../docker/compose.production.yaml) | Producción: `NODE_ENV=production`, proveedor IA de prueba desactivado, sistema de archivos de solo lectura, `no-new-privileges`, límites de CPU/memoria, rotación de logs, proxy en 80/443. |

### Perfiles

| Perfil | Servicios | Para qué |
| --- | --- | --- |
| `local-db` | `postgres` (`pgvector/pgvector:0.8.7-pg18-trixie`) | Base de datos local. Sin este perfil, define `DATABASE_URL` hacia tu PostgreSQL externo. |
| `rag-db` | `rag-postgres` (misma imagen) y, en `compose.dev.yaml`, `retrieval-test` | Probar un almacén de conocimiento PostgreSQL **externo** y el contrato de API de recuperación externa (doble de pruebas que además sirve un sitio estático para ingesta por URL/sitemap; se niega a correr con `NODE_ENV=production`). |
| `dev-mail` | `mailpit` (`ghcr.io/axllent/mailpit:v1.32.0`) | Captura correos. Dentro de la red: SMTP `mailpit:1025`. Con `compose.dev.yaml` publica en `127.0.0.1` la UI (`MAILPIT_PORT`, 8025) y el SMTP (`MAILPIT_SMTP_PORT`, 1025) para las apps que corren en el host con `pnpm dev`. |
| `edge` | `proxy` (`caddy:2.11.7-alpine`) | Origen único: `/api` → `api:3001`, resto → `web:3000`; HTTPS automático si `SITE_ADDRESS` es un dominio. |

Activar un perfil nunca habilita un módulo por sí solo: el modo RAG, los proveedores y los permisos
se configuran en la aplicación.

### Servicios de aplicación

- `migrate` (imagen `api`, `node dist/scripts/migrate.js`): migraciones SQL bajo candado, esquema de
  pg-boss, actualización de almacenes de conocimiento internos activos, permisos DML para el rol de
  ejecución, catálogo de permisos, roles de sistema, propietario inicial y asistente por defecto.
  Corre una vez (`restart: 'no'`); `api` y `worker` esperan a que termine bien.
- `api` y `worker` montan el volumen `storage` en `/data/storage` (archivos subidos, adjuntos,
  originales de documentos).
- `web` espera a que `api` esté sana; el proxy espera a `web` y `api`.

### Volúmenes

`pgdata`, `ragpgdata`, `storage`, `caddy-data` (certificados) y `caddy-config`. Respáldalos;
**`APP_ENCRYPTION_KEY` no está en ninguno de ellos** (vive en el entorno) y es necesaria para
descifrar las credenciales guardadas.

## Variables y archivos de entorno

Hay dos mecanismos distintos:

1. **Interpolación de Compose** (`${POSTGRES_PASSWORD}`, `${SITE_ADDRESS}`…): Compose lee el `.env`
   del *directorio del proyecto*, que por defecto es `docker/`. Pasa siempre
   `--env-file .env` desde la raíz (lo hacen `pnpm infra:up` y `scripts/e2e-stack.mjs`).
2. **Entorno de los contenedores**: los servicios de aplicación cargan
   `env_file: ${STARTER_ENV_FILE:-../.env}` (relativo a `docker/`). El stack E2E usa
   `STARTER_ENV_FILE=../.env.e2e`.

Rol de base de datos: `docker/postgres/init/01-app-role.sh` crea `POSTGRES_APP_USER` sin
privilegios de superusuario ni DDL; las migraciones usan `POSTGRES_USER` mediante
`DATABASE_MIGRATION_URL`. Si activas el **conocimiento interno** con ese rol de ejecución, `api` y
`worker` también necesitan `DATABASE_MIGRATION_URL`: la activación y la creación de índices HNSW
por perfil de embeddings (DDL) pasan por esa conexión. `compose.dev.yaml` ya la define para todos
los servicios; en producción agrégala al `.env`.

## Comandos habituales

```bash
# Solo infraestructura para desarrollo (apps en el host con pnpm dev):
# PostgreSQL en 127.0.0.1:5432, Mailpit UI en :8025 y SMTP en :1025
pnpm infra:up
pnpm infra:down

# Stack completo local (http://localhost:8080):
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.dev.yaml \
  --profile local-db --profile dev-mail up -d --build

# Producción (base externa, proxy incluido):
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.production.yaml \
  --profile edge up -d web api worker proxy

# Logs y estado
docker compose --env-file .env -f docker/compose.yaml ps
docker compose --env-file .env -f docker/compose.yaml logs -f api worker
```

## Producción: lista de control

- Versiones fijas de todas las imágenes (las de terceros están fijadas en `compose.yaml`; las
  propias se publican por etiqueta y digest inmutable desde el flujo de *release*). Nunca `latest`.
- `NODE_ENV=production`, `MAIL_TRANSPORT` real (Resend por defecto; ver [mail.md](mail.md)), `AI_TEST_PROVIDER_ENABLED=false` (el
  arranque falla si no).
- `APP_URL` con HTTPS y el dominio real; `TRUSTED_ORIGINS` solo si hay orígenes adicionales.
- `OPENAPI_DOCS=protected` (permiso `api.docs`) o `disabled`.
- `RAG_FETCH_ALLOW_PRIVATE=false` salvo que necesites ingerir URLs de tu red interna.
- PostgreSQL y Mailpit no publican puertos en `compose.production.yaml`.
- Tras cada despliegue revisa `/admin/diagnostics` y ejecuta `pnpm starter doctor` desde un
  checkout con el mismo `.env` (la CLI no se incluye en las imágenes de ejecución).

Ver también [installation.md](installation.md), [upgrades.md](upgrades.md) y
[troubleshooting.md](troubleshooting.md).
