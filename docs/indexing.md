# Indexación: trabajos durables, reindexación y costos

Toda la ingesta del conocimiento corre en el **worker** como trabajos durables: sobreviven reinicios, se reintentan con espera exponencial, informan etapa, progreso, unidades y costo, y se pueden cancelar. La API solo encola. Conceptos generales: [rag.md](rag.md).

---

## 1. Arquitectura

| Pieza | Rol |
| --- | --- |
| `rag_jobs` (base de la aplicación) | Vista de dominio de cada trabajo: tipo, estado, etapa, progreso, intentos, unidades, costo, presupuesto, error, tiempos por etapa y latido. Es lo que muestra el panel. |
| pg-boss (esquema `pgboss`) | Cola durable en la misma base PostgreSQL. Cada mensaje solo lleva `{ ragJobId }`. |
| Worker (`apps/worker`) | Consume las colas y ejecuta `IngestionService.run(ragJobId, retryCount)`. |

Colas y políticas:

| Cola | Tipo de trabajo | Concurrencia por worker | Reintentos (pg-boss) | Intentos máx. del trabajo | Espera inicial | Expira |
| --- | --- | :-: | :-: | :-: | :-: | :-: |
| `rag.ingest-source` | `ingest-source` | 1 | 5 | 5 | 30 s (exponencial) | 1 h |
| `rag.ingest-document` | `ingest-document` | 3 | 5 | 5 | 15 s (exponencial) | 30 min |
| `rag.reindex` | `reindex` | 1 | 3 | 4 | 60 s (exponencial) | 2 h |
| `rag.delete-document` | `delete-document` | 2 | 8 | 5 | 15 s (exponencial) | 10 min |
| `rag.purge` | `purge-collection` | 1 | 8 | 5 | 60 s (exponencial) | 1 h |
| `rag.schedule-tick` | programaciones y retención | singleton, cada minuto | 0 | — | — | 2 min |

Los intentos máximos de cada trabajo (`maxAttempts`) se derivan del límite de reintentos de su cola: `mín(5, reintentos + 1)`. Así el último intento transitorio siempre cierra el trabajo como `failed` y ninguno queda en `retrying` cuando la cola ya no lo volverá a entregar.

Para más capacidad se agregan réplicas del worker; pg-boss reparte los trabajos.

## 2. Tipos de trabajo y etapas

| Tipo | Lo crea | Etapas |
| --- | --- | --- |
| `ingest-source` | Crear o sincronizar una fuente `url`, `sitemap` o `text`; programación | `discover` → `enqueue` (crea un `ingest-document` por URL y `delete-document` por URL desaparecida) |
| `ingest-document` | Subida, `ingest-source`, «Volver a procesar» | `fetch` → `parse` → `embed` → `write` (o `unchanged`; en API: `push`) |
| `reindex` | «Reindexar» (panel, API o CLI) | `reindex` (por documento) → `activate` |
| `delete-document` | Eliminar documento o fuente, URL desaparecida, retención | `delete` |
| `purge-collection` | Eliminar colección | `purge` |

Estados: `queued` → `running` → `succeeded` | `failed` | `cancelled`, con `retrying` entre intentos. Cada cambio de etapa y cada lote de embeddings actualizan `heartbeatAt`; el mantenimiento del worker registra una advertencia cuando un trabajo `running` lleva más de 15 minutos sin latido.

## 3. Errores, reintentos y cancelación

- **Permanentes** (no se reintentan): `VALIDATION_FAILED` (p. ej. documento sin texto, PDF escaneado sin texto, URL bloqueada), `NOT_FOUND`, `CAPABILITY_UNSUPPORTED`, `BUDGET_EXCEEDED`, `NOT_CONFIGURED`, `FEATURE_DISABLED` y la cancelación. El trabajo queda `failed` con el mensaje; si tenía documento, el documento queda `failed` con el error visible en el panel.
- **Transitorios** (red, tiempo límite, proveedor de IA, base ocupada): el trabajo pasa a `retrying` y pg-boss lo reintenta con espera exponencial; al agotar los intentos (`maxAttempts`, ver §1) queda `failed` con el último error.
- **Cancelar** (`POST /api/rag/jobs/{id}/cancel`, botón en el panel): un trabajo en cola se cancela de inmediato; uno en curso se detiene en el siguiente punto seguro (antes de cada lote de embeddings, de cada URL encolada o de cada documento reindexado).
- **Reintentar** (`POST /api/rag/jobs/{id}/retry`): solo trabajos `failed` o `cancelled`; crea un trabajo nuevo con los mismos parámetros y presupuesto.

