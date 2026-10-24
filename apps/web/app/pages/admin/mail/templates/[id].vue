<script setup lang="ts">
import { mailTemplatesDelete, mailTemplatesGenerate, mailTemplatesGet, mailTemplatesReset, mailTemplatesTest, mailTemplatesUpdate, type MailTemplate } from '@starter/api-client';
import { AUTOMATION_VARIABLES, renderMailTemplate, sampleMailData, templateVariables, type MailTemplateVariable } from '@starter/contracts';
import { Braces, Monitor, RotateCcw, Save, Send, Smartphone, Sparkles, Trash2 } from '@lucide/vue';
import { Badge } from '#ui/components/ui/badge';
import { Button } from '#ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '#ui/components/ui/field';
import { Input } from '#ui/components/ui/input';
import { Label } from '#ui/components/ui/label';
import { Switch } from '#ui/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '#ui/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '#ui/components/ui/tooltip';
import { formatUsd } from '#ui/lib/format';

/**
 * Template editor: HTML/subject/text with variable chips, live preview (shared renderer, so it
 * matches what is sent) in a sandboxed iframe, sample values, AI generation with undo, test send.
 */
definePageMeta({ permission: 'mail.read' });

const route = useRoute();
const api = useApi();
const can = useCan();
const me = useMe();
const notify = useNotify();
const { confirm } = useConfirm();
const id = computed(() => String(route.params.id));
const manage = computed(() => can('mail.manage'));
const aiEnabled = computed(() => !!me.value?.features.ai && can('ai.chat'));

const { data, status, refresh, problem } = await useApiData(() => `mail-template-${id.value}`, () => unwrap(mailTemplatesGet({ client: api, path: { id: id.value } })), { fatal: [404] });
useHead({ title: () => data.value?.name ?? 'Plantilla' });

const draft = reactive({ name: '', subject: '', html: '', text: '' });
const version = ref(0);
function load(t: MailTemplate) {
  Object.assign(draft, { name: t.name, subject: t.subject, html: t.html, text: t.text ?? '' });
  version.value = t.version;
}
watch(data, (t) => t && load(t), { immediate: true });
const dirty = computed(() => !!data.value && (draft.name !== data.value.name || draft.subject !== data.value.subject || draft.html !== data.value.html || draft.text !== (data.value.text ?? '')));

// ── variables and preview ──────────────────────────────────────────────
const variables = computed<MailTemplateVariable[]>(() => {
  const t = data.value;
  if (!t) return [];
  const seen = new Set<string>();
  return [...t.variables, ...(t.kind === 'custom' ? AUTOMATION_VARIABLES : []), ...t.baseVariables].filter((v) => !seen.has(v.name) && seen.add(v.name));
});
const overrides = reactive<Record<string, string>>({});
// The preview uses the real branding; template variables use their sample values (editable).
const branding = useBranding();
const brand = computed(() => ({ appName: branding.value.appName, primaryColor: branding.value.primaryColor, logoUrl: branding.value.logoUrl ?? '', appUrl: import.meta.client ? window.location.origin : '' }));
const preview = computed(() => renderMailTemplate({ subject: draft.subject, html: draft.html, text: draft.text || null }, sampleMailData(variables.value, { ...brand.value, ...overrides })));
const used = computed(() => new Set(templateVariables(draft.subject, draft.html, draft.text)));
const unknown = computed(() => [...used.value].filter((n) => !variables.value.some((v) => v.name === n)));
const missingRequired = computed(() => variables.value.filter((v) => v.required && !used.value.has(v.name)).map((v) => v.name));
const device = ref<'desktop' | 'mobile'>('desktop');
const previewMode = ref<'html' | 'text'>('html');
const showSamples = ref(false);

// ── insert a variable where the cursor is ──────────────────────────────
type Target = 'subject' | 'html' | 'text';
const subjectEl = ref<HTMLInputElement | null>(null);
const htmlEl = ref<HTMLTextAreaElement | null>(null);
const textEl = ref<HTMLTextAreaElement | null>(null);
const lastTarget = ref<Target>('html');
function insert(name: string) {
  const tag = `{{${name}}}`;
  const el = { subject: subjectEl, html: htmlEl, text: textEl }[lastTarget.value].value;
  const field = lastTarget.value;
  const value = draft[field];
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  draft[field] = value.slice(0, start) + tag + value.slice(end);
  void nextTick(() => {
    el?.focus();
    el?.setSelectionRange(start + tag.length, start + tag.length);
  });
}

