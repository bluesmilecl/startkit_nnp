<script setup lang="ts">
import { Button } from '#ui/components/ui/button';
import AppAlert from './AppAlert.vue';

/**
 * Form footer: optional form-level error, extra buttons (default slot) and Cancel / Submit.
 * Inside a <form> the submit button submits it; outside, pass `form` with the form id.
 *
 *   <form novalidate @submit="submit">
 *     <FormFields :form="form" :fields="fields" />
 *     <FormActions :loading="form.submitting.value" :error="form.formError.value" cancel-label="Descartar" @cancel="form.reset()" />
 *   </form>
 */
withDefaults(
  defineProps<{ submitLabel?: string; cancelLabel?: string; loading?: boolean; disabled?: boolean; error?: string | null; form?: string; align?: 'end' | 'start' | 'between'; sticky?: boolean; testid?: string }>(),
  { submitLabel: 'Guardar', loading: false, disabled: false, error: null, align: 'end', sticky: false },
);
const emit = defineEmits<{ cancel: [] }>();
const ALIGN = { end: 'sm:justify-end', start: 'sm:justify-start', between: 'sm:justify-between' } as const;
</script>

<template>
  <div class="w-full space-y-3" :class="sticky ? 'bg-background/95 sticky bottom-0 z-10 border-t py-3 backdrop-blur' : undefined">
    <AppAlert v-if="error" variant="destructive" :description="error" :data-testid="testid ? `${testid}-error` : undefined" />
    <div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center" :class="ALIGN[align]">
      <slot />
      <div class="flex flex-col-reverse gap-2 sm:flex-row">
        <Button v-if="cancelLabel" type="button" variant="outline" :disabled="loading" @click="emit('cancel')">{{ cancelLabel }}</Button>
        <Button type="submit" :form="form" :loading="loading" :disabled="disabled" :data-testid="testid ? `${testid}-submit` : undefined">{{ submitLabel }}</Button>
      </div>
    </div>
  </div>
</template>