Permiso para ver y operar trabajos: `rag.jobs.manage`. Panel: **Conocimiento → Trabajos** (`/admin/knowledge/jobs`) y la pestaña *Trabajos* de cada colección; ambos se actualizan solos mientras haya trabajos activos y muestran etapa, progreso, intentos, costo, unidades y tiempos por etapa.

## 4. Idempotencia

Los trabajos con clave de idempotencia no se duplican mientras haya uno activo (`queued`, `running`, `retrying`) con la misma clave: se devuelve el existente.

| Clave | Evita |
| --- | --- |
| `sync:<fuente>` | Dos sincronizaciones simultáneas de la misma fuente (manual o programada). |
| `ingest:<colección>:<sha1(url)>` | Encolar dos veces la misma URL. |
| `ingest:<colección>:text:<fuente>` | Reprocesar dos veces una fuente de texto. |
| `ingest:<documento>` | Doble «Volver a procesar». |
| `delete:<documento>` | Doble eliminación. |
| `reindex:<colección>` | Dos reindexaciones (además se rechaza si ya hay una versión en construcción). |
| `purge:<colección>` | Doble purga. |

Las subidas no usan clave: cada subida es un trabajo.

## 5. Pipeline de un documento (`ingest-document`)

1. **fetch**: si el trabajo trae URL y aún no hay original guardado, o pide `refetch` (sincronización de fuentes URL/sitemap) o `force`, descarga con la política anti-SSRF (ver [rag.md](rag.md#12-seguridad)) y guarda el original en el almacenamiento (`STORAGE_DRIVER`), así reindexar nunca depende del sitio remoto. Si no, lee el archivo guardado.
2. Calcula el **hash SHA-256** del contenido.
3. **parse** (detección por contenido, no por extensión):
   - **PDF** con `unpdf`: una sección por página (las citas indican la página). Sin OCR: un PDF escaneado sin texto falla con un mensaje claro.
   - **HTML**: se eliminan `script`, `style`, `nav`, `header`, `footer`, `aside`, `form`, `iframe` y elementos ocultos; se toma `main`, `article` o `body`; los títulos `h1–h6` se convierten en encabezados y las listas en viñetas. El título sale de `<title>` o del primer `h1`.
   - **Markdown y texto**: secciones por encabezados `#…######`; cada sección conserva la ruta de encabezados (`Guía › Regiones`) para las citas.
   - Binarios no soportados se rechazan.
4. **chunk** (fragmentación por estructura): las secciones nunca se mezclan; dentro de una sección se agrupan párrafos hasta `size` caracteres, los párrafos largos se cortan en fin de oración y un solapamiento de `overlap` caracteres mantiene el contexto entre fragmentos consecutivos. Se estiman tokens (≈ caracteres / 4).
5. **upsert** del documento (único por colección + `externalId`):
   - Mismo hash, ya indexado y sin error → etapa **`unchanged`**: solo se actualizan título, URL, ACL y metadatos; no se generan embeddings ni costo. Si viene de una fuente, cuenta como «sin cambios» en la sincronización.
   - Contenido nuevo o distinto → versión + 1 y estado `processing`.
   - «Volver a procesar» (`force`) siempre regenera los fragmentos y embeddings, aunque el contenido no haya cambiado.
6. **embed**: lotes de 32 fragmentos (el encabezado se antepone al texto) mediante el runtime de IA, que aplica presupuestos, registra el uso en el libro con la función **`embedding`** y el `jobId`, y devuelve el costo; el trabajo acumula unidades (`embedding_tokens`) y costo. Una llamada sin tarifa vigente no suma cero: incrementa `units.unpriced_calls` y el panel muestra el costo como «… + desconocido». Se valida que el modelo devuelva las dimensiones del perfil.
7. **write**: reemplaza los fragmentos del documento en la versión de índice activa dentro de una transacción y marca el documento `indexed`.

En colecciones de una **API externa**, después de `parse` el texto normalizado se envía con `PUT /documents/…` (etapa `push`); el servicio fragmenta y genera embeddings ([contrato](rag-external.md)).

Resincronización idempotente:

- Las fuentes **URL** y **sitemap** vuelven a descargar cada página en cada sincronización (`refetch`), pero solo generan embeddings (y costo) cuando el contenido cambió; las páginas iguales terminan en `unchanged`.
- Las fuentes de **texto** y las **subidas** con el mismo contenido también terminan en `unchanged`.
- Solo «Volver a procesar» (`force`) regenera un documento sin cambios.

## 6. Fuentes con descubrimiento (`ingest-source`)

- **url**: un documento cuyo `externalId` es la URL.
- **sitemap**: lee el sitemap (y sitemaps índice, hasta 10 archivos), aplica `include`/`exclude` y `maxUrls`, encola un documento por URL y encola la eliminación de los documentos de esa fuente cuya URL ya no aparece. Un sitemap sin URL que pasen los filtros falla con un mensaje claro.
- **text**: un documento `text:<fuente>` a partir del Markdown guardado.

Cada sincronización deja un registro en `sync_runs` (descubiertos, nuevos, actualizados, sin cambios, quitados) y actualiza en la fuente `lastSyncAt`, `lastError`, `nextSyncAt` y las estadísticas que muestra el panel. Una página ya existente se cuenta primero como «actualizada» y, si su trabajo termina en `unchanged`, pasa a «sin cambios» (en `sync_runs` y en las estadísticas de la fuente). Una fuente con error vuelve a `active` en la siguiente sincronización exitosa.

## 7. Reindexación atómica

Necesaria al cambiar de perfil de embeddings (modelo, dimensiones o métrica) o de fragmentación, o para reconstruir el índice.

1. Se crea una **versión de índice** nueva en estado `building` (la colección guarda `buildingIndexVersionId`) y, si hace falta, el índice HNSW del perfil.
2. Se reprocesan los documentos indexados desde los originales guardados (parse, chunk, embed, write en la versión nueva). Las búsquedas siguen usando la versión **activa** durante todo el proceso.
3. Se reprocesan también los documentos ingeridos mientras se construía (*catch-up*).
4. **activate**: en una transacción, la versión nueva pasa a `active` y la anterior a `retired`; la colección actualiza la versión activa y el perfil, y las versiones retiradas se eliminan.
5. Si el trabajo falla, se cancela o supera su presupuesto, la versión en construcción se descarta y la colección queda como estaba.

Un documento que falla individualmente durante la reindexación no detiene el trabajo: al activar la versión nueva queda en estado `failed` con el error «Reindexación: <motivo>» y se cuenta en `units.failed` del trabajo (también en la auditoría). Como no tiene fragmentos en la versión nueva, no aparece en las búsquedas hasta que se use «Volver a procesar».

Formas de lanzarla:

- Panel: botón **Reindexar** del detalle de la colección (perfil opcional y presupuesto máximo en USD).
- API: `POST /api/rag/collections/{id}/reindex` con `{ "embeddingProfileId"?: "…", "budgetUsd"?: "0.50" }` (permiso `rag.collections.manage`).
- CLI: `pnpm starter rag reindex <colección> [--profile <clave>] [--budget <usd>] [--wait]` (`<colección>` es el identificador o el id; `--wait` muestra el progreso hasta terminar; el worker debe estar corriendo).

Las colecciones de una API externa no se reindexan desde el starter.

## 8. Presupuestos y costos

- Cada trabajo puede tener `budgetUsd`. Tras cada lote de embeddings se suma el costo; si supera el presupuesto, el trabajo falla con `BUDGET_EXCEEDED` (permanente).
- Los presupuestos de IA de la organización también aplican: el runtime los verifica antes de llamar al proveedor.
- El costo de cada trabajo se ve en el panel; el detalle está en **Uso y costos** (función `embedding` para ingesta y reindexación, `rag_query` para consultas) y en la analítica de conocimiento.
- Un costo desconocido (modelo sin tarifa) no se registra como cero: queda como desconocido en el libro de uso y, en el trabajo, se cuenta en `units.unpriced_calls` sin sumar al costo; el panel lo muestra como «… + desconocido».

## 9. Eliminación, purga y retención

- **delete-document**: borra el documento y sus fragmentos (todas las versiones) del almacén y el archivo original del almacenamiento.
- **purge-collection**: borra documentos, versiones de índice, fragmentos y archivos (incluidos los de fuentes de texto) y finalmente la colección. Mientras tanto la colección queda en `deleting` y no se consulta.
- **Retención** (`retentionDays`): el *tick* encola la eliminación de documentos cuya última actualización es anterior al límite (solo en almacenes PostgreSQL con escritura). Una resincronización sin cambios renueva la fecha, así que el contenido vigente de las fuentes no expira.

Todas estas operaciones quedan en la auditoría.

## 10. Programación (`rag.schedule-tick`)

Cada minuto, un único worker:

1. Toma hasta 20 fuentes activas con programación vencida (`nextSyncAt <= now()`), calcula la próxima ejecución (cron de 5 campos en UTC) y encola `ingest-source` con clave `sync:<fuente>`.
2. Aplica la retención de las colecciones activas que la tienen.

Las fuentes pausadas no se sincronizan. Una expresión cron inválida se rechaza al guardar la fuente.

## 11. CLI

```bash
pnpm starter rag doctor                       # diagnostica todas las conexiones (solo lectura)
pnpm starter rag reindex manual --wait        # reindexa la colección "manual" y espera
pnpm starter rag reindex manual --profile openai-small --budget 2
```

## 12. Solución de problemas

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| Trabajos en `queued` que no avanzan | El worker no está corriendo o no alcanza la base | Revisa el proceso/contenedor del worker y `pnpm starter doctor`. |
| `running` sin avance y advertencia «rag jobs without heartbeat» | El worker se detuvo a mitad | pg-boss lo volverá a entregar al expirar; si no, cancela y reintenta. |
| «La URL respondió 403/404» | El sitio rechaza la descarga | Revisa la URL; algunos sitios bloquean bots. |
| «El endpoint apunta a una red privada…» | La URL resuelve a una red privada | Usa una URL pública o, solo para fuentes internas de confianza, `RAG_FETCH_ALLOW_PRIVATE=true`. |
| «El recurso supera N MB» | Mayor que `RAG_FETCH_MAX_BYTES` | Divide el documento o ajusta el límite. |
| «El PDF no contiene texto extraíble» | PDF escaneado (imagen) | Aplica OCR antes de subirlo. |
| «El modelo devolvió N dimensiones; el perfil espera M» | Perfil con dimensiones incorrectas | Crea un perfil nuevo y reindexa. |
| «El modelo de embeddings … ya no está en el catálogo» | Se eliminó o cambió la conexión de IA | Vuelve a sincronizar modelos (`pnpm starter ai sync`) o reindexa con otro perfil. |
| `BUDGET_EXCEEDED` | Presupuesto del trabajo o de la organización | Aumenta el presupuesto y reintenta. |
| «La colección no tiene índice activo» | Colección creada sin perfil o versión | Reindexa la colección. |
| «must be owner of table chunks» al crear una colección o reindexar | Almacén interno: la API o el worker corren con un rol de mínimo privilegio y no tienen `DATABASE_MIGRATION_URL` (los índices por perfil se crean con esa conexión). PostgreSQL externo: el usuario de la conexión no es propietario del esquema | Define `DATABASE_MIGRATION_URL` en el entorno de la API y del worker; en conexiones externas usa un usuario propietario o crea los índices (ver [rag-external.md](rag-external.md#32-administrada-por-el-starter-managed--true)). |
| Documentos en `failed` con «Reindexación: …» | No se pudieron reconstruir en la nueva versión del índice | Revisa el motivo y usa «Volver a procesar». |
| Costo «+ desconocido» en un trabajo | El modelo de embeddings no tiene tarifa vigente | Registra la tarifa en **Tarifas** o sincroniza precios (`pnpm starter ai sync`). |
