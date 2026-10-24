<script setup lang="ts">
import { adminSettingsGet, adminSettingsUpdate, type AppSettings } from '@starter/api-client';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Input } from '#ui/components/ui/input';
import { Switch } from '#ui/components/ui/switch';
import { Label } from '#ui/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#ui/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Field, FieldDescription, FieldLabel } from '#ui/components/ui/field';
import { Badge } from '#ui/components/ui/badge';

definePageMeta({ permission: 'settings.read' });
useHead({ title: 'Configuración' });
const api = useApi();
const notify = useNotify();
const can = useCan();
const readonly = computed(() => !can('settings.update'));
const { data } = await useAsyncData('settings', () => unwrap(adminSettingsGet({ client: api })));
const EMPTY: AppSettings = {
  branding: { appName: '', logoUrl: null, primaryColor: '#2563eb', supportEmail: null },
  locale: { locale: 'es-CL', timezone: 'UTC', currencyDisplay: 'USD' },
  auth: { registration: 'invite-only', sessionExpiresDays: 7 },
  mail: { transport: 'smtp', from: '', configured: false },
  retention: { conversationsDays: null, retrievalQueriesDays: null, audioKeepAfterTranscription: false, auditDays: null },
  onboardingCompletedAt: null,
};
const draft = ref<AppSettings>(structuredClone(EMPTY));
watch(data, (d) => (draft.value = structuredClone(toRaw(d ?? EMPTY))), { immediate: true });
const saving = ref(false);
async function save(section: 'branding' | 'locale' | 'auth' | 'retention') {
  saving.value = true;
  try {
    data.value = await unwrap(adminSettingsUpdate({ client: api, body: { [section]: draft.value[section] } }));
    toast.success('Configuración guardada');
    if (section === 'branding' || section === 'auth') await loadBranding();
  } catch (err) {
    notify.error(err);
  } finally {
    saving.value = false;
  }
}
function setNullable<S extends 'branding' | 'retention'>(section: S, key: string, value: unknown, numeric = false) {
  const v = value === '' || value === undefined ? null : numeric ? Number(value) : String(value);
  (draft.value[section] as Record<string, unknown>)[key] = v;
}
const timezones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['America/Santiago', 'UTC'];
</script>

