# Consumo, costos y presupuestos de IA

Todo uso de modelos (chat, agentes, laboratorio, recomendador, embeddings de conocimiento, transcripción y verificaciones) pasa por un **libro de consumo** append-only y por los **presupuestos** antes de llegar al proveedor. Principio rector: **un costo desconocido nunca se cuenta como cero**.

Servicios: [`packages/ai/src/services/ledger.ts`](../packages/ai/src/services/ledger.ts), [`budgets.ts`](../packages/ai/src/services/budgets.ts), [`runtime.ts`](../packages/ai/src/services/runtime.ts), [`metered-model.ts`](../packages/ai/src/services/metered-model.ts) y [`usage.ts`](../packages/ai/src/services/usage.ts). Tarifas en [models-and-pricing.md](models-and-pricing.md).

## Libro de consumo

| Tabla | Una fila por… | Contenido |
| --- | --- | --- |
| `ai_requests` | ejecución lógica (un mensaje del chat, una verificación, un lote de embeddings…) | función, organización, persona, agente y versión, conversación, trabajo, modelo principal, estimación previa, estado, latencia, tokens agregados, costo y estado del costo |
| `ai_attempts` | llamada real al proveedor | número de intento, modelo efectivo (incluye respaldos), unidades, estado de uso, facturable, costo, error clasificado |
| `usage_events` | unidad facturada de un intento | unidad, cantidad, costo de la línea, tarifa aplicada (`priceId`) e instantánea (`snapshotId`) |
| `cost_snapshots` | intento costeado | copia de las tarifas vigentes usadas |

**Solicitudes vs. intentos.** Un mensaje del chat con dos pasos de herramienta, un reintento y un respaldo genera 1 solicitud y 4 intentos; cada intento se cobra con el modelo que realmente respondió.

Funciones registradas: `chat`, `recommendation`, `lab`, `embedding`, `rag_query`, `transcription`, `tool`, `connection_test`, `evaluation`, `summary`.

**Idempotencia.** `ai_requests.idempotency_key` es única (una clave repetida devuelve la misma solicitud) y cada `usage_event` tiene la clave `<intento>:<unidad>`, de modo que un reproceso no duplica cobros.

### Unidades

El uso del AI SDK se traduce así: `input_tokens` excluye los tokens leídos o escritos en caché (`cached_input_tokens`, `cache_write_tokens`); `output_tokens` ya incluye los de razonamiento, por lo que `reasoning_tokens` se registra como **informativo** (no se cobra dos veces). Embeddings usan `embedding_tokens` y transcripción `audio_seconds`.

### Estados

| Campo | Valores | Regla |
| --- | --- | --- |
| `usageStatus` (intento) | `known`, `estimated`, `unknown` | `known` si el proveedor informó el uso; `estimated` si se derivó localmente (p. ej. respuesta interrumpida); `unknown` si no hay datos. |
| `costStatus` | `calculated`, `estimated`, `unknown`, `reconciled` | Ver abajo. |
| `billable` | sí/no | Errores ocurridos antes de que el proveedor procese la solicitud no son facturables. |

- Si **alguna** unidad usada no tiene tarifa vigente, el costo del intento es `null` con estado `unknown`; la solicitud queda `unknown` si cualquier intento facturable lo es.
- Tokens en caché sin tarifa de caché publicada se cobran a la tarifa de entrada y el costo queda `estimated`.
- Una respuesta **cancelada** o cortada después de empezar a generar se registra como `cancelled`/`failed` con uso **estimado** (caracteres del prompt y de lo generado / 4) y costo `estimated`. Una llamada interrumpida antes de recibir contenido queda `cancelled`, no facturable.
- `reconciled` está previsto para registrar el monto conciliado con la factura del proveedor (`reconciledCostUsd`) sin sobrescribir el calculado. **No hay integración automática** con APIs de facturación: es un punto de extensión.

## Panel de uso y costos

Ruta: **`/admin/ai/usage`** (permiso `ai.usage.read`).

- Rango de días, filtro por función y agrupación por proveedor, modelo, agente, persona o función (y organización para lectores de plataforma cuando `FEATURE_ORGANIZATIONS=true`).
- Totales separados: **calculado**, **estimado**, **conciliado** y número de solicitudes con **costo desconocido**; tokens, errores y latencias p50/p95.
- Gráficos diarios (costo, acumulado, solicitudes/errores, tokens) con tabla equivalente y exportación CSV. Días en **UTC**.
- Libro de solicitudes con número de intentos y estado del costo; exportación CSV (`ai_usage_export`, máximo 10.000 filas).

### Conversión a CLP (solo visual)

- `FX_PROVIDER=mindicador`: el worker consulta el "dólar observado" del Banco Central de Chile publicado por mindicador.cl los días hábiles a las 13:41 UTC (cola `ai.fx-rates`) y guarda la tasa con su fecha y fuente en `fx_rates`. **Actualizar tasa** (`ai_fx_refresh`) encola una consulta inmediata; requiere `ai.models.manage` y el botón no se muestra sin ese permiso.
- En el panel aparece **Ver en CLP**, que muestra la tasa, su fecha y la fuente. Los montos se convierten solo para mostrar: el libro, los presupuestos y la exportación siguen en **USD**.
- `FX_PROVIDER=none` (por defecto): la conversión no está disponible y el panel lo indica.

## Presupuestos

