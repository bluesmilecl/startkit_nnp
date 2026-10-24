# Actualizar una instalación

## Versionado

- El starter se versiona con etiquetas `vX.Y.Z`. El flujo de *release* corre primero las pruebas
  E2E en varios navegadores y luego publica las imágenes `api`, `worker` y `web` en GHCR con su
  **digest inmutable** anotado en las notas de la versión.
- La API pública sigue el contrato OpenAPI versionado en `packages/api-client/openapi.json`; los
  cambios incompatibles los detecta `pnpm api:contract:check` y solo se aceptan en versiones
  mayores.

## Despliegue de una nueva versión (Docker)

1. Respalda la base de datos y el volumen `storage`. Confirma que tienes `APP_ENCRYPTION_KEY`.
2. Lee las notas de la versión (migraciones, variables nuevas, cambios de permisos).
3. Fija la nueva etiqueta o digest (`STARTER_VERSION`, `STARTER_IMAGE_PREFIX`).
4. `docker compose --env-file .env -f docker/compose.yaml -f docker/compose.production.yaml up -d`:
   el servicio `migrate` aplica las migraciones bajo candado antes de que `api` y `worker` arranquen.
5. Verifica `/admin/diagnostics` y `pnpm starter doctor`.

Las migraciones son **solo hacia adelante**. Para volver atrás, restaura el respaldo y la imagen
anterior.

## Qué cambia automáticamente y qué no

| Elemento | En una actualización |
| --- | --- |
| Esquema de base de datos | Migraciones nuevas se aplican en `migrate`. |
| Catálogo de permisos | Se sincroniza: claves nuevas se agregan, eliminadas quedan obsoletas. |
| Rol `owner` | Siempre tiene el catálogo completo. |
| Roles `admin`, `editor`, `viewer` | Reciben las claves **nuevas** según sus valores por defecto; las claves que ya existían conservan tu configuración. |
| Roles personalizados | No cambian; concede los permisos nuevos en `/admin/permissions`. |
| Almacenes de conocimiento internos activos | Se migran al esquema de almacén vigente. |
| Esquema de pg-boss | Se actualiza en `migrate`. |
| Tarifas y catálogo de modelos | Se sincronizan con los trabajos diarios o `pnpm starter ai sync`. |

## Proyecto derivado del starter

Si creaste tu aplicación con `create-ecortes-app`, tu repositorio es independiente. Para traer
cambios del starter:

1. Agrega el starter como remoto: `git remote add starter <url>` y `git fetch starter`.
2. Crea una rama y fusiona la etiqueta deseada: `git merge vX.Y.Z` (o aplica los *commits*
   puntuales con `git cherry-pick`).
3. Resuelve conflictos priorizando tus módulos de negocio; las zonas del starter que normalmente
   no modificas son `packages/*`, `apps/api/src/common`, `apps/api/src/modules/{auth,admin,ai,agents,rag,system,health}`,
   `docker/` y `scripts/`.
4. Regenera artefactos: `pnpm install`, `pnpm build:ts`, `pnpm db:generate` (solo si tu esquema y
   el del starter divergen), `pnpm api:docs:generate`, `pnpm api:client:generate`,
   `node scripts/manifest.mjs`.
5. Ejecuta `pnpm verify` (y el E2E si es posible) antes de desplegar.

Recomendaciones para que las actualizaciones sean simples:

- Agrega tu lógica como **módulos nuevos** (`pnpm starter generate module …`) en lugar de editar
  los del starter.
- Agrega permisos al catálogo con nombres propios (`clientes.read`), no reutilices los del starter
  para otras operaciones.
- Mantén tus textos y marca en la configuración (onboarding, `/admin/settings`) en lugar de
  modificar componentes base.

## Rotación de la clave de cifrado

1. Genera una clave nueva (32 bytes base64).
2. Mueve la clave actual a `APP_ENCRYPTION_PREVIOUS_KEYS` (separadas por coma) y pon la nueva en
   `APP_ENCRYPTION_KEY`; reinicia `api` y `worker`.
3. Las credenciales se descifran con cualquiera de las claves. Re-cífralas con la clave nueva:
   `pnpm starter secrets reencrypt --dry-run` muestra cuántas quedan con claves anteriores (y
   cuáles no se pueden descifrar) y `pnpm starter secrets reencrypt --yes` las re-cifra en una
   transacción (los valores solo se descifran en memoria). Guardar una credencial desde el panel
   también la re-cifra.
4. Cuando el comando informe 0 pendientes, retira la clave de `APP_ENCRYPTION_PREVIOUS_KEYS`.

Ver [dependency-updates.md](dependency-updates.md) para la política de dependencias.
