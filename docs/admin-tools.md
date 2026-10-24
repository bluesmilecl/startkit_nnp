# Herramientas administrativas desde el chat

Un agente puede administrar usuarios, roles y permisos conversando, con las **mismas reglas** que el panel: los mismos servicios de dominio, las mismas comprobaciones de permisos y jerarquía, la misma protección del último propietario y la misma auditoría. Los cambios sensibles nunca se aplican desde el modelo: se convierten en **propuestas** que la persona confirma en una tarjeta de la interfaz.

Código: catálogo en [`packages/contracts/src/agents.ts`](../packages/contracts/src/agents.ts) (`ADMIN_TOOLS`), herramientas en [`packages/ai/src/chat/admin-tools.ts`](../packages/ai/src/chat/admin-tools.ts), propuestas en [`packages/auth/src/proposals.ts`](../packages/auth/src/proposals.ts) y ejecutores en [`packages/auth/src/admin-executors.ts`](../packages/auth/src/admin-executors.ts). La configuración del agente está en [agents-and-chat.md](agents-and-chat.md).

## Catálogo

| Herramienta | Qué hace | Permiso de la persona | Modo |
| --- | --- | --- | --- |
| `users_list` | Lista usuarios (búsqueda, estado, rol; máximo 25) | `users.read` | directo (lectura) |
| `users_get` | Ficha de un usuario | `users.read` | directo (lectura) |
| `users_create` | Crea el usuario; si se pide un rol, la asignación queda como propuesta | `users.create` | directo + propuesta |
| `users_update` | Cambia el nombre | `users.update` | directo |
| `users_enable` | Reactiva un usuario | `users.disable` | directo |
| `users_disable` | Desactiva y revoca sesiones | `users.disable` | **propuesta** |
| `users_delete` | Elimina la cuenta | `users.delete` | **propuesta** |
| `users_changeRole` | Reemplaza el rol | `roles.manage` | **propuesta** |
| `users_assignRole` / `users_removeRole` | Agrega o quita un rol | `roles.manage` | **propuesta** |
| `roles_list` / `roles_get` | Roles y sus permisos | `roles.read` | directo (lectura) |
| `roles_create` | Crea un rol | `roles.manage` | **propuesta** |
| `roles_setPermissions` | Agrega/quita permisos de un rol | `permissions.manage` | **propuesta** |
| `roles_delete` | Elimina un rol | `roles.manage` | **propuesta** |
| `permissions_list` | Catálogo de permisos | `permissions.read` | directo (lectura) |

## Qué herramientas recibe el modelo

Solo las que están **habilitadas en la versión publicada del agente** *y* para las que **la persona que conversa** tiene el permiso. Las demás ni siquiera se describen al modelo. La validación del agente advierte cuando se habilitan herramientas que escriben sin tarjeta (`users_create`, `users_update`, `users_enable`).

## Actor inyectado por el servidor

Cada herramienta se construye con el actor autenticado de la solicitud: **la misma persona y los mismos permisos**, marcada con el canal `chat` y el contexto del agente (agente, conversación y solicitud del libro de consumo). Los argumentos del modelo **solo identifican el objetivo** (correo exacto, nombre o id de la persona; clave o nombre del rol) y **nunca** la identidad de quien actúa, su organización ni sus permisos.

- Si un nombre coincide con varias personas, la herramienta devuelve `ambiguous` con los candidatos y el modelo debe preguntar (no elegir).
- Si no hay coincidencia devuelve `not_found`; un rol inexistente devuelve `role_not_found` con los disponibles.
- Un error de autorización vuelve al modelo como dato (`FORBIDDEN`) y se registra como denegado; el modelo no puede "insistir" para saltárselo.

## Propuestas: vista previa → confirmación → ejecución

