<script setup lang="ts">
import { adminRolesList, mailAutomationsCreate, mailAutomationsDelete, mailAutomationsList, mailAutomationsTest, mailAutomationsUpdate, mailTemplatesList, type MailAutomation } from '@starter/api-client';
import { MAIL_EVENTS, MAIL_RECIPIENT_KINDS, MailAutomationInput, type MailEventKey, type MailRecipientKind, type MailTrigger } from '@starter/contracts';
import { CalendarClock, Clock, Plus, Users, Workflow, Zap } from '@lucide/vue';
import { Badge } from '#ui/components/ui/badge';
import { Button } from '#ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Field, FieldDescription, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Input } from '#ui/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Switch } from '#ui/components/ui/switch';
import ActionMenu from '#ui/components/common/ActionMenu.vue';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import { CRON_PRESETS } from '~/utils/mail-labels';

/**
 * Automations: when an audited action happens (or on a schedule), send a template to the person
 * of the event, whoever did it, everyone with a role or fixed addresses. Sends are durable jobs.
 */
definePageMeta({ permission: 'mail.read' });
useHead({ title: 'Automatizaciones de correo' });

const api = useApi();
const can = useCan();
const me = useMe();
const notify = useNotify();
const manage = computed(() => can('mail.manage'));
const VARS_HINT = ['recipient.name', 'event.label', 'event.date', 'actor.name', 'resource.name'].map((v) => `{{${v}}}`).join(', ');

const { data, status, refresh, problem } = await useApiData('mail-automations', () => unwrap(mailAutomationsList({ client: api })));
const { data: templates } = await useApiData('mail-automation-templates', () => unwrap(mailTemplatesList({ client: api })));
const { data: roles } = await useApiData('mail-automation-roles', () => (can('roles.read') ? unwrap(adminRolesList({ client: api })) : Promise.resolve([])));

const eventGroups = computed(() => {
  const groups = new Map<string, { key: MailEventKey; label: string }[]>();
  for (const [key, e] of Object.entries(MAIL_EVENTS)) groups.set(e.group, [...(groups.get(e.group) ?? []), { key: key as MailEventKey, label: e.label }]);
  return [...groups.entries()];
});
const triggerLabel = (t: MailTrigger) => (t === 'schedule' ? 'Programada' : MAIL_EVENTS[t].label);
function recipientLabel(a: MailAutomation) {
  if (a.recipientKind === 'role') return `Rol ${roles.value?.find((r) => r.key === a.recipientRoleKey)?.name ?? a.recipientRoleKey}`;
  if (a.recipientKind === 'emails') return a.recipientEmails.join(', ');
  return MAIL_RECIPIENT_KINDS[a.recipientKind];
}

// ── form ───────────────────────────────────────────────────────────────
const open = ref(false);
const editing = ref<MailAutomation | null>(null);
const form = useZodForm(MailAutomationInput, { name: '', description: null, trigger: 'users.register', cron: null, templateId: '', recipientKind: 'subject', recipientRoleKey: null, recipientEmails: [], delayMinutes: 0, enabled: true });
const description = nullableModel(form.values, 'description');
const cron = nullableModel(form.values, 'cron');
const emails = computed({
  get: () => (form.values.recipientEmails ?? []).join(', '),
  set: (v: string) => (form.values.recipientEmails = v.split(/[,\s;]+/).map((x) => x.trim()).filter(Boolean)),
});
const recipientOptions = computed(() => {
  const t = form.values.trigger;
  const person = t !== 'schedule' && !!MAIL_EVENTS[t as MailEventKey]?.person;
  return (Object.entries(MAIL_RECIPIENT_KINDS) as [MailRecipientKind, string][]).filter(([k]) => (k === 'subject' ? person : k === 'actor' ? t !== 'schedule' : true));
});
watch(recipientOptions, (opts) => {
  if (!opts.some(([k]) => k === form.values.recipientKind)) form.values.recipientKind = opts[0]![0];
});
function openCreate() {
  editing.value = null;
  form.reset({ name: '', description: null, trigger: 'users.register', cron: null, templateId: templates.value?.find((t) => t.key === 'automation.notice')?.id ?? '', recipientKind: 'subject', recipientRoleKey: null, recipientEmails: [], delayMinutes: 0, enabled: true });
  open.value = true;
}
function openEdit(a: MailAutomation) {
  editing.value = a;
  form.reset({ name: a.name, description: a.description, trigger: a.trigger, cron: a.cron, templateId: a.template.id, recipientKind: a.recipientKind, recipientRoleKey: a.recipientRoleKey, recipientEmails: a.recipientEmails, delayMinutes: a.delayMinutes, enabled: a.enabled });
  open.value = true;
}
const submit = form.handleSubmit(async (values) => {
  if (editing.value) await mailAutomationsUpdate({ client: api, path: { id: editing.value.id }, body: { ...values, version: editing.value.version } });
  else await mailAutomationsCreate({ client: api, body: values });
  notify.success(editing.value ? 'Automatización actualizada' : 'Automatización creada');
  open.value = false;
  await refresh();
});

