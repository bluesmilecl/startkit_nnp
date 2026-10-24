<script setup lang="ts">
import { adminOnboardingComplete, adminSettingsGet, adminSettingsUpdate, meUpdate } from '@starter/api-client';
import { Check } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Input } from '#ui/components/ui/input';
import { Field, FieldDescription, FieldLabel } from '#ui/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Progress } from '#ui/components/ui/progress';

definePageMeta({ layout: 'auth' });
useHead({ title: 'Configuración inicial' });
const api = useApi();
const me = useMe();
const { data: settings } = await useAsyncData('onboarding-settings', () => unwrap(adminSettingsGet({ client: api })));
const step = ref(0);
const steps = ['Tu perfil', 'Marca', 'Acceso', 'Listo'];
const name = ref(me.value?.user.name ?? '');
const appName = ref(settings.value?.branding.appName ?? 'Starter Kit');
const color = ref(settings.value?.branding.primaryColor ?? '#2563eb');
const timezone = ref(settings.value?.locale.timezone ?? 'America/Santiago');
const registration = ref(settings.value?.auth.registration ?? 'invite-only');
const busy = ref(false);

async function next() {
  busy.value = true;
  try {
    if (step.value === 0) await meUpdate({ client: api, body: { name: name.value.trim() || undefined } });
    if (step.value === 1) {
      await adminSettingsUpdate({ client: api, body: { branding: { appName: appName.value, primaryColor: color.value }, locale: { timezone: timezone.value } } });
      await loadBranding();
    }
    if (step.value === 2) await adminSettingsUpdate({ client: api, body: { auth: { registration: registration.value } } });
    if (step.value === 3) {
      await adminOnboardingComplete({ client: api });
      await refreshMe();
      await navigateTo('/admin');
      return;
    }
    step.value++;
  } catch (err) {
    toast.error(apiError(err).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Card class="w-full" data-testid="onboarding">
    <CardHeader>
      <CardTitle>Configuración inicial</CardTitle>
      <CardDescription>Paso {{ step + 1 }} de {{ steps.length }}: {{ steps[step] }}</CardDescription>
      <Progress :model-value="((step + 1) / steps.length) * 100" class="mt-2" />
    </CardHeader>
    <CardContent class="space-y-4">
      <template v-if="step === 0">
        <Field><FieldLabel for="ob-name">¿Cómo te llamas?</FieldLabel><Input id="ob-name" v-model="name" autocomplete="name" data-testid="onboarding-name" /></Field>
      </template>
      <template v-else-if="step === 1">
        <Field><FieldLabel for="ob-app">Nombre de la aplicación</FieldLabel><Input id="ob-app" v-model="appName" data-testid="onboarding-app-name" /></Field>
        <Field><FieldLabel for="ob-color">Color principal</FieldLabel><div class="flex gap-2"><Input id="ob-color" v-model="color" /><input v-model="color" type="color" aria-label="Selector de color" class="h-9 w-12 rounded border" /></div></Field>
        <Field><FieldLabel for="ob-tz">Zona horaria</FieldLabel><Input id="ob-tz" v-model="timezone" /></Field>
      </template>
      <template v-else-if="step === 2">
        <Field>
          <FieldLabel for="ob-reg">¿Quién puede crear una cuenta?</FieldLabel>
          <Select v-model="registration"><SelectTrigger id="ob-reg"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="invite-only">Solo personas invitadas</SelectItem><SelectItem value="open">Cualquiera con correo (rol Lector)</SelectItem><SelectItem value="disabled">Nadie (solo administradores crean cuentas)</SelectItem></SelectContent></Select>
          <FieldDescription>Puedes cambiarlo después en Configuración.</FieldDescription>
        </Field>
      </template>
      <template v-else>
        <ul class="space-y-2 text-sm">
          <li class="flex gap-2"><Check class="size-4 text-green-600" /> Perfil y marca configurados</li>
          <li class="flex gap-2"><Check class="size-4 text-green-600" /> Política de acceso definida</li>
          <li class="text-muted-foreground">Siguiente: conecta un proveedor IA en <strong>Inteligencia artificial → Conexiones</strong> y prueba el asistente flotante.</li>
        </ul>
      </template>
    </CardContent>
    <CardFooter class="justify-between">
      <Button variant="ghost" :disabled="step === 0 || busy" @click="step--">Atrás</Button>
      <Button :disabled="busy" data-testid="onboarding-next" @click="next">{{ step === steps.length - 1 ? 'Ir al panel' : 'Continuar' }}</Button>
    </CardFooter>
  </Card>
</template>
