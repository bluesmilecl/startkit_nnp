<script setup lang="ts">
import { z } from 'zod';
import { formatUsd } from '#ui/lib/format';
import type { FormFieldDef, WizardStep } from '#ui/lib/kit';
import CatalogExample from './CatalogExample.vue';

/** Wizard: one Zod schema split into steps, a step that "saves" before moving on, and a summary. */
const notify = useNotify();
const Onboarding = z.object({
  company: z.string().trim().min(2, 'Mínimo 2 caracteres'),
  contactEmail: z.email('Correo inválido'),
  plan: z.enum(['basic', 'pro', 'enterprise'], { error: 'Elige un plan' }),
  seats: z.number({ error: 'Ingresa un número' }).int().min(1, 'Al menos 1'),
  notifications: z.boolean(),
  channels: z.array(z.string()).min(1, 'Elige al menos un canal'),
});
const form = useZodForm(Onboarding, { company: '', contactEmail: '', plan: 'pro', seats: 10, notifications: true, channels: ['mail'] });
const PRICES = { basic: 9, pro: 19, enterprise: 39 } as const;

const steps: WizardStep[] = [
  { id: 'company', title: 'Empresa', description: 'Con quién firmamos el contrato.', fields: ['company', 'contactEmail'], icon: 'organization' },
  { id: 'plan', title: 'Plan', description: 'Se puede cambiar después.', fields: ['plan', 'seats'], icon: 'payment' },
  { id: 'notifications', title: 'Avisos', description: 'Este paso se guarda al continuar.', fields: ['notifications', 'channels'], icon: 'notification' },
  { id: 'summary', title: 'Resumen', description: 'Revisa antes de confirmar.', icon: 'check' },
];
const fields: Record<string, FormFieldDef[]> = {
  company: [
    { name: 'company', label: 'Razón social', required: true, testid: 'wz-company' },
    { name: 'contactEmail', label: 'Correo de contacto', type: 'email', required: true, testid: 'wz-email' },
  ],
  plan: [
    {
      name: 'plan',
      label: 'Plan',
      type: 'radio',
      options: [
        { value: 'basic', label: 'Básico', description: 'US$ 9 por usuario al mes' },
        { value: 'pro', label: 'Profesional', description: 'US$ 19 por usuario al mes' },
        { value: 'enterprise', label: 'Empresa', description: 'US$ 39 por usuario al mes' },
      ],
    },
    { name: 'seats', label: 'Usuarios', type: 'number', min: 1, required: true },
  ],
  notifications: [
    { name: 'notifications', label: 'Enviar avisos', type: 'switch', description: 'Resúmenes y alertas de presupuesto.' },
    {
      name: 'channels',
      label: 'Canales',
      type: 'checkbox',
      options: [
        { value: 'mail', label: 'Correo' },
        { value: 'chat', label: 'Chat interno' },
      ],
    },
  ],
};
const monthly = computed(() => formatUsd(String(PRICES[form.values.plan as keyof typeof PRICES] * Number(form.values.seats || 0)), 2));

// A step can save before moving on; returning false (or throwing) keeps the person on it.
async function beforeNext(step: WizardStep) {
  if (step.id !== 'notifications') return;
  await new Promise((r) => setTimeout(r, 500));
  notify.info('Preferencias de aviso guardadas');
}
const step = ref(0);
const submit = form.handleSubmit(async (v) => {
  await new Promise((r) => setTimeout(r, 600));
  notify.success(`Alta de «${v.company}» completada`);
  form.reset();
  step.value = 0;
});

const code = `const form = useZodForm(Onboarding, { company: '', contactEmail: '', plan: 'pro', seats: 10 });
const steps: WizardStep[] = [
  { id: 'company', title: 'Empresa', fields: ['company', 'contactEmail'], icon: 'organization' },
  { id: 'plan', title: 'Plan', fields: ['plan', 'seats'] },
  { id: 'summary', title: 'Resumen' },
];
const submit = form.handleSubmit(async (values) => { await create(values); });
// Opcional: guardar un paso antes de avanzar (false o un error lo detienen)
const beforeNext = async (step: WizardStep) => { if (step.id === 'plan') await savePlan(); };

<FormWizard v-model:step="step" :steps="steps" :form="form" :before-next="beforeNext"
  :loading="form.submitting.value" submit-label="Confirmar alta" @complete="submit">
  <template #step-company><FormFields :form="form" :fields="companyFields" /></template>
  <template #step-plan><FormFields :form="form" :fields="planFields" :columns="2" /></template>
  <template #step-summary>…resumen con form.values…</template>
</FormWizard>

// Lógica sola (sin el componente): useWizard(steps, { validate: form.validateFields, beforeNext, onComplete })`;
</script>

<template>
  <CatalogExample
    title="FormWizard"
    description="Asistente por pasos: cada paso valida solo sus campos con el esquema Zod, puede guardar antes de avanzar y al final valida todo (si algo falla vuelve al paso que corresponde). En teléfonos muestra «Paso n de N» con barra de progreso."
    :code="code"
  >
    <FormWizard v-model:step="step" :steps="steps" :form="form" :before-next="beforeNext" :loading="form.submitting.value" submit-label="Confirmar alta" testid="demo-wizard" @complete="submit">
      <template #step-company><FormFields :form="form" :fields="fields.company!" id-prefix="wz" /></template>
      <template #step-plan><FormFields :form="form" :fields="fields.plan!" :columns="2" id-prefix="wz" /></template>
      <template #step-notifications><FormFields :form="form" :fields="fields.notifications!" id-prefix="wz" /></template>
      <template #step-summary>
        <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]" data-testid="wz-summary">
          <dt class="text-muted-foreground">Empresa</dt><dd>{{ form.values.company }}</dd>
          <dt class="text-muted-foreground">Contacto</dt><dd>{{ form.values.contactEmail }}</dd>
          <dt class="text-muted-foreground">Plan</dt><dd>{{ form.values.plan }} · {{ form.values.seats }} usuarios</dd>
          <dt class="text-muted-foreground">Costo mensual</dt><dd class="tabular-nums">{{ monthly }}</dd>
          <dt class="text-muted-foreground">Avisos</dt><dd>{{ form.values.notifications ? (form.values.channels as string[]).join(', ') : 'No' }}</dd>
        </dl>
      </template>
    </FormWizard>
  </CatalogExample>
</template>
