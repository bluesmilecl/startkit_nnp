# Conocimiento externo: API de recuperación y PostgreSQL externo

El conocimiento puede vivir fuera de la base de la aplicación. Este documento define el **contrato HTTP** que debe implementar un servicio de recuperación para conectarse como conexión de tipo `api`, la implementación de referencia incluida para desarrollo y pruebas, y los requisitos de un **PostgreSQL externo** (`postgres`).

Conceptos generales (colecciones, permisos, citas): [rag.md](rag.md). Pipeline de ingesta: [indexing.md](indexing.md).

---

## 1. API de recuperación

### 1.1 Cuándo usarla

- Ya existe un buscador corporativo, un servicio gestionado o un índice que otro equipo mantiene.
- El starter solo debe **consultar** (y opcionalmente enviar documentos); los fragmentos, embeddings e índices los gestiona el servicio.

Con una API el starter no genera embeddings de consulta ni de documentos, no muestra documentos ni fragmentos (no hay capacidad de exploración) y no puede reindexar.

### 1.2 Reglas generales

| Aspecto | Regla |
| --- | --- |
| URL base | Se configura en la conexión (`baseUrl`); el starter quita la barra final y concatena las rutas de abajo. |
| Transporte | HTTPS. HTTP solo se acepta con `RAG_FETCH_ALLOW_PRIVATE=true`. Cada solicitud pasa la política anti-SSRF (direcciones privadas y de metadatos bloqueadas salvo esa variable). |
| Autenticación | `Authorization: Bearer <token>` cuando la conexión tiene token (guardado cifrado o como referencia `env:…`). |
| Formato | `Content-Type: application/json` en solicitudes con cuerpo; `Accept: application/json`. |
| Redirecciones | No se siguen: una redirección se trata como error. |
| Tiempo límite | `timeoutMs` de la conexión (1 000–120 000 ms; 10 000 por defecto) por solicitud. |
| Tamaño | Respuestas de hasta 5 000 000 caracteres. |
| Errores | Cualquier estado distinto de 2xx es un fallo («API de recuperación respondió *N*»). En el chat el fallo se registra y la respuesta continúa sin contexto; en el laboratorio se devuelve `502 UPSTREAM_ERROR`. |

### 1.3 `GET /capabilities`

Respuesta (los campos ausentes toman el valor por defecto):

```json
{ "search": true, "ingest": false, "delete": false, "acl": false, "hybrid": false }
```

| Campo | Defecto | Efecto en el starter |
| --- | --- | --- |
| `search` | `true` | Habilita la búsqueda (vectorial desde el punto de vista del starter). |
| `hybrid` | `false` | Si es `false`, una búsqueda híbrida se envía como `vector`, el resultado incluye el aviso «… no soporta búsqueda híbrida; se usó búsqueda vectorial» y la ejecución queda registrada con el método `vector`. |
| `ingest` | `false` | Permite crear fuentes y subir archivos en colecciones de esta conexión (`PUT /documents/…`). |
| `delete` | `false` | Declara que el servicio acepta `DELETE /documents/{externalId}?collection={ref}`. |
| `acl` | `false` | Declara que el servicio filtra por la persona (`principal`). Sin `acl`, el diagnóstico advierte que solo debe usarse en colecciones de toda la organización. |

El texto completo (`fullText`), la reindexación y la exploración de documentos no están disponibles para conexiones API.

### 1.4 `POST /search`

Solicitud:

```json
{
  "query": "¿Cuál es el horario de soporte?",
  "collections": ["soporte"],
  "topK": 6,
  "method": "vector",
  "principal": { "userId": "8f0c…", "roles": ["editor"] },
  "filters": {}
}
```

| Campo | Tipo | Notas |
| --- | --- | --- |
| `query` | string | Texto de la consulta (máx. 2 000 caracteres en el laboratorio). |
| `collections` | string[] | Identificadores remotos: el `externalRef` de cada colección, o el id de la colección del starter si no tiene. **Vacío significa todas** (lo usa la búsqueda de prueba del diagnóstico). |
| `topK` | number | Máximo de resultados que el starter usará. |
| `method` | `"vector"` \| `"hybrid"` \| `"keyword"` | En la práctica se envía `vector`, o `hybrid` si el servicio declaró `hybrid`. |
| `principal.userId` | string \| null | Usuario que busca; `null` en la prueba del diagnóstico. |
| `principal.roles` | string[] | Claves de rol de la persona (`owner`, `admin`, `editor`, `viewer`, roles personalizados). |
| `filters` | object | Reservado (`documentIds`, `sourceIds`); hoy se envía vacío. |

Si declaras `acl`, **debes** excluir los documentos que la persona no puede ver: un documento con roles o usuarios en su ACL solo se devuelve si `principal.roles` contiene uno de esos roles o `principal.userId` está en la lista.

