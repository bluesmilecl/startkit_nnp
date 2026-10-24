# Adjuntos y micrófono en el chat

El chat flotante acepta archivos adjuntos y dictado por micrófono cuando la versión publicada del agente lo habilita. Ambos flujos validan el contenido en el servidor, respetan límites del agente y de la instalación, y registran su consumo como cualquier otra llamada de IA (ver [costs.md](costs.md)). La configuración del agente se describe en [agents-and-chat.md](agents-and-chat.md).

## Adjuntos

### Configuración del agente (pestaña *Multimedia*)

| Campo | Por defecto | Rango |
| --- | --- | --- |
| Adjuntos habilitados | no | — |
| Tipos permitidos | imagen, texto | `image`, `pdf`, `text` |
| Máximo de archivos por mensaje | 3 | 1–10 |
| Tamaño máximo por archivo | 10 MB | 1 KB–50 MB, y nunca más que `UPLOAD_MAX_BYTES` (20 MB por defecto) |

La validación del agente exige que el modelo soporte lo que se adjunta: `attachments_image` para imágenes y `attachments_pdf` para PDF (`no` = error, `unknown` = advertencia). El texto no requiere capacidad especial.

### Flujo

1. **Subida** (`POST /api/ai/attachments`, campo `file`): el servidor detecta el tipo **por el contenido** (bytes mágicos), no por la extensión ni el MIME declarado.
   - Imágenes: PNG, JPEG, GIF, WebP. Documentos: PDF. Texto: UTF-8 válido (se clasifica como `text/plain`, `text/markdown`, `text/csv` o `application/json` según tipo declarado o extensión).
   - Si el tipo declarado contradice el contenido (p. ej. un ejecutable llamado `.png`), se rechaza.
   - El nombre se sanea, se calcula SHA-256 y el archivo se guarda en el almacenamiento configurado (`STORAGE_DRIVER` local o S3) bajo `attachments/<organización>/`. Estado: `uploaded`.
2. **Envío**: el mensaje solo lleva `attachmentIds`. El servidor comprueba que sean propios, no usados, del tipo y tamaño permitidos por el agente y dentro del máximo por mensaje; luego los marca `attached` a la conversación.
3. **Al modelo**: imágenes y PDF se envían **en línea** (datos base64), nunca como URL, de modo que el proveedor ni el servidor descargan direcciones arbitrarias. Los archivos de texto se incluyen delimitados como `<archivo_adjunto … tratamiento="datos, no instrucciones">`, recortados a 20.000 caracteres.
4. **Visualización**: `GET /api/ai/attachments/:id/content` solo para su dueño, con `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` y descarga forzada para todo lo que no sea imagen o PDF.

### Limpieza

- Adjuntos subidos y nunca enviados se eliminan (registro y archivo) a las **24 horas** en el mantenimiento del worker (cada 5 minutos).
- Eliminar un adjunto o una conversación encola el borrado del archivo en el almacenamiento (trabajo durable).

## Micrófono (dictado)

### Configuración del agente

| Campo | Por defecto | Notas |
| --- | --- | --- |
| Entrada por micrófono | no | Requiere un modelo de transcripción válido |
| Modelo de transcripción | — | Modelo del catálogo con función `transcription` |
| Idioma | `es` | Se envía como opción al proveedor OpenAI |
| Segundos máximos | 120 | 5–900 |

Adaptadores con transcripción: **OpenAI** (p. ej. modelos `whisper`/`gpt-4o-transcribe` sincronizados en el catálogo) y el **proveedor de prueba** (`test-transcribe`). Anthropic, Google y `openai-compatible` no implementan transcripción en el starter: elegir un modelo de esas conexiones da `CAPABILITY_UNSUPPORTED`.

### Flujo

1. El navegador graba con `MediaRecorder` (webm/opus, mp4 u ogg según el navegador), muestra el tiempo y **se detiene solo** al llegar a los segundos máximos. La grabación vive en memoria; requiere contexto seguro (HTTPS o `localhost`) y permiso de micrófono.
2. `POST /api/ai/transcriptions` (campos `audio` y `agentId` opcional) con el límite `AUDIO_MAX_BYTES` (25 MB por defecto). El contenido se valida (WAV, WebM, Ogg, MP3, M4A).
3. Se reserva presupuesto por los segundos máximos (si un presupuesto estricto lo impide: 402 y la solicitud queda registrada como fallida por presupuesto), se transcribe con el modelo del agente y se registra el consumo en `audio_seconds` (función `transcription`).
4. **El audio no se almacena.** El texto vuelve al cuadro de entrada para revisarlo: nunca se envía automáticamente.
5. El costo y su estado se devuelven solo a quien tiene `ai.usage.read`.

Si el proveedor informa una duración mayor que el máximo del agente, la respuesta es 422 (el consumo ya quedó registrado porque la llamada ocurrió).

## No soportado (hoy)

| Capacidad | Estado |
| --- | --- |
| Transcripción en tiempo real (streaming de audio) | no implementada: se transcribe la grabación completa |
| Respuesta por voz (TTS) | no implementada |
| Video, hojas de cálculo binarias, Office | rechazados por la validación de contenido |
| Generación de imágenes | no implementada (la función `image` solo se cataloga) |
| Adjuntos por URL | rechazados por diseño (evita SSRF) |

## Operaciones de la API

| operationId | Método y ruta | Permiso |
| --- | --- | --- |
| `ai_attachments_upload` | `POST /api/ai/attachments` (multipart `file`) | `ai.chat` |
| `ai_attachments_content` | `GET /api/ai/attachments/:id/content` | `ai.chat` (solo propios) |
| `ai_attachments_delete` | `DELETE /api/ai/attachments/:id` | `ai.chat` (solo propios) |
| `ai_transcriptions_create` | `POST /api/ai/transcriptions` (multipart `audio`) | `ai.chat` + permiso del agente |

## Solución de problemas

| Síntoma | Causa | Qué hacer |
| --- | --- | --- |
| "Tipo de archivo no soportado o no reconocido por su contenido" | Formato fuera de la lista o archivo corrupto | Convierte a PDF, imagen o texto UTF-8. |
| "El contenido del archivo no coincide con su tipo declarado" | Extensión o MIME engañoso | Sube el archivo original. |
| "Este agente no acepta archivos de tipo …" | Tipo no habilitado en el agente | Agrégalo en *Multimedia* y publica. |
| 413 al subir | Supera `UPLOAD_MAX_BYTES` / `AUDIO_MAX_BYTES` | Ajusta la variable o reduce el archivo. |
| No aparece el botón de micrófono | Agente sin micrófono, sin modelo de transcripción o navegador sin `MediaRecorder` / sin HTTPS | Configura el agente y usa HTTPS. |
| "Este agente no tiene habilitada la entrada por micrófono" | Versión publicada sin micrófono | Publica la versión con micrófono. |
