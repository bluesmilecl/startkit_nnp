# Modelos, capacidades, tarifas, recomendación y laboratorio

El starter mantiene un catálogo de modelos **por conexión** (ver [ai-providers.md](ai-providers.md)) con funciones, modalidades, capacidades y tarifas versionadas. Nada de esto se inventa: cada dato tiene una fuente (API del proveedor, catálogo estructurado, importación manual con evidencia o verificación real) y lo desconocido se muestra como desconocido.

## Catálogo de modelos

Ruta: **`/admin/ai/models`** (lista con filtros por nombre, función, capacidad y disponibilidad) y **`/admin/ai/models/:id`** (ficha). Servicio: [`packages/ai/src/services/models.ts`](../packages/ai/src/services/models.ts).

### Orden de descubrimiento al sincronizar

1. **API del proveedor**: modelos visibles para esa credencial (`GET /models` o equivalente). Fuente `provider_api`.
2. **Catálogo estructurado** (`MODEL_CATALOG_URL`, por defecto `https://models.dev/api.json`, cacheado 1 hora): enriquece cada modelo listado con nombre, familia, modalidades, contexto, máximo de salida, dimensiones de embeddings y capacidades.
3. Si el proveedor no permite listar (o el listado falla por algo distinto de autenticación), se cargan los modelos del catálogo estructurado para ese proveedor con fuente `catalog`.
4. **Importación manual** (`ai_models_import`): exige `sourceUrl` como evidencia; sus capacidades quedan con fuente `manual`.

Si la credencial es rechazada durante la sincronización, la operación falla con un mensaje explícito (no se cargan modelos "a ciegas"). Cada sincronización queda registrada en `price_sync_runs` (visible con `ai_sync_runs`).

Los modelos `openai-compatible` no tienen catálogo estructurado: aparecen con funciones adivinadas por el nombre (baja confianza) y sin tarifas. Corrige sus funciones/capacidades a mano y registra la tarifa.

### Funciones y modalidades

Funciones: `chat`, `embedding`, `transcription`, `speech`, `image`, `moderation`, `other`. El starter **ejecuta** `chat`, `embedding` y `transcription`; las demás se catalogan pero no tienen flujo de uso.

### Disponibilidad: listado ≠ disponible

| Estado | Significado |
| --- | --- |
| `unverified` | Descubierto o importado, nunca probado con esta credencial (o la última prueba falló por un error transitorio). |
| `available` | Una llamada mínima real respondió correctamente (**Verificar con la credencial**). |
| `unavailable` | La verificación falló por `auth` o `model_not_found`. |

La verificación (`ai_models_verify`) hace una llamada real y pagada, registrada en el libro de consumo con la función `connection_test`:

- chat: `generateText` con "Responde solo: ok" y máximo 16 tokens de salida;
- embeddings: `embed('ping')`, y guarda las dimensiones reales devueltas;
- transcripción: medio segundo de silencio WAV.

### Capacidades

Cada capacidad tiene estado `yes`, `no` o `unknown` y una fuente (`catalog`, `provider_api`, `manual`, `verified`). Capacidades usadas por el starter:

| Capacidad | Dónde importa |
| --- | --- |
| `tools` | Agentes con herramientas administrativas o conocimiento en modo `tool`. |
| `streaming` | Chat flotante (el catálogo estructurado no la publica: queda `unknown` hasta corregirla). |
| `attachments_image`, `attachments_pdf` | Adjuntos del chat. |
| `temperature` | Si es `no`, un agente con temperatura no se puede publicar. |
| `structured_output` | Evaluador del recomendador. |
| `reasoning`, `audio_input` | Informativas / filtros del recomendador. |

Reglas: la validación de agentes trata `no` como **error** y `unknown` como **advertencia**; el recomendador exige `yes`. Una sincronización nunca sobrescribe una capacidad marcada como `manual` o `verified`. Puedes corregirlas en la ficha del modelo (`ai_models_update`), junto con habilitar/deshabilitar el modelo (un modelo deshabilitado no puede usarse: `NOT_CONFIGURED`).

## Tarifas

