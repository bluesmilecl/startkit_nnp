---
name: install-starter
description: Instala y deja funcionando el Starter Kit Nuxt + NestJS IA (nueva instalación o clon existente), con propietario, base de datos, migraciones y verificación. Úsala cuando pidan crear, instalar, levantar o diagnosticar una instalación del starter.
---

# Instalar el starter

## 1. Crear el proyecto

```bash
# desde npm (paquete publicado) o desde un clon del starter
pnpm create ecortes-app mi-app --owner propietaria@empresa.cl --modules ai,rag --db docker --mail smtp
# alternativa desde este repositorio
pnpm starter create ../mi-app --from . --owner propietaria@empresa.cl --modules ai --yes
```

- Sin `--yes` el asistente pregunta nombre, carpeta, correo propietario, módulos (`ai`, `rag`, `organizations`), base (`docker` o `external` con `--database-url`) y correo (`smtp`, `resend`, `log`).
- Genera `.env` (permisos 600) con `BETTER_AUTH_SECRET`, `APP_ENCRYPTION_KEY` y contraseñas de PostgreSQL únicas, y `starter.config.json` **sin secretos**.
- Nunca copies secretos a `starter.config.json`; valida con `pnpm starter config validate`.

## 2. Infraestructura, compilación y migraciones

```bash
cd mi-app
pnpm install                  # si se usó --no-install
pnpm infra:up                 # PostgreSQL 18 + pgvector y Mailpit (docker compose con el .env de la raíz)
pnpm build:ts
pnpm db:migrate               # migraciones, cola de trabajos, almacén interno de conocimiento y datos base
pnpm starter doctor           # debe terminar en "Instalación en buen estado."
pnpm dev
```

Base externa: asegúrate de PostgreSQL 18 con pgvector disponible; define `DATABASE_URL` (rol de la aplicación) y opcionalmente `DATABASE_MIGRATION_URL` (rol con permisos de DDL).

## 3. Primer ingreso

1. Abre http://localhost:3000 e ingresa con el correo de `OWNER_EMAIL`.
2. El código llega a Mailpit (http://localhost:8025) con `MAIL_TRANSPORT=smtp`.
3. El primer visitante **no** se vuelve administrador. Si no hay propietario: `pnpm starter owner assign correo@empresa.cl` (pide confirmación; `--additional` para sumar otro propietario).

## 4. Producción

- `NODE_ENV=production`, `APP_URL` con HTTPS, `MAIL_TRANSPORT=smtp` o `resend` (nunca `log`), `AI_TEST_PROVIDER_ENABLED=false`, `OPENAPI_DOCS=protected` o `disabled`.
- Contenedores: `docker/compose.yaml` + `docker/compose.production.yaml` con el perfil `edge` (Caddy con HTTPS automático usando `SITE_ADDRESS`). Ver `docs/docker.md`.
- Ejecuta `pnpm starter doctor` en el servidor tras desplegar.

## Problemas frecuentes

| Síntoma | Acción |
| --- | --- |
| No llega el código | `pnpm starter doctor` revisa SMTP; en desarrollo mira Mailpit |
| "Variables de entorno inválidas" | Corrige lo que indica `doctor` (mismos nombres que `.env.example`) |
| `pgvector no disponible` | Usa la imagen `pgvector/pgvector` o instala la extensión en tu servidor |
| Migraciones pendientes | `pnpm build:ts && pnpm db:migrate` |

Detalle: `docs/installation.md`, `docs/troubleshooting.md`.