Respuesta:

```json
{
  "hits": [
    {
      "id": "seed-1#0",
      "documentId": "seed-1",
      "text": "El soporte técnico atiende de lunes a viernes…",
      "score": 0.83,
      "title": "Horario de soporte",
      "url": "https://example.com/soporte/horario",
      "heading": null,
      "page": null,
      "collection": "soporte"
    }
  ]
}
```

| Campo | Tipo | Requerido | Límites |
| --- | --- | :-: | --- |
| `hits` | array | sí | máx. 200 |
| `id` | string | sí | 1–200; identificador del fragmento (se usa para citas y analítica) |
| `documentId` | string | sí | 1–200 |
| `text` | string | sí | máx. 50 000 |
| `score` | number | sí | mayor es mejor; se filtra con `minScore` |
| `title` | string \| null | no | máx. 500 |
| `url` | string \| null | no | máx. 2 000; se muestra como enlace de la cita |
| `heading` | string \| null | no | máx. 500 |
| `page` | integer \| null | no | |
| `collection` | string | no | identificador remoto; permite atribuir el resultado a su colección cuando se consultan varias |

Una respuesta que no cumple el esquema es un error. El starter conserva el orden recibido, aplica `minScore`, recorta a `topK` y marca los puntajes como `external`.

### 1.5 `PUT /documents/{externalId}?collection={ref}`

Solo si `ingest: true`. El starter descarga o lee el archivo, lo convierte a texto normalizado (los encabezados como `## …`) y lo envía; el servicio decide cómo fragmentar y generar embeddings.

```json
{
  "title": "Política de vacaciones",
  "url": null,
  "text": "## Vacaciones\nCada persona tiene quince días hábiles…",
  "metadata": { "mediaType": "text/markdown" },
  "acl": { "roles": ["admin", "owner"], "users": [] }
}
```

`externalId` (codificado en la URL) identifica el documento dentro de la colección: `upload:<archivo>`, la URL de origen o `text:<id de fuente>`. Repetir el `PUT` con el mismo `externalId` debe **reemplazar** el documento. La respuesta solo necesita un 2xx.

### 1.6 `DELETE /documents/{externalId}?collection={ref}`

Declarada por la capacidad `delete`. El starter envía el mismo `externalId` del `PUT` y el identificador remoto de la colección (`externalRef`, o el id de la colección si no tiene). Debe eliminar el documento y sus fragmentos; la respuesta solo necesita un 2xx.

Limitación vigente: el starter no lleva un inventario de los documentos remotos (las conexiones API no tienen capacidad de exploración), así que eliminar una fuente, eliminar documentos desde el panel o purgar una colección API **no borra** en el servicio remoto los documentos que el starter no tiene registrados. Elimínalos en el propio servicio cuando corresponda.

### 1.7 Diagnóstico de una conexión API

| Verificación | Resultado |
| --- | --- |
| Conexión | URL base alcanzable. |
| Capacidades declaradas | Lista de capacidades activas. |
| Búsqueda de prueba | `POST /search` con `{"query":"diagnóstico","collections":[],"topK":1,"principal":{"userId":null,"roles":[]}}` y validación del esquema de respuesta. |
| Control de acceso | `ok` si declara `acl`; advertencia si no. |

### 1.8 Mapeo de colecciones

Al crear una colección sobre una conexión API se indica `externalRef` (por ejemplo `soporte`). El starter guarda el mapeo en la conexión y lo usa en `collections` y `?collection=`. Las colecciones API no requieren perfil de embeddings.

## 2. Implementación de referencia (pruebas y desarrollo)

`apps/api/src/scripts/retrieval-test-server.ts` implementa el contrato completo en memoria (búsqueda por palabras, ACL por documento) y sirve un pequeño sitio estático para probar la ingesta de URL y sitemaps sin acceso a internet. Es un doble de pruebas: **se niega a arrancar con `NODE_ENV=production`**.

Ejecutarlo localmente (después de `pnpm build:ts`):

```bash
RETRIEVAL_TEST_PORT=3005 RETRIEVAL_TEST_TOKEN=secreto node apps/api/dist/scripts/retrieval-test-server.js
```

| Variable | Defecto | Uso |
| --- | --- | --- |
| `RETRIEVAL_TEST_PORT` | `3005` | Puerto. |
| `RETRIEVAL_TEST_TOKEN` | vacío | Si se define, exige `Authorization: Bearer <token>` (excepto en `/site/…`). |

Rutas:

| Ruta | Descripción |
| --- | --- |
| `GET /capabilities` | `{ search: true, ingest: true, delete: true, acl: true, hybrid: false }` |
| `POST /search` | Puntaje = proporción de términos de la consulta (≥ 3 letras, sin tildes) presentes en título + texto. |
| `PUT/DELETE /documents/{id}?collection=` | Alta/reemplazo y baja en memoria. |
| `GET /health` | Estado y cantidad de documentos. |
| `GET /site/sitemap.xml` | Sitemap con `guia.html`, `faq.html` y `privado/notas.html` (para probar `exclude`). |
| `GET /site/guia.html`, `/site/faq.html`, `/site/privado/notas.html` | Páginas con navegación, pie y `<script>` para comprobar la limpieza del HTML. |

Datos iniciales: colección `soporte` con «Horario de soporte», «Restablecer contraseña» y «Escalamiento interno» (este último restringido a `admin` y `owner`).

En Docker corre como el servicio `retrieval-test` del perfil `rag-db` (definido en `docker/compose.dev.yaml`, solo para desarrollo y E2E) con la imagen de la API. Desde otros contenedores se alcanza como `http://retrieval-test:3005`; como es una red privada, la API necesita `RAG_FETCH_ALLOW_PRIVATE=true` (el stack de E2E lo configura). Las pruebas que lo usan: `tests/integration/rag.test.ts` (lo inicia en un puerto libre) y `tests/e2e/rag.spec.ts` (variables `E2E_RETRIEVAL_URL` y `E2E_RETRIEVAL_TOKEN` para un stack fuera de Docker).

## 3. PostgreSQL externo

### 3.1 Requisitos

| Requisito | Detalle |
| --- | --- |
| PostgreSQL | Versión con soporte de pgvector (el stack usa la imagen `pgvector/pgvector:0.8.7-pg18-trixie`). |
| pgvector | **≥ 0.7** (`halfvec`, necesario para perfiles de 2 001–4 000 dimensiones); desde 0.8 se usa la búsqueda iterativa de HNSW (`hnsw.iterative_scan`). |
| Red | Alcanzable desde la API y el worker; si está en una red privada, `RAG_FETCH_ALLOW_PRIVATE` no interviene (aplica a HTTP), pero sí la configuración de red de tu despliegue. |
| TLS | `tls`: `disable`, `require` (cifrado sin validar certificado) o `verify-full`. |
| Credencial | Cadena `postgres://usuario:clave@host:5432/base` guardada cifrada, o referencia `env:NOMBRE` (por ejemplo `env:RAG_DATABASE_URL`). |

### 3.2 Administrada por el starter (`managed = true`)

Al activar, con la credencial de la conexión:

1. `CREATE EXTENSION IF NOT EXISTS vector` (el usuario debe poder crearla; si no, el diagnóstico indica el paso para un superusuario).
2. `CREATE SCHEMA IF NOT EXISTS <esquema>` y la tabla `<esquema>.store_migrations`.
3. Migraciones del almacén (`documents`, `index_versions`, `chunks` con `tsvector` generado e índices GIN), serializadas con un *advisory lock*.
4. Al crear colecciones o reindexar, índices HNSW parciales por perfil sobre `<esquema>.chunks`.

Para conexiones externas el starter no otorga permisos a otros roles: usa el mismo usuario de la cadena para DDL y consultas. Si quieres separar roles, crea el esquema con un rol propietario y otorga al usuario de la conexión:

```sql
GRANT USAGE ON SCHEMA conocimiento TO starter_rag;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA conocimiento TO starter_rag;
ALTER DEFAULT PRIVILEGES IN SCHEMA conocimiento GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO starter_rag;
```

Crear los índices HNSW por perfil (al crear colecciones o reindexar) requiere ser propietario de `<esquema>.chunks`: en conexiones externas se crean con el usuario de la conexión, así que ese usuario debe ser el propietario del esquema (o crea tú los índices). En el almacén interno, en cambio, el starter usa `DATABASE_MIGRATION_URL` para ese DDL.

### 3.3 Preparada manualmente (`managed = false`)

El starter solo diagnostica: verifica pgvector, la versión del esquema y los privilegios de lectura/escritura, y lista los pasos pendientes. Una forma práctica de prepararla es activarla una vez con una credencial con privilegios (`managed = true`) y después rotar la credencial de la conexión (`PATCH /api/rag/connections/{id}` con `connectionUrl`) a un usuario con solo DML, otorgando los permisos anteriores.

### 3.4 Solo lectura

Con `access = read-only` el starter consulta pero no ingiere, elimina ni reindexa (útil cuando otro sistema escribe en el mismo esquema con el mismo formato).

### 3.5 Base de pruebas en Docker

El perfil `rag-db` agrega `rag-postgres` (pgvector 0.8.7) con usuario `rag`, base `rag` y contraseña `RAG_POSTGRES_PASSWORD`. Desde la API: `postgres://rag:<RAG_POSTGRES_PASSWORD>@rag-postgres:5432/rag`.

Comprobar el estado de todas las conexiones desde la terminal:

```bash
pnpm starter rag doctor
```