Ruta: **`/admin/ai/prices`**. Servicio: [`packages/ai/src/services/prices.ts`](../packages/ai/src/services/prices.ts).

Cada fila de `model_prices` contiene: proveedor, modelo, conexión (vacía = tarifa general del proveedor; con conexión = acuerdo propio, que **tiene prioridad**), ámbito (`direct`, `gateway`, `custom`, `tier`), nivel de servicio, **unidad**, cantidad de la unidad (por defecto 1.000.000), precio en USD, fuente (nombre, tipo y URL), fecha de consulta y **vigencia** (`effectiveFrom` / `effectiveTo`).

Unidades: `input_tokens`, `output_tokens`, `cached_input_tokens`, `cache_write_tokens`, `reasoning_tokens`, `audio_input_tokens`, `audio_seconds`, `images`, `requests`, `embedding_tokens`.

### Versionado e historial

- Si llega un precio idéntico al vigente, solo se actualiza la fecha de consulta.
- Si cambia, la versión vigente se **cierra** (`effectiveTo`) y se inserta una nueva. El historial nunca se reescribe (`includeHistory=true` en `ai_prices_list` lo muestra).
- El costo de cada llamada usa el precio vigente **en el momento en que empezó el intento**.
- Las tarifas con nivel de servicio (`serviceTier`) se guardan para referencia, pero no se aplican al costear ni se muestran como precio vigente del modelo: el costo y la ficha usan siempre la tarifa sin nivel.

### Sincronización desde el catálogo

- Automática cada día a las 05:23 UTC (cola `ai.sync-prices` del worker), manual con `ai_prices_sync` (trabajo durable, responde 202) o con `pnpm starter ai sync`.
- Mapeo: `input` → `input_tokens`, `output` → `output_tokens`, `cache_read` → `cached_input_tokens`, `cache_write` → `cache_write_tokens`, `input_audio` → `audio_input_tokens`; para modelos de embeddings, `input` → `embedding_tokens`.
- Si el catálogo no publica un valor, la unidad se **omite** (cuenta como "omitida"), nunca se guarda como 0.
- Solo se sincronizan proveedores con conexiones configuradas.

### Tarifa manual o acuerdo propio

**Registrar tarifa** (`ai_prices_set`): unidad, cantidad, precio, fuente y vigencia opcional (`effectiveFrom`). Si indicas una conexión, la fuente queda como acuerdo (`agreement`) y prevalece sobre la tarifa general para esa conexión. Se audita como `ai.prices.set`.

### Instantáneas de costo

Al costear un intento se guarda en `cost_snapshots` la lista exacta de precios aplicados, y cada `usage_event` referencia la tarifa (`priceId`) y la instantánea. Así un costo histórico se puede explicar aunque la tarifa haya cambiado después.

## Dinero exacto

- Montos en USD como cadenas decimales (`UsdAmount`, p. ej. `"0.001250000000"`), columnas `numeric(24, 12)`.
- Aritmética con `bigint` a 12 decimales ([`packages/ai/src/money.ts`](../packages/ai/src/money.ts)): `costo = cantidad × precio / cantidadUnidad`, redondeo half-up en el decimal 12. Nunca se acumulan flotantes.
- Visualización: 2 decimales, o 3 cifras significativas para montos menores a un centavo.

## Recomendación de modelos

Ruta: **`/admin/ai/lab`**, pestaña *Recomendar* (permiso `ai.lab.use`). Servicio: [`packages/ai/src/services/recommendation.ts`](../packages/ai/src/services/recommendation.ts).

1. **Filtro determinista** sobre el catálogo de la organización: modelos habilitados con la función pedida; por defecto solo `available` (`onlyAvailable`); capacidades requeridas en `yes`; modalidades de entrada; contexto mínimo; precio máximo por millón (si se fija un máximo, un modelo con tarifa desconocida queda fuera).
2. **Puntaje determinista**: disponibilidad verificada, tarifa conocida (más barata = mejor), contexto y cobertura de capacidades, con razones legibles. Se proponen los 3 mejores.
3. **Evaluador opcional** (`evaluatorModelId`, un modelo ya configurado): recibe solo los candidatos y sus datos de catálogo, devuelve un ranking con salida estructurada validada con Zod. Si propone un id fuera de los candidatos o falla, se usa el ranking determinista y se informa el motivo. Respeta presupuestos (`budgetUsd`, por defecto 0,05 USD, y los presupuestos estrictos aplicables) y se registra en el libro de consumo como `recommendation`.

