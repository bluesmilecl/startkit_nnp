---
name: install-starter
description: Instala y deja funcionando el Starter Kit Nuxt + NestJS IA (nueva instalación o clon existente), con propietario, base de datos, migraciones y verificación. Úsala cuando pidan crear, instalar, levantar o diagnosticar una instalación del starter.
---

# Instalar el starter

Ruta completa y verificable en [INSTALL.md](../../INSTALL.md). Resumen:

## 1. Un comando (clon de este repositorio)

```bash
git clone https://github.com/bluesmilecl/startkit_nnp mi-app && cd mi-app
node scripts/quickstart.mjs --owner propietaria@empresa.cl --test-ai
```

- Revisa requisitos, instala, compila, crea `.env` con secretos únicos (`pnpm starter init`),
  levanta PostgreSQL 18 + pgvector y Mailpit, migra y diagnostica. Es idempotente: ante un error,
  aplica la indicación `→` y repite el mismo comando.
- Lee la última línea: `QUICKSTART_RESULT=ok …` o `QUICKSTART_RESULT=error step="…"`; detalle en
  `quickstart.log`.
- Variantes: `--db external --database-url …`, `--modules ai` / `''`, `--ai openai --chat-model
  <id>` (clave en `OPENAI_API_KEY`), `--start`.
- Nunca copies secretos a `starter.config.json`; valida con `pnpm starter config validate`.

## 2. Arrancar y comprobar

```bash
pnpm dev                                   # en segundo plano si eres un agente
curl -sf http://localhost:3001/api/health/live
pnpm starter doctor                        # debe terminar en "Instalación en buen estado."
```

IA después de instalar (la clave se lee de una variable de entorno, nunca de un argumento):

```bash
OPENAI_API_KEY=sk-… pnpm starter ai connect --provider openai --chat-model gpt-4.1-mini
```

Copia nueva en otra carpeta: `pnpm starter create ../mi-app --from . --owner propietaria@empresa.cl --modules ai --yes`.

Base externa: PostgreSQL 18 con pgvector; define `DATABASE_URL` (rol de la aplicación) y
opcionalmente `DATABASE_MIGRATION_URL` (rol con permisos de DDL).

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
