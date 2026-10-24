<script setup lang="ts">
import { mailTemplatesCreate, mailTemplatesGet, mailTemplatesList, type MailTemplateSummary } from '@starter/api-client';
import { CreateMailTemplateInput } from '@starter/contracts';
import { LayoutTemplate, Plus, Workflow } from '@lucide/vue';
import { z } from 'zod';
import { Badge } from '#ui/components/ui/badge';
import { Button } from '#ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Field, FieldDescription, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Input } from '#ui/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import RelativeTime from '#ui/components/common/RelativeTime.vue';

definePageMeta({ permission: 'mail.read' });
useHead({ title: 'Plantillas de correo' });

const api = useApi();
const can = useCan();
const { data, status, refresh, problem } = await useApiData('mail-templates', () => unwrap(mailTemplatesList({ client: api })));
const groups = computed(() => [
  { title: 'Del sistema', description: 'Las usa la plataforma (código de acceso, invitaciones, alertas). Puedes editarlas y restablecerlas.', items: data.value?.filter((t) => t.kind === 'system') ?? [] },
  { title: 'Propias', description: 'Para automatizaciones o para enviarlas desde el código por su clave.', items: data.value?.filter((t) => t.kind === 'custom') ?? [] },
]);

const NewTemplate = CreateMailTemplateInput.pick({ name: true, key: true, description: true }).extend({ baseId: z.string().min(1) });
const form = useZodForm(NewTemplate, { name: '', key: '', description: '', baseId: '' });
const description = nullableModel(form.values, 'description');
const open = ref(false);
const keyTouched = ref(false);
watch(
  () => form.values.name,
  (name) => {
    if (keyTouched.value) return;
    form.values.key = slug(name);
  },
);
function slug(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}
function openCreate() {
  keyTouched.value = false;
  form.reset({ name: '', key: '', description: '', baseId: data.value?.find((t) => t.key === 'automation.notice')?.id ?? data.value?.[0]?.id ?? '' });
  open.value = true;
}
const submit = form.handleSubmit(async (values) => {
  const base = await unwrap(mailTemplatesGet({ client: api, path: { id: values.baseId } }));
  const created = await unwrap(
    mailTemplatesCreate({
      client: api,
      body: {
        key: values.key,
        name: values.name,
        description: values.description || null,
        subject: base.subject,
        html: base.html,
        text: base.text,
        variables: base.variables.map((v) => ({ ...v, required: false })),
      },
    }),
  );
  open.value = false;
  await navigateTo(`/admin/mail/templates/${created.id}`);
});
const kindLabel = (t: MailTemplateSummary) => (t.kind === 'system' ? 'Sistema' : 'Propia');
</script>

<template>
  <PageHeader title="Plantillas de correo" description="Contenido de cada correo con variables como {{appName}} o {{code}}. Edítalas con vista previa en vivo o genéralas con IA.">
    <template #actions>
      <Button v-if="can('mail.manage')" data-testid="template-new" @click="openCreate"><Plus class="size-4" /> Nueva plantilla</Button>
    </template>
  </PageHeader>

  <LoadError v-if="problem" :error="problem" :retrying="status === 'pending'" testid="templates-load-error" @retry="refresh()" />
  <template v-else-if="data">
    <section v-for="g in groups" :key="g.title" class="mb-8">
      <div class="mb-3">
        <h2 class="text-base font-semibold">{{ g.title }}</h2>
        <p class="text-muted-foreground text-sm">{{ g.description }}</p>
      </div>
      <EmptyState v-if="!g.items.length" title="Aún no hay plantillas propias" description="Crea una a partir de otra y ajústala con el editor o con IA." :icon="LayoutTemplate">
        <Button v-if="can('mail.manage')" @click="openCreate"><Plus class="size-4" /> Nueva plantilla</Button>
      </EmptyState>
      <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <NuxtLink v-for="t in g.items" :key="t.id" :to="`/admin/mail/templates/${t.id}`" class="group" :data-testid="`template-${t.key}`">
          <Card class="group-hover:border-primary/50 h-full transition-colors">
            <CardHeader>
              <div class="flex flex-wrap items-center gap-2">
                <CardTitle class="text-base">{{ t.name }}</CardTitle>
                <Badge variant="secondary">{{ kindLabel(t) }}</Badge>
                <Badge v-if="t.modified" variant="outline">Modificada</Badge>
              </div>
              <CardDescription><code class="text-xs">{{ t.key }}</code></CardDescription>
            </CardHeader>
            <CardContent class="space-y-2 text-sm">
              <p class="line-clamp-1"><span class="text-muted-foreground">Asunto:</span> {{ t.subject }}</p>
              <p v-if="t.usage" class="text-muted-foreground line-clamp-2">{{ t.usage }}</p>
              <div class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span v-if="t.automations" class="inline-flex items-center gap-1"><Workflow class="size-3" /> {{ t.automations }} automatización{{ t.automations === 1 ? '' : 'es' }}</span>
                <span>Editada <RelativeTime :value="t.updatedAt" /></span>
              </div>
            </CardContent>
          </Card>
        </NuxtLink>
      </div>
    </section>
  </template>

  <FormDialog v-model:open="open" title="Nueva plantilla" description="Parte de una existente y luego ajústala en el editor (o con IA)." submit-label="Crear y editar" :loading="form.submitting.value" :error="form.formError.value" testid="template-form" @submit="submit">
    <Field :data-invalid="!!form.errors.name">
      <FieldLabel for="tpl-name">Nombre</FieldLabel>
      <Input id="tpl-name" v-model="form.values.name" placeholder="Recordatorio de pago" data-testid="template-form-name" />
      <FieldError :errors="[form.errors.name]" />
    </Field>
    <Field :data-invalid="!!form.errors.key">
      <FieldLabel for="tpl-key">Clave</FieldLabel>
      <Input id="tpl-key" v-model="form.values.key" class="font-mono" data-testid="template-form-key" @input="keyTouched = true" />
      <FieldDescription>Identificador para el código: <code>mailer.send({ template: { key } })</code>.</FieldDescription>
      <FieldError :errors="[form.errors.key]" />
    </Field>
    <Field>
      <FieldLabel for="tpl-desc">Descripción (opcional)</FieldLabel>
      <Input id="tpl-desc" v-model="description" />
    </Field>
    <Field :data-invalid="!!form.errors.baseId">
      <FieldLabel for="tpl-base">Basada en</FieldLabel>
      <ClientOnly>
        <Select v-model="form.values.baseId">
          <SelectTrigger id="tpl-base" data-testid="template-form-base"><SelectValue placeholder="Elige una plantilla" /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="t in data ?? []" :key="t.id" :value="t.id">{{ t.name }}</SelectItem>
          </SelectContent>
        </Select>
      </ClientOnly>
      <FieldError :errors="[form.errors.baseId]" />
    </Field>
  </FormDialog>
</template>
