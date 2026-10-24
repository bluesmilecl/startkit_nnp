# Conocimiento (RAG)

El módulo de conocimiento permite que los agentes respondan con información de la organización (manuales, políticas, páginas web, PDFs) citando las fuentes, respetando los permisos de cada persona y midiendo calidad y costo.

Es opcional: se habilita con `FEATURE_RAG=true` y no requiere servicios adicionales. Todo funciona con PostgreSQL + pgvector; no hay Redis, motor vectorial aparte ni framework de agentes.

Documentos relacionados:

- [Servicios externos de recuperación y PostgreSQL externo](rag-external.md)
- [Indexación: trabajos durables, reindexación y costos](indexing.md)
- [Referencia de la API](api-reference.md) (rutas `/api/rag/*`)

---

## 1. Plano de control y plano de datos

| Plano | Dónde vive | Qué contiene |
| --- | --- | --- |
| Control | Base transaccional de la aplicación (siempre) | Conexiones (`rag_connections`), perfiles de embeddings, colecciones y su ACL, fuentes, trabajos (`rag_jobs`), ejecuciones de búsqueda (`retrieval_runs`/`retrieval_hits`), evaluaciones y retroalimentación |
| Datos | El almacén elegido por cada conexión | Documentos, versiones de índice y fragmentos con vectores (`<esquema>.documents`, `<esquema>.index_versions`, `<esquema>.chunks`), o el servicio externo |

Nunca se hacen *joins* entre bases: el plano de control guarda identificadores y el almacén resuelve el resto. Cada almacén declara sus **capacidades**; el panel y el pipeline solo ofrecen lo que el almacén soporta.

## 2. Modos

| Modo | Conexión (`kind`) | Requisitos | Cuándo elegirlo |
| --- | --- | --- | --- |
| Desactivado | — | `FEATURE_RAG=false` (o sin conexiones) | La aplicación no necesita conocimiento. Los agentes no pueden usar `knowledge` (la validación del agente lo bloquea). |
| Interno | `internal` | pgvector ≥ 0.7 en la base de la aplicación | Opción por defecto: misma base, mismos respaldos, sin infraestructura extra. Volúmenes de miles a cientos de miles de fragmentos. |
| PostgreSQL externo | `postgres` | Otro PostgreSQL con pgvector ≥ 0.7 | Aislar la carga de búsqueda o el crecimiento del índice de la base transaccional, o reutilizar un servidor dedicado. |
| API externa | `api` | Un servicio que implemente el [contrato HTTP](rag-external.md) | Ya existe un buscador corporativo (o uno gestionado) y el starter solo debe consultarlo. |

Capacidades por tipo:

| Capacidad | Interno / PostgreSQL | API externa |
| --- | --- | --- |
| Búsqueda vectorial | sí | sí (`search`) |
| Texto completo | sí | no |
| Híbrida | sí | si declara `hybrid` |
| Ingesta desde el starter | sí (salvo acceso `read-only`) | si declara `ingest` |
| Eliminación | sí (salvo `read-only`) | si declara `delete` |
| Reindexación | sí (salvo `read-only`) | no (la gestiona el servicio) |
| Permisos por documento | sí (en la consulta SQL) | si declara `acl` |
| Explorar documentos y fragmentos | sí | no |

## 3. Conexiones: crear, diagnosticar y activar

Panel: **Conocimiento → Conexiones RAG** (`/admin/knowledge/connections`). API: `POST /api/rag/connections`, `POST /api/rag/connections/{id}/diagnose`, `POST /api/rag/connections/{id}/activate`. Requiere `rag.collections.manage`.

Datos de una conexión:

| Campo | Notas |
| --- | --- |
| `name` | Único por organización. |
| `kind` | `internal`, `postgres` o `api`. |
| `schema` | Esquema del almacén PostgreSQL (por defecto `rag`; letras minúsculas, dígitos y `_`). |
| `connectionUrl` | Solo `postgres`. Se guarda cifrada con `APP_ENCRYPTION_KEY`; el panel muestra una pista `usuario@host:puerto/base`, nunca la contraseña. |
| `baseUrl`, `token` | Solo `api`. El token se guarda cifrado y se muestra enmascarado. |
| `credentialRef` | Alternativa a guardar el secreto: referencia `env:NOMBRE_VARIABLE` resuelta en el servidor. |
| `tls` | `disable`, `require` o `verify-full` (PostgreSQL externo). |
| `timeoutMs` | 1 000–120 000 ms (por defecto 10 000). También fija el `statement_timeout` del pool. |
| `access` | `read-write` o `read-only`. En solo lectura no hay ingesta, eliminación ni reindexación. Las API son siempre de solo lectura para el starter salvo lo que declaren. |
| `managed` | Si el starter puede crear la extensión, el esquema y los índices en el destino. |

### Diagnóstico (solo lectura)

Crear una conexión ejecuta un diagnóstico; se puede repetir en cualquier momento. Nunca modifica el destino.

PostgreSQL (interno o externo):

| Verificación | Qué revisa |
| --- | --- |
| Conexión | Versión de PostgreSQL, usuario y base. |
| Extensión pgvector | Disponible / instalada / versión ≥ 0.7 (`halfvec`). Desde 0.8 se informa la búsqueda iterativa. |
| Esquema | Existe y su versión (`<esquema>.store_migrations`) es la requerida. |
| Privilegios de la aplicación | Lectura y escritura sobre `<esquema>.chunks`. |
| Contenido | Cantidad de documentos y fragmentos. |

Cuando algo no se puede corregir automáticamente, el diagnóstico devuelve **pasos manuales** concretos (por ejemplo `CREATE EXTENSION IF NOT EXISTS vector;` como superusuario o `GRANT CREATE ON DATABASE …`).

API externa: conexión, capacidades declaradas (`GET /capabilities`), una búsqueda de prueba validada contra el contrato y si el servicio filtra por persona (`acl`).

Estados: `pending` (aún no lista), `ready`, `error` (estaba activada y dejó de funcionar), `disabled`.

### Activación

`Activar` prepara el almacén y vuelve a diagnosticar:

- **Interna**: usa `DATABASE_MIGRATION_URL` (o `DATABASE_URL` si no existe) para el DDL. Crea la extensión `vector` si no existe, el esquema, aplica las migraciones del almacén (versionadas aparte de las de la aplicación) serializadas con un *advisory lock* y, si la aplicación corre con un rol distinto del de migración, otorga `USAGE` y `SELECT/INSERT/UPDATE/DELETE` (también por defecto para tablas futuras) al rol de `DATABASE_URL`. Nunca otorga DDL al rol de la aplicación.

  Los índices HNSW de cada perfil (al crear una colección o reindexar) también se crean con esa conexión de DDL, porque crear un índice exige ser propietario de `<esquema>.chunks`. Por eso, cuando la aplicación usa un rol de mínimo privilegio (la configuración de Docker), **la API y el worker** necesitan `DATABASE_MIGRATION_URL` en su entorno, no solo el servicio de migración: en Docker llega desde el `.env` (`env_file`) y el perfil de desarrollo la define para todos los servicios.
- **PostgreSQL externo**: lo mismo con la cadena de la conexión, solo si `managed=true`. Si `managed=false`, no ejecuta nada y deja los pasos manuales.
- **API**: consulta `GET /capabilities` y guarda las capacidades declaradas.

Si la activación falla, el primer paso manual explica el error. Las actualizaciones posteriores del esquema del almacén interno se aplican con `pnpm db:migrate` (solo para almacenes internos ya activados).

Una conexión solo se puede eliminar si no tiene colecciones; los datos del almacén externo no se borran.

## 4. Perfiles de embeddings

Un perfil fija el **espacio vectorial**: modelo del catálogo de IA (función `embedding`), dimensiones y métrica. Panel: tabla «Perfiles de embeddings» en Conexiones RAG.

