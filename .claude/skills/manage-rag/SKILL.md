---
name: manage-rag
description: Activa y administra el conocimiento (RAG) del Starter Kit — conexiones interna/PostgreSQL externo/API externa, perfiles de embeddings, colecciones con permisos, fuentes, indexación, reindexación, búsqueda, evaluación y analítica. Úsala cuando pidan que el asistente responda con documentos de la empresa o diagnosticar búsquedas.
---

# Administrar el conocimiento (RAG)

Requisitos: `FEATURE_RAG=true`, IA configurada con un modelo de **embeddings** (y su tarifa) y permisos `rag.collections.manage` y `rag.sources.manage`.

## 1. Elegir dónde vive el conocimiento (/admin/knowledge/connections)

| Modo | Cuándo | Qué hace el starter |
| --- | --- | --- |
| Interna | Opción por defecto; misma base de la aplicación | Crea la extensión `vector`, el esquema (`rag`) e índices; da permisos al rol de la aplicación |
| PostgreSQL externo | Separar carga o datos; otro servidor | Igual que la interna sobre esa base (con "administrada"); si no, muestra los pasos manuales |
| API externa | Ya existe un servicio de búsqueda | Habla el contrato de `docs/rag-external.md`; capacidades declaradas por el servicio |

Flujo: crear → **Diagnosticar** (solo lectura) → **Activar** (prepara el almacén o verifica el contrato) → estado "Listo". Las credenciales quedan cifradas y no se vuelven a mostrar.

```bash
pnpm starter rag doctor        # diagnostica todas las conexiones desde el servidor
```

## 2. Perfil de embeddings

Modelo + dimensiones + métrica (coseno, L2, producto interno). Las dimensiones salen del catálogo. Cambiar de perfil exige reindexar (se hace sin cortar el servicio).

## 3. Colecciones (/admin/knowledge/collections)

- Conexión, perfil, idioma (texto completo), fragmentación (tamaño/solapamiento), recuperación (vectorial, texto o híbrida; top K; puntaje mínimo) y retención.
- Acceso: toda la organización o **solo roles/personas elegidos**. Las colecciones restringidas no aparecen a otros roles ni en el chat.
- API externa: indica el identificador remoto (`externalRef`).

## 4. Fuentes y documentos

- Archivos (PDF, Markdown, HTML, texto) desde la colección; opcionalmente restringidos a roles (**ACL por documento**: quien no tiene el rol no los ve ni los recupera).
- URL, sitemap (con expresiones de inclusión/exclusión y máximo de URLs) y texto. Programación cron en UTC para resincronizar.
- Las URL privadas o de metadatos de nube se bloquean salvo `RAG_FETCH_ALLOW_PRIVATE=true` (solo redes internas de confianza).
- Todo se procesa en **trabajos durables** (/admin/knowledge/jobs): etapas, progreso, costo, reintentos, cancelación y reintento manual. Un contenido sin cambios no se vuelve a pagar.

## 5. Reindexar

Desde la colección (botón Reindexar) o:

```bash
pnpm starter rag reindex <slug-o-id> [--profile clave-perfil] [--budget 0.50] [--wait]
```

Se construye un índice nuevo y se cambia de forma atómica; las búsquedas siguen usando el anterior mientras tanto. Con `--budget` el trabajo se detiene al alcanzar el tope.

## 6. Conectar al asistente

En el agente (/admin/ai/agents → Conocimiento): modo `tool` (el modelo decide cuándo buscar) o `always` (busca antes de responder), colecciones, top K, puntaje mínimo, exigir citas y abstenerse sin contexto. Publica una versión. Las respuestas citan `[f1]…` y muestran las fuentes; los documentos recuperados son datos, nunca instrucciones.

## 7. Calidad

- /admin/knowledge/search: prueba consultas y compara métodos lado a lado.
- Evaluaciones: preguntas + documentos relevantes → recall@k, latencia y costo por configuración; calificación humana 1–5.
- /admin/knowledge/analytics: consultas del chat, abstenciones, sin resultados, latencia p95, costo de embeddings, ingesta y valoraciones 👍/👎.

## Diagnóstico

| Síntoma | Revisión |
| --- | --- |
| Sin resultados | ¿Documentos indexados? ¿Puntaje mínimo alto? ¿El rol tiene acceso a la colección/documento? |
| "no soporta búsqueda híbrida" | La API externa no declara `hybrid`; se usó vectorial |
| Trabajo fallido "presupuesto" | Sube el tope o el presupuesto de IA |
| "apunta a una red privada" | URL interna bloqueada por SSRF; usa una pública o habilita `RAG_FETCH_ALLOW_PRIVATE` con cuidado |
| Conexión "pendiente" | Ejecuta Activar y sigue los pasos manuales del diagnóstico |

Detalle: `docs/rag.md`, `docs/indexing.md`, `docs/rag-external.md`.
