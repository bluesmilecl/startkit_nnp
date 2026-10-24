<script setup lang="ts">
import { aiAgentsCreate, aiAgentsList, aiAgentsUpdate, type AgentSummary } from '@starter/api-client';
import { CreateAgentInput } from '@starter/contracts';
import { Bot, MoreHorizontal, Plus } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Input } from '#ui/components/ui/input';
import { Badge } from '#ui/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#ui/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Alert, AlertDescription } from '#ui/components/ui/alert';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '#ui/components/ui/dropdown-menu';
import RelativeTime from '#ui/components/common/RelativeTime.vue';

definePageMeta({ permission: 'ai.agents.manage', feature: 'ai' });
useHead({ title: 'Agentes' });
const api = useApi();
const { confirm } = useConfirm();
const { data: agents, refresh } = await useAsyncData('ai-agents', () => unwrap(aiAgentsList({ client: api })));

const open = ref(false);
const form = useZodForm(CreateAgentInput, { key: '', name: '' });
const basedOn = ref('none');
const submit = form.handleSubmit(async (values) => {
  const a = await unwrap(aiAgentsCreate({ client: api, body: { ...values, basedOnAgentId: basedOn.value === 'none' ? undefined : basedOn.value } }));
  open.value = false;
  form.reset();
  await navigateTo(`/admin/ai/agents/${a.id}`);
});
async function makeDefault(a: AgentSummary) {
  if (!a.published && !(await confirm({ title: `¿Usar ${a.name} como predeterminado?`, description: 'Aún no tiene versión publicada: el chat flotante quedará oculto hasta publicarla.', confirmLabel: 'Continuar' }))) return;
  try {
    await aiAgentsUpdate({ client: api, path: { id: a.id }, body: { isDefault: true } });
    toast.success(`${a.name} es ahora el agente del chat flotante`);
    await refresh();
  } catch (err) {
    toast.error(apiError(err).message);
  }
}
async function toggleArchive(a: AgentSummary) {
  try {
    await aiAgentsUpdate({ client: api, path: { id: a.id }, body: { archived: !a.archived } });
    await refresh();
  } catch (err) {
    toast.error(apiError(err).message);
  }
}
</script>

<template>
  <PageHeader title="Agentes" description="Configuraciones versionadas del asistente: modelo, instrucciones, herramientas, conocimiento y multimedia. Lo publicado es lo único que usa el chat.">
    <template #actions><Button data-testid="agent-new" @click="open = true"><Plus class="size-4" /> Nuevo agente</Button></template>
  </PageHeader>

  <EmptyState v-if="agents && !agents.length" title="Sin agentes" description="Crea un agente para habilitar el chat flotante." :icon="Bot" />
  <div v-else class="overflow-x-auto rounded-md border">
    <Table>
      <TableHeader>
        <TableRow><TableHead>Agente</TableHead><TableHead>Publicado</TableHead><TableHead>Borrador</TableHead><TableHead>Actualizado</TableHead><TableHead class="sr-only">Acciones</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="a in agents" :key="a.id" :class="{ 'opacity-60': a.archived }" :data-testid="`agent-${a.key}`">
          <TableCell>
            <NuxtLink :to="`/admin/ai/agents/${a.id}`" class="font-medium underline-offset-4 hover:underline" data-testid="agent-link">{{ a.name }}</NuxtLink>
            <div class="text-muted-foreground flex items-center gap-1 text-xs">{{ a.key }} <Badge v-if="a.isDefault" variant="secondary">chat flotante</Badge><Badge v-if="a.archived" variant="outline">archivado</Badge></div>
          </TableCell>
          <TableCell>
            <span v-if="a.published">v{{ a.published.version }} · {{ a.published.modelId ?? 'sin modelo' }}</span>
            <span v-else class="text-muted-foreground">Sin publicar</span>
          </TableCell>
          <TableCell>
            <template v-if="a.draft">
              v{{ a.draft.version }}
              <Badge v-if="a.draft.ok === false" variant="destructive">con errores</Badge>
              <Badge v-else-if="a.draft.ok" variant="secondary">válido</Badge>
            </template>
            <span v-else class="text-muted-foreground">—</span>
          </TableCell>
          <TableCell><RelativeTime :value="a.updatedAt" /></TableCell>
          <TableCell class="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger as-child><Button variant="ghost" size="icon" :aria-label="`Acciones de ${a.name}`"><MoreHorizontal class="size-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem as-child><NuxtLink :to="`/admin/ai/agents/${a.id}`">Editar</NuxtLink></DropdownMenuItem>
                <DropdownMenuItem v-if="!a.isDefault && !a.archived" @click="makeDefault(a)">Usar en el chat flotante</DropdownMenuItem>
                <DropdownMenuItem v-if="!a.isDefault" @click="toggleArchive(a)">{{ a.archived ? 'Restaurar' : 'Archivar' }}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>

  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader><DialogTitle>Nuevo agente</DialogTitle><DialogDescription>Se crea con un borrador; publícalo cuando la validación no tenga errores.</DialogDescription></DialogHeader>
      <form id="agent-form" class="space-y-4" novalidate @submit="submit">
        <Field :data-invalid="!!form.errors.name"><FieldLabel for="ag-name">Nombre</FieldLabel><Input id="ag-name" v-model="form.values.name" data-testid="agent-name" /><FieldError :errors="[form.errors.name]" /></Field>
        <Field :data-invalid="!!form.errors.key">
          <FieldLabel for="ag-key">Clave</FieldLabel>
          <Input id="ag-key" v-model="form.values.key" placeholder="soporte" data-testid="agent-key" />
          <FieldDescription>Identificador estable para API y CLI.</FieldDescription>
          <FieldError :errors="[form.errors.key]" />
        </Field>
        <Field>
          <FieldLabel for="ag-base">Copiar configuración de</FieldLabel>
          <Select v-model="basedOn">
            <SelectTrigger id="ag-base"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">Configuración por defecto</SelectItem><SelectItem v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</SelectItem></SelectContent>
          </Select>
        </Field>
        <Alert v-if="form.formError.value" variant="destructive"><AlertDescription>{{ form.formError.value }}</AlertDescription></Alert>
      </form>
      <DialogFooter><Button type="submit" form="agent-form" :disabled="form.submitting.value" data-testid="agent-submit">Crear</Button></DialogFooter>
    </DialogContent>
  </Dialog>
</template>
