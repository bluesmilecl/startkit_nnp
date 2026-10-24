# Proveedores de IA y credenciales

Cómo se conectan proveedores de modelos al starter, cómo se guardan sus claves y qué se verifica realmente al probarlos. El catálogo de modelos y las tarifas se describen en [models-and-pricing.md](models-and-pricing.md); el consumo y los presupuestos en [costs.md](costs.md).

## Conceptos

- **Adaptador**: código que habla con un proveedor a través del AI SDK (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`) o el proveedor de prueba. Ver [`packages/ai/src/providers/registry.ts`](../packages/ai/src/providers/registry.ts).
- **Conexión**: una credencial concreta de un adaptador dentro de la organización (alias único por organización, URL base opcional, clave cifrada o referencia a secreto, opciones). Un mismo proveedor puede tener varias conexiones (por ejemplo, una clave por área o un acuerdo comercial distinto).
- **Estado de la conexión**: `unverified` (recién creada o con credencial rotada), `ok` (la última prueba listó modelos), `error` (la última prueba falló; se guarda el tipo de error) o `disabled`.

## Adaptadores disponibles

| Clave | Proveedor | Chat | Embeddings | Transcripción | Listado de modelos | URL base | Clave | Catálogo estructurado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `openai` | OpenAI | sí | sí | sí | sí | opcional (por defecto `https://api.openai.com/v1`) | obligatoria | `openai` (models.dev) |
| `anthropic` | Anthropic | sí | no | no | sí | opcional | obligatoria | `anthropic` |
| `google` | Google Gemini | sí | sí | no | sí | opcional | obligatoria | `google` |
| `openai-compatible` | Cualquier API compatible con OpenAI (Ollama, vLLM, LM Studio, gateways) | sí | sí | no | sí (`GET /models`) | **obligatoria** | opcional | no (sin tarifas automáticas) |
| `test` | Proveedor de prueba determinista | sí | sí | sí | sí | — | — | tarifas sintéticas |

"No" significa que el adaptador del starter no lo implementa: usar ese modelo para esa función devuelve `CAPABILITY_UNSUPPORTED` (HTTP 422). No se simula.

## Configurar en el panel

Ruta: **`/admin/ai/connections`** (permiso `ai.providers.manage`).

1. **Nueva conexión** → elige el proveedor, un alias (p. ej. `openai-principal`) y la credencial:
   - **Clave de API**: se envía una sola vez y se guarda cifrada; o
   - **Referencia a secreto**: `env:NOMBRE_VARIABLE` o `file:/ruta/al/secreto` (Docker secrets). La clave nunca entra a la base de datos.
   - No se pueden indicar ambas a la vez.
2. **Crear y probar**: la prueba lista los modelos visibles con esa credencial (operación gratuita en los proveedores soportados) y deja el estado `ok` o `error` con un mensaje clasificado.
3. **Rotar credencial**: menú de la tarjeta → nueva clave o referencia. La conexión vuelve a `unverified` y se audita como `ai.connections.rotateCredential`.
4. **Deshabilitar**: las llamadas que usen esa conexión fallan con `NOT_CONFIGURED` (409) sin borrar nada.
5. **Eliminar**: falla con 409 si hay perfiles de embeddings u otros recursos que la usan.

Después de crear la conexión, sincroniza su catálogo en `/admin/ai/models` (o con `pnpm starter ai sync`).

## Cómo se guardan las claves

| Aspecto | Comportamiento real |
| --- | --- |
| Cifrado | AES-256-GCM con la llave `APP_ENCRYPTION_KEY` (32 bytes en base64). Formato del sobre: `enc:v1:<keyId>:<iv>:<tag>:<ciphertext>`; `keyId` se deriva de la llave. Ver [`packages/config/src/secrets.ts`](../packages/config/src/secrets.ts). |
| Dónde vive la llave | Solo en el entorno de la API y del worker (`.env`, secreto del orquestador). Nunca en la base de datos ni en `starter.config.json`; un respaldo de la base sin la llave no permite descifrar. |
| Lo que devuelve la API | `credentialSource` (`stored`, `reference`, `none`) y `credentialHint` (`••••` + últimos 4 caracteres, o el nombre de la referencia). La clave nunca se devuelve ni se registra en auditoría (solo el indicio). |
| Descifrado | Solo en el servidor, en el momento de llamar al proveedor (`ConnectionsService.resolve`). |
| Referencias `env:` / `file:` | Se resuelven en cada uso desde el proceso que llama (API o worker): ambos deben tener la variable o el archivo. |

### Rotar la llave maestra (`APP_ENCRYPTION_KEY`)

1. Genera una llave nueva: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
2. Pon la nueva en `APP_ENCRYPTION_KEY` y mueve la anterior a `APP_ENCRYPTION_PREVIOUS_KEYS` (lista separada por comas) en **todos** los procesos que usan la base (API, worker y la CLI).
3. Reinicia API y worker. Los secretos antiguos se siguen descifrando porque el `keyId` del sobre identifica la llave.
4. Revisa qué falta re-cifrar: `pnpm starter secrets reencrypt --dry-run` (cuenta las credenciales cifradas con llaves anteriores y las que no se pueden descifrar).
5. Re-cifra: `pnpm starter secrets reencrypt --yes`. Descifra en memoria y vuelve a cifrar con la llave actual, en una sola transacción, todas las credenciales guardadas de **conexiones de IA** (`provider_connections`) y de **conexiones de conocimiento** (`rag_connections`). Nada se muestra ni se escribe en disco ([`tooling/create-starter/src/commands/secrets.ts`](../tooling/create-starter/src/commands/secrets.ts)).
6. Cuando el comando informe 0 pendientes y 0 ilegibles, quita la llave anterior de `APP_ENCRYPTION_PREVIOUS_KEYS` y reinicia.

Las credenciales por referencia (`env:` / `file:`) no se cifran en la base y no requieren este paso. Si quitas una llave anterior antes de re-cifrar, las llamadas fallan con *"Secret was encrypted with an unknown key"* y el comando reporta esas credenciales como ilegibles (código de salida 1).

## Política de endpoints (SSRF)

Cada URL base se valida al crear o editar la conexión ([`packages/ai/src/endpoint-policy.ts`](../packages/ai/src/endpoint-policy.ts)):

- Solo `https://`; `http://` se acepta únicamente si `AI_ALLOW_PRIVATE_ENDPOINTS=true`.
- Sin usuario/contraseña en la URL.
- Se resuelve el DNS y **todas** las direcciones deben ser públicas (se bloquean loopback, redes privadas, link-local, CGNAT, multicast, etc.), salvo `AI_ALLOW_PRIVATE_ENDPOINTS=true`.
- Los endpoints de metadatos de nube (`169.254.169.254`, `metadata.google.internal`, `fd00:ec2::254`) se bloquean **siempre**, aunque se permitan redes privadas.

Para modelos autoalojados en tu red (Ollama, vLLM) usa `openai-compatible` y activa `AI_ALLOW_PRIVATE_ENDPOINTS=true` solo en esa instalación. La validación ocurre al configurar la conexión, no en cada llamada: si cambias el DNS de un host ya aprobado, vuelve a guardar la conexión.

## Probar una conexión vs. verificar un modelo

| Acción | Qué hace | Costo | Resultado |
| --- | --- | --- | --- |
| **Probar conexión** (`ai_connections_test`) | Lista modelos con la credencial | Ninguno en los proveedores soportados | Estado `ok`/`error`, tipo de error, latencia |
| **Verificar modelo** (`ai_models_verify`, ver [models-and-pricing.md](models-and-pricing.md)) | Hace una llamada mínima real a ese modelo | Sí, se registra en el libro de consumo (`connection_test`) | Disponibilidad `available` / `unavailable` / `unverified` |

Los errores del proveedor se clasifican en `auth`, `quota`, `network`, `model_not_found`, `invalid_request`, `content_filter`, `timeout` y `unknown` ([`packages/ai/src/errors.ts`](../packages/ai/src/errors.ts)). Los mensajes que ve la persona no incluyen secretos.

## Proveedor de prueba

- Se habilita con `AI_TEST_PROVIDER_ENABLED=true`. **El arranque falla** si está activo con `NODE_ENV=production`; en producción el adaptador aparece con `available: false`.
- Modelos: `test-chat` (herramientas, salida estructurada e imágenes), `test-chat-mini` (sin herramientas), `test-embedding-64` (64 dimensiones) y `test-transcribe`.
- Tarifas sintéticas, rotuladas como tales (fuente "Tarifas sintéticas del proveedor de prueba").
- Opciones de conexión para pruebas de error: `{"failWith": "auth" | "quota" | "network"}` y `{"streamDelayMs": 50}`.
- Recorre el mismo camino que un proveedor real (AI SDK, streaming, herramientas, libro de consumo, presupuestos), pero sus respuestas salen de un conjunto pequeño de reglas: **no simula la calidad** de un modelo real. Sirve para CI, E2E y demostraciones sin claves pagadas.

## Permisos

| Permiso | Uso |
| --- | --- |
| `ai.providers.manage` (sensible) | Crear, editar, rotar, probar y eliminar conexiones. Por defecto solo lo tiene el rol propietario (el rol administrador lo excluye). |
| `ai.models.manage`, `ai.agents.manage`, `ai.lab.use`, `rag.collections.manage` | Ver la lista de conexiones (credenciales enmascaradas) para elegir modelos. |

## Operaciones de la API

Referencia completa en [api-reference.md](api-reference.md).

| operationId | Método y ruta | Permiso |
| --- | --- | --- |
| `ai_providers_list` | `GET /api/ai/providers` | sesión |
| `ai_connections_list` | `GET /api/ai/connections` | ver arriba |
| `ai_connections_get` | `GET /api/ai/connections/:id` | ver arriba |
| `ai_connections_create` | `POST /api/ai/connections` | `ai.providers.manage` |
| `ai_connections_update` | `PATCH /api/ai/connections/:id` | `ai.providers.manage` |
| `ai_connections_delete` | `DELETE /api/ai/connections/:id` | `ai.providers.manage` |
| `ai_connections_test` | `POST /api/ai/connections/:id/test` | `ai.providers.manage` |

Todas responden 404 (`FEATURE_DISABLED`) si `FEATURE_AI=false`.

## Línea de comandos

- `pnpm starter ai sync` sincroniza el catálogo de modelos de todas las conexiones activas y luego las tarifas. `pnpm starter ai sync --connection openai-principal` limita a una conexión.
- `pnpm starter doctor` informa cuántas conexiones, modelos verificados y tarifas vigentes hay.
- `pnpm starter secrets reencrypt [--dry-run] [--yes]` re-cifra las credenciales guardadas tras rotar `APP_ENCRYPTION_KEY` (ver arriba).

## Solución de problemas

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| "El endpoint apunta a una red privada" | URL base en tu red y `AI_ALLOW_PRIVATE_ENDPOINTS=false` | Actívalo solo si confías en ese servicio. |
| "El endpoint debe usar HTTPS" | URL `http://` sin permitir redes privadas | Usa HTTPS o el ajuste anterior. |
| Prueba con `auth` | Clave inválida, revocada o sin permisos | Rota la credencial. |
| Prueba con `quota` | Cuota o facturación del proveedor | Revisa la cuenta del proveedor; el starter no reintenta errores de cuota no recuperables. |
| "Secret reference env:X is not set" | La variable no existe en el proceso (API o worker) | Defínela en ambos servicios. |
| "Secret was encrypted with an unknown key" | Cambiaste `APP_ENCRYPTION_KEY` sin conservar la anterior | Agrega la llave anterior en `APP_ENCRYPTION_PREVIOUS_KEYS` y ejecuta `pnpm starter secrets reencrypt`. |
| El proveedor de prueba no aparece | `AI_TEST_PROVIDER_ENABLED=false` o producción | Esperado en producción. |
