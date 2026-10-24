# Instalar el Starter Kit (personas y agentes de IA)

Una sola ruta, sin preguntas, que se puede repetir sin romper nada. Si usas un asistente de IA
(Claude Code, Codex, Cursor, Copilot, Gemini…), basta con pedirle:

> Instala https://github.com/bluesmilecl/startkit_nnp siguiendo su `INSTALL.md`. El correo del
> propietario es **tu@empresa.cl**. Déjalo corriendo y dime cómo ingresar.

## Requisitos

| Necesitas | Versión | Comprobar |
| --- | --- | --- |
| Node.js | 24 LTS (≥ 24.11) | `node --version` |
| pnpm | la que fija `package.json` (vía corepack; el instalador la activa) | `pnpm --version` |
| Docker con Compose v2 | cualquiera reciente (o un PostgreSQL 18 + pgvector propio) | `docker compose version` |
| git | cualquiera | `git --version` |
| Puertos libres | 3000 (web), 3001 (API), 5432 (PostgreSQL; si está ocupado se usa otro), 8025/1025 (Mailpit) | |

## Instalación en 3 comandos

Probado sobre un clon limpio: ~45 s con la caché de pnpm llena; la primera vez en un equipo
nuevo descarga dependencias e imágenes (unos minutos).

```bash
git clone https://github.com/bluesmilecl/startkit_nnp mi-app && cd mi-app
node scripts/quickstart.mjs --owner tu@empresa.cl --test-ai
pnpm dev
```

`quickstart` hace, en orden: revisa requisitos → `pnpm install` → compila → crea `.env` con
**secretos únicos** (`pnpm starter init`) → levanta PostgreSQL 18 + pgvector y Mailpit en Docker →
migra y crea los datos base → diagnostica (`pnpm starter doctor`) → conecta la IA si se pidió.
Toda la salida queda en `quickstart.log`.

Termina siempre con una línea fácil de leer por un programa:

```text
QUICKSTART_RESULT=ok web=http://localhost:3000 mailpit=http://localhost:8025 owner=tu@empresa.cl ai=test next="pnpm dev"
QUICKSTART_RESULT=error step="PostgreSQL 18 + pgvector y Mailpit (Docker)"     ← con la causa y qué hacer arriba
```

Luego de `pnpm dev`:

1. Abre http://localhost:3000 e ingresa con el correo del propietario.
2. El código de 6 dígitos llega a **Mailpit**: http://localhost:8025.
3. Completa la configuración inicial (nombre, marca, acceso) y ya estás en el panel.

## Variantes

| Quiero… | Comando |
| --- | --- |
| Probar el chat sin claves (solo desarrollo) | `node scripts/quickstart.mjs --owner tu@empresa.cl --test-ai` |
| Usar OpenAI de inmediato | `OPENAI_API_KEY=sk-… node scripts/quickstart.mjs --owner tu@empresa.cl --ai openai --chat-model gpt-4.1-mini` |
| Usar Anthropic o Google | `ANTHROPIC_API_KEY=… … --ai anthropic --chat-model <id>` · `GOOGLE_GENERATIVE_AI_API_KEY=… … --ai google --chat-model <id>` |
| Conectar la IA después | `OPENAI_API_KEY=sk-… pnpm starter ai connect --provider openai --chat-model gpt-4.1-mini` |
| Mi propio PostgreSQL (sin Docker) | `node scripts/quickstart.mjs --owner tu@empresa.cl --db external --database-url postgres://usuario:clave@host:5432/base` |
| Solo identidad y panel (sin IA ni RAG) | `--modules ''` · solo IA: `--modules ai` · con organizaciones: `--modules ai,rag,organizations` |
| Arrancar al terminar | agrega `--start` (ejecuta `pnpm dev`) |
| Reinstalar desde cero en este equipo | agrega `--reset-db` (borra la base local anterior y sus datos) |

Sobre la IA:

- La clave **siempre** se lee de una variable de entorno (de la terminal o del `.env`), nunca de
  un argumento; se guarda cifrada en la base y no se vuelve a mostrar.
- `--chat-model` debe ser el id exacto del proveedor. Sin él, `ai connect` sincroniza el catálogo
  y puedes elegir el modelo en **/admin/ai/agents**.
- Con `--chat-model` el modelo se verifica con una llamada real mínima y se publica en el
  asistente predeterminado: el chat flotante queda listo.

## Checklist para agentes de IA

1. Clona y entra a la carpeta. No edites código para instalar.
2. Ejecuta `node scripts/quickstart.mjs --owner <correo>` (más las variantes pedidas) y lee la
   última línea. Si es `QUICKSTART_RESULT=error`, aplica la indicación `→` que aparece encima y
   **vuelve a ejecutar el mismo comando** (es idempotente).
3. Inicia `pnpm dev` en segundo plano y espera a que respondan:
   - `curl -sf http://localhost:3001/api/health/live` → `{"status":"ok"}`
   - `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login` → `200`
4. Confirma con `pnpm starter doctor` → «Instalación en buen estado.»
5. Entrega a la persona: URL, correo propietario, dónde llega el código (Mailpit) y si la IA quedó
   conectada (`ai=` en la línea final).

Reglas: nunca subas `.env` a git ni copies secretos a `starter.config.json`; no conviertas al
primer visitante en administrador (para otro propietario: `pnpm starter owner assign
correo@empresa.cl --additional`); `AI_TEST_PROVIDER_ENABLED` (`--test-ai`) es solo para desarrollo.
Para **modificar** el proyecto después, sigue [AGENTS.md](AGENTS.md).

## Qué crea en tu equipo

| Qué | Dónde |
| --- | --- |
| `.env` con secretos únicos (permisos 600, ignorado por git) | raíz del proyecto |
| `starter.config.json` (configuración exportable, sin secretos) | raíz del proyecto |
| Contenedores `starter-postgres-1` y `starter-mailpit-1` y su volumen de datos | Docker (proyecto `starter`) |
| `node_modules`, compilados `dist/` y `quickstart.log` | carpeta del proyecto |

Para detener la infraestructura: `pnpm infra:down`. Para borrar todo: `pnpm infra:down` y
`docker volume ls` → elimina los volúmenes `starter_*`.

## Problemas frecuentes

| Mensaje | Qué hacer |
| --- | --- |
| `Node … es muy antiguo` | Instala Node 24 LTS (`.node-version`) |
| «pnpm no está disponible» | `corepack enable pnpm` o `npm install -g pnpm@<versión de package.json>` |
| `Docker no responde` | Inicia Docker Desktop / el servicio, o usa `--db external` |
| `El puerto 8025 (Mailpit) está ocupado` | Libéralo o define `MAILPIT_PORT` y `MAILPIT_SMTP_PORT` en `.env` |
| `Falta --owner <correo>` | Repite con el correo de quien administrará la aplicación |
| `Ya existe una base local de una instalación anterior` | Copia el `.env` de esa instalación a este clon, o repite con `--reset-db` (borra esa base) |
| `Define la clave en la variable OPENAI_API_KEY` | `export OPENAI_API_KEY=…` y repite el comando |
| `Modelo … no encontrado` | Usa el id exacto; `pnpm starter ai connect --provider openai` lista y sincroniza el catálogo |
| No llega el código | Mira Mailpit (http://localhost:8025) y `pnpm starter doctor` |
| «Reenviar en 60s» al pedir otro código | Es la espera entre envíos (`OTP_RESEND_SECONDS`); usa el último código de Mailpit |
| La primera visita en `pnpm dev` se recarga sola | Normal en desarrollo: Vite prepara dependencias la primera vez; reintenta el ingreso |

Más detalle: [docs/installation.md](docs/installation.md) · producción con contenedores y HTTPS:
[docs/docker.md](docs/docker.md) · problemas: [docs/troubleshooting.md](docs/troubleshooting.md).