async function toggle(a: MailAutomation, enabled: boolean) {
  try {
    await mailAutomationsUpdate({ client: api, path: { id: a.id }, body: { name: a.name, description: a.description, trigger: a.trigger, cron: a.cron, templateId: a.template.id, recipientKind: a.recipientKind, recipientRoleKey: a.recipientRoleKey, recipientEmails: a.recipientEmails, delayMinutes: a.delayMinutes, enabled, version: a.version } });
    notify.success(enabled ? `«${a.name}» activada` : `«${a.name}» desactivada`);
  } catch (err) {
    notify.error(err);
  }
  await refresh();
}
async function test(a: MailAutomation) {
  const to = me.value?.user.email;
  if (!to) return;
  try {
    const r = await unwrap(mailAutomationsTest({ client: api, path: { id: a.id }, body: { to } }));
    if (r.ok) notify.success(`Prueba enviada a ${to}`, { description: 'Con valores de ejemplo del evento.' });
    else notify.warning('El proveedor rechazó el envío', { description: r.detail ?? undefined });
  } catch (err) {
    notify.error(err);
  }
}
async function remove(a: MailAutomation) {
  try {
    await mailAutomationsDelete({ client: api, path: { id: a.id } });
    notify.success('Automatización eliminada');
    await refresh();
  } catch (err) {
    notify.error(err);
  }
}
</script>

