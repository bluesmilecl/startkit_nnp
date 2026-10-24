# Manejo de errores

Un solo estándar para la API, el worker, el CLI y el panel: **cada error tiene un código estable
del catálogo, un mensaje en español que se puede mostrar, un código de solicitud para soporte y
una política de reintento y de log**. Nada de `Error` genérico hacia la persona, nada de texto del
navegador, del framework o de SQL en pantalla, y ningún 500 por una carrera o por datos mal
formados.

```
servicio ──throw AppError──▶ ErrorFilter ──{ error: { code, message, details, requestId } }──▶ ApiError (cliente generado)
   │                            │  log por nivel + métrica                                     │
   │                            └─ errores de Postgres / body-parser / Nest → catálogo        ├─ notify.error(err)   (acciones)
   └─ worker: AppError no reintentable → termina sin gastar reintentos                         ├─ <LoadError>         (cargas)
                                                                                                ├─ form.handleSubmit   (formularios)
                                                                                                └─ error.vue           (404 y fatales)
```

## Catálogo

Fuente única: `ERROR_CATALOG` en
[`packages/contracts/src/errors.ts`](../packages/contracts/src/errors.ts). Para agregar un código,
súmalo a `ErrorCodes` (`common.ts`) y al catálogo; la prueba unitaria exige que estén completos.

| Código | HTTP | Título | ¿Reintentable? | Log | Cuándo usarlo |
| --- | --- | --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Solicitud inválida | no | info | JSON mal formado, valores con formato imposible. |
| `UNAUTHENTICATED` | 401 | Sesión requerida | no | info | Sin sesión o sesión vencida (la web lleva a `/session-expired`). |
| `BUDGET_EXCEEDED` | 402 | Presupuesto agotado | no | info | Un presupuesto estricto bloquea la llamada. |
| `FORBIDDEN` | 403 | Sin permiso | no | info | Falta un permiso (`assertCan`) o la jerarquía no alcanza. |
| `NOT_FOUND` | 404 | No encontrado | no | info | El recurso no existe **en la organización del actor** (también un id mal formado en la ruta). |
| `FEATURE_DISABLED` | 404 | Función desactivada | no | info | Módulo opcional apagado (`feature` en `@Endpoint`). |
| `CONFLICT` | 409 | Conflicto | no | info | Duplicados (índice único), datos relacionados que impiden borrar. |
| `NOT_CONFIGURED` | 409 | Falta configuración | no | info | Falta un modelo, una conexión lista, un agente publicado… |
| `GONE` | 410 | Ya no está disponible | no | info | Propuestas o enlaces vencidos. |
| `PRECONDITION_FAILED` | 412 | Datos desactualizados | no | info | Concurrencia optimista (`version`). |
| `PAYLOAD_TOO_LARGE` | 413 | Contenido demasiado grande | no | info | Cuerpo o archivo sobre el límite. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Formato no soportado | no | info | Tipo o codificación del contenido no soportados. |
| `VALIDATION_FAILED` | 422 | Revisa los datos | no | info | El contrato Zod rechazó la entrada; incluye errores por campo. |
| `CAPABILITY_UNSUPPORTED` | 422 | No soportado | no | info | El proveedor o la conexión no ofrece la operación. |
| `RATE_LIMITED` | 429 | Demasiadas solicitudes | sí | warn | Límite de frecuencia (con `Retry-After`). |
| `INTERNAL` | 500 | Error inesperado | sí | error | Cualquier fallo no clasificado. El mensaje es genérico; la causa queda en el log. |
| `UPSTREAM_ERROR` | 502 | Falló un servicio externo | sí* | warn | Proveedor IA, API externa, correo, URL. *El que lanza puede decir `retryable: false`. |
| `UNAVAILABLE` | 503 | Servicio no disponible | sí | warn | Base de datos caída, bloqueo o deadlock (con `Retry-After`). |
| `TIMEOUT` | 504 | Tiempo agotado | sí | warn | `statement_timeout`, proveedor que no respondió a tiempo. |