<template>
  <PageHeader title="Configuración" description="Marca, idioma, acceso y retención de la instalación." />
  <Tabs v-if="data" default-value="branding" class="w-full">
    <TabsList class="flex-wrap">
      <TabsTrigger value="branding">Marca</TabsTrigger>
      <TabsTrigger value="locale">Idioma y zona horaria</TabsTrigger>
      <TabsTrigger value="auth">Acceso</TabsTrigger>
      <TabsTrigger value="mail">Correo</TabsTrigger>
      <TabsTrigger value="retention">Retención</TabsTrigger>
    </TabsList>
    <TabsContent value="branding">
      <Card>
        <CardHeader><CardTitle>Marca</CardTitle><CardDescription>Nombre, logotipo y color principal visibles en el acceso, el panel y los correos.</CardDescription></CardHeader>
        <CardContent class="grid gap-4 sm:grid-cols-2">
          <Field><FieldLabel for="b-name">Nombre de la aplicación</FieldLabel><Input id="b-name" v-model="draft.branding.appName" :disabled="readonly" data-testid="settings-app-name" /></Field>
          <Field><FieldLabel for="b-color">Color principal</FieldLabel><div class="flex gap-2"><Input id="b-color" v-model="draft.branding.primaryColor" :disabled="readonly" /><input v-model="draft.branding.primaryColor" type="color" aria-label="Selector de color" class="h-9 w-12 rounded border" :disabled="readonly" /></div></Field>
          <Field><FieldLabel for="b-logo">URL del logotipo</FieldLabel><Input id="b-logo" :model-value="draft.branding.logoUrl ?? ''" placeholder="https://…" :disabled="readonly" @update:model-value="setNullable('branding', 'logoUrl', $event)" /></Field>
          <Field><FieldLabel for="b-support">Correo de soporte</FieldLabel><Input id="b-support" :model-value="draft.branding.supportEmail ?? ''" :disabled="readonly" @update:model-value="setNullable('branding', 'supportEmail', $event)" /></Field>
          <div v-if="!readonly" class="sm:col-span-2"><Button :disabled="saving" data-testid="settings-save-branding" @click="save('branding')">Guardar</Button></div>
        </CardContent>
      </Card>
    </TabsContent>
    <TabsContent value="locale">
      <Card>
        <CardHeader><CardTitle>Idioma y zona horaria</CardTitle></CardHeader>
        <CardContent class="grid gap-4 sm:grid-cols-3">
          <Field><FieldLabel for="l-locale">Idioma</FieldLabel>
            <Select v-model="draft.locale.locale" :disabled="readonly"><SelectTrigger id="l-locale"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="es-CL">Español (Chile)</SelectItem><SelectItem value="es-ES">Español (España)</SelectItem><SelectItem value="es-MX">Español (México)</SelectItem><SelectItem value="en-US">English (US)</SelectItem></SelectContent></Select>
          </Field>
          <Field><FieldLabel for="l-tz">Zona horaria</FieldLabel>
            <Select v-model="draft.locale.timezone" :disabled="readonly"><SelectTrigger id="l-tz"><SelectValue /></SelectTrigger><SelectContent class="max-h-72"><SelectItem v-for="tz in timezones" :key="tz" :value="tz">{{ tz }}</SelectItem></SelectContent></Select>
          </Field>
          <Field><FieldLabel for="l-cur">Moneda de visualización</FieldLabel>
            <Select v-model="draft.locale.currencyDisplay" :disabled="readonly"><SelectTrigger id="l-cur"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="USD">USD (registro original)</SelectItem><SelectItem value="CLP">CLP (conversión visual)</SelectItem></SelectContent></Select>
            <FieldDescription>Los costos se registran siempre en USD.</FieldDescription>
          </Field>
          <div v-if="!readonly" class="sm:col-span-3"><Button :disabled="saving" @click="save('locale')">Guardar</Button></div>
        </CardContent>
      </Card>
    </TabsContent>
    <TabsContent value="auth">
      <Card>
        <CardHeader><CardTitle>Acceso</CardTitle><CardDescription>Ingreso por código de un solo uso enviado al correo.</CardDescription></CardHeader>
        <CardContent class="grid gap-4 sm:grid-cols-2">
          <Field><FieldLabel for="a-reg">Registro</FieldLabel>
            <Select v-model="draft.auth.registration" :disabled="readonly"><SelectTrigger id="a-reg" data-testid="settings-registration"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="invite-only">Solo por invitación</SelectItem><SelectItem value="open">Abierto</SelectItem><SelectItem value="disabled">Deshabilitado</SelectItem></SelectContent></Select>
            <FieldDescription>Abierto asigna el rol Lector a las cuentas nuevas.</FieldDescription>
          </Field>
          <Field><FieldLabel for="a-days">Duración de sesión (días)</FieldLabel><Input id="a-days" v-model.number="draft.auth.sessionExpiresDays" type="number" min="1" max="365" :disabled="readonly" /><FieldDescription>Aplica a sesiones nuevas tras reiniciar la API.</FieldDescription></Field>
          <div v-if="!readonly" class="sm:col-span-2"><Button :disabled="saving" @click="save('auth')">Guardar</Button></div>
        </CardContent>
      </Card>
    </TabsContent>
    <TabsContent value="mail">
      <Card>
        <CardHeader><CardTitle>Correo</CardTitle><CardDescription>El proveedor y sus credenciales se configuran en el despliegue (variables MAIL_*, o <code>pnpm starter mail use resend</code>), nunca en la base de datos.</CardDescription></CardHeader>
        <CardContent class="space-y-2 text-sm">
          <div>Transporte: <Badge variant="secondary">{{ draft.mail.transport }}</Badge></div>
          <p>Remitente: <code>{{ draft.mail.from }}</code></p>
          <p>Estado: <StatusBadge :status="draft.mail.configured ? 'ok' : 'degraded'" /></p>
        </CardContent>
      </Card>
    </TabsContent>
    <TabsContent value="retention">
      <Card>
        <CardHeader><CardTitle>Retención</CardTitle><CardDescription>Datos sin plazo se conservan hasta su eliminación manual.</CardDescription></CardHeader>
        <CardContent class="grid gap-4 sm:grid-cols-2">
          <Field><FieldLabel for="r-conv">Conversaciones (días)</FieldLabel><Input id="r-conv" :model-value="draft.retention.conversationsDays ?? ''" type="number" min="1" placeholder="Sin límite" :disabled="readonly" @update:model-value="setNullable('retention', 'conversationsDays', $event, true)" /></Field>
          <Field><FieldLabel for="r-q">Consultas RAG (días)</FieldLabel><Input id="r-q" :model-value="draft.retention.retrievalQueriesDays ?? ''" type="number" min="1" placeholder="Sin límite" :disabled="readonly" @update:model-value="setNullable('retention', 'retrievalQueriesDays', $event, true)" /></Field>
          <Field><FieldLabel for="r-audit">Auditoría (días)</FieldLabel><Input id="r-audit" :model-value="draft.retention.auditDays ?? ''" type="number" min="30" placeholder="Sin límite" :disabled="readonly" @update:model-value="setNullable('retention', 'auditDays', $event, true)" /></Field>
          <div class="flex items-center gap-2 self-end pb-2"><Switch id="r-audio" v-model="draft.retention.audioKeepAfterTranscription" :disabled="readonly" /><Label for="r-audio">Conservar audio tras transcribir</Label></div>
          <div v-if="!readonly" class="sm:col-span-2"><Button :disabled="saving" @click="save('retention')">Guardar</Button></div>
        </CardContent>
      </Card>
    </TabsContent>
  </Tabs>
</template>
