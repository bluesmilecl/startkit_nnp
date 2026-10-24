# Pruebas

| Nivel | Herramienta | Qué usa | Comando |
| --- | --- | --- | --- |
| Unitarias | Vitest (proyecto `unit`) | Lógica pura (`packages/*/src/**/*.test.ts`, `apps/*/src/**`, `tooling/*/src/**`) | `pnpm test` |
| Integración | Vitest (proyecto `integration`) | PostgreSQL + pgvector reales, servicios de dominio, proveedor IA determinista | `pnpm test:integration` |
| Extremo a extremo | Playwright | Stack Docker completo (web, api, worker, PostgreSQL, Mailpit, RAG) | `pnpm test:e2e` |
| Todo | `scripts/verify.mjs` | Lo anterior + contratos, manifiesto, documentación, Compose, build | `pnpm verify` |

**Nada de la lógica de negocio se simula.** El único sustituto es el proveedor de IA `test`
(determinista, sin claves pagadas), que ejercita el mismo camino real de herramientas, libro de
uso, costos y presupuestos. La API de recuperación externa se prueba contra un doble que
implementa el contrato documentado en [rag-external.md](rag-external.md).

## Integración

- Requiere PostgreSQL con pgvector (por ejemplo `pnpm infra:up`) y los paquetes compilados
  (`pnpm build:ts`): las pruebas importan los compilados igual que las aplicaciones.
- Recrea una base aislada `<base>_it` (o `TEST_DATABASE_NAME`) a partir de `DATABASE_URL`, aplica
  migraciones y datos base. Nunca toca la base de desarrollo.
- Archivos en `tests/integration`:
  - `access.test.ts`: autorización en servicios (mismas reglas REST/chat), jerarquía, último
    propietario, propuestas (vista previa → confirmación → ejecución), aislamiento de organizaciones.
  - `ai.test.ts`: conexiones, libro de uso y costos, presupuestos con reservas atómicas.
  - `agents.test.ts`: agentes versionados, herramientas del chat con los permisos del actor.
  - `rag.test.ts`: almacén interno, PostgreSQL externo y API externa; ingesta con costo, búsqueda
    vectorial/texto/híbrida, ACL de colección y documento, sitemaps, SSRF, reindexación atómica,
    presupuestos, cancelación/reintento, evaluación, analítica y purga.

## E2E con Playwright

### Stack dedicado

```bash
node scripts/e2e-stack.mjs up      # construye imágenes y levanta el stack (proyecto starter-e2e)
pnpm test:e2e --project=chromium
node scripts/e2e-stack.mjs logs    # últimas 300 líneas de cada servicio
node scripts/e2e-stack.mjs down    # detiene y borra volúmenes
```

`up` genera `.env.e2e` (secretos aleatorios, `NODE_ENV=test`, `OWNER_EMAIL=owner@e2e.test`,
proveedor IA de prueba activo, `RAG_FETCH_ALLOW_PRIVATE=true`, token del doble de recuperación) y
usa los perfiles `local-db`, `dev-mail` y `rag-db` con su propio proyecto Compose, así nunca toca
el entorno de desarrollo.

| Variable | Defecto | Uso |
| --- | --- | --- |
| `E2E_PROJECT` | `starter-e2e` | Nombre del proyecto Compose. |
| `E2E_PORT` / `E2E_MAIL_PORT` / `E2E_MAIL_SMTP_PORT` / `E2E_PG_PORT` | `8080` / `8025` / `51025` / `55433` | Puertos publicados (proxy, UI de Mailpit, SMTP de Mailpit, PostgreSQL); no chocan con el stack de desarrollo. |
| `E2E_BUILD_ARGS` | — | Argumentos extra para `docker build` (proxy, CA, espejo de imágenes; ver [docker.md](docker.md)). |
| `E2E_SKIP_BUILD` | — | Reutiliza las imágenes ya construidas. |
| `E2E_KEEP_ENV` | — | Conserva el `.env.e2e` existente. |

### Variables de las pruebas