En el navegador existen además `NETWORK` (no llegó respuesta), `ABORTED` (solicitud cancelada) y
`CLIENT` (falla del código de la página); nunca los envía el servidor.

## Forma de la respuesta

Todas las respuestas de error de la API de negocio tienen el esquema `ErrorResponse`:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Ya existe un proyecto con ese nombre",
    "details": [{ "path": "name", "message": "Ya existe un proyecto con ese nombre" }],
    "requestId": "8c1f…"
  }
}
```

- `code`: estable; el cliente decide por el código, **nunca por el mensaje**.
- `message`: español, seguro de mostrar. Sin secretos, SQL, rutas internas ni cuerpos de terceros.
- `details` según el código:
  - `VALIDATION_FAILED` (y un `CONFLICT` de un campo): `[{ path, message, code? }]`, con `path`
    igual al nombre del campo del formulario (`a.b.0`).
  - `PRECONDITION_FAILED`: `{ currentVersion }`.
  - `RATE_LIMITED` / `UNAVAILABLE`: `{ retryAfterSeconds }` (también en la cabecera `Retry-After`).
  - `UPSTREAM_ERROR`: `{ upstreamStatus }` o `{ errorKind, aiRequestId }` según el origen.
- `requestId`: el mismo valor de la cabecera `x-request-id` y de los logs. Si el cliente envía un
  `x-request-id` válido se conserva de punta a punta.
- Las respuestas de error llevan `Cache-Control: no-store`.

Las rutas de Better Auth (`/api/auth/*`) conservan su forma propia (`{ code, message }`); la web
las traduce con `authErrorMessage`.

## Servidor (API, CLI, worker)

### Lanzar errores del catálogo

```ts
import { AppError } from '@starter/contracts';

throw AppError.notFound('Proyecto');                     // «Proyecto no encontrado»
throw AppError.notFound('Colección', 'f');               // «Colección no encontrada»
throw AppError.field('name', 'Ya existe un proyecto con ese nombre', 'CONFLICT');
throw AppError.precondition('El proyecto fue modificado…', { currentVersion });
throw AppError.notConfigured('La colección no tiene índice activo');
throw AppError.unsupported('La API externa no admite ingesta');
throw AppError.upstream(`La URL respondió ${res.status}`, { retryable: res.status >= 500, details: { upstreamStatus: res.status } });
throw AppError.unavailable(undefined, 5, err);           // con Retry-After: 5
throw new AppError('BUDGET_EXCEEDED', 'El trabajo alcanzó su presupuesto');
```

Reglas:

- **Nunca `throw new Error('mensaje para la persona')`** en código que llega a una respuesta o a
  un trabajo: usa `AppError`. Un `Error` genérico se convierte en `INTERNAL` con mensaje genérico.
- El mensaje es para la persona; la causa técnica va en `cause` (solo log).
- `NOT_FOUND` también para recursos de otra organización: no se revela que existen.
- Un error de un tercero que no cambiará al reintentar (credencial inválida, 4xx) lleva
  `retryable: false`.

### Base de datos: la restricción manda

Para unicidad usa un **índice único con nombre** y traduce su violación; un `SELECT` previo no
protege contra solicitudes simultáneas. Es el patrón del módulo de referencia:

```ts
import { isUniqueViolation } from '@starter/db';

function rethrowNameTaken(err: unknown): never {
  if (isUniqueViolation(err, 'projects_org_name_uq')) throw AppError.field('name', 'Ya existe un proyecto con ese nombre', 'CONFLICT');
  throw err;
}
await db.insert(projects).values(…).returning().catch(rethrowNameTaken);
```

Lo que no se traduce en el servicio lo traduce el filtro con `mapDatabaseError`
([`packages/db/src/errors.ts`](../packages/db/src/errors.ts)), siempre con mensajes genéricos:

| PostgreSQL | Resultado |
| --- | --- |
| `23505` única, `23503` clave foránea | `CONFLICT` |
| `23502`, `23514`, `22001`, `22003` | `VALIDATION_FAILED` |
| `22P02`, `22007`, `22008` (uuid o fecha inválidos) | `BAD_REQUEST` |
| `40001`, `40P01`, `55P03` (serialización, deadlock, lock) | `UNAVAILABLE` con `Retry-After: 1` |
| `57014` (statement timeout) | `TIMEOUT` |
| `08xxx`, `53xxx`, `57P0x`, `ECONNREFUSED`… | `UNAVAILABLE` con `Retry-After: 5` |
| Cualquier otro (`42P01`, sintaxis…) | `INTERNAL` (es un bug) |

### Filtro HTTP

[`apps/api/src/common/error.filter.ts`](../apps/api/src/common/error.filter.ts) clasifica todo lo
que se lanza (`classifyError`, función pura con pruebas):

1. `AppError`: tal cual (con `details`).
2. Errores de body-parser: JSON inválido → 400, demasiado grande → 413, charset → 415.
3. `HttpException` de Nest (ruta inexistente, límites de multer): mensaje del catálogo; el texto
   del framework (en inglés, con rutas) no sale.
4. Errores de PostgreSQL: `mapDatabaseError`.
5. Todo lo demás: `INTERNAL` con «Ocurrió un error inesperado. Si persiste, comparte el código de
   solicitud con soporte.»

Un id mal formado en la ruta (`/api/projects/abc`) responde **404**, igual que uno inexistente.

### Logs y métricas

- Un error = **una línea de log** en el filtro, con `requestId`, `errorCode`, `status`, `origin`
  (`app`, `framework`, `body`, `database`, `unknown`), método y ruta (sin query string).
- Nivel según el catálogo: 4xx en `info` sin stack; `RATE_LIMITED` y fallas de terceros
  (`UPSTREAM_ERROR`, `UNAVAILABLE`, `TIMEOUT` lanzados por el servicio) en `warn`; `INTERNAL` en
  `error` **con stack**. Los errores de PostgreSQL traducidos llevan `db.sqlState`, `constraint` y
  `table`: los 4xx (carrera de duplicados, regla que el contrato no validó) en `warn` y los 5xx
  (base caída, timeout, deadlock) en `error`.
- No registres el mismo error dos veces (en el servicio y en el filtro): lanza y deja que el filtro
  lo registre. Registra en el servicio solo lo que el filtro no ve (errores absorbidos a propósito).
- Métricas en `/api/health/metrics`: `http_errors_total{code,status}`,
  `job_failures_total{queue,errorCode,retryable}` y `process_errors_total{kind}`.
- Los procesos API y worker instalan `installProcessHandlers`: una promesa rechazada sin manejar se
  registra con stack y el proceso sigue; una excepción no capturada se registra y el proceso termina
  (el orquestador lo reinicia).

### Worker y trabajos

`JobQueue.work` decide con `isRetryableError(err)`:

- `AppError` **no reintentable** (`FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `NOT_CONFIGURED`,
  `CAPABILITY_UNSUPPORTED`, `BUDGET_EXCEEDED`, `UPSTREAM_ERROR` con `retryable: false`…): el trabajo
  termina sin gastar reintentos y se registra `job failed permanently; not retried`. La fila de
  estado del dominio (p. ej. `rag_jobs`) guarda el motivo para la persona.
- Reintentables (`UPSTREAM_ERROR`, `UNAVAILABLE`, `TIMEOUT`, `RATE_LIMITED`, `INTERNAL`) y errores
  desconocidos: se relanzan y pg-boss reintenta con backoff hasta `retryLimit`.

La ingesta RAG aplica la misma regla (`permanent()` usa `isRetryableError`) además de la
cancelación.

## Web (Nuxt)

Todo lo que se lanza pasa por **`normalizeError(err, fallback?)`**
([`packages/ui/app/lib/errors.ts`](../packages/ui/app/lib/errors.ts)), que devuelve un `Problem`:
`{ code, status, title, message, requestId, details, fieldErrors, retryable, retryAfterSeconds }`.
Entiende el `ApiError` del cliente generado, el `NuxtError` serializado tras SSR, errores de
`$fetch`, fallas de red, cancelaciones y `AppError` lanzados por la propia página. Un mensaje de
JavaScript o del navegador nunca llega a la pantalla: se reemplaza por `fallback` o por el texto
del catálogo.

El cliente generado (`plugins/api.ts`) lanza siempre `ApiError` (estado + cuerpo); una página de
error HTML de un proxy (502) se convierte en el mensaje del catálogo para su estado.

| Situación | Usa |
| --- | --- |
| Cargar datos de una vista | `useApiData(key, handler, { fatal: [404] })` + `<LoadError v-if="problem" :error="problem" @retry="refresh()" />` |
| Detalle con id inexistente | `fatal: [404]` → `error.vue` en español con estado HTTP correcto (también en SSR) |
| Acción (guardar, borrar, sincronizar) | `try { … } catch (err) { notify.error(err) }`; con `{ retry }` agrega «Reintentar» si es transitorio |
| Formularios | `form.handleSubmit(…)`: errores por campo desde `details` y mensaje general (con código de solicitud si es 5xx) |
| Decidir por tipo de error | `normalizeError(err).code === 'PRECONDITION_FAILED'` (o `apiError(err).code`) |
| Falla no manejada en un handler | `plugins/errors.client.ts` muestra el toast estándar (red de seguridad, no un reemplazo) |

```ts
const { data: order, problem, refresh, status } = await useApiData(`order-${id}`, () => unwrap(ordersGet({ client: api, path: { id } })), { fatal: [404] });

async function approve() {
  try {
    await unwrap(ordersApprove({ client: api, path: { id } }));
    notify.success('Orden aprobada');
  } catch (err) {
    notify.error(err, { retry: approve });
  }
}
```

```vue
<LoadError v-if="problem" :error="problem" :retrying="status === 'pending'" @retry="refresh()" />
<template v-else-if="order">…</template>
```

Reglas:

- Siempre `await useApiData(...)` en `<script setup>`; sin `await`, un 404 fatal no reemplaza la
  página.
- Nunca `toast.error(err.message)` ni `toast.error(apiError(err).message)`: `notify.error(err)`
  agrega el código de solicitud y respeta `Retry-After`.
- No muestres `error.message` crudo de un `catch` en la plantilla; usa `normalizeError` o
  `LoadError`.
- Un 401 lleva a `/session-expired` desde el plugin de la API; no lo manejes en cada vista.
- Ejemplos vivos en `/admin/components?tab=feedback` (sección «Errores»).

## Pruebas

- Unitarias: catálogo completo y helpers
  ([`errors.test.ts`](../packages/contracts/src/errors.test.ts)), traducción de PostgreSQL
  ([`packages/db/src/errors.test.ts`](../packages/db/src/errors.test.ts)), clasificación del filtro
  ([`error.filter.test.ts`](../apps/api/src/common/error.filter.test.ts)) y normalización web
  ([`packages/ui/test/kit.test.ts`](../packages/ui/test/kit.test.ts)).
- Integración con PostgreSQL real:
  [`tests/integration/errors.test.ts`](../tests/integration/errors.test.ts) (índice único, clave
  foránea, uuid inválido, statement timeout a través de Drizzle).
- E2E: [`tests/e2e/errors.spec.ts`](../tests/e2e/errors.spec.ts) (forma de la respuesta, carrera
  de duplicados → un 201 y el resto 409, página de error en SSR y navegación, `LoadError` con
  reintento, falla de red al guardar).
- Para un módulo nuevo: prueba que un rol sin permiso recibe 403 con `code: 'FORBIDDEN'`, que un
  duplicado devuelve 409 con el error en el campo y que un id inexistente muestra la página 404.
