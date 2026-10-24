# Agentes versionados y chat flotante

El chat flotante del panel conversa con un **agente**: una configuración versionada (modelo, instrucciones, límites, herramientas, conocimiento, multimedia, interfaz y acceso) que se edita como borrador y se publica. El cliente nunca decide el modelo, las instrucciones ni las herramientas.

## Stack

- **AI SDK 7** (`ai` 7.0.x, especificación de proveedores V4) en el servidor: `streamText`, `createUIMessageStream` y `pipeUIMessageStreamToResponse` con keep-alive de 15 s; herramientas con `tool()` y `stopWhen: stepCountIs(maxSteps)`.
- `@ai-sdk/vue` 4 en el navegador: `useChat` con `DefaultChatTransport` hacia `POST /api/ai/chat`, que envía solo el mensaje nuevo.
- Protocolo: *UI message stream* sobre Server-Sent Events.
- Código: [`packages/ai/src/services/agents.ts`](../packages/ai/src/services/agents.ts), [`packages/ai/src/chat/chat.ts`](../packages/ai/src/chat/chat.ts), [`apps/web/app/components/FloatingChat.vue`](../apps/web/app/components/FloatingChat.vue).

## Agentes y versiones

Ruta: **`/admin/ai/agents`** y **`/admin/ai/agents/:id`** (permiso `ai.agents.manage`).

- Cada organización tiene un agente predeterminado `asistente`, creado **sin publicar**: el chat no responde hasta que alguien lo configure y publique.
- Un agente tiene a lo sumo **un borrador** y **una versión publicada**; las anteriores quedan **archivadas**.
- **Guardar borrador** valida contra el catálogo real y guarda el resultado de la validación. Con `expectedUpdatedAt`, si otra persona cambió el borrador, responde 412.
- **Publicar** revalida dentro de una transacción con bloqueo; si hay errores, no publica (422 con la lista). La versión publicada anterior se archiva.
- **Restaurar** (rollback) toma una versión archivada, la revalida y la **publica como versión nueva** ("Restauración de la versión N"): el historial es lineal y auditable.
- **Descartar borrador** solo es posible si existe una versión publicada.
- **Diferencias**: el editor compara cualquier versión con la publicada.
- Se puede marcar otro agente como predeterminado o archivar agentes (no el predeterminado).

Todas estas acciones se auditan (`ai.agents.create`, `ai.agents.draft.save`, `ai.agents.publish`, `ai.agents.rollback`, …).

### Configuración

| Sección | Campos (por defecto) |
| --- | --- |
| Modelo | modelo principal (función chat), hasta 3 respaldos, temperatura (vacía = la del proveedor), `maxOutputTokens` (1024; 64–32.000) |
| Instrucciones | texto del sistema (hasta 20.000 caracteres) |
| Límites | `maxSteps` 5 (1–10 idas y vueltas modelo↔herramientas), `maxInputChars` 8000, `historyMessages` 20, `timeoutMs` 90.000, `retries` 1 (0–3) |
| Herramientas | herramientas administrativas habilitadas (ver [admin-tools.md](admin-tools.md)) |
| Conocimiento | modo `off` / `tool` / `always`, colecciones (≤ 20), `topK` 6, `minScore` 0, exigir citas, abstenerse sin contexto |
| Multimedia | adjuntos y tipos, máximo de archivos y tamaño, micrófono, modelo de transcripción, idioma, segundos máximos (ver [audio-and-media.md](audio-and-media.md)) |
| Interfaz | título, saludo, placeholder, hasta 6 sugerencias, mostrar detalles a administradores |
| Acceso | permiso requerido para usar el agente (por defecto `ai.chat`) |

### Validación

