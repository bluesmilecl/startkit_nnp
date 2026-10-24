<script setup lang="ts">
import { Button } from '#ui/components/ui/button';
import { Badge } from '#ui/components/ui/badge';
import { Progress } from '#ui/components/ui/progress';
import { Skeleton } from '#ui/components/ui/skeleton';
import { Spinner } from '#ui/components/ui/spinner';
import { ApiError } from '#ui/lib/errors';
import StatusBadge from '~/components/shared/StatusBadge.vue';
import CatalogExample from './CatalogExample.vue';

/** Alerts, toasts, confirmations, modals, loading states and the error standard. */
const notify = useNotify();
const { confirm } = useConfirm();
const dismissed = ref(true);
const modalOpen = ref(false);
const sheetOpen = ref(false);

async function demoConfirm(kind: 'simple' | 'destructive' | 'typed') {
  const ok = await confirm(
    kind === 'simple'
      ? { title: '¿Publicar la versión 3?', description: 'El chat empezará a usarla de inmediato.', confirmLabel: 'Publicar' }
      : kind === 'destructive'
        ? { title: '¿Desactivar a Ana?', description: 'Se cerrarán todas sus sesiones.', confirmLabel: 'Desactivar', destructive: true }
        : { title: '¿Eliminar la colección «manual»?', description: 'Se purgan documentos, fragmentos y vectores.', confirmLabel: 'Eliminar', destructive: true, typeToConfirm: 'manual' },
  );
  notify.info(ok ? 'Confirmado' : 'Cancelado');
}
function apiFailure() {
  // Same shape the generated client throws: { error: { code, message, requestId } }.
  notify.error({ error: { code: 'BUDGET_EXCEEDED', message: 'Presupuesto «Chat por persona» agotado', requestId: 'req_7f3a2c' } });
}
// ── errors (docs/errors.md) ─────────────────────────────────────────────
// Same objects the generated client throws (ApiError: status + ErrorResponse body).
const unavailable = new ApiError(503, { code: 'UNAVAILABLE', message: 'La base de datos no está disponible en este momento; intenta de nuevo en unos segundos.', requestId: 'req_5b81d0', details: { retryAfterSeconds: 5 } });
const forbidden = new ApiError(403, { code: 'FORBIDDEN', message: 'Permiso requerido: projects.manage', requestId: 'req_19c4e2' });
const loadFailed = ref(true);
const retrying = ref(false);
async function retryLoad() {
  retrying.value = true;
  await new Promise((r) => setTimeout(r, 800));
  retrying.value = false;
  loadFailed.value = false;
}
function retryToast() {
  notify.error(unavailable, { retry: () => notify.success('Reintento exitoso') });
}

async function promiseDemo(ok: boolean) {
  await notify
    .promise(new Promise((resolve, reject) => setTimeout(() => (ok ? resolve(3) : reject(new Error('El proveedor no respondió'))), 1200)), {
      loading: 'Sincronizando modelos…',
      success: (n) => `${n} modelos sincronizados`,
    })
    .catch(() => {});
}

