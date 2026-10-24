<script setup lang="ts">
import {
  aiConnectionsCreate,
  aiConnectionsDelete,
  aiConnectionsList,
  aiConnectionsTest,
  aiConnectionsUpdate,
  aiModelsSync,
  aiProvidersList,
  type Connection,
} from '@starter/api-client';
import { CreateConnectionInput } from '@starter/contracts';
import { KeyRound, MoreHorizontal, Plug, Plus, RefreshCw } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Input } from '#ui/components/ui/input';
import { Badge } from '#ui/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#ui/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { RadioGroup, RadioGroupItem } from '#ui/components/ui/radio-group';
import { Label } from '#ui/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '#ui/components/ui/alert';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '#ui/components/ui/dropdown-menu';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import StatusBadge from '~/components/shared/StatusBadge.vue';

definePageMeta({ permission: 'ai.providers.manage', feature: 'ai' });
useHead({ title: 'Conexiones de IA' });

const api = useApi();
const { confirm } = useConfirm();
const { data: providers } = await useAsyncData('ai-providers', () => unwrap(aiProvidersList({ client: api })));
const { data: connections, refresh } = await useAsyncData('ai-connections', () => unwrap(aiConnectionsList({ client: api })));
const providerLabel = (key: string) => providers.value?.find((p) => p.key === key)?.label ?? key;

const ERROR_KIND: Record<string, string> = {
  auth: 'Credencial rechazada',
  quota: 'Cuota o límite de uso',
  network: 'Error de red',
  model_not_found: 'Modelo inexistente',
  invalid_request: 'Solicitud inválida',
  timeout: 'Tiempo de espera agotado',
  content_filter: 'Filtro de contenido',
  unknown: 'Error desconocido',
};

// ── create ──────────────────────────────────────────────────────────────
const createOpen = ref(false);
const credentialMode = ref<'stored' | 'reference' | 'none'>('stored');
const form = useZodForm(CreateConnectionInput, { provider: 'openai', alias: '', baseUrl: null, apiKey: undefined, credentialRef: undefined, options: {} });
const selected = computed(() => providers.value?.find((p) => p.key === form.values.provider));
const baseUrl = nullableModel(form.values, 'baseUrl');
watch(
  () => form.values.provider,
  (p) => {
    const info = providers.value?.find((x) => x.key === p);
    credentialMode.value = info?.requiresApiKey ? 'stored' : 'none';
    if (!form.values.alias || providers.value?.some((x) => x.key === form.values.alias)) form.values.alias = p;
  },
  { immediate: true },
);
const submit = form.handleSubmit(async (values) => {
  const body = {
    ...values,
    baseUrl: values.baseUrl || null,
    apiKey: credentialMode.value === 'stored' ? values.apiKey : undefined,
    credentialRef: credentialMode.value === 'reference' ? values.credentialRef : undefined,
  };
  const created = await unwrap(aiConnectionsCreate({ client: api, body }));
  toast.success(`Conexión ${created.alias} creada`);
  createOpen.value = false;
  form.reset();
  await refresh();
  await test(created);
});

// ── actions ─────────────────────────────────────────────────────────────
const busy = ref<string | null>(null);
async function test(c: Connection) {
  busy.value = c.id;
  try {
    const r = await unwrap(aiConnectionsTest({ client: api, path: { id: c.id } }));
    if (r.ok) toast.success(`${c.alias}: ${r.message}`, { description: `${r.latencyMs} ms` });
    else toast.error(`${c.alias}: ${ERROR_KIND[r.errorKind ?? 'unknown']}`, { description: r.message });
    await refresh();
  } catch (err) {
    toast.error(apiError(err).message);
  } finally {
    busy.value = null;
  }
}
async function syncModels(c: Connection) {
  try {
    await aiModelsSync({ client: api, body: { connectionId: c.id } });
    toast.success('Sincronización de modelos en cola', { description: 'El worker consulta el proveedor y el catálogo estructurado.', action: { label: 'Ver modelos', onClick: () => navigateTo('/admin/ai/models') } });
  } catch (err) {
    toast.error(apiError(err).message);
  }
}
async function toggleDisabled(c: Connection) {
  const disabling = c.status !== 'disabled';
  if (disabling && !(await confirm({ title: `¿Desactivar ${c.alias}?`, description: 'Los agentes y procesos que usan sus modelos dejarán de funcionar hasta reactivarla.', confirmLabel: 'Desactivar', destructive: true }))) return;
  try {
    await aiConnectionsUpdate({ client: api, path: { id: c.id }, body: { disabled: disabling } });
    toast.success(disabling ? 'Conexión desactivada' : 'Conexión reactivada');
    await refresh();
  } catch (err) {
    toast.error(apiError(err).message);
  }
}
async function remove(c: Connection) {
  if (!(await confirm({ title: `¿Eliminar ${c.alias}?`, description: `Se eliminarán ${c.modelCount} modelos del catálogo de esta conexión. El historial de consumo se conserva.`, confirmLabel: 'Eliminar', destructive: true }))) return;
  try {
    await aiConnectionsDelete({ client: api, path: { id: c.id } });
    toast.success('Conexión eliminada');
    await refresh();
  } catch (err) {
    toast.error(apiError(err).message);
  }
}