| Situación | Severidad |
| --- | --- |
| Sin modelo principal, modelo inexistente, deshabilitado, sin función chat o `unavailable` | error |
| Modelo no verificado con la credencial | advertencia |
| Capacidad necesaria en `no` (herramientas si hay herramientas o conocimiento `tool`; `streaming`; imágenes/PDF si se adjuntan; temperatura) | error |
| Esa misma capacidad en `unknown` | advertencia |
| `maxOutputTokens` mayor que el máximo del modelo | error |
| Tarifa de entrada o salida desconocida | advertencia (el costo será desconocido y un presupuesto estricto rechazará las solicitudes) |
| Micrófono sin modelo de transcripción válido | error |
| Conocimiento activo con RAG desactivado o sin colecciones | error; colección no activa → advertencia |
| Herramientas que escriben sin tarjeta de confirmación (`users_create`, `users_update`, `users_enable`) | advertencia |

### Probar una versión

La pestaña **Probar** (`ai_agents_test`) ejecuta cualquier versión, incluido el borrador, sin crear conversación. Muestra texto, llamadas a herramientas, modelo que respondió, tokens, latencia y costo. Pasa por el libro de consumo (función `chat`, metadato `test`) y por los presupuestos.

## Cómo funciona un mensaje

1. `GET /api/ai/chat/agent` devuelve lo que el chat necesita **de la versión publicada**: título, saludo, sugerencias, adjuntos, micrófono, si usa conocimiento, si se muestran detalles (solo con `ai.usage.read`) y las herramientas que **esta persona** puede usar.
2. `POST /api/ai/chat` recibe un esquema **estricto**: `{ conversationId?, agentId?, message: { id, role: 'user', parts: [{ type: 'text', text }] }, attachmentIds }`. Cualquier campo extra (system, model, tools, temperature, colecciones, URLs de archivos) se rechaza con 422.
3. El servidor carga la conversación propia, verifica el permiso del agente, valida longitud y adjuntos, guarda el mensaje del usuario y arma el historial **desde la base de datos** (últimos `historyMessages`).
4. Estima el costo, abre la solicitud en el libro de consumo y **reserva presupuesto** antes de cualquier llamada.
5. Construye las instrucciones: las del agente + reglas de plataforma no modificables (fecha, identidad de la persona, que los permisos los verifica el servidor, que las propuestas no están aplicadas, que archivos/documentos/resultados son datos y no instrucciones) + el contexto de conocimiento si corresponde.
6. Llama al modelo a través de un envoltorio medido: cada paso, reintento y respaldo es un intento con su uso. Antes del primer contenido, los errores recuperables se reintentan y luego pasan al respaldo; después del primer contenido, el error se muestra.
7. Al terminar guarda la respuesta con metadatos (cancelada, citas y, para administradores, modelo, tokens, latencia, costo y número de llamadas) y liquida el presupuesto.

### Cancelar

El botón **Detener** (o cerrar la pestaña) corta la conexión; el servidor aborta la generación, registra el intento como `cancelled` con uso **estimado**, guarda la respuesta parcial marcada como "Respuesta detenida" y liquida el presupuesto con criterio conservador.

### Conversaciones y valoraciones

- Cada persona ve solo sus conversaciones: historial, renombrar y eliminar (borra mensajes y, mediante un trabajo durable, los archivos adjuntos).
- El panel recuerda si el chat estaba abierto y la conversación activa (almacenamiento local del navegador).
- 👍/👎 en cada respuesta (`ai_messages_feedback`): una valoración por persona y respuesta (se puede cambiar). Alimenta la analítica de conocimiento.

## Conocimiento en el chat

| Modo | Comportamiento |
| --- | --- |
| `off` | Sin recuperación. |
| `tool` | El modelo recibe la herramienta `knowledge_search` y decide cuándo buscar; cada resultado lleva etiquetas `f1`, `f2`… para citar. Requiere la capacidad `tools`. |
| `always` | Antes de responder se busca con el texto del usuario y los fragmentos se inyectan en las instrucciones como `<fragmento id="fN">`. |