// ── actions ────────────────────────────────────────────────────────────
const saving = ref(false);
const saveError = ref<string | null>(null);
async function save() {
  saving.value = true;
  saveError.value = null;
  try {
    const t = await unwrap(mailTemplatesUpdate({ client: api, path: { id: id.value }, body: { name: draft.name, subject: draft.subject, html: draft.html, text: draft.text.trim() ? draft.text : null, version: version.value } }));
    data.value = t;
    notify.success('Plantilla guardada');
  } catch (err) {
    saveError.value = apiError(err).message;
    notify.error(err);
  } finally {
    saving.value = false;
  }
}
async function resetTemplate() {
  if (!(await confirm({ title: '¿Restablecer la plantilla?', description: 'Vuelve al contenido original del starter; se pierden tus cambios en esta plantilla.', confirmLabel: 'Restablecer', destructive: true }))) return;
  try {
    data.value = await unwrap(mailTemplatesReset({ client: api, path: { id: id.value } }));
    notify.success('Plantilla restablecida');
  } catch (err) {
    notify.error(err);
  }
}
async function remove() {
  const t = data.value!;
  if (!(await confirm({ title: `¿Eliminar «${t.name}»?`, description: 'Las automatizaciones que la usan impiden eliminarla.', confirmLabel: 'Eliminar', destructive: true, typeToConfirm: t.key }))) return;
  try {
    await mailTemplatesDelete({ client: api, path: { id: id.value } });
    notify.success('Plantilla eliminada');
    await navigateTo('/admin/mail/templates');
  } catch (err) {
    notify.error(err);
  }
}

const testOpen = ref(false);
const testTo = ref('');
const testing = ref(false);
async function sendTest() {
  testing.value = true;
  try {
    const r = await unwrap(mailTemplatesTest({ client: api, path: { id: id.value }, body: { to: testTo.value, data: { ...overrides } } }));
    if (r.ok) notify.success(`Enviada a ${testTo.value}`);
    else notify.warning('El proveedor rechazó el envío', { description: r.detail ?? undefined });
    testOpen.value = false;
  } catch (err) {
    notify.error(err);
  } finally {
    testing.value = false;
  }
}

const aiOpen = ref(false);
const aiPrompt = ref('');
const aiImprove = ref(true);
const generating = ref(false);
const lastGeneration = ref<string | null>(null);
async function generate() {
  if (aiPrompt.value.trim().length < 10) {
    notify.warning('Describe el correo con un poco más de detalle');
    return;
  }
  generating.value = true;
  try {
    const own = variables.value.filter((v) => !data.value!.baseVariables.some((b) => b.name === v.name)).map((v) => v.name);
    const r = await unwrap(mailTemplatesGenerate({ client: api, body: { prompt: aiPrompt.value, variables: own, current: aiImprove.value && draft.html ? { subject: draft.subject, html: draft.html } : null } }));
    const previous = { subject: draft.subject, html: draft.html, text: draft.text };
    Object.assign(draft, { subject: r.subject, html: r.html, text: '' });
    lastGeneration.value = `${r.modelId} · ${r.costUsd ? formatUsd(r.costUsd) : 'costo desconocido'}`;
    aiOpen.value = false;
    notify.undo('Contenido generado con IA: revísalo y guarda', () => Object.assign(draft, previous));
  } catch (err) {
    notify.error(err);
  } finally {
    generating.value = false;
  }
}

onBeforeRouteLeave(async () => {
  if (dirty.value && manage.value) return confirm({ title: '¿Salir sin guardar?', description: 'Tienes cambios sin guardar en esta plantilla.', confirmLabel: 'Salir', destructive: true });
});
</script>

