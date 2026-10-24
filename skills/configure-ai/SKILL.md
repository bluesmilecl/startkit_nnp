---
name: configure-ai
description: Configura la IA del Starter Kit — conexiones a proveedores, catálogo y verificación de modelos, tarifas, presupuestos, agentes versionados y chat flotante — y diagnostica costos. Úsala cuando pidan conectar OpenAI/Anthropic/Google u otro proveedor, elegir modelos, controlar gastos o ajustar el asistente.
---

# Configurar la IA

Requisitos: `FEATURE_AI=true` y una cuenta con permisos `ai.providers.manage`, `ai.models.manage`, `ai.agents.manage` y `ai.budgets.manage` (el propietario los tiene todos).

## 1. Conexión al proveedor (/admin/ai/connections)

- Crea la conexión eligiendo proveedor y alias. La clave se guarda **cifrada** con `APP_ENCRYPTION_KEY`; después solo se muestra una pista (últimos 4 caracteres). Alternativa sin guardar la clave: referencia `env:NOMBRE_VARIABLE`.
- Endpoints propios (compatibles con OpenAI) requieren HTTPS; redes privadas solo con `AI_ALLOW_PRIVATE_ENDPOINTS=true` (modelos autoalojados). Los metadatos de nube siempre se bloquean.
- "Probar" hace una llamada real y clasifica errores (credencial, cuota, red, modelo inexistente).
- Rotación: cambia la clave en la conexión; para rotar `APP_ENCRYPTION_KEY`, mueve la anterior a `APP_ENCRYPTION_PREVIOUS_KEYS`.
- El proveedor `test` (determinista, sin costo real) solo existe con `AI_TEST_PROVIDER_ENABLED=true` y se rechaza en producción.

## 2. Modelos (/admin/ai/models)

```bash
pnpm starter ai sync                  # todas las conexiones
pnpm starter ai sync --connection mi-alias
```

- La sincronización descubre modelos del proveedor y los enriquece con el catálogo (`MODEL_CATALOG_URL`). Quedan **sin verificar** hasta que pruebes la llamada en la ficha del modelo.
- Capacidades (herramientas, visión, audio, salida estructurada, contexto) vienen del catálogo y de la verificación; un agente no se puede publicar con capacidades que su modelo no tiene.

## 3. Tarifas (/admin/ai/prices)

- Se sincronizan del catálogo o se cargan a mano; cada cambio crea una versión con vigencia (historial). Las solicitudes guardan el precio aplicado (snapshot).
- Sin tarifa, el costo queda **desconocido** (nunca cero) y aparece señalado en uso y costos.
- `FX_PROVIDER=mindicador` agrega una conversión visual a CLP; los montos se guardan en USD exactos.

## 4. Presupuestos (/admin/ai/budgets)

- Por organización, usuario, agente o función; período diario/mensual; límite duro (bloquea antes de llamar) o blando (alerta).
- Cada llamada reserva el costo estimado de forma atómica y luego liquida el real; las cancelaciones conservan el costo estimado.

## 5. Agentes y chat (/admin/ai/agents)

1. Edita el borrador: modelo principal y alternativos, instrucciones, límites (tokens, pasos), herramientas de administración, conocimiento (`off`, `tool`, `always` + colecciones), multimedia (adjuntos, dictado con modelo de transcripción) y apariencia del chat.
2. "Probar" ejecuta el borrador sin crear conversación. La validación indica errores (bloquean) y advertencias.
3. "Publicar" crea una versión inmutable; "Revertir" vuelve a una versión anterior. El chat flotante siempre usa la versión publicada del agente por defecto.
4. El cliente nunca envía prompt, modelo ni colecciones: todo sale de la versión publicada en el servidor.

## 6. Medir y recomendar

- /admin/ai/usage: solicitudes vs. intentos, tokens, latencia, costo por día/modelo/usuario/función, exportación CSV.
- /admin/ai/lab: compara modelos con el mismo prompt (corre en el worker, con costo y presupuesto propio) y obtén una recomendación determinista (y opcionalmente un evaluador con salida validada por Zod).

## Diagnóstico

| Síntoma | Causa probable |
| --- | --- |
| "El proveedor rechazó la solicitud por cuota" | Cuota o límite del proveedor; revisa su consola |
| "La credencial no es válida" | Clave revocada o mal copiada; actualízala en la conexión |
| Costo "desconocido" | Falta tarifa vigente para el modelo/unidad |
| Bloqueo por presupuesto | Límite duro alcanzado; súbelo o espera el siguiente período |
| El chat dice "no configurado" | No hay agente publicado o su modelo no está verificado |

Detalle: `docs/ai-providers.md`, `docs/models-and-pricing.md`, `docs/costs.md`, `docs/agents-and-chat.md`, `docs/audio-and-media.md`.