// ── rotate ──────────────────────────────────────────────────────────────
const rotating = ref<Connection | null>(null);
const rotateMode = ref<'stored' | 'reference'>('stored');
const rotateKey = ref('');
const rotateRef = ref('');
const rotateError = ref<string | null>(null);
function openRotate(c: Connection) {
  rotating.value = c;
  rotateMode.value = c.credentialSource === 'reference' ? 'reference' : 'stored';
  rotateKey.value = '';
  rotateRef.value = '';
  rotateError.value = null;
}
async function rotate() {
  if (!rotating.value) return;
  rotateError.value = null;
  try {
    const body = rotateMode.value === 'stored' ? { apiKey: rotateKey.value } : { credentialRef: rotateRef.value };
    await aiConnectionsUpdate({ client: api, path: { id: rotating.value.id }, body });
    const c = rotating.value;
    rotating.value = null;
    toast.success('Credencial actualizada');
    await refresh();
    await test(c);
  } catch (err) {
    rotateError.value = apiError(err).message;
  }
}
</script>

<template>
  <PageHeader title="Conexiones de IA" description="Credenciales por proveedor. Las claves se guardan cifradas y nunca se vuelven a mostrar; pueden referenciar secretos del despliegue.">
    <template #actions><Button data-testid="connection-new" @click="createOpen = true"><Plus class="size-4" /> Nueva conexión</Button></template>
  </PageHeader>

  <EmptyState v-if="connections && !connections.length" title="Sin conexiones" description="Agrega una conexión a un proveedor para sincronizar modelos y configurar agentes." :icon="Plug">
    <Button @click="createOpen = true"><Plus class="size-4" /> Nueva conexión</Button>
  </EmptyState>

  <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    <Card v-for="c in connections" :key="c.id" :data-testid="`connection-${c.alias}`">
      <CardHeader>
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <CardTitle class="truncate">{{ c.alias }}</CardTitle>
            <CardDescription>{{ providerLabel(c.provider) }}</CardDescription>
          </div>
          <div class="flex items-center gap-1">
            <StatusBadge :status="c.status" data-testid="connection-status" />
            <DropdownMenu>
              <DropdownMenuTrigger as-child><Button variant="ghost" size="icon" :aria-label="`Acciones de ${c.alias}`"><MoreHorizontal class="size-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem @click="openRotate(c)"><KeyRound class="size-4" /> Rotar credencial</DropdownMenuItem>
                <DropdownMenuItem @click="toggleDisabled(c)">{{ c.status === 'disabled' ? 'Reactivar' : 'Desactivar' }}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem class="text-destructive" @click="remove(c)">Eliminar</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-2 text-sm">
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt class="text-muted-foreground">Credencial</dt>
          <dd class="truncate font-mono text-xs" data-testid="connection-hint">
            <template v-if="c.credentialSource === 'none'">No requiere</template>
            <template v-else>{{ c.credentialHint ?? '—' }} <Badge variant="outline" class="ml-1">{{ c.credentialSource === 'reference' ? 'secreto' : 'cifrada' }}</Badge></template>
          </dd>
          <template v-if="c.baseUrl"><dt class="text-muted-foreground">Endpoint</dt><dd class="truncate font-mono text-xs">{{ c.baseUrl }}</dd></template>
          <dt class="text-muted-foreground">Modelos</dt>
          <dd><NuxtLink :to="`/admin/ai/models?connectionId=${c.id}`" class="underline-offset-4 hover:underline">{{ c.modelCount }}</NuxtLink></dd>
          <dt class="text-muted-foreground">Verificada</dt>
          <dd><RelativeTime v-if="c.lastCheckedAt" :value="c.lastCheckedAt" /><span v-else>nunca</span></dd>
        </dl>
        <Alert v-if="c.status === 'error' && c.lastErrorKind" variant="destructive">
          <AlertTitle>{{ ERROR_KIND[c.lastErrorKind] }}</AlertTitle>
          <AlertDescription class="break-words">{{ c.lastError }}</AlertDescription>
        </Alert>
      </CardContent>
      <CardFooter class="gap-2">
        <Button variant="outline" size="sm" :disabled="busy === c.id || c.status === 'disabled'" data-testid="connection-test" @click="test(c)">Probar</Button>
        <Button variant="outline" size="sm" :disabled="c.status === 'disabled'" data-testid="connection-sync" @click="syncModels(c)"><RefreshCw class="size-4" /> Sincronizar modelos</Button>
      </CardFooter>
    </Card>
  </div>

  <Dialog v-model:open="createOpen">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader><DialogTitle>Nueva conexión</DialogTitle><DialogDescription>La clave se cifra con la clave de aplicación (fuera de la base de datos) y solo se muestra enmascarada.</DialogDescription></DialogHeader>
      <form id="connection-form" class="space-y-4" novalidate autocomplete="off" @submit="submit">
        <Field>
          <FieldLabel for="conn-provider">Proveedor</FieldLabel>
          <Select v-model="form.values.provider">
            <SelectTrigger id="conn-provider" data-testid="connection-provider"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="p in providers" :key="p.key" :value="p.key" :disabled="!p.available">{{ p.label }}{{ p.available ? '' : ' (no disponible)' }}</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription v-if="selected">
            {{ [selected.supports.chat && 'chat', selected.supports.embeddings && 'embeddings', selected.supports.transcription && 'transcripción'].filter(Boolean).join(' · ') }}
            <template v-if="selected.key === 'test'"> — proveedor determinista para pruebas, deshabilitado en producción.</template>
          </FieldDescription>
        </Field>
        <Field :data-invalid="!!form.errors.alias">
          <FieldLabel for="conn-alias">Alias</FieldLabel>
          <Input id="conn-alias" v-model="form.values.alias" data-testid="connection-alias" />
          <FieldDescription>Identificador único, por ejemplo <code>openai-prod</code>.</FieldDescription>
          <FieldError :errors="[form.errors.alias]" />
        </Field>
        <Field v-if="selected?.requiresBaseUrl || selected?.key === 'openai-compatible'" :data-invalid="!!form.errors.baseUrl">
          <FieldLabel for="conn-url">URL base</FieldLabel>
          <Input id="conn-url" v-model="baseUrl" type="url" placeholder="https://mi-gateway.example.com/v1" />
          <FieldDescription>Se valida contra redes privadas y endpoints de metadatos (SSRF).</FieldDescription>
          <FieldError :errors="[form.errors.baseUrl]" />
        </Field>
        <template v-if="selected?.requiresApiKey || selected?.key === 'openai-compatible'">
          <RadioGroup v-model="credentialMode" class="flex flex-wrap gap-4">
            <div class="flex items-center gap-2"><RadioGroupItem id="cm-stored" value="stored" /><Label for="cm-stored">Guardar clave cifrada</Label></div>
            <div class="flex items-center gap-2"><RadioGroupItem id="cm-ref" value="reference" /><Label for="cm-ref">Referencia a secreto</Label></div>
            <div v-if="!selected?.requiresApiKey" class="flex items-center gap-2"><RadioGroupItem id="cm-none" value="none" /><Label for="cm-none">Sin clave</Label></div>
          </RadioGroup>
          <Field v-if="credentialMode === 'stored'" :data-invalid="!!form.errors.apiKey">
            <FieldLabel for="conn-key">Clave de API</FieldLabel>
            <Input id="conn-key" v-model="form.values.apiKey" type="password" autocomplete="new-password" spellcheck="false" data-testid="connection-key" />
            <FieldError :errors="[form.errors.apiKey]" />
          </Field>
          <Field v-else-if="credentialMode === 'reference'" :data-invalid="!!form.errors.credentialRef">
            <FieldLabel for="conn-ref">Referencia</FieldLabel>
            <Input id="conn-ref" v-model="form.values.credentialRef" placeholder="env:OPENAI_API_KEY o file:/run/secrets/openai" />
            <FieldDescription>El secreto se lee del entorno o de un archivo montado en el momento de usarlo.</FieldDescription>
            <FieldError :errors="[form.errors.credentialRef]" />
          </Field>
        </template>
        <Alert v-if="form.formError.value" variant="destructive"><AlertDescription>{{ form.formError.value }}</AlertDescription></Alert>
      </form>
      <DialogFooter><Button type="submit" form="connection-form" :disabled="form.submitting.value" data-testid="connection-submit">Crear y probar</Button></DialogFooter>
    </DialogContent>
  </Dialog>

  <Dialog :open="!!rotating" @update:open="(v: boolean) => !v && (rotating = null)">
    <DialogContent>
      <DialogHeader><DialogTitle>Rotar credencial de {{ rotating?.alias }}</DialogTitle><DialogDescription>La credencial anterior se reemplaza; la nueva se prueba de inmediato.</DialogDescription></DialogHeader>
      <form id="rotate-form" class="space-y-4" autocomplete="off" @submit.prevent="rotate">
        <RadioGroup v-model="rotateMode" class="flex gap-4">
          <div class="flex items-center gap-2"><RadioGroupItem id="rm-stored" value="stored" /><Label for="rm-stored">Clave cifrada</Label></div>
          <div class="flex items-center gap-2"><RadioGroupItem id="rm-ref" value="reference" /><Label for="rm-ref">Referencia</Label></div>
        </RadioGroup>
        <Field v-if="rotateMode === 'stored'"><FieldLabel for="rot-key">Nueva clave</FieldLabel><Input id="rot-key" v-model="rotateKey" type="password" autocomplete="new-password" required /></Field>
        <Field v-else><FieldLabel for="rot-ref">Referencia</FieldLabel><Input id="rot-ref" v-model="rotateRef" placeholder="env:NOMBRE" required /></Field>
        <Alert v-if="rotateError" variant="destructive"><AlertDescription>{{ rotateError }}</AlertDescription></Alert>
      </form>
      <DialogFooter><Button type="submit" form="rotate-form" :disabled="rotateMode === 'stored' ? !rotateKey : !rotateRef">Guardar</Button></DialogFooter>
    </DialogContent>
  </Dialog>
</template>