| Campo | Notas |
| --- | --- |
| `key`, `name` | Clave única por organización. |
| `modelCatalogId` | Modelo de embeddings del catálogo (ver configuración de IA). |
| `dimensions` | Se toman del catálogo; solo se indican si el catálogo no las declara. |
| `metric` | `cosine` (por defecto), `l2` o `inner_product`. |

Índice según dimensiones (`indexType`):

| Dimensiones | Índice |
| --- | --- |
| ≤ 2 000 | HNSW sobre `embedding::vector(N)` |
| 2 001–4 000 | HNSW sobre `embedding::halfvec(N)` (requiere pgvector ≥ 0.7) |
| > 4 000 | Sin índice (búsqueda exacta) |

Todos los perfiles comparten la columna `embedding`; cada perfil tiene su propio **índice parcial de expresión** (`… using hnsw ((embedding::vector(N)) …) where profile_id = '<id>'`), así cambiar de modelo nunca altera la tabla: basta un perfil nuevo y una reindexación. En el almacén interno el índice se crea con la conexión de DDL (`DATABASE_MIGRATION_URL`); en un PostgreSQL externo, con el usuario de la conexión. Las consultas usan `hnsw.ef_search = 100` y `hnsw.iterative_scan = relaxed_order` para que los filtros (ACL, versión) no dejen la búsqueda sin resultados.

Un perfil en uso no se puede eliminar ni cambiar en una colección sin reindexar.

## 5. Colecciones

Panel: **Conocimiento → Colecciones** (`/admin/knowledge/collections`). Crear y configurar requiere `rag.collections.manage`; la conexión debe estar `ready`.

| Campo | Notas |
| --- | --- |
| `name`, `slug` | El identificador (`slug`) es único y se usa en la CLI. |
| `ragConnectionId` | Almacén de la colección (no se cambia después). |
| `embeddingProfileId` | Obligatorio en PostgreSQL. Al crear la colección se crea una versión de índice vacía y activa. |
| `language` | `spanish`, `english`, `portuguese` o `simple`: configuración de texto completo (`tsvector`). |
| `chunking` | `size` 200–8 000 caracteres (1 200 por defecto) y `overlap` 0–2 000 (150; se limita a un tercio del tamaño). Aplica a documentos nuevos o al reindexar. |
| `retrieval` | `method` (`hybrid` por defecto), `topK` (6) y `minScore` (0): valores por defecto de búsqueda cuando quien busca no los indica (ver §8). |
| `visibility` | `organization` (todas las personas con `rag.documents.read`) o `restricted` (solo `aclRoles`/`aclUsers`). |
| `retentionDays` | Documentos sin actualizar por más días se eliminan automáticamente (ver [indexación](indexing.md)). |
| `externalRef` | Solo API: identificador de la colección en el servicio remoto. |
| `status` | `active`, `paused` o `deleting`. Solo las activas se consultan y aceptan ingesta. |

Eliminar una colección pide escribir su identificador y lanza una **purga durable** (documentos, fragmentos, vectores y archivos).

## 6. Fuentes

Desde el detalle de la colección (pestañas *Documentos* y *Fuentes*). Requiere `rag.sources.manage`.

| Tipo | Qué hace | `externalId` del documento |
| --- | --- | --- |
| `upload` | Archivos subidos (PDF, Markdown, HTML, texto), validados por contenido; límite `UPLOAD_MAX_BYTES` y `RAG_FETCH_MAX_BYTES`. Se crea una fuente «Archivos subidos» por colección. | `upload:<nombre de archivo>` (subir otra vez el mismo nombre reemplaza el documento) |
| `url` | Descarga una página o PDF. | la URL |
| `sitemap` | Lee `sitemap.xml` (y sitemaps índice, hasta 10 archivos), filtra con `include`/`exclude` (expresiones regulares) y toma hasta `maxUrls` (1–5 000, 200 por defecto). Las URL que desaparecen del sitemap se eliminan del índice. | cada URL |
| `text` | Texto Markdown escrito en el panel; se guarda como archivo para poder reindexar. | `text:<id de la fuente>` |