1. La herramienta llama a `ProposalsService.propose`, que ejecuta la **vista previa** con las mismas comprobaciones de autorización que la ejecución (si no tienes permiso, falla aquí y se audita como denegado).
2. Se guarda en `action_proposals`: actor, organización, acción, recurso y **versión del recurso**, argumentos normalizados, **hash SHA-256** canónico de (acción, recurso, versión, argumentos), vista previa (título, objetivo, cambios antes/después, efectos), origen (`chat` con agente, conversación y llamada de herramienta) y vencimiento (**10 minutos**).
3. El modelo recibe `needs_confirmation` y la indicación de que nada se aplicó; las reglas de plataforma le prohíben decir lo contrario. **No existe herramienta para confirmar.**
4. La tarjeta del chat (`ProposalCard`) muestra la vista previa con **Confirmar** y **Cancelar**. Al confirmar (`POST /api/admin/action-proposals/:id/confirm`) el servidor:
   - exige que la propuesta sea de la misma persona y siga `pending` (reclamo atómico de un solo uso);
   - rechaza propuestas vencidas (410 `GONE`);
   - recalcula el hash: si los argumentos guardados cambiaron, 412 "La propuesta fue alterada";
   - compara la versión actual del recurso con la de la vista previa: si cambió, 412 y hay que pedir el cambio de nuevo;
   - ejecuta con el servicio de dominio usando **el actor de la confirmación** (permisos y jerarquía se vuelven a comprobar en ese momento).
5. Una segunda confirmación devuelve el resultado ya ejecutado sin repetir el cambio (**idempotente**). Cancelar deja la propuesta `cancelled`.

Estados: `pending`, `executing`, `executed`, `cancelled`, `expired`, `failed`. Las propuestas pendientes que vencen se marcan `expired` en la base de datos en el mantenimiento del worker (cada 5 minutos). El panel usa el mismo flujo (origen `panel`) para sus acciones sensibles.

## Registro y auditoría

| Registro | Contenido |
| --- | --- |
| `tool_executions` | Cada llamada de herramienta: agente, conversación, solicitud del libro de consumo, persona, nombre, entrada, salida, estado (`succeeded`, `proposed`, `denied`, `failed`) y propuesta asociada |
| `action_proposals` | Propuesta completa, decisión, resultado o error |
| `audit_events` | Acciones hechas por las herramientas (lecturas no se auditan; escrituras directas como `users_create` y vistas previas denegadas sí): `actorType: 'agent'`, la persona (`actorUserId`), `agentId` y `conversationId`. Al confirmar una propuesta desde la tarjeta: `proposals.execute` / `.denied` / `.failed` / `.cancelled` con la propuesta y su origen (`chat`, agente, conversación), más la auditoría propia de la acción de dominio, atribuidas a la persona que confirmó |

Los argumentos y resultados pasan por la redacción de secretos de la auditoría.

## Agregar una herramienta

1. Declárala en `ADMIN_TOOLS` con etiqueta, permiso requerido y si es propuesta.
2. Impleméntala en `buildAdminTools` llamando al **servicio de dominio** existente (no a SQL directo) y usando `ctx.actor`.
3. Si modifica datos sensibles, crea un `ProposalExecutor` (vista previa, versión actual, ejecución) en `admin-executors.ts`; la tarjeta del chat es genérica.
4. Agrega pruebas de permisos (permitido, denegado, objetivo ambiguo) y un caso E2E si cambia la interfaz.

## Operaciones de la API

| operationId | Método y ruta | Uso |
| --- | --- | --- |
| `admin_proposals_create` | `POST /api/admin/action-proposals` | Vista previa desde el panel |
| `admin_proposals_get` | `GET /api/admin/action-proposals/:id` | Estado de una propuesta propia |
| `admin_proposals_confirm` | `POST /api/admin/action-proposals/:id/confirm` | Confirmar y ejecutar |
| `admin_proposals_cancel` | `POST /api/admin/action-proposals/:id/cancel` | Cancelar |

## Solución de problemas

| Síntoma | Causa | Qué hacer |
| --- | --- | --- |
| "La propuesta venció" (410) | Pasaron más de 10 minutos | Pide el cambio de nuevo. |
| "El recurso cambió desde la vista previa" (412) | Alguien modificó el usuario/rol | Pide el cambio de nuevo para ver el estado actual. |
| El modelo dice que no puede hacer algo | La herramienta no está habilitada o no tienes el permiso | Revisa el agente y tus roles. |
| "Permiso requerido…" al confirmar | Te quitaron el permiso después de la propuesta | Esperado: la confirmación revalida permisos. |
