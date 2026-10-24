<script setup lang="ts">
import { mailSettingsCheck, mailSettingsGet, mailSettingsReset, mailSettingsTest, mailSettingsUpdate, type MailProviderSettings } from '@starter/api-client';
import { MailProviderInput, type MailProviderInput as ProviderValues } from '@starter/contracts';
import { CheckCircle2, ExternalLink, KeyRound, Mail, PlugZap, RotateCcw, Save, Send } from '@lucide/vue';
import { Button } from '#ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Field, FieldDescription, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Input } from '#ui/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Switch } from '#ui/components/ui/switch';
import { Badge } from '#ui/components/ui/badge';
import { Spinner } from '#ui/components/ui/spinner';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import { MAIL_PROVIDERS, SMTP_PRESETS } from '~/utils/mail-labels';

/**
 * Mail provider for the whole installation. The key/password is write-only: the API stores it
 * encrypted and returns a hint. "Comprobar" and "Enviar prueba" use the form as it is, before saving.
 */
definePageMeta({ permission: 'mail.read' });
useHead({ title: 'Proveedor de correo' });

const api = useApi();
const can = useCan();
const notify = useNotify();
const me = useMe();
const { confirm } = useConfirm();
const manage = computed(() => can('mail.manage'));

const { data, status, refresh, problem } = await useApiData('mail-settings', () => unwrap(mailSettingsGet({ client: api })));

const blank: ProviderValues = { transport: 'resend', from: '', replyTo: null, smtpHost: null, smtpPort: 587, smtpUser: null, smtpSecure: false, mailgunDomain: null, mailgunRegion: 'us' };
const form = useZodForm(MailProviderInput, blank);
const secret = ref('');
function load(s: MailProviderSettings) {
  form.reset({
    transport: s.transport,
    from: s.from,
    replyTo: s.replyTo,
    smtpHost: s.smtpHost,
    smtpPort: s.smtpPort ?? 587,
    smtpUser: s.smtpUser,
    smtpSecure: s.smtpSecure ?? false,
    mailgunDomain: s.mailgunDomain,
    mailgunRegion: s.mailgunRegion ?? 'us',
  });
  secret.value = '';
}
watch(data, (s) => s && load(s), { immediate: true });

const provider = computed(() => MAIL_PROVIDERS[form.values.transport] ?? MAIL_PROVIDERS.smtp!);
const storedSecret = computed(() => (data.value?.source === 'database' && data.value.transport === form.values.transport && data.value.hasSecret ? data.value.secretHint : null));
const replyTo = nullableModel(form.values, 'replyTo');
const smtpHost = nullableModel(form.values, 'smtpHost');
const smtpUser = nullableModel(form.values, 'smtpUser');
const mailgunDomain = nullableModel(form.values, 'mailgunDomain');
const smtpPort = computed({ get: () => form.values.smtpPort ?? '', set: (v: string | number) => (form.values.smtpPort = v === '' ? null : Number(v)) });
const presetHint = ref<string | null>(null);
function applyPreset(label: unknown) {
  const p = SMTP_PRESETS.find((x) => x.label === label);
  if (!p) return;
  form.values.smtpHost = p.host;
  form.values.smtpPort = p.port;
  form.values.smtpSecure = p.secure;
  if (p.user) form.values.smtpUser = p.user;
  presetHint.value = p.hint ?? null;
}

const busy = ref<'check' | 'test' | 'reset' | null>(null);
const result = ref<{ title: string; ok: boolean; detail: string | null } | null>(null);
function draft(): ProviderValues | null {
  const values = form.validate();
  if (!values) return null;
  return { ...values, secret: secret.value.trim() || undefined };
}
async function check() {
  const d = draft();
  if (!d) return;
  busy.value = 'check';
  result.value = null;
  try {
    const r = await unwrap(mailSettingsCheck({ client: api, body: { draft: d } }));
    result.value = { title: r.ok ? 'Conexión correcta' : 'El proveedor no aceptó la configuración', ok: r.ok, detail: r.detail };
  } catch (err) {
    form.applyServerError(err);
    notify.error(err);
  } finally {
    busy.value = null;
  }
}