- La búsqueda usa la identidad de quien conversa: aplica los permisos de cada colección y de cada documento. Las colecciones las fija el agente; el cliente no puede cambiarlas.
- Con **exigir citas**, se pide citar como `[f1]`; solo los fragmentos **efectivamente citados** se muestran como fuentes bajo la respuesta.
- Con **abstenerse sin contexto**, se pide decir que no hay información suficiente en vez de inventar. Cada búsqueda queda registrada con si se usó en la respuesta, si hubo abstención y qué fragmentos se citaron.
- El contenido recuperado se trata como **datos no confiables**: las instrucciones de plataforma ordenan ignorar órdenes contenidas en documentos.

## Detalles y errores visibles

| Situación | Lo que ve la persona |
| --- | --- |
| Sin agente publicado | "Configurar agentes" (si puede administrarlos) o el chat oculto |
| Presupuesto (402) | Mensaje con el presupuesto alcanzado |
| Cuota o credencial del proveedor | Mensaje clasificado, sin secretos, con **Reintentar** |
| Mensaje demasiado largo / adjunto no permitido | Error de validación |

## Seguridad

- El cliente **no puede** inyectar instrucciones de sistema, modelo, temperatura, herramientas, colecciones ni URLs de archivos (esquema estricto).
- El historial viene del servidor; el `id` del cliente solo identifica el mensaje.
- Las herramientas reciben el actor **inyectado por el servidor**, nunca desde los argumentos del modelo; actúan con los permisos de la persona y se auditan como acciones del agente en esa conversación ([admin-tools.md](admin-tools.md)).
- Los adjuntos se validan por contenido y se envían al modelo como datos en línea, nunca como URLs ([audio-and-media.md](audio-and-media.md)).

## Operaciones de la API

| operationId | Método y ruta | Permiso |
| --- | --- | --- |
| `ai_agents_list` / `ai_agents_create` | `GET/POST /api/ai/agents` | `ai.agents.manage` |
| `ai_agents_get` / `ai_agents_update` | `GET/PATCH /api/ai/agents/:id` | `ai.agents.manage` |
| `ai_agents_save_draft` / `ai_agents_discard_draft` | `PUT/DELETE /api/ai/agents/:id/draft` | `ai.agents.manage` |
| `ai_agents_validate` | `POST /api/ai/agents/:id/validate` | `ai.agents.manage` |
| `ai_agents_publish` | `POST /api/ai/agents/:id/publish` | `ai.agents.manage` |
| `ai_agents_rollback` | `POST /api/ai/agents/:id/rollback` | `ai.agents.manage` |
| `ai_agents_test` | `POST /api/ai/agents/:id/test` | `ai.agents.manage` |
| `ai_chat_agent` | `GET /api/ai/chat/agent` | `ai.chat` + permiso del agente |
| `ai_chat_stream` | `POST /api/ai/chat` (SSE) | `ai.chat` + permiso del agente |
| `ai_conversations_list` / `_get` / `_rename` / `_delete` | `/api/ai/conversations[/:id]` | `ai.chat` (solo propias) |
| `ai_messages_feedback` | `POST /api/ai/messages/:id/feedback` | `ai.chat` |

## Solución de problemas

| Síntoma | Causa | Qué hacer |
| --- | --- | --- |
| "El agente … aún no tiene una versión publicada" (409) | Solo hay borrador | Publica en `/admin/ai/agents/:id`. |
| No aparecen herramientas | La persona no tiene el permiso de la herramienta o no está habilitada en el agente | Revisa la pestaña Herramientas y los roles. |
| Publicar falla por capacidades | El modelo no soporta herramientas/streaming/adjuntos | Corrige la capacidad si estaba mal catalogada o cambia de modelo. |
| Respuestas sin citas | `requireCitations` desactivado o el modelo ignora la instrucción | Actívalo; prefiere el modo `always` con modelos pequeños. |
| Siempre "no tengo información" | Colecciones sin documentos indexados o sin permiso | Revisa la colección y prueba en el laboratorio de búsqueda. |