`url` y `sitemap` aceptan `schedule`: expresión cron de 5 campos en **UTC** (vacía = solo manual). Las fuentes se pueden pausar, sincronizar ahora o eliminar (sus documentos se eliminan con trabajos durables).

Cada fuente y cada subida aceptan una **ACL de documento** (roles y usuarios) que se copia a sus documentos.

## 7. Permisos de acceso

Hay dos niveles y se aplican en el servidor:

**Colección**

- Búsqueda del chat: la persona necesita `rag.documents.read` y, si la colección es `restricted`, uno de sus roles o estar en `aclUsers`. Las colecciones no autorizadas se descartan con un aviso; nunca se consultan.
- Laboratorio y evaluaciones: quien tiene `rag.collections.manage` puede consultar cualquier colección activa (para administrarla); el resto sigue la regla anterior.
- Vistas de administración (listas y detalle): las colecciones `restricted` solo aparecen a sus roles/usuarios y a quienes administran el conocimiento; para el resto responden 404.

**Documento**

- Búsqueda (chat, laboratorio, evaluaciones): la ACL del documento se evalúa **dentro de la consulta SQL**, nunca después, para todas las personas sin excepción. Un documento sin ACL es visible para quien puede leer la colección; con ACL, solo para los roles (por clave, p. ej. `admin`, `owner`) o usuarios listados. Si un documento debe aparecer a propietarios y administradores, incluye esos roles en su ACL.
- Exploración (lista de documentos, visor de fragmentos): quien tiene `rag.collections.manage` ve todos los documentos de las colecciones que administra; el resto solo los que su ACL permite (los demás responden 404).
- Los almacenes de una API externa solo filtran por persona si declaran `acl`; si no, úsalos únicamente en colecciones de toda la organización.

## 8. Recuperación

`RetrievalService.search` (panel, chat y evaluaciones usan la misma función):

1. Resuelve las colecciones autorizadas y las agrupa por conexión y perfil (una sola consulta de embeddings por perfil; su costo se registra en el libro de uso con la función `rag_query`).
   - Parámetros: lo que indica quien busca tiene prioridad; lo que falte se toma de la configuración `retrieval` de la colección (la primera autorizada si son varias) y, en último término, `hybrid`, 6 y 0. El chat envía `topK` y `minScore` del agente, nunca el método, así que el método lo define la colección; el laboratorio y las evaluaciones envían valores explícitos.
2. **Vectorial**: KNN por versión de índice activa, `max(topK × 4, 20)` candidatos, con el operador de la métrica del perfil. El puntaje siempre es una **similitud (mayor es mejor)** y su tipo sigue la métrica: `cosine_similarity` (1 − distancia coseno), `l2_similarity` (1 / (1 + distancia L2)), `inner_product` (producto interno) o `vector_similarity` si se mezclan perfiles con métricas distintas. `minScore` se compara con esa similitud.
3. **Texto completo**: `plainto_tsquery` convertida a OR (cualquier término puede coincidir) y ordenada con `ts_rank_cd`, de modo que preguntas en lenguaje natural encuentran documentos que comparten algunos términos.
4. **Híbrida** (por defecto): fusión por rango recíproco (RRF, `k = 60`). Un fragmento encontrado por texto se conserva aunque su similitud vectorial sea menor que `minScore`.
5. Varias conexiones o perfiles se fusionan también con RRF (los puntajes de almacenes distintos no son comparables).
6. Si una API no soporta el método pedido, se usa búsqueda vectorial y la respuesta incluye un aviso («… no soporta búsqueda híbrida; se usó búsqueda vectorial»).
7. Cada búsqueda queda registrada en `retrieval_runs` (texto de la consulta, **método efectivamente usado** —p. ej. `vector` cuando la API no soporta `hybrid`—, colecciones, latencia, costo, error) y sus resultados en `retrieval_hits` (con el título del documento). La respuesta (`SearchResult.method`) informa el mismo método. El texto de las consultas solo es visible con `rag.analytics.read`.