| Variable | Defecto | Uso |
| --- | --- | --- |
| `E2E_BASE_URL` | `http://localhost:8080` | Origen de la aplicación. |
| `E2E_MAILPIT_URL` | `http://localhost:<MAILPIT_PORT>` | API de Mailpit para leer los códigos OTP. |
| `E2E_DATABASE_URL` | derivada de `.env.e2e` | Acceso directo a la base **solo para preparar o inspeccionar** (expirar un código, verificar auditoría). |
| `E2E_OWNER_EMAIL` | `OWNER_EMAIL` de `.env.e2e` | Propietario con el que se inicia sesión. |
| `PW_CHROMIUM_EXECUTABLE` | — | Chromium preinstalado (entornos sin descarga de navegadores). |
| `E2E_RETRIEVAL_URL` | `http://retrieval-test:3005` | Dirección del doble de recuperación vista **desde la API**. |
| `E2E_RETRIEVAL_TOKEN` | `RETRIEVAL_TEST_TOKEN` de `.env.e2e` | Token del doble. |
| `E2E_RAG_PG_URL` | `postgres://rag:…@rag-postgres:5432/rag` | PostgreSQL externo para conocimiento; si falta, esa prueba se omite. |

Contra servidores de desarrollo (`pnpm dev`) define `E2E_BASE_URL=http://localhost:3000`,
`E2E_DATABASE_URL`, `E2E_OWNER_EMAIL` y las direcciones RAG locales (`http://localhost:3005` si
corres `node apps/api/dist/scripts/retrieval-test-server.js` con `RETRIEVAL_TEST_TOKEN`).

### Proyectos

| Proyecto | Dispositivo | Qué corre |
| --- | --- | --- |
| `chromium` | Desktop Chrome con micrófono simulado (`--use-fake-device-for-media-stream`) | Toda la suite. |
| `mobile` | Pixel 7 | Pruebas etiquetadas `@mobile`. |
| `firefox`, `webkit` | Desktop | En CI semanal: pruebas `@critical`. |

Configuración ([`playwright.config.ts`](../playwright.config.ts)): un *worker* (las pruebas
comparten la sesión del propietario y la espera entre reenvíos de OTP), 60 s por prueba, trazas y
capturas solo al fallar, `locale es-CL` y zona `America/Santiago`. La sesión del propietario se
crea una vez por *worker* iniciando sesión por la interfaz con el código leído desde Mailpit.

### Especificaciones (`tests/e2e`)

| Archivo | Cubre |
| --- | --- |
| `auth.spec.ts` | Código correcto, incorrecto y vencido; espera de reenvío; correos sin acceso (misma respuesta, sin envío); sesión persistente en SSR, cierre y revocación. |
| `users.spec.ts` | Crear, ver, editar, desactivar, reactivar y eliminar usuarios; asignar roles y cambiar la matriz de permisos; rechazo de solicitudes fabricadas sin permiso; CSRF por origen. |
| `ui.spec.ts` | Navegación por teclado, modo oscuro y barra lateral móvil. |
| `ai.spec.ts` | Conexión de prueba, sincronización y verificación de modelos, tarifas, laboratorio en el worker con costo en el libro, presupuesto duro que bloquea antes del proveedor, claves nunca visibles. |
| `chat.spec.ts` | Herramientas administrativas, propuestas confirmadas/canceladas, otra persona no puede confirmar, el cliente no puede inyectar configuración, cancelación con costo estimado, adjuntos validados por contenido, dictado por micrófono, publicar y revertir versiones del agente. |
| `rag.spec.ts` | Conexiones interna, PostgreSQL externo y API; perfil y colección; ingesta por archivo, texto y sitemap con visor de fragmentos; ACL de documento para lectores; laboratorio y evaluación; chat con citas y valoración; analítica; reindexación y eliminación con confirmación. |
| `projects.spec.ts` | Módulo de referencia: CRUD, búsqueda, archivar/restaurar, eliminación con confirmación, auditoría, conflicto de concurrencia (412) y rol de solo lectura. |

Los módulos generados con `pnpm starter generate module` incluyen su propia especificación.

## `pnpm verify`

Ejecuta en orden: instalación congelada, `build:ts`, lint, typecheck web, unitarias, OpenAPI al
día, cliente generado al día y compilando, `api:contract:check`, manifiesto, esquemas JSON
(`node scripts/schemas.mjs --check`), `docs:check`,
validación de las variantes Compose, build web y, si hay infraestructura, migraciones e
integración. Opciones: `--skip-integration` y `--with-e2e` (levanta el stack Docker y corre
Playwright). El resultado queda en `verify-report.md`.
