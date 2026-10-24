<script setup lang="ts">
import { z } from 'zod';
import { Input } from '#ui/components/ui/input';
import { Button } from '#ui/components/ui/button';
import type { FormFieldDef } from '#ui/lib/kit';
import CatalogExample from './CatalogExample.vue';

/** Forms: schema-driven fields, single fields, sections with actions and modal forms. */
const notify = useNotify();

// ── FormFields: every field type bound to one Zod schema ────────────────
const Customer = z.object({
  name: z.string().trim().min(2, 'Mínimo 2 caracteres'),
  email: z.email('Correo inválido'),
  phone: z.union([z.literal(''), z.string().regex(/^\+?[0-9 ]{8,15}$/, 'Teléfono inválido')]),
  plan: z.enum(['basic', 'pro', 'enterprise'], { error: 'Elige un plan' }),
  seats: z.number({ error: 'Ingresa un número' }).int('Sin decimales').min(1, 'Al menos 1').max(500, 'Máximo 500'),
  budget: z.number().min(0, 'No puede ser negativo').optional(),
  billing: z.enum(['monthly', 'yearly']),
  channels: z.array(z.string()).min(1, 'Elige al menos un canal'),
  tags: z.array(z.string()).max(5, 'Máximo 5 etiquetas'),
  startDate: z.string().min(1, 'Elige una fecha'),
  discount: z.number().min(0).max(50),
  notes: z.string().max(500, 'Máximo 500 caracteres').optional(),
  active: z.boolean(),
  terms: z.boolean().refine((v) => v, 'Debes aceptar los términos'),
});
const form = useZodForm(Customer, {
  name: '',
  email: '',
  phone: '',
  plan: 'basic',
  seats: 5,
  budget: undefined,
  billing: 'monthly',
  channels: [],
  tags: ['pyme'],
  startDate: '',
  discount: 10,
  notes: '',
  active: true,
  terms: false,
});
const fields: FormFieldDef[] = [
  { name: 'name', label: 'Nombre', required: true, placeholder: 'Comercial Andes SpA', testid: 'demo-name' },
  { name: 'email', label: 'Correo', type: 'email', required: true, autocomplete: 'email', testid: 'demo-email' },
  { name: 'phone', label: 'Teléfono', type: 'tel', placeholder: '+56 9 1234 5678', description: 'Opcional.' },
  {
    name: 'plan',
    label: 'Plan',
    type: 'select',
    required: true,
    options: [
      { value: 'basic', label: 'Básico' },
      { value: 'pro', label: 'Profesional' },
      { value: 'enterprise', label: 'Empresa' },
    ],
  },
  { name: 'seats', label: 'Usuarios', type: 'number', min: 1, max: 500, required: true },
  { name: 'budget', label: 'Presupuesto mensual', type: 'number', prefix: 'US$', min: 0, step: 0.01, placeholder: '0,00' },
  {
    name: 'billing',
    label: 'Facturación',
    type: 'radio',
    options: [
      { value: 'monthly', label: 'Mensual', description: 'Se cobra cada mes.' },
      { value: 'yearly', label: 'Anual', description: 'Dos meses de descuento.' },
    ],
  },
  {
    name: 'channels',
    label: 'Canales de contacto',
    type: 'checkbox',
    required: true,
    options: [
      { value: 'mail', label: 'Correo' },
      { value: 'phone', label: 'Teléfono' },
      { value: 'chat', label: 'Chat' },
    ],
  },
  { name: 'tags', label: 'Etiquetas', type: 'tags', description: 'Hasta 5.' },
  { name: 'startDate', label: 'Inicio del contrato', type: 'date', required: true },
  { name: 'discount', label: 'Descuento', type: 'slider', min: 0, max: 50, step: 5, suffix: ' %' },
  { name: 'notes', label: 'Notas', type: 'textarea', rows: 3, span: 'full' },
  { name: 'active', label: 'Cliente activo', type: 'switch', description: 'Puede ingresar y recibir correos.' },
  { name: 'terms', label: 'Acepto los términos del servicio', type: 'checkbox' },
];
const submit = form.handleSubmit(async (v) => {
  await new Promise((r) => setTimeout(r, 600));
  notify.success(`Cliente «${v.name}» válido`, { description: `${v.seats} usuarios · plan ${v.plan}` });
});
function simulateServerError() {
  form.applyServerError({ error: { code: 'VALIDATION_FAILED', message: 'Revisa los campos marcados', details: [{ path: 'email', message: 'Ese correo ya está registrado' }] } });
}
const fieldsCode = `const Customer = z.object({ name: z.string().min(2), email: z.email(), plan: z.enum(['basic', 'pro']), active: z.boolean() });
const form = useZodForm(Customer, { name: '', email: '', plan: 'basic', active: true });
const fields: FormFieldDef[] = [
  { name: 'name', label: 'Nombre', required: true },
  { name: 'email', label: 'Correo', type: 'email', required: true },
  { name: 'plan', label: 'Plan', type: 'select', options: [{ value: 'basic', label: 'Básico' }, { value: 'pro', label: 'Profesional' }] },
  { name: 'active', label: 'Activo', type: 'switch', description: 'Puede ingresar' },
];
const submit = form.handleSubmit(async (values) => { await customersCreate({ client: api, body: values }); notify.success('Cliente creado'); });

<form novalidate @submit="submit">
  <FormFields :form="form" :fields="fields" :columns="2" />
  <FormActions :loading="form.submitting.value" :error="form.formError.value" />
</form>

// Tipos: text, email, password, url, tel, number, textarea, select, radio, checkbox (uno o lista),
// switch, date, tags, slider. Opciones: required, description, placeholder, span, prefix/suffix,
// min/max/step, rows, disabled, testid. Slot #field-<name> para un control propio.`;