const testOpen = ref(false);
const testTo = ref('');
function openTest() {
  testTo.value = me.value?.user.email ?? '';
  testOpen.value = true;
}
async function sendTest() {
  const d = draft();
  if (!d) {
    testOpen.value = false;
    return;
  }
  busy.value = 'test';
  try {
    const r = await unwrap(mailSettingsTest({ client: api, body: { to: testTo.value, draft: d } }));
    result.value = { title: r.ok ? `Correo de prueba enviado a ${testTo.value}` : 'El envío de prueba falló', ok: r.ok, detail: r.ok ? (r.messageId ? `Id del proveedor: ${r.messageId}` : null) : r.detail };
    testOpen.value = false;
  } catch (err) {
    form.applyServerError(err);
    notify.error(err);
    testOpen.value = false;
  } finally {
    busy.value = null;
  }
}

const save = form.handleSubmit(async (values) => {
  const saved = await unwrap(mailSettingsUpdate({ client: api, body: { provider: { ...values, secret: secret.value.trim() || undefined }, version: data.value?.version ?? 0 } }));
  data.value = saved;
  result.value = null;
  notify.success('Proveedor de correo guardado', { description: 'Los próximos correos usan esta configuración.' });
});

async function resetToEnv() {
  if (!(await confirm({ title: '¿Volver a las variables de entorno?', description: 'Se elimina la configuración guardada en la plataforma, incluida la clave cifrada. Los correos usarán MAIL_TRANSPORT y MAIL_FROM.', confirmLabel: 'Volver a variables', destructive: true }))) return;
  busy.value = 'reset';
  try {
    data.value = await unwrap(mailSettingsReset({ client: api }));
    notify.success('Usando las variables de entorno');
  } catch (err) {
    notify.error(err);
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <PageHeader title="Proveedor de correo" description="Con este proveedor la plataforma envía códigos de acceso, invitaciones, alertas y automatizaciones. Las claves se guardan cifradas y nunca se muestran." />

  <LoadError v-if="problem" :error="problem" :retrying="status === 'pending'" testid="mail-settings-load-error" @retry="refresh()" />
  <template v-else-if="data">
    <AppAlert v-if="data.source === 'environment'" variant="info" title="Usando variables de entorno" class="mb-6" data-testid="mail-source">
      Hoy se envía con <strong>{{ MAIL_PROVIDERS[data.environment.transport]?.name ?? data.environment.transport }}</strong> desde <code>MAIL_TRANSPORT</code>. Guarda un proveedor aquí para administrarlo desde la plataforma.
    </AppAlert>
    <AppAlert v-else variant="success" title="Configurado en la plataforma" class="mb-6" data-testid="mail-source">
      {{ MAIL_PROVIDERS[data.transport]?.name }} · remitente <strong>{{ data.from }}</strong>
      <template v-if="data.lastCheck"> · última comprobación <RelativeTime :value="data.lastCheck.at" /> ({{ data.lastCheck.ok ? 'correcta' : 'con error' }})</template>
    </AppAlert>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Card>
        <CardHeader>
          <CardTitle>Proveedor</CardTitle>
          <CardDescription>Elige cómo se envían los correos y completa sus datos.</CardDescription>
        </CardHeader>
        <CardContent>
          <form class="space-y-6" novalidate data-testid="mail-provider-form" @submit="save">
            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Proveedor de correo">
              <button
                v-for="(p, key) in MAIL_PROVIDERS"
                :key="key"
                type="button"
                role="radio"
                :aria-checked="form.values.transport === key"
                :disabled="!manage"
                :data-testid="`mail-provider-${key}`"
                class="hover:border-primary/60 focus-visible:ring-ring rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                :class="form.values.transport === key ? 'border-primary bg-primary/5 ring-primary/30 ring-1' : ''"
                @click="form.values.transport = key as ProviderValues['transport']"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="font-medium">{{ p.name }}</span>
                  <CheckCircle2 v-if="form.values.transport === key" class="text-primary size-4" aria-hidden="true" />
                </div>
                <p class="text-muted-foreground mt-1 text-xs">{{ p.description }}</p>
              </button>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <Field :data-invalid="!!form.errors.from">
                <FieldLabel for="mail-from">Remitente</FieldLabel>
                <Input id="mail-from" v-model="form.values.from" :disabled="!manage" placeholder="Mesa de Ayuda <no-reply@tudominio.cl>" data-testid="mail-from" />
                <FieldDescription>Debe pertenecer a un dominio verificado en el proveedor.</FieldDescription>
                <FieldError :errors="[form.errors.from]" />
              </Field>
              <Field :data-invalid="!!form.errors.replyTo">
                <FieldLabel for="mail-reply">Responder a (opcional)</FieldLabel>
                <Input id="mail-reply" v-model="replyTo" type="email" :disabled="!manage" placeholder="soporte@tudominio.cl" data-testid="mail-reply-to" />
                <FieldError :errors="[form.errors.replyTo]" />
              </Field>
            </div>

            <template v-if="form.values.transport === 'smtp'">
              <Field>
                <FieldLabel for="mail-preset">Completar con los datos de…</FieldLabel>
                <Select :disabled="!manage" @update:model-value="applyPreset">
                  <SelectTrigger id="mail-preset" data-testid="mail-smtp-preset"><SelectValue placeholder="Elige un servicio (opcional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="p in SMTP_PRESETS" :key="p.label" :value="p.label">{{ p.label }}</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription v-if="presetHint">{{ presetHint }}</FieldDescription>
              </Field>
              <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <Field :data-invalid="!!form.errors.smtpHost">
                  <FieldLabel for="mail-host">Servidor SMTP</FieldLabel>
                  <Input id="mail-host" v-model="smtpHost" :disabled="!manage" placeholder="smtp.tudominio.cl" autocomplete="off" data-testid="mail-smtp-host" />
                  <FieldError :errors="[form.errors.smtpHost]" />
                </Field>
                <Field :data-invalid="!!form.errors.smtpPort">
                  <FieldLabel for="mail-port">Puerto</FieldLabel>
                  <Input id="mail-port" v-model="smtpPort" type="number" inputmode="numeric" :disabled="!manage" data-testid="mail-smtp-port" />
                  <FieldError :errors="[form.errors.smtpPort]" />
                </Field>
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel for="mail-user">Usuario</FieldLabel>
                  <Input id="mail-user" v-model="smtpUser" :disabled="!manage" autocomplete="off" data-testid="mail-smtp-user" />
                </Field>
                <Field :data-invalid="!!form.errors.secret">
                  <FieldLabel for="mail-secret">Contraseña</FieldLabel>
                  <Input id="mail-secret" v-model="secret" type="password" :disabled="!manage" autocomplete="new-password" :placeholder="storedSecret ? `Guardada (${storedSecret}); escribe para cambiarla` : 'Sin contraseña'" data-testid="mail-secret" />
                  <FieldError :errors="[form.errors.secret]" />
                </Field>
              </div>
              <label class="flex items-center gap-3 text-sm">
                <Switch v-model="form.values.smtpSecure" :disabled="!manage" data-testid="mail-smtp-secure" />
                Cifrar desde el inicio (SSL/TLS, normalmente puerto 465)
              </label>
            </template>

            <template v-else-if="provider.secretLabel">
              <Field :data-invalid="!!form.errors.secret">
                <FieldLabel for="mail-secret"><KeyRound class="size-4" /> {{ provider.secretLabel }}</FieldLabel>
                <Input
                  id="mail-secret"
                  v-model="secret"
                  type="password"
                  :disabled="!manage"
                  autocomplete="new-password"
                  :placeholder="storedSecret ? `Guardada (${storedSecret}); escribe para reemplazarla` : provider.secretPlaceholder"
                  data-testid="mail-secret"
                />
                <FieldDescription>
                  {{ provider.help }}
                  <a v-if="provider.url" :href="provider.url" target="_blank" rel="noopener" class="inline-flex items-center gap-1 underline">Abrir <ExternalLink class="size-3" /></a>
                </FieldDescription>
                <FieldError :errors="[form.errors.secret]" />
              </Field>
              <div v-if="form.values.transport === 'mailgun'" class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <Field :data-invalid="!!form.errors.mailgunDomain">
                  <FieldLabel for="mail-mg-domain">Dominio de envío</FieldLabel>
                  <Input id="mail-mg-domain" v-model="mailgunDomain" :disabled="!manage" placeholder="mg.tudominio.cl" data-testid="mail-mailgun-domain" />
                  <FieldError :errors="[form.errors.mailgunDomain]" />
                </Field>
                <Field>
                  <FieldLabel for="mail-mg-region">Región</FieldLabel>
                  <Select v-model="form.values.mailgunRegion" :disabled="!manage">
                    <SelectTrigger id="mail-mg-region"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="us">EE. UU.</SelectItem><SelectItem value="eu">Unión Europea</SelectItem></SelectContent>
                  </Select>
                </Field>
              </div>
            </template>
            <p v-else class="text-muted-foreground text-sm">{{ provider.help }}</p>

            <AppAlert v-if="result" :variant="result.ok ? 'success' : 'destructive'" :title="result.title" :description="result.detail ?? undefined" data-testid="mail-result" />
            <AppAlert v-if="form.formError.value" variant="destructive" :description="form.formError.value" />

            <div v-if="manage" class="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" :disabled="!!busy || form.submitting.value" data-testid="mail-check" @click="check">
                <Spinner v-if="busy === 'check'" /><PlugZap v-else class="size-4" /> Comprobar conexión
              </Button>
              <Button type="button" variant="outline" :disabled="!!busy || form.submitting.value" data-testid="mail-test-open" @click="openTest"><Send class="size-4" /> Enviar prueba</Button>
              <Button type="submit" :disabled="!!busy || form.submitting.value" data-testid="mail-save">
                <Spinner v-if="form.submitting.value" /><Save v-else class="size-4" /> Guardar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div class="space-y-4">
        <Card>
          <CardHeader><CardTitle class="text-base">Cómo funciona</CardTitle></CardHeader>
          <CardContent class="text-muted-foreground space-y-3 text-sm">
            <p><strong class="text-foreground">Prueba antes de guardar.</strong> «Comprobar conexión» valida la clave sin enviar; «Enviar prueba» manda un correo real con los datos del formulario.</p>
            <p><strong class="text-foreground">Claves seguras.</strong> Se cifran con <code>APP_ENCRYPTION_KEY</code>; la pantalla solo muestra una pista.</p>
            <p><strong class="text-foreground">Respaldo.</strong> Sin configuración guardada se usan las variables <code>MAIL_*</code> del despliegue.</p>
            <p>
              Contenido de los correos en
              <NuxtLink to="/admin/mail/templates" class="text-foreground underline">Plantillas</NuxtLink>; envíos automáticos en
              <NuxtLink to="/admin/mail/automations" class="text-foreground underline">Automatizaciones</NuxtLink>.
            </p>
          </CardContent>
        </Card>
        <Card v-if="data.source === 'database'">
          <CardHeader>
            <CardTitle class="text-base">Configuración guardada</CardTitle>
            <CardDescription>Versión {{ data.version }}<template v-if="data.updatedAt"> · <RelativeTime :value="data.updatedAt" /></template></CardDescription>
          </CardHeader>
          <CardContent class="space-y-3 text-sm">
            <div class="flex items-center gap-2"><Mail class="text-muted-foreground size-4" /> {{ MAIL_PROVIDERS[data.transport]?.name }} <Badge v-if="data.hasSecret" variant="secondary">clave {{ data.secretHint }}</Badge></div>
            <Button v-if="manage" variant="outline" size="sm" :disabled="!!busy" data-testid="mail-reset" @click="resetToEnv">
              <Spinner v-if="busy === 'reset'" /><RotateCcw v-else class="size-4" /> Volver a variables de entorno
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  </template>

  <FormDialog v-model:open="testOpen" title="Enviar correo de prueba" description="Se envía con los datos del formulario (aunque no los hayas guardado)." submit-label="Enviar" :loading="busy === 'test'" testid="mail-test" @submit="sendTest">
    <Field>
      <FieldLabel for="mail-test-to">Enviar a</FieldLabel>
      <Input id="mail-test-to" v-model="testTo" type="email" required data-testid="mail-test-to" />
    </Field>
  </FormDialog>
</template>