El evaluador **no inventa** precios, capacidades ni benchmarks. Cada recomendación queda guardada (`lab_runs`, tipo `recommendation`) y auditada (`ai.recommendation.run`).

## Laboratorio de comparación

Ruta: **`/admin/ai/lab`**, pestaña *Comparar*. Servicio: [`packages/ai/src/services/lab.ts`](../packages/ai/src/services/lab.ts).

- Hasta 10 prompts × 8 modelos, instrucción de sistema opcional, `maxOutputTokens` de 16 a 8000 (por defecto 400), presupuesto de la ejecución (por defecto 0,50 USD) y concurrencia de 1 a 4.
- Se ejecuta en el **worker** como trabajo durable (cola `ai.lab-run`); la página consulta el avance.
- Antes de cada llamada se estima el costo: si la tarifa es desconocida o el presupuesto de la ejecución se agotaría, esa combinación se **omite** con el motivo. Además aplican los presupuestos de la organización (función `lab`).
- Resultado por modelo y prompt: texto, latencia, tiempo al primer token, tokens, costo y estado del costo. Cada llamada está en el libro de consumo.

## Permisos

| Permiso | Uso |
| --- | --- |
| `ai.models.manage` | Sincronizar, importar, verificar, habilitar y corregir modelos; registrar y sincronizar tarifas. |
| `ai.lab.use` | Recomendador y laboratorio. |
| `ai.usage.read` | Ver tarifas (además de `ai.models.manage`). |

## Operaciones de la API

| operationId | Método y ruta | Permiso |
| --- | --- | --- |
| `ai_models_list` | `GET /api/ai/models` | `ai.models.manage`, `ai.agents.manage`, `ai.lab.use`, `ai.providers.manage` o `rag.collections.manage` |
| `ai_models_get` | `GET /api/ai/models/:id` | igual que la lista |
| `ai_models_import` | `POST /api/ai/models` | `ai.models.manage` |
| `ai_models_update` | `PATCH /api/ai/models/:id` | `ai.models.manage` |
| `ai_models_verify` | `POST /api/ai/models/:id/verify` | `ai.models.manage` |
| `ai_models_sync` | `POST /api/ai/models/sync` (202, trabajo durable) | `ai.models.manage` |
| `ai_sync_runs` | `GET /api/ai/sync-runs` | `ai.models.manage` o `ai.providers.manage` |
| `ai_prices_list` | `GET /api/ai/prices` | `ai.models.manage` o `ai.usage.read` |
| `ai_prices_set` | `POST /api/ai/prices` | `ai.models.manage` |
| `ai_prices_sync` | `POST /api/ai/prices/sync` (202) | `ai.models.manage` |
| `ai_recommendations_create` | `POST /api/ai/recommendations` | `ai.lab.use` |
| `ai_lab_create` / `ai_lab_list` / `ai_lab_get` | `POST/GET /api/ai/lab/runs[/:id]` | `ai.lab.use` |

## Solución de problemas

| Síntoma | Causa | Qué hacer |
| --- | --- | --- |
| Modelo "sin verificar" en la validación del agente | Nunca se llamó con la credencial | **Verificar con la credencial** en su ficha. |
| Costo "desconocido" | No hay tarifa vigente para alguna unidad usada | Registra la tarifa o sincroniza; revisa el modelo exacto (`provider:modelId`). |
| El laboratorio omite un modelo | Tarifa desconocida o presupuesto de la ejecución agotado | Registra la tarifa o sube el presupuesto. |
| El recomendador no devuelve candidatos | Filtros demasiado estrictos o ningún modelo `available` | Desmarca "solo disponibles" o verifica modelos. |
| Sincronización sin datos de catálogo | `MODEL_CATALOG_URL` inaccesible (red/proxy) | Revisa la salida a internet o importa manualmente con fuente. |