const alertCode = `<AppAlert variant="info | success | warning | destructive" title="…" description="…" dismissible v-model:open="visible">
  <template #actions><Button size="sm" variant="outline">Configurar</Button></template>
</AppAlert>`;
const toastCode = `const notify = useNotify();
notify.success('Proyecto creado');
notify.error(err);                                     // error de la API → mensaje + «Código de solicitud»
notify.undo('Proyecto archivado', () => restore(p));   // botón Deshacer
await notify.promise(sync(), { loading: 'Sincronizando…', success: (n) => \`\${n} modelos\` });`;
const confirmCode = `const { confirm } = useConfirm();
if (!(await confirm({ title: \`¿Eliminar «\${p.name}»?\`, destructive: true, confirmLabel: 'Eliminar', typeToConfirm: p.name }))) return;`;
const modalCode = `<AppModal v-model:open="open" title="Detalle de la orden" description="…" size="sm | md | lg | xl" variant="dialog | sheet">
  …contenido (con scroll propio)…
  <template #footer><Button @click="open = false">Listo</Button></template>
</AppModal>
// Para formularios: <FormDialog> (pestaña Formularios). Para confirmar: useConfirm().`;
const errorsCode = `// Servidor: lanza errores del catálogo (@starter/contracts), nunca Error genérico
throw AppError.notFound('Proyecto');                              // 404 «Proyecto no encontrado»
throw AppError.field('name', 'Ya existe un proyecto con ese nombre', 'CONFLICT');
throw AppError.upstream('El proveedor IA falló', { retryable: false, cause: err });

// Web: carga de datos (await) + error en línea; 404 en detalle → página de error
const { data, problem, refresh, status } = await useApiData('orders', () => unwrap(ordersList({ client: api })), { fatal: [404] });
<LoadError v-if="problem" :error="problem" :retrying="status === 'pending'" @retry="refresh()" />

// Acciones: toast con mensaje + código de solicitud (+ «Reintentar» si es transitorio)
try { await save(); } catch (err) { notify.error(err, { retry: save }); }
// Formularios: form.handleSubmit(...) ya muestra los errores por campo y el mensaje`;
const loadingCode = `<Skeleton class="h-4 w-40" />   <Spinner />   <Progress :model-value="62" aria-label="Avance" />
<StatusBadge status="running" />   <!-- etiquetas en español para estados conocidos -->`;
</script>

