<script setup lang="ts">
import { aiBudgetsCreate, aiBudgetsDelete, aiBudgetsList, aiBudgetsUpdate, type Budget, type UserSummary } from '@starter/api-client';
import { BudgetInput } from '@starter/contracts';
import { MoreHorizontal, Plus, Wallet } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Input } from '#ui/components/ui/input';
import { Badge } from '#ui/components/ui/badge';
import { Switch } from '#ui/components/ui/switch';
import { Label } from '#ui/components/ui/label';
import { Progress } from '#ui/components/ui/progress';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#ui/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Alert, AlertDescription } from '#ui/components/ui/alert';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '#ui/components/ui/dropdown-menu';
import { formatUsd } from '#ui/lib/format';
import UserPicker from '~/components/shared/UserPicker.vue';

definePageMeta({ permission: 'ai.budgets.manage', feature: 'ai' });
useHead({ title: 'Presupuestos de IA' });
const api = useApi();
const notify = useNotify();
const { confirm } = useConfirm();
const { data: budgets, refresh } = await useAsyncData('ai-budgets', () => unwrap(aiBudgetsList({ client: api })));

const SCOPE: Record<string, string> = { organization: 'Organización', user: 'Usuario', agent: 'Agente', feature: 'Función' };
const usedPercent = (b: Budget) => Math.min(100, ((Number(b.current.spentUsd) + Number(b.current.reservedUsd)) / Number(b.limitUsd)) * 100);
function scopeLabel(b: Budget) {
  if (b.scopeType === 'organization') return 'Toda la organización';
  if (b.scopeType === 'feature') return `Función: ${FEATURE_LABELS[b.scopeId ?? ''] ?? b.scopeId}`;
  return `${SCOPE[b.scopeType]}: ${b.scopeId}`;
}

const open = ref(false);
const editing = ref<Budget | null>(null);
const form = useZodForm(BudgetInput, { name: '', scopeType: 'organization', scopeId: null, period: 'month', limitUsd: '', alertThresholds: [80, 100], hardLimit: true, enabled: true });
const pickedUser = ref<UserSummary | null>(null);
const thresholds = computed({
  get: () => (form.values.alertThresholds ?? []).join(', '),
  set: (v: string) => {
    form.values.alertThresholds = v
      .split(/[,\s]+/)
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0 && n <= 100);
  },
});
const scopeId = nullableModel(form.values, 'scopeId');
watch(pickedUser, (u) => {
  if (u) form.values.scopeId = u.id;
});
function openCreate() {
  editing.value = null;
  pickedUser.value = null;
  form.reset();
  open.value = true;
}
function openEdit(b: Budget) {
  editing.value = b;
  pickedUser.value = null;
  form.reset({ name: b.name, scopeType: b.scopeType, scopeId: b.scopeId, period: b.period, limitUsd: Number(b.limitUsd).toString(), alertThresholds: b.alertThresholds, hardLimit: b.hardLimit, enabled: b.enabled });
  open.value = true;
}
const submit = form.handleSubmit(async (values) => {
  if (editing.value) await aiBudgetsUpdate({ client: api, path: { id: editing.value.id }, body: values });
  else await aiBudgetsCreate({ client: api, body: values });
  toast.success(editing.value ? 'Presupuesto actualizado' : 'Presupuesto creado');
  open.value = false;
  await refresh();
});
async function remove(b: Budget) {
  if (!(await confirm({ title: `¿Eliminar el presupuesto «${b.name}»?`, description: 'El consumo histórico se conserva en el libro.', confirmLabel: 'Eliminar', destructive: true }))) return;
  try {
    await aiBudgetsDelete({ client: api, path: { id: b.id } });
    toast.success('Presupuesto eliminado');
    await refresh();
  } catch (err) {
    notify.error(err);
  }
}
</script>