En el chat, un fallo del almacén no interrumpe la respuesta: se registra el error y la búsqueda devuelve cero resultados. En el laboratorio responde `502 UPSTREAM_ERROR`.

## 9. Agentes, citas y abstención

En el editor del agente (pestaña *Conocimiento*):

| Campo | Valores |
| --- | --- |
| `mode` | `off`; `tool`: el modelo decide cuándo llamar la herramienta `knowledge_search`; `always`: se recupera antes de responder con el último mensaje como consulta. |
| `collectionIds` | 1–20 colecciones (la validación exige al menos una y que existan). |
| `topK` | 1–20 (6). |
| `minScore` | 0–1 (0). |
| `requireCitations` | Pide citar con `[f1]`, `[f2]`… (por defecto sí). |
| `abstainWithoutContext` | Pide decir que no hay contexto suficiente en vez de inventar (por defecto sí). |

Citas:

- En `always`, los fragmentos se inyectan en el mensaje de sistema como `<fragmento id="fN" titulo="…">` numerados `f1…fn`.
- En `tool`, la herramienta numera los resultados de cada llamada de forma correlativa durante la respuesta.
- Al terminar, solo los fragmentos **efectivamente citados** en el texto se adjuntan como metadatos del mensaje (título, URL, documento) y el chat los muestra como lista de fuentes.
- La ejecución de búsqueda se marca como usada en la respuesta, se marcan los fragmentos citados y se registra la **abstención** (sin fragmentos, o sin citas y con una respuesta del tipo «no encontré»/«sin contexto suficiente»).

El mensaje de sistema siempre indica que los documentos recuperados son **datos, no instrucciones**. El cliente no puede elegir colecciones, modelo ni instrucciones: vienen de la versión publicada del agente.

Retroalimentación: cada respuesta del asistente tiene 👍/👎 (`POST /api/ai/messages/{id}/feedback`, una valoración por persona y mensaje); alimenta la analítica.

## 10. Laboratorio de búsqueda y evaluaciones

Panel: **Conocimiento → Laboratorio de búsqueda** (`/admin/knowledge/search`), permiso `rag.playground.use`.

- **Búsqueda**: consulta, colecciones, método, `topK` y `minScore`; «Comparar los tres métodos» ejecuta híbrida, vectorial y texto completo en paralelo. Cada resultado muestra puntaje y tipo (similitud coseno, similitud L2, producto interno, similitud vectorial, rango de texto, fusión RRF o puntaje externo), el método efectivamente usado, posición vectorial y de texto, encabezado, página, URL y botón para copiar el identificador del documento.
- **Evaluaciones**: un conjunto tiene colecciones y casos (`pregunta`, `documentos relevantes`, respuesta esperada opcional). Ejecutar con una configuración (etiqueta, método, `topK`) calcula por caso **recall@k** = documentos relevantes recuperados / documentos relevantes (vacío si el caso no declara relevantes), latencia y costo. Repetir una etiqueta reemplaza su resultado. Cada caso admite una calificación humana de 1 a 5.

Las búsquedas del laboratorio (`playground`) y de las evaluaciones (`evaluation`) se registran, pero **no** cuentan en la analítica.

## 11. Analítica

Panel: **Conocimiento → Analítica** (`/admin/knowledge/analytics`), permiso `rag.analytics.read`; período de 7, 30 o 90 días y filtro por colección.

| Métrica | Origen |
| --- | --- |
| Consultas, sin resultados, abstenciones, latencia media y p95 | Búsquedas del chat (`origin = chat`). |
| Costo de embeddings | Libro de uso de IA, funciones `embedding` (ingesta y reindexación) y `rag_query` (consultas). |
| Trabajos de ingesta y fallidos | `rag_jobs` del período. |
| Retroalimentación | 👍/👎 de las respuestas. |
| Preguntas más frecuentes | Texto normalizado en minúsculas (máx. 15). |
| Documentos más recuperados | Veces en resultados y veces citados (máx. 10). |
| Por colección | Consultas, documentos y fragmentos. |

Cada gráfico tiene su tabla equivalente y exportación CSV.

