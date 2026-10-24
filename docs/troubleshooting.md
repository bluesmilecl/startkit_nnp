# Solución de problemas

Empieza siempre por `pnpm starter doctor` (solo lectura): revisa Node/pnpm/Docker, compilación,
variables, `starter.config.json`, PostgreSQL, pgvector, migraciones, propietario, SMTP, IA y
conexiones de conocimiento. En producción revisa también `/admin/diagnostics`.

## No llega el código OTP

1. **Desarrollo**: los correos van a Mailpit, <http://localhost:8025>. `pnpm infra:up` publica
   el SMTP de Mailpit en `127.0.0.1:1025` (variable `MAILPIT_SMTP_PORT`), que es el
   `SMTP_URL` por defecto (`smtp://localhost:1025`) de `pnpm dev`. Si cambiaste el puerto, ajusta
   `SMTP_URL`; `doctor` muestra "SMTP … no responde" cuando no hay conexión.
2. **Modo de registro**: con `invite-only` (o `disabled`) un correo **sin invitación** recibe la
   misma respuesta pero no se envía nada (protección contra enumeración). Invítalo desde
   `/admin/invitations` o define `OWNER_EMAIL` para el propietario.
3. **Espera entre reenvíos**: si pides otro código antes de `OTP_RESEND_SECONDS` (60 s por
   defecto) recibes `OTP_RESEND_COOLDOWN` con los segundos restantes.
4. **Proveedor**: `pnpm starter mail test <correo>` envía un mensaje y muestra el motivo del rechazo
   (clave inválida, dominio sin verificar). Con `onboarding@resend.dev` como remitente, Resend solo
   entrega al correo de tu cuenta. Revisa también los logs `mail` de la API. Ver [mail.md](mail.md).
5. Código rechazado: vence a los 5 minutos y se invalida tras 5 intentos; pide uno nuevo.

## La API no arranca: "Invalid environment configuration"

El mensaje lista cada variable inválida. Casos típicos:

| Mensaje | Solución |
| --- | --- |
| `BETTER_AUTH_SECRET must be at least 32 characters` | Genera uno con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `APP_ENCRYPTION_KEY must be 32 bytes encoded as base64` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. |
| `AI_TEST_PROVIDER_ENABLED: must be false in production` | El proveedor de prueba nunca se habilita en producción. |
| `MAIL_TRANSPORT: log transport would expose codes in logs` | Usa Resend, SMTP u otro proveedor en producción ([mail.md](mail.md)). |
| `RESEND_API_KEY: required when MAIL_TRANSPORT=resend` (o la clave de otro proveedor) / `S3_BUCKET: required…` | Completa la variable del servicio elegido; `pnpm starter mail use <proveedor>` lo hace por ti. |

Las variables vacías se tratan como no definidas (aplican los valores por defecto).

## PostgreSQL / pgvector

- **No conecta**: revisa `DATABASE_URL`, que el contenedor esté sano (`pnpm infra:up` espera el
  *healthcheck*) y `DATABASE_SSL`.
- **pgvector no disponible**: usa la imagen `pgvector/pgvector:0.8.7-pg18-trixie` o instala la
  extensión en tu servidor. La extensión se crea al **activar** el conocimiento interno desde
  `/admin/knowledge/connections` (si la conexión es administrada y el rol tiene privilegios) o a
  mano con `CREATE EXTENSION vector;`; las migraciones no la crean. El diagnóstico de la conexión
  indica los pasos manuales exactos cuando no puede hacerlo.
- **Índices HNSW con un rol de ejecución sin DDL**: el conocimiento interno crea un índice por
  perfil de embeddings mediante `DATABASE_MIGRATION_URL`. Si la aplicación usa un rol sin
  privilegios de DDL, define esa variable también para `api` y `worker`.
- **Migraciones pendientes** (`Migraciones n/m` en `doctor`): `pnpm build:ts && pnpm db:migrate`.
- **`permission denied for schema`** durante la migración: el rol de `DATABASE_URL` no puede hacer
  DDL; define `DATABASE_MIGRATION_URL` con el rol propietario.

## 403 "Origen no permitido"