<template>
  <PageHeader title="Automatizaciones de correo" description="Envía una plantilla cuando ocurre algo en la plataforma (una persona ingresa por primera vez, se crea un proyecto…) o según un horario. Solo cuentan los eventos posteriores a su activación.">
    <template #actions>
      <Button v-if="manage" data-testid="automation-new" @click="openCreate"><Plus class="size-4" /> Nueva automatización</Button>
    </template>
  </PageHeader>

  <LoadError v-if="problem" :error="problem" :retrying="status === 'pending'" testid="automations-load-error" @retry="refresh()" />
  <EmptyState v-else-if="data && !data.length" title="Sin automatizaciones" description="Crea la primera: por ejemplo, una bienvenida cuando una persona ingresa por primera vez." :icon="Workflow">
    <Button v-if="manage" @click="openCreate"><Plus class="size-4" /> Nueva automatización</Button>
  </EmptyState>
  <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    <Card v-for="a in data" :key="a.id" :class="{ 'opacity-70': !a.enabled }" :data-testid="`automation-${a.name}`">
      <CardHeader>
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <CardTitle class="text-base">{{ a.name }}</CardTitle>
            <CardDescription v-if="a.description" class="line-clamp-2">{{ a.description }}</CardDescription>
          </div>
          <div class="flex items-center gap-1">
            <Switch v-if="manage" :model-value="a.enabled" :aria-label="a.enabled ? `Desactivar ${a.name}` : `Activar ${a.name}`" :data-testid="`automation-toggle-${a.name}`" @update:model-value="(v: boolean) => toggle(a, v)" />
            <ActionMenu
              v-if="manage"
              :label="`Acciones para ${a.name}`"
              :items="[
                { label: 'Editar', icon: 'edit', testid: 'automation-edit', onSelect: () => openEdit(a) },
                { label: 'Enviarme una prueba', icon: 'send', testid: 'automation-test', onSelect: () => test(a) },
                { label: 'Ver envíos', icon: 'history', onSelect: () => navigateTo({ path: '/admin/mail/deliveries', query: { automationId: a.id } }) },
                { label: 'Eliminar', icon: 'delete', destructive: true, separator: true, confirm: { title: `¿Eliminar «${a.name}»?`, description: 'Los envíos ya hechos quedan en el historial.', confirmLabel: 'Eliminar', destructive: true }, onSelect: () => remove(a) },
              ]"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-2 text-sm">
        <p class="flex items-center gap-2"><component :is="a.trigger === 'schedule' ? CalendarClock : Zap" class="text-muted-foreground size-4 shrink-0" /> {{ triggerLabel(a.trigger) }}<code v-if="a.cron" class="text-xs">{{ a.cron }} UTC</code></p>
        <p class="flex items-center gap-2"><Users class="text-muted-foreground size-4 shrink-0" /> <span class="line-clamp-1">{{ recipientLabel(a) }}</span></p>
        <p class="text-muted-foreground">Plantilla: <NuxtLink :to="`/admin/mail/templates/${a.template.id}`" class="text-foreground underline">{{ a.template.name }}</NuxtLink></p>
        <div class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <Badge :variant="a.enabled ? 'default' : 'outline'">{{ a.enabled ? 'Activa' : 'Inactiva' }}</Badge>
          <span v-if="a.delayMinutes" class="inline-flex items-center gap-1"><Clock class="size-3" /> {{ a.delayMinutes }} min después</span>
          <span>{{ a.deliveries7d }} envíos en 7 días</span>
          <span v-if="a.nextRunAt">Próxima: <RelativeTime :value="a.nextRunAt" /></span>
          <span v-else-if="a.lastRunAt">Última: <RelativeTime :value="a.lastRunAt" /></span>
        </div>
      </CardContent>
    </Card>
  </div>

  <FormDialog
    v-model:open="open"
    variant="sheet"
    :title="editing ? 'Editar automatización' : 'Nueva automatización'"
    description="Cuándo se envía, a quién y con qué plantilla."
    :submit-label="editing ? 'Guardar cambios' : 'Crear automatización'"
    :loading="form.submitting.value"
    :error="form.formError.value"
    testid="automation-form"
    @submit="submit"
  >
    <Field :data-invalid="!!form.errors.name">
      <FieldLabel for="au-name">Nombre</FieldLabel>
      <Input id="au-name" v-model="form.values.name" placeholder="Aviso de proyecto nuevo" data-testid="automation-form-name" />
      <FieldError :errors="[form.errors.name]" />
    </Field>
    <Field>
      <FieldLabel for="au-desc">Descripción (opcional)</FieldLabel>
      <Input id="au-desc" v-model="description" />
    </Field>
    <Field :data-invalid="!!form.errors.trigger">
      <FieldLabel for="au-trigger">Cuándo</FieldLabel>
      <Select v-model="form.values.trigger">
        <SelectTrigger id="au-trigger" data-testid="automation-form-trigger"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup v-for="[group, items] in eventGroups" :key="group">
            <SelectLabel>{{ group }}</SelectLabel>
            <SelectItem v-for="e in items" :key="e.key" :value="e.key">{{ e.label }}</SelectItem>
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Horario</SelectLabel>
            <SelectItem value="schedule">Programada (cron)</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
    <template v-if="form.values.trigger === 'schedule'">
      <Field :data-invalid="!!form.errors.cron">
        <FieldLabel for="au-cron">Programación (cron, hora UTC)</FieldLabel>
        <Input id="au-cron" v-model="cron" class="font-mono" placeholder="0 12 * * 1" data-testid="automation-form-cron" />
        <div class="flex flex-wrap gap-1">
          <Button v-for="p in CRON_PRESETS" :key="p.cron" type="button" size="sm" variant="outline" class="h-7 text-xs" @click="form.values.cron = p.cron">{{ p.label }}</Button>
        </div>
        <FieldError :errors="[form.errors.cron]" />
      </Field>
    </template>
    <Field :data-invalid="!!form.errors.templateId">
      <FieldLabel for="au-template">Plantilla</FieldLabel>
      <ClientOnly>
        <Select v-model="form.values.templateId">
          <SelectTrigger id="au-template" data-testid="automation-form-template"><SelectValue placeholder="Elige una plantilla" /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="t in templates ?? []" :key="t.id" :value="t.id">{{ t.name }}</SelectItem>
          </SelectContent>
        </Select>
      </ClientOnly>
      <FieldDescription>La plantilla recibe <span v-text="VARS_HINT" />.</FieldDescription>
      <FieldError :errors="[form.errors.templateId]" />
    </Field>
    <Field :data-invalid="!!form.errors.recipientKind">
      <FieldLabel for="au-recipient">A quién</FieldLabel>
      <Select v-model="form.values.recipientKind">
        <SelectTrigger id="au-recipient" data-testid="automation-form-recipient"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem v-for="[k, label] in recipientOptions" :key="k" :value="k">{{ label }}</SelectItem>
        </SelectContent>
      </Select>
      <FieldError :errors="[form.errors.recipientKind]" />
    </Field>
    <Field v-if="form.values.recipientKind === 'role'" :data-invalid="!!form.errors.recipientRoleKey">
      <FieldLabel for="au-role">Rol</FieldLabel>
      <ClientOnly>
        <Select v-model="form.values.recipientRoleKey">
          <SelectTrigger id="au-role" data-testid="automation-form-role"><SelectValue placeholder="Elige un rol" /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="r in roles ?? []" :key="r.id" :value="r.key">{{ r.name }}</SelectItem>
          </SelectContent>
        </Select>
      </ClientOnly>
      <FieldError :errors="[form.errors.recipientRoleKey]" />
    </Field>
    <Field v-if="form.values.recipientKind === 'emails'" :data-invalid="!!form.errors.recipientEmails">
      <FieldLabel for="au-emails">Correos</FieldLabel>
      <Input id="au-emails" v-model="emails" placeholder="ana@empresa.cl, equipo@empresa.cl" data-testid="automation-form-emails" />
      <FieldError :errors="[form.errors.recipientEmails]" />
    </Field>
    <Field :data-invalid="!!form.errors.delayMinutes">
      <FieldLabel for="au-delay">Esperar antes de enviar (minutos)</FieldLabel>
      <Input id="au-delay" v-model.number="form.values.delayMinutes" type="number" min="0" max="10080" />
      <FieldError :errors="[form.errors.delayMinutes]" />
    </Field>
    <label class="flex items-center gap-3 text-sm"><Switch v-model="form.values.enabled" data-testid="automation-form-enabled" /> Activa</label>
  </FormDialog>
</template>