// ── FormField: a single field with your own control ─────────────────────
const single = useZodForm(z.object({ code: z.string().regex(/^[A-Z]{3}-\d{3}$/, 'Formato AAA-000') }), { code: '' });
const singleCode = `<FormField label="Código interno" description="Formato AAA-000" :error="form.errors.code" required v-slot="field">
  <Input v-bind="field" v-model="form.values.code" @blur="form.validateField('code')" />
</FormField>`;

// ── FormSection + FormActions ───────────────────────────────────────────
const billing = useZodForm(z.object({ legalName: z.string().min(2, 'Mínimo 2 caracteres'), rut: z.string().regex(/^\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]$/, 'RUT inválido'), address: z.string().min(5, 'Dirección incompleta') }), {
  legalName: 'Comercial Andes SpA',
  rut: '76.123.456-7',
  address: '',
});
const billingFields: FormFieldDef[] = [
  { name: 'legalName', label: 'Razón social', required: true },
  { name: 'rut', label: 'RUT', required: true, placeholder: '76.123.456-7' },
  { name: 'address', label: 'Dirección', span: 'full', required: true },
];
const saveBilling = billing.handleSubmit(async () => {
  await new Promise((r) => setTimeout(r, 500));
  notify.success('Datos de facturación guardados');
});
const sectionCode = `<form novalidate @submit="save">
  <FormSection title="Datos de facturación" description="Aparecen en las boletas y facturas.">
    <FormFields :form="form" :fields="billingFields" :columns="2" />
    <template #footer>
      <FormActions :loading="form.submitting.value" :error="form.formError.value" cancel-label="Descartar" @cancel="form.reset()" />
    </template>
  </FormSection>
</form>`;

// ── FormDialog ───────────────────────────────────────────────────────────
const dialogOpen = ref(false);
const dialogVariant = ref<'dialog' | 'sheet'>('dialog');
const contact = useZodForm(z.object({ fullName: z.string().min(2, 'Mínimo 2 caracteres'), role: z.string().min(2, 'Indica el cargo') }), { fullName: '', role: '' });
const contactFields: FormFieldDef[] = [
  { name: 'fullName', label: 'Nombre completo', required: true, testid: 'contact-name' },
  { name: 'role', label: 'Cargo', required: true },
];
function openDialog(variant: 'dialog' | 'sheet') {
  contact.reset();
  dialogVariant.value = variant;
  dialogOpen.value = true;
}
const saveContact = contact.handleSubmit(async (v) => {
  await new Promise((r) => setTimeout(r, 500));
  dialogOpen.value = false;
  notify.success(`Contacto «${v.fullName}» agregado`);
});
const dialogCode = `<FormDialog v-model:open="open" title="Nuevo contacto" submit-label="Agregar" variant="dialog | sheet"
  :loading="form.submitting.value" :error="form.formError.value" testid="contact-form" @submit="save">
  <FormFields :form="form" :fields="fields" />
</FormDialog>`;
</script>

<template>
  <div class="grid gap-6">
    <CatalogExample id="form-fields" title="FormFields" description="Formulario completo desde una lista de campos y el mismo esquema Zod de la API. Valida al salir de cada campo y al corregir; los errores del servidor vuelven a cada campo." :code="fieldsCode">
      <form class="space-y-6" novalidate data-testid="demo-form" @submit="submit">
        <FormFields :form="form" :fields="fields" :columns="2" id-prefix="demo" />
        <FormActions :loading="form.submitting.value" :error="form.formError.value" submit-label="Validar" cancel-label="Reiniciar" testid="demo-form" @cancel="form.reset()">
          <Button type="button" variant="ghost" class="sm:mr-auto" @click="simulateServerError">Simular error del servidor</Button>
        </FormActions>
      </form>
    </CatalogExample>

    <div class="grid gap-6 lg:grid-cols-2">
      <CatalogExample title="FormField" description="Un campo con su etiqueta, ayuda y error, para controles propios. El slot recibe id y atributos de accesibilidad." :code="singleCode">
        <FormField v-slot="field" label="Código interno" description="Formato AAA-000" :error="single.errors.code" required>
          <Input v-bind="field" v-model="single.values.code" placeholder="ABC-123" @blur="single.validateField('code')" />
        </FormField>
      </CatalogExample>

      <CatalogExample title="FormDialog" description="Formulario en un modal o en un panel lateral, con Cancelar/Guardar, carga y error general." :code="dialogCode">
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" data-testid="open-form-dialog" @click="openDialog('dialog')">Abrir en diálogo</Button>
          <Button variant="outline" @click="openDialog('sheet')">Abrir en panel lateral</Button>
        </div>
        <FormDialog v-model:open="dialogOpen" title="Nuevo contacto" description="Se agrega a la lista de contactos del cliente." submit-label="Agregar" :variant="dialogVariant" :loading="contact.submitting.value" :error="contact.formError.value" testid="contact-form" @submit="saveContact">
          <FormFields :form="contact" :fields="contactFields" id-prefix="contact" />
        </FormDialog>
      </CatalogExample>
    </div>

    <CatalogExample title="FormSection + FormActions" description="Bloques de formularios largos y páginas de configuración: título a la izquierda, campos en tarjeta, acciones abajo." :code="sectionCode">
      <form novalidate @submit="saveBilling">
        <FormSection title="Datos de facturación" description="Aparecen en las boletas y facturas.">
          <FormFields :form="billing" :fields="billingFields" :columns="2" id-prefix="billing" />
          <template #footer>
            <FormActions :loading="billing.submitting.value" :error="billing.formError.value" cancel-label="Descartar" @cancel="billing.reset()" />
          </template>
        </FormSection>
      </form>
    </CatalogExample>
  </div>
</template>