<template>
  <div class="grid gap-6">
    <CatalogExample title="AppAlert" description="Mensajes en la página con variante semántica e ícono. Advertencias y errores se anuncian de inmediato." :code="alertCode">
      <div class="grid gap-3" data-testid="demo-alerts">
        <AppAlert variant="info" title="Modo de prueba" description="El proveedor de IA de prueba no tiene costo real." />
        <AppAlert variant="success" title="Conexión verificada" description="Los modelos están disponibles para el chat." />
        <AppAlert variant="warning" title="Configuración pendiente" description="Sin proveedor de IA verificado: el chat no está disponible.">
          <template #actions><Button size="sm" variant="outline">Configurar ahora</Button></template>
        </AppAlert>
        <AppAlert variant="destructive" title="Presupuesto agotado" description="Las llamadas se bloquean antes de llegar al proveedor." />
        <AppAlert v-model:open="dismissed" variant="info" title="Aviso que se puede cerrar" description="Usa v-model:open para recordarlo." dismissible />
        <Button v-if="!dismissed" variant="ghost" size="sm" class="justify-self-start" @click="dismissed = true">Mostrar de nuevo</Button>
      </div>
    </CatalogExample>

    <div class="grid gap-6 lg:grid-cols-2">
      <CatalogExample title="Toasts: useNotify" description="Avisos temporales con convenciones del starter: errores de la API con su código de solicitud, deshacer y promesas." :code="toastCode">
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" data-testid="toast-success" @click="notify.success('Proyecto creado')">Éxito</Button>
          <Button variant="outline" @click="notify.info('Hay una versión nueva del agente')">Información</Button>
          <Button variant="outline" @click="notify.warning('Revisa el diagnóstico')">Advertencia</Button>
          <Button variant="outline" data-testid="toast-api-error" @click="apiFailure">Error de la API</Button>
          <Button variant="outline" @click="notify.undo('Proyecto archivado', () => notify.info('Archivado deshecho'))">Con «Deshacer»</Button>
          <Button variant="outline" @click="promiseDemo(true)">Promesa (éxito)</Button>
          <Button variant="outline" @click="promiseDemo(false)">Promesa (error)</Button>
        </div>
      </CatalogExample>
      <CatalogExample title="Confirmaciones: useConfirm" description="Diálogo basado en promesas; para acciones irreversibles exige escribir un texto." :code="confirmCode">
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" @click="demoConfirm('simple')">Confirmación simple</Button>
          <Button variant="outline" @click="demoConfirm('destructive')">Acción destructiva</Button>
          <Button variant="outline" data-testid="confirm-typed" @click="demoConfirm('typed')">Escribir para confirmar</Button>
        </div>
      </CatalogExample>
    </div>

    <CatalogExample title="AppModal" description="Modal de contenido con encabezado, cuerpo con scroll y pie; como diálogo centrado o panel lateral." :code="modalCode">
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" data-testid="open-modal" @click="modalOpen = true">Abrir diálogo</Button>
        <Button variant="outline" @click="sheetOpen = true">Abrir panel lateral</Button>
      </div>
      <AppModal v-model:open="modalOpen" title="Orden OC-1044" description="Comercial Andes · actualizada hace 2 horas" size="lg" testid="demo-modal">
        <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt class="text-muted-foreground">Estado</dt><dd><StatusBadge status="active" /></dd>
          <dt class="text-muted-foreground">Total</dt><dd class="tabular-nums">US$ 1.240,00</dd>
          <dt class="text-muted-foreground">Ítems</dt><dd>3 licencias · 1 implementación</dd>
          <dt class="text-muted-foreground">Notas</dt><dd>Entrega coordinada con el área de TI del cliente.</dd>
        </dl>
        <template #footer>
          <Button variant="outline" @click="modalOpen = false">Cerrar</Button>
          <Button @click="(modalOpen = false, notify.success('Orden aprobada'))">Aprobar</Button>
        </template>
      </AppModal>
      <AppModal v-model:open="sheetOpen" title="Historial de cambios" description="Últimos movimientos del registro." variant="sheet">
        <ol class="space-y-3 text-sm">
          <li v-for="n in 12" :key="n" class="border-l-2 pl-3"><span class="font-medium">Cambio {{ 13 - n }}</span> <span class="text-muted-foreground">· hace {{ n }} h</span></li>
        </ol>
      </AppModal>
    </CatalogExample>

    <CatalogExample
      title="Errores: LoadError, notify.error y página de error"
      description="Un solo estándar: mensaje en español del catálogo, código de solicitud para soporte y «Reintentar» solo cuando el error es transitorio."
      :code="errorsCode"
    >
      <div class="grid gap-3 lg:grid-cols-2" data-testid="demo-errors">
        <LoadError v-if="loadFailed" :error="unavailable" :retrying="retrying" testid="demo-load-error" @retry="retryLoad" />
        <AppAlert v-else variant="success" title="Datos cargados" description="El reintento funcionó." data-testid="demo-load-ok">
          <template #actions><Button size="sm" variant="outline" @click="loadFailed = true">Volver a fallar</Button></template>
        </AppAlert>
        <LoadError :error="forbidden" testid="demo-forbidden" @retry="retryLoad" />
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" data-testid="toast-retry" @click="retryToast">Toast con «Reintentar»</Button>
        <Button variant="outline" as-child><NuxtLink to="/admin/no-existe" data-testid="demo-error-page">Ver la página de error (404)</NuxtLink></Button>
      </div>
    </CatalogExample>

    <CatalogExample title="Estados y carga" description="Insignias de estado con etiquetas en español, esqueletos, spinner y progreso." :code="loadingCode">
      <div class="space-y-4">
        <div class="flex flex-wrap gap-2">
          <StatusBadge v-for="s in ['active', 'pending', 'disabled', 'ready', 'running', 'failed', 'succeeded', 'draft', 'published', 'archived']" :key="s" :status="s" />
          <Badge variant="outline">Personalizada</Badge>
        </div>
        <div class="flex flex-wrap items-center gap-6">
          <div class="w-48 space-y-2"><Skeleton class="h-4 w-40" /><Skeleton class="h-4 w-32" /></div>
          <Spinner class="size-5" />
          <div class="w-56"><Progress :model-value="62" aria-label="Avance de la ingesta" /></div>
        </div>
      </div>
    </CatalogExample>
  </div>
</template>
