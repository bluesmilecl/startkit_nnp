# Starter Kit Nuxt + NestJS IA

Base de producción para aplicaciones internas con **autenticación por código al correo**, **roles y permisos**, **panel de administración completo**, **IA con costos medidos**, **agentes versionados con chat flotante** y **conocimiento (RAG) opcional** interno o externo. Monorepo pnpm con Nuxt 4 (SSR con Nitro), NestJS, PostgreSQL 18 + pgvector, worker durable y Docker.

> Propietario: Esteban Cortés · Especificación v1.1 · Versión del starter: ver [`starter.manifest.json`](starter.manifest.json)

## Qué incluye

| Área | Contenido |
| --- | --- |
| Identidad | Ingreso con código OTP de 6 dígitos (5 min, 5 intentos, reenvío con espera), sesiones, invitaciones, propietario inicial por configuración (nunca el primer visitante), perfil, auditoría |
| Acceso | Roles propietario/administrador/editor/lector y roles propios, catálogo de permisos aplicado en el servidor (deny by default), organizaciones opcionales |
| Panel | Usuarios, invitaciones, roles, matriz de permisos, configuración, auditoría, diagnósticos, catálogo de componentes, Swagger protegido |
| IA | Conexiones a proveedores con claves cifradas, catálogo de modelos y capacidades, verificación real, tarifas con historial, libro de uso (solicitudes vs. intentos, costo desconocido ≠ cero), presupuestos con reservas atómicas, conversión visual a CLP, recomendación de modelos y laboratorio |
| Agentes y chat | Agentes versionados (borrador, publicación, rollback), chat flotante con streaming y cancelación, adjuntos, dictado por micrófono, herramientas de administración con propuestas confirmadas en el servidor |
| Conocimiento | Modos desactivado / interno (pgvector) / PostgreSQL externo / API externa, colecciones con ACL por rol y documento, fuentes (archivos, URL, sitemap, texto, programadas), indexación durable con costo, búsqueda híbrida con citas, laboratorio, evaluaciones y analítica |
| Distribución | CLI `create-ecortes-app` / `pnpm starter`, generador de módulos desde el módulo de referencia **Proyectos**, OpenAPI + cliente TypeScript generado, documentación, skills para agentes, `llms.txt`, Renovate, CI y E2E con Playwright |

## Inicio rápido

Requisitos: Node 24 LTS, Docker con Compose v2 y git (pnpm se activa solo con corepack).

```bash
git clone https://github.com/bluesmilecl/startkit_nnp mesa-de-ayuda && cd mesa-de-ayuda
node scripts/quickstart.mjs --new "Mesa de Ayuda" --owner tu@empresa.cl --test-ai   # instala, configura, levanta la base y migra
pnpm dev                                                                            # web :3000 · API :3001 · worker
```