## 12. Seguridad

- **Datos no confiables**: el contenido indexado nunca se trata como instrucciones (regla explícita en el mensaje de sistema y en la respuesta de la herramienta).
- **SSRF**: solo `http(s)`; cada salto de redirección (máximo 5) se resuelve y se valida; se bloquean direcciones privadas, *loopback*, *link-local*, de metadatos de nube y similares. `RAG_FETCH_ALLOW_PRIVATE=true` permite redes privadas (solo para fuentes y servicios internos de confianza; `pnpm starter doctor` advierte si está activo en producción). Las conexiones API exigen HTTPS salvo con esa variable.
- **Límites**: descarga y subida hasta `RAG_FETCH_MAX_BYTES` (10 MB por defecto) y `UPLOAD_MAX_BYTES` para la carga HTTP; descargas con tiempo límite de 20 s; respuestas de la API externa hasta 5 MB; tipos detectados por contenido (binarios no soportados se rechazan).
- **Secretos**: cadenas de conexión y tokens cifrados con `APP_ENCRYPTION_KEY` o referenciados (`env:…`); nunca se devuelven por la API ni se exportan en `starter.config.json`.
- **Auditoría**: conexiones, perfiles, colecciones, fuentes, subidas, eliminaciones, reindexaciones y purgas quedan registradas.

## 13. Permisos y roles por defecto

| Permiso | Uso | Propietario | Administrador | Editor | Lector |
| --- | --- | :-: | :-: | :-: | :-: |
| `rag.collections.read` | Ver colecciones | ✓ | ✓ | ✓ | ✓ |
| `rag.collections.manage` | Conexiones, perfiles, colecciones, reindexar, purgar | ✓ | ✓ | | |
| `rag.sources.manage` | Fuentes, subidas, reprocesar | ✓ | ✓ | ✓ | |
| `rag.documents.read` | Leer documentos y fragmentos autorizados (y usar conocimiento en el chat) | ✓ | ✓ | ✓ | ✓ |
| `rag.documents.delete` | Eliminar documentos | ✓ | ✓ | ✓ | |
| `rag.jobs.manage` | Ver, cancelar y reintentar trabajos | ✓ | ✓ | ✓ | |
| `rag.playground.use` | Laboratorio y evaluaciones | ✓ | ✓ | ✓ | |
| `rag.analytics.read` | Analítica | ✓ | ✓ | ✓ | |

La matriz se ajusta en **Acceso → Permisos**.

## 14. Rutas

| Panel | API |
| --- | --- |
| `/admin/knowledge/connections` | `/api/rag/connections`, `/api/rag/profiles` |
| `/admin/knowledge/collections` y `/admin/knowledge/collections/{id}` | `/api/rag/collections`, `/api/rag/collections/{id}/sources`, `/api/rag/collections/{id}/documents`, `/api/rag/sources/{id}` |
| `/admin/knowledge/documents` | `/api/rag/documents` |
| `/admin/knowledge/jobs` | `/api/rag/jobs` |
| `/admin/knowledge/search` | `/api/rag/search`, `/api/rag/evaluations` |
| `/admin/knowledge/analytics` | `/api/rag/analytics` |

## 15. Variables de entorno

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `FEATURE_RAG` | `true` en `.env.example` | Habilita el módulo. |
| `DATABASE_MIGRATION_URL` | vacía | Rol con DDL para activar el almacén interno y crear sus índices por perfil (si falta, `DATABASE_URL`). Con un rol de aplicación de mínimo privilegio debe estar también en el entorno de la API y del worker. |
| `RAG_FETCH_ALLOW_PRIVATE` | `false` | Permite URL y servicios en redes privadas. |
| `RAG_FETCH_MAX_BYTES` | `10485760` | Tamaño máximo por documento descargado o subido. |
| `UPLOAD_MAX_BYTES` | `20971520` | Límite de la carga HTTP de archivos. |
| `APP_ENCRYPTION_KEY` | — | Cifra cadenas de conexión y tokens. |