La API rechaza escrituras cuyo `Origin` no coincide con `APP_URL` o `TRUSTED_ORIGINS`. Ajusta
`APP_URL` al origen que abre el navegador (en Docker local, `http://localhost:8080`; con
`pnpm dev`, `http://localhost:3000`) y reinicia la API.

## Avisos de hidratación en la consola (desarrollo)

- **No pongas `<Badge>` (un `div`) dentro de `<p>`**: el HTML resultante no es válido y Vue
  reporta *hydration mismatch*. Usa `<div>` o `<span>`.
- **Selects con datos asíncronos** (reka-ui renderiza un *teleport* cuando hay valor): envuélvelos
  en `<ClientOnly>` como hacen `ModelSelect` y los filtros de colección.
- Fechas relativas: usa `RelativeTime`, que renderiza la fecha absoluta en el servidor.
- Gráficos: `TimeSeriesChart` y `DonutChart` ya se montan solo en el cliente.

## La página se recarga sola al abrirla por primera vez (desarrollo)

Vite optimiza dependencias nuevas la primera vez que una página las importa y recarga el
navegador ("new dependencies optimized"). Es propio del modo desarrollo; si una dependencia lo
provoca a menudo, agrégala a `vite.optimizeDeps.include` en `apps/web/nuxt.config.ts`. Antes de
correr E2E contra el servidor de desarrollo, visita las páginas una vez para "calentarlo".

## Proxy corporativo / certificados

- Node solo usa `HTTPS_PROXY` con `NODE_USE_ENV_PROXY=1`; si el proxy intercepta TLS agrega su CA
  con `NODE_EXTRA_CA_CERTS=/ruta/ca.pem` (variables comentadas en `.env.example`).
- Para construir imágenes detrás del proxy, ver [docker.md](docker.md#construir-en-redes-restringidas-proxy-corporativo).
- Si `models.dev` no es accesible, la sincronización de modelos y tarifas lo informa; puedes
  cargar tarifas manuales (ver [models-and-pricing.md](models-and-pricing.md)).

## Conocimiento (RAG)

- **"El endpoint apunta a una red privada"** al crear una conexión API o al ingerir una URL: por
  seguridad (SSRF) se bloquean direcciones privadas, *loopback* y metadatos de nube. Para fuentes
  internas de confianza define `RAG_FETCH_ALLOW_PRIVATE=true` (los metadatos de nube siguen
  bloqueados). Para modelos autoalojados de IA la variable es `AI_ALLOW_PRIVATE_ENDPOINTS`.
- **Documentos "Pendiente" que no avanzan**: el worker no está corriendo o no tiene el módulo
  activo (`FEATURE_RAG`). Revisa `/admin/knowledge/jobs` y los logs `worker-rag`.
- **"no soporta búsqueda híbrida"**: la API externa no declara esa capacidad; se usa búsqueda
  vectorial y se informa en la respuesta.
- `pnpm starter rag doctor` diagnostica todas las conexiones.

## IA

- **402 / `BUDGET_EXCEEDED`**: un presupuesto duro bloquea la llamada **antes** de llegar al
  proveedor. Revisa `/admin/ai/budgets` y el consumo en `/admin/ai/usage` (ver
  [costs.md](costs.md)).
- **Clave inválida o sin cuota**: la conexión muestra el tipo de error (`auth`, `quota`, `network`);
  prueba la conexión y rota la clave en `/admin/ai/connections`.
- **El chat no aparece**: el asistente por defecto se crea **sin publicar**; publícalo en
  `/admin/ai/agents` (ver [agents-and-chat.md](agents-and-chat.md)).
- El proveedor `test` solo existe con `AI_TEST_PROVIDER_ENABLED=true` y nunca en producción.

## Sesión

- Te envía a `/session-expired`: la sesión venció (`SESSION_EXPIRES_DAYS`) o fue revocada.
- Cuenta desactivada: no puede iniciar sesión (`ACCOUNT_DISABLED`); reactívala desde `/admin/users`.
- Sin propietario o acceso perdido: `pnpm starter owner assign <correo>` desde el servidor.