Abre http://localhost:3000, ingresa con el correo propietario y lee el código en Mailpit
(http://localhost:8025). `--test-ai` deja el chat funcionando sin claves (solo desarrollo); con
una clave real: `OPENAI_API_KEY=sk-… pnpm starter ai connect --provider openai --chat-model gpt-4.1-mini`.

`--new "Mesa de Ayuda"` lo convierte en tu proyecto: nombre propio, contenedores Docker propios
(puedes tener varios proyectos a la vez), el starter como remoto `starter` para traer mejoras y un
`PROJECT.md` con el contexto que los agentes leen al abrirlo. Sin `--new` queda como el starter.

> **¿Con un asistente de IA?** Pídele: *«Crea un proyecto llamado Mesa de Ayuda a partir de
> https://github.com/bluesmilecl/startkit_nnp siguiendo su INSTALL.md; el propietario es
> tu@empresa.cl»*. [INSTALL.md](INSTALL.md) es una ruta sin preguntas, repetible y verificable
> (`QUICKSTART_RESULT=ok`); después `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`, `PROJECT.md` y las
> [skills](.claude/skills/) le dan el contexto para seguir construyendo.

**Correo:** Resend por defecto (`RESEND_API_KEY=re_… node scripts/quickstart.mjs …` o
`pnpm starter mail use resend`), o tu propio SMTP, Postmark, SendGrid, Mailgun o Brevo:
[docs/mail.md](docs/mail.md).

Variantes (PostgreSQL propio, OpenAI/Anthropic/Google, solo algunos módulos) en
[INSTALL.md](INSTALL.md). Producción con contenedores (web, API, worker, migrate y Caddy con
HTTPS automático): [docs/docker.md](docs/docker.md).

## Comandos

| Comando | Qué hace |
| --- | --- |
| `node scripts/quickstart.mjs --owner <correo> [--new "<Nombre>"]` | Instalación local completa en un comando (idempotente); con `--new`, como proyecto propio |
| `pnpm dev` | Compilación TypeScript en modo watch + API + worker + Nuxt |
| `pnpm infra:up` / `pnpm infra:down` | Base de datos y Mailpit en Docker (lee el `.env` de la raíz) |
| `pnpm build` / `pnpm build:ts` | Compilación completa / solo paquetes y apps Node |
| `pnpm db:generate` / `pnpm db:migrate` | Genera migraciones Drizzle / aplica migraciones, cola de trabajos, almacén interno de conocimiento y datos base |
| `pnpm lint` · `pnpm typecheck` | ESLint · TypeScript (incluida la web) |
| `pnpm test` · `pnpm test:integration` · `pnpm test:e2e` | Unitarias · integración con PostgreSQL real · Playwright |
| `pnpm api:docs:generate` · `pnpm api:client:generate` · `pnpm api:contract:check` | OpenAPI y referencia Markdown · cliente TypeScript · cambios incompatibles |
| `pnpm docs:check` | Enlaces, comandos, `llms.txt`, configuración de ejemplo y versión del AI SDK |
| `pnpm starter <comando>` | CLI: `create`, `init`, `doctor`, `config validate`, `mail use`, `mail test`, `ai connect`, `ai sync`, `rag doctor`, `rag reindex`, `generate module`, `docs check`, `owner assign` |
| `pnpm verify` | Verificación integral reproducible (escribe `verify-report.md`) |

## Estructura

```
apps/
  api/        NestJS (Express): auth, admin, IA, agentes/chat, conocimiento, proyectos, OpenAPI
  worker/     pg-boss: correo, IA (laboratorio, sincronizaciones, purgas), ingesta e indexación
  web/        Nuxt 4 + Nitro SSR, panel, chat flotante
packages/
  config/     variables de entorno validadas, starter.config, secretos cifrados
  contracts/  esquemas Zod compartidos (fuente de OpenAPI y del cliente)
  db/         esquema Drizzle y migraciones
  auth/       actor, permisos, políticas, auditoría, invitaciones, propuestas
  ai/         proveedores, catálogo, tarifas, libro de uso, presupuestos, agentes, chat
  rag/        almacenes (pgvector, PostgreSQL externo, API), parsing, ingesta, recuperación
  jobs/ mail/ storage/ observability/ ui/ api-client/
tooling/
  create-starter/   CLI create-ecortes-app / pnpm starter
  generator/        generador de módulos
docker/  docs/  scripts/  tests/  .claude/skills/
```

## Documentación

- Arquitectura y operación: [arquitectura](docs/architecture.md) · [instalación](docs/installation.md) · [Docker](docs/docker.md) · [actualizaciones](docs/upgrades.md) · [dependencias](docs/dependency-updates.md) · [problemas frecuentes](docs/troubleshooting.md)
- Identidad: [autenticación](docs/authentication.md) · [correo](docs/mail.md) · [permisos](docs/permissions.md) · [herramientas de administración](docs/admin-tools.md)
- IA: [proveedores](docs/ai-providers.md) · [modelos y tarifas](docs/models-and-pricing.md) · [costos](docs/costs.md) · [agentes y chat](docs/agents-and-chat.md) · [audio y multimedia](docs/audio-and-media.md)
- Conocimiento: [RAG](docs/rag.md) · [API externa de recuperación](docs/rag-external.md) · [indexación](docs/indexing.md)
- Desarrollo: [extender el starter](docs/extending.md) · [kit de interfaz](docs/frontend-components.md) · [manejo de errores](docs/errors.md) · [pruebas E2E](docs/e2e.md) · [referencia de la API](docs/api-reference.md)
- Para agentes de código: [AGENTS.md](AGENTS.md) · [skills](.claude/skills/) · [llms.txt](llms.txt)

## Principios de seguridad

- Los secretos viven solo en variables de entorno o en la base cifrados con `APP_ENCRYPTION_KEY` (que nunca se guarda en la base); `starter.config.json` no admite secretos ni cadenas de conexión.
- El primer visitante nunca se vuelve administrador: el propietario se define con `OWNER_EMAIL` o con `pnpm starter owner assign` desde el servidor.
- Cada operación valida permisos en el servidor; la interfaz solo oculta lo que no corresponde.
- El cliente no puede inyectar prompt de sistema, modelo ni colecciones; el actor de las herramientas del chat se inyecta en el servidor y las acciones sensibles requieren una propuesta confirmada.
- Los documentos del conocimiento son datos no confiables; las descargas tienen protección SSRF, límites de tamaño y redirecciones controladas.
- El proveedor de IA de prueba y el transporte de correo `log` se rechazan en producción; los códigos OTP nunca se registran en logs de producción.
- No se requieren Redis, Kubernetes, una base vectorial adicional ni un framework de agentes; las imágenes de producción se fijan por versión (sin `latest`).

## Estado de verificación

Cada capacidad se distingue como **verificada** (pruebas de integración o E2E contra PostgreSQL real y la pila completa), **simulada** (proveedor de IA determinista para pruebas sin claves de pago), **configuración pendiente** (requiere credenciales del proveedor en tu instalación) o **no soportada** (la conexión declara que no la ofrece y la interfaz lo indica). Revisa `pnpm verify` y [docs/e2e.md](docs/e2e.md) para el detalle.
