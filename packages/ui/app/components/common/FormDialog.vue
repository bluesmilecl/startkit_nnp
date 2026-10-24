<script setup lang="ts">
import { useId } from 'vue';
import { Button } from '#ui/components/ui/button';
import AppModal from './AppModal.vue';
import AppAlert from './AppAlert.vue';

/**
 * Modal form: header, fields (default slot), form-level error and Cancel / Submit. The submit
 * button lives in the footer and targets the form by id, so Enter in any field also submits.
 * Pair it with useZodForm (`@submit="submit"` where `submit = form.handleSubmit(...)`).
 *
 *   <FormDialog v-model:open="open" title="Nuevo proyecto" submit-label="Crear proyecto"
 *     :loading="form.submitting.value" :error="form.formError.value" @submit="submit">
 *     <FormFields :form="form" :fields="fields" />
 *   </FormDialog>
 *
 * `testid` prefixes the form (`<testid>`), the submit button (`<testid>-submit`) and the error
 * (`<testid>-error`).
 */
const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    submitLabel?: string;
    cancelLabel?: string;
    loading?: boolean;
    disabled?: boolean;
    error?: string | null;
    destructive?: boolean;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    variant?: 'dialog' | 'sheet';
    testid?: string;
  }>(),
  { submitLabel: 'Guardar', cancelLabel: 'Cancelar', loading: false, disabled: false, error: null, destructive: false, size: 'md', variant: 'dialog' },
);
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ submit: [Event] }>();
const formId = props.testid ?? `form-${useId()}`;
</script>

<template>
  <AppModal v-model:open="open" :title="title" :description="description" :size="size" :variant="variant">
    <form :id="formId" class="space-y-4 pt-1" novalidate :data-testid="testid" @submit.prevent="emit('submit', $event)">
      <slot />
      <AppAlert v-if="error" variant="destructive" :description="error" :data-testid="testid ? `${testid}-error` : undefined" />
    </form>
    <template #footer>
      <slot name="footer-start" />
      <Button type="button" variant="outline" :disabled="loading" @click="open = false">{{ cancelLabel }}</Button>
      <Button type="submit" :form="formId" :variant="destructive ? 'destructive' : 'default'" :loading="loading" :disabled="disabled" :data-testid="testid ? `${testid}-submit` : undefined">{{ submitLabel }}</Button>
    </template>
  </AppModal>
</template>