<template>
  <LoadError v-if="problem" :error="problem" :retrying="status === 'pending'" testid="template-load-error" @retry="refresh()" />
  <template v-else-if="data">
    <PageHeader :title="draft.name || data.name" :description="data.description ?? undefined">
      <template #actions>
        <template v-if="manage">
          <Button v-if="aiEnabled" variant="outline" data-testid="template-ai-open" @click="aiOpen = true"><Sparkles class="size-4" /> Generar con IA</Button>
          <Button variant="outline" data-testid="template-test-open" @click="(testTo = me?.user.email ?? ''), (testOpen = true)"><Send class="size-4" /> Enviar prueba</Button>
          <Button v-if="data.kind === 'system' && data.modified" variant="outline" data-testid="template-reset" @click="resetTemplate"><RotateCcw class="size-4" /> Restablecer</Button>
          <Button v-if="data.kind === 'custom'" variant="outline" class="text-destructive" data-testid="template-delete" @click="remove"><Trash2 class="size-4" /> Eliminar</Button>
          <Button :disabled="!dirty || saving" :loading="saving" data-testid="template-save" @click="save"><Save class="size-4" /> Guardar</Button>
        </template>
      </template>
    </PageHeader>

    <div class="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <Badge variant="secondary">{{ data.kind === 'system' ? 'Del sistema' : 'Propia' }}</Badge>
      <code class="bg-muted rounded px-1.5 py-0.5 text-xs">{{ data.key }}</code>
      <Badge v-if="data.modified" variant="outline">Modificada</Badge>
      <Badge v-if="dirty" variant="outline" data-testid="template-dirty">Cambios sin guardar</Badge>
      <span v-if="data.usage" class="text-muted-foreground">{{ data.usage }}</span>
      <span v-if="lastGeneration" class="text-muted-foreground">· IA: {{ lastGeneration }}</span>
    </div>

    <div class="grid gap-6 xl:grid-cols-2">
      <Card class="min-w-0">
        <CardHeader>
          <CardTitle class="text-base">Contenido</CardTitle>
          <CardDescription>Haz clic en una variable para insertarla donde está el cursor. Partes opcionales: <code v-text="'{{#nombre}}…{{/nombre}}'" />.</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <Field>
            <FieldLabel for="tpl-name">Nombre</FieldLabel>
            <Input id="tpl-name" v-model="draft.name" :disabled="!manage" />
          </Field>
          <Field>
            <FieldLabel for="tpl-subject">Asunto</FieldLabel>
            <input
              id="tpl-subject"
              ref="subjectEl"
              v-model="draft.subject"
              :disabled="!manage"
              class="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-50"
              data-testid="template-subject"
              @focus="lastTarget = 'subject'"
            />
          </Field>
          <div>
            <Label class="mb-2 flex items-center gap-1"><Braces class="size-4" /> Variables</Label>
            <div class="flex flex-wrap gap-1.5" data-testid="template-variables">
              <Tooltip v-for="v in variables" :key="v.name">
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    :disabled="!manage"
                    class="hover:bg-accent rounded-md border px-2 py-0.5 font-mono text-xs transition-colors disabled:opacity-60"
                    :class="[used.has(v.name) ? 'border-primary/50 bg-primary/5' : '', v.required ? 'font-semibold' : '']"
                    :data-testid="`template-var-${v.name}`"
                    @mousedown.prevent
                    @click="insert(v.name)"
                    v-text="`{{${v.name}}}`"
                  />
                </TooltipTrigger>
                <TooltipContent>{{ v.description || v.name }}{{ v.required ? ' · obligatoria' : '' }}</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <Field>
            <FieldLabel for="tpl-html">HTML</FieldLabel>
            <textarea
              id="tpl-html"
              ref="htmlEl"
              v-model="draft.html"
              :disabled="!manage"
              rows="22"
              spellcheck="false"
              class="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs leading-relaxed shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-50"
              data-testid="template-html"
              @focus="lastTarget = 'html'"
            />
          </Field>
          <details class="rounded-md border p-3">
            <summary class="cursor-pointer text-sm font-medium">Texto plano (opcional)</summary>
            <p class="text-muted-foreground my-2 text-xs">Para clientes sin HTML. Si lo dejas vacío se genera a partir del HTML.</p>
            <textarea
              ref="textEl"
              v-model="draft.text"
              :disabled="!manage"
              rows="6"
              aria-label="Texto plano"
              class="border-input w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs"
              data-testid="template-text"
              @focus="lastTarget = 'text'"
            />
          </details>
          <AppAlert v-if="missingRequired.length" variant="destructive" title="Faltan variables obligatorias" data-testid="template-missing">
            Agrega <code v-for="n in missingRequired" :key="n" class="mr-1" v-text="`{{${n}}}`" /> o la plantilla no se podrá guardar.
          </AppAlert>
          <AppAlert v-if="unknown.length" variant="warning" title="Variables desconocidas">
            <code v-for="n in unknown" :key="n" class="mr-1" v-text="`{{${n}}}`" /> no se reciben en este correo y quedarán vacías.
          </AppAlert>
          <AppAlert v-if="saveError" variant="destructive" :description="saveError" />
        </CardContent>
      </Card>

      <Card class="min-w-0 self-start xl:sticky xl:top-4">
        <CardHeader class="gap-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <CardTitle class="text-base">Vista previa</CardTitle>
            <div class="flex items-center gap-2">
              <Tabs v-model="previewMode"><TabsList><TabsTrigger value="html">HTML</TabsTrigger><TabsTrigger value="text">Texto</TabsTrigger></TabsList></Tabs>
              <Tabs v-if="previewMode === 'html'" v-model="device">
                <TabsList>
                  <TabsTrigger value="desktop" aria-label="Escritorio"><Monitor class="size-4" /></TabsTrigger>
                  <TabsTrigger value="mobile" aria-label="Celular" data-testid="template-preview-mobile"><Smartphone class="size-4" /></TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
          <p class="text-sm"><span class="text-muted-foreground">Asunto:</span> <strong data-testid="template-preview-subject">{{ preview.subject }}</strong></p>
        </CardHeader>
        <CardContent class="space-y-3">
          <div v-if="previewMode === 'html'" class="bg-muted/40 flex justify-center rounded-lg border p-2">
            <!-- sandbox without allow-scripts: the e-mail cannot run code in the panel -->
            <iframe
              :srcdoc="preview.html"
              sandbox=""
              title="Vista previa del correo"
              class="h-[34rem] rounded-md border bg-white transition-[width]"
              :class="device === 'mobile' ? 'w-[375px]' : 'w-full'"
              data-testid="template-preview"
            />
          </div>
          <pre v-else class="bg-muted/40 max-h-[34rem] overflow-auto rounded-lg border p-3 text-xs whitespace-pre-wrap" data-testid="template-preview-text">{{ preview.text }}</pre>
          <label class="flex items-center gap-2 text-sm"><Switch v-model="showSamples" /> Editar datos de ejemplo</label>
          <div v-if="showSamples" class="grid gap-2 sm:grid-cols-2">
            <Field v-for="v in variables" :key="v.name">
              <FieldLabel :for="`sample-${v.name}`" class="font-mono text-xs">{{ v.name }}</FieldLabel>
              <Input :id="`sample-${v.name}`" v-model="overrides[v.name]" :placeholder="v.sample" class="h-8 text-xs" />
              <FieldDescription v-if="v.description" class="text-xs">{{ v.description }}</FieldDescription>
            </Field>
          </div>
        </CardContent>
      </Card>
    </div>

    <FormDialog v-model:open="testOpen" title="Enviar prueba" :description="dirty ? 'Se envía la versión guardada: guarda antes para probar tus cambios.' : 'Se envía con los datos de ejemplo de la vista previa.'" submit-label="Enviar" :loading="testing" testid="template-test" @submit="sendTest">
      <Field>
        <FieldLabel for="tpl-test-to">Enviar a</FieldLabel>
        <Input id="tpl-test-to" v-model="testTo" type="email" required data-testid="template-test-to" />
      </Field>
    </FormDialog>

    <FormDialog v-model:open="aiOpen" title="Generar con IA" description="Describe el correo; la IA propone asunto y HTML con las variables de esta plantilla. Nada se guarda hasta que pulses Guardar." submit-label="Generar" :loading="generating" testid="template-ai" @submit="generate">
      <Field>
        <FieldLabel for="tpl-ai-prompt">¿Qué correo necesitas?</FieldLabel>
        <textarea
          id="tpl-ai-prompt"
          v-model="aiPrompt"
          rows="5"
          class="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          placeholder="Recordatorio amable de que la suscripción vence en 3 días, con un botón para renovar y tono cercano."
          data-testid="template-ai-prompt"
        />
      </Field>
      <label class="flex items-center gap-2 text-sm"><Switch v-model="aiImprove" /> Mejorar el contenido actual en vez de empezar de cero</label>
      <p class="text-muted-foreground text-xs">Usa el modelo del asistente predeterminado; el costo queda en Uso y costos.</p>
    </FormDialog>
  </template>
</template>