Ruta: **`/admin/ai/budgets`** (permiso `ai.budgets.manage`; lectura también con `ai.usage.read`).

| Campo | Valores |
| --- | --- |
| Ámbito | `organization`, `user` (id de persona), `agent` (id de agente), `feature` (`chat`, `lab`, `embedding`, `rag_query`, `transcription`, …) |
| Período | `day` o `month`, evaluados en UTC |
| Límite | USD (> 0) |
| Umbrales de alerta | hasta 5 porcentajes (por defecto 80 y 100) |
| Estricto (`hardLimit`) | por defecto sí: bloquea; si no, solo alerta |

### Reservas atómicas

1. Antes de llamar, se **estima** el costo máximo: tokens de entrada (caracteres / 3,5) + máximo de salida (en el chat, multiplicado por `maxSteps`); para embeddings, los tokens del lote; para transcripción, los segundos máximos.
2. Se **reserva** la estimación en todos los presupuestos aplicables dentro de una transacción con `SELECT … FOR UPDATE` sobre la fila del período: dos solicitudes concurrentes no pueden superar juntas un límite estricto.
3. Si `gastado + reservado + estimación > límite` en un presupuesto estricto → **402 `BUDGET_EXCEEDED`** y no se llama al proveedor; la solicitud queda registrada en el libro como fallida con `errorKind: budget` (chat, prueba de agentes, laboratorio, recomendador, embeddings y transcripción).
4. Al terminar, la reserva se **liquida** con el costo final; si el costo final es desconocido se conserva la estimación (criterio conservador); si no hubo nada facturable se **libera**.
5. Reservas abandonadas (proceso caído, conexión perdida) vencen a los 30 minutos y el mantenimiento del worker (cada 5 minutos) las **liquida con su estimación**.

**Tarifa desconocida + presupuesto estricto = solicitud rechazada**: sin precio no se puede acotar el gasto. Registra la tarifa o usa un presupuesto no estricto.

### Alertas

Cada 10 minutos (cola `ai.budget-alerts`) se evalúan los umbrales; cada umbral se notifica **una vez por presupuesto y período**, por correo, a las personas **miembros de la organización del presupuesto** cuyo rol de plataforma o rol en esa organización sea propietario o incluya `ai.budgets.manage`. Personas de otras organizaciones no reciben la alerta.

### Dónde aplican

| Uso | Función | Presupuesto |
| --- | --- | --- |
| Chat flotante y prueba de agentes | `chat` | sí (ámbitos organización, persona, agente, función) |
| Laboratorio | `lab` | sí, además del presupuesto propio de la ejecución |
| Evaluador del recomendador | `recommendation` | sí, además de `budgetUsd` |
| Embeddings de indexación y consultas de conocimiento | `embedding`, `rag_query` | sí, además del presupuesto opcional de cada trabajo de indexación |
| Transcripción | `transcription` | sí |
| Verificación de modelos | `connection_test` | se registra en el libro, **no** reserva presupuesto |

## Qué es real y qué es estimado

| Dato | Naturaleza |
| --- | --- |
| Tokens/segundos informados por el proveedor | real (`known`) |
| Costo con tarifa vigente | cálculo exacto sobre la tarifa registrada; no es la factura |
| Uso de respuestas canceladas o cortadas | estimado |
| Estimación previa para presupuestos | estimación (cota superior) |
| Conversión a CLP | visual, con tasa fechada |
| Factura del proveedor | no integrada (campo de conciliación disponible) |

## Operaciones de la API

| operationId | Método y ruta | Permiso |
| --- | --- | --- |
| `ai_usage_summary` | `GET /api/ai/usage` | `ai.usage.read` |
| `ai_usage_requests` | `GET /api/ai/usage/requests` | `ai.usage.read` |
| `ai_usage_export` | `GET /api/ai/usage/export.csv` | `ai.usage.read` |
| `ai_budgets_list` | `GET /api/ai/budgets` | `ai.budgets.manage` o `ai.usage.read` |
| `ai_budgets_create` | `POST /api/ai/budgets` | `ai.budgets.manage` |
| `ai_budgets_update` | `PUT /api/ai/budgets/:id` | `ai.budgets.manage` |
| `ai_budgets_delete` | `DELETE /api/ai/budgets/:id` | `ai.budgets.manage` |
| `ai_fx_refresh` | `POST /api/ai/fx/refresh` (202) | `ai.models.manage` |

## Solución de problemas

| Síntoma | Causa | Qué hacer |
| --- | --- | --- |
| 402 "Presupuesto «X» alcanzado" | Límite estricto del período | Sube el límite, espera el próximo período (UTC) o márcalo como no estricto. |
| 402 "El modelo no tiene tarifa conocida…" | Presupuesto estricto + tarifa desconocida | Registra la tarifa del modelo. |
| Totales con "costo desconocido" | Solicitudes sin tarifa para alguna unidad | Revisa el desglose por modelo y registra las tarifas faltantes. |
| "Reservado" alto sin actividad | Solicitudes en curso o reservas pendientes de vencer | Se liquidan solas a los 30 minutos. |
| No aparece "Ver en CLP" | `FX_PROVIDER=none` o aún no hay tasa | Configura `FX_PROVIDER=mindicador` y usa **Actualizar tasa**. |
| No llegan alertas | Correo no configurado o nadie de esa organización tiene el permiso | Revisa `pnpm starter doctor` y los roles de la organización del presupuesto. |