<template>
  <PageHeader title="Presupuestos de IA" description="Límites en USD por organización, usuario, agente o función. Los períodos se evalúan en UTC; un límite estricto bloquea antes de ejecutar mediante reservas atómicas.">
    <template #actions><Button data-testid="budget-new" @click="openCreate"><Plus class="size-4" /> Nuevo presupuesto</Button></template>
  </PageHeader>

  <EmptyState v-if="budgets && !budgets.length" title="Sin presupuestos" description="Sin presupuestos el consumo no se limita. Define al menos un límite mensual para la organización." :icon="Wallet" />

  <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    <Card v-for="b in budgets" :key="b.id" :data-testid="`budget-${b.name}`" :class="{ 'opacity-60': !b.enabled }">
      <CardHeader>
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <CardTitle class="truncate">{{ b.name }}</CardTitle>
            <CardDescription>{{ scopeLabel(b) }} · {{ b.period === 'day' ? 'diario' : 'mensual' }} desde {{ b.current.periodStart }}</CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger as-child><Button variant="ghost" size="icon" :aria-label="`Acciones de ${b.name}`"><MoreHorizontal class="size-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @click="openEdit(b)">Editar</DropdownMenuItem>
              <DropdownMenuItem class="text-destructive" @click="remove(b)">Eliminar</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-2xl font-semibold tabular-nums" data-testid="budget-spent">{{ formatUsd(b.current.spentUsd) }}</span>
          <span class="text-muted-foreground text-sm">de {{ formatUsd(b.limitUsd) }}</span>
        </div>
        <Progress :model-value="usedPercent(b)" :aria-label="`Uso de ${b.name}`" :class="{ '[&>*]:bg-destructive': usedPercent(b) >= 100 }" />
        <div class="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span>{{ b.current.percent.toFixed(1) }}% usado</span>
          <span v-if="Number(b.current.reservedUsd) > 0">{{ formatUsd(b.current.reservedUsd) }} reservado en curso</span>
          <span>Alertas: {{ b.alertThresholds.map((x) => `${x}%`).join(', ') || 'ninguna' }}</span>
        </div>
        <div class="flex gap-1">
          <Badge :variant="b.hardLimit ? 'default' : 'secondary'">{{ b.hardLimit ? 'Límite estricto' : 'Solo alerta' }}</Badge>
          <Badge v-if="!b.enabled" variant="outline">Desactivado</Badge>
        </div>
      </CardContent>
    </Card>
  </div>

  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader><DialogTitle>{{ editing ? 'Editar presupuesto' : 'Nuevo presupuesto' }}</DialogTitle><DialogDescription>Las alertas se envían por correo a quienes administran presupuestos.</DialogDescription></DialogHeader>
      <form id="budget-form" class="space-y-4" novalidate @submit="submit">
        <Field :data-invalid="!!form.errors.name"><FieldLabel for="b-name">Nombre</FieldLabel><Input id="b-name" v-model="form.values.name" data-testid="budget-name" /><FieldError :errors="[form.errors.name]" /></Field>
        <div class="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel for="b-scope">Ámbito</FieldLabel>
            <Select v-model="form.values.scopeType" @update:model-value="form.values.scopeId = null">
              <SelectTrigger id="b-scope"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem v-for="(l, k) in SCOPE" :key="k" :value="k">{{ l }}</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel for="b-period">Período</FieldLabel>
            <Select v-model="form.values.period">
              <SelectTrigger id="b-period"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="day">Diario (UTC)</SelectItem><SelectItem value="month">Mensual (UTC)</SelectItem></SelectContent>
            </Select>
          </Field>
        </div>
        <Field v-if="form.values.scopeType === 'user'">
          <FieldLabel>Usuario</FieldLabel>
          <UserPicker v-model="pickedUser" />
          <FieldDescription v-if="form.values.scopeId && !pickedUser">Actual: {{ form.values.scopeId }}</FieldDescription>
        </Field>
        <Field v-else-if="form.values.scopeType === 'feature'">
          <FieldLabel for="b-feature">Función</FieldLabel>
          <Select v-model="scopeId">
            <SelectTrigger id="b-feature"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
            <SelectContent><SelectItem v-for="(l, k) in FEATURE_LABELS" :key="k" :value="k">{{ l }}</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field v-else-if="form.values.scopeType === 'agent'">
          <FieldLabel for="b-agent">Agente</FieldLabel>
          <AgentSelect id="b-agent" v-model="scopeId" />
        </Field>
        <div class="grid grid-cols-2 gap-3">
          <Field :data-invalid="!!form.errors.limitUsd"><FieldLabel for="b-limit">Límite (USD)</FieldLabel><Input id="b-limit" v-model="form.values.limitUsd" inputmode="decimal" placeholder="50" data-testid="budget-limit" /><FieldError :errors="[form.errors.limitUsd]" /></Field>
          <Field><FieldLabel for="b-thr">Alertas (%)</FieldLabel><Input id="b-thr" v-model.lazy="thresholds" placeholder="80, 100" /></Field>
        </div>
        <div class="flex flex-wrap gap-6">
          <div class="flex items-center gap-2"><Switch id="b-hard" v-model="form.values.hardLimit" /><Label for="b-hard">Límite estricto</Label></div>
          <div class="flex items-center gap-2"><Switch id="b-enabled" v-model="form.values.enabled" /><Label for="b-enabled">Activo</Label></div>
        </div>
        <Alert v-if="form.formError.value" variant="destructive"><AlertDescription>{{ form.formError.value }}</AlertDescription></Alert>
      </form>
      <DialogFooter><Button type="submit" form="budget-form" :disabled="form.submitting.value" data-testid="budget-submit">Guardar</Button></DialogFooter>
    </DialogContent>
  </Dialog>
</template>
