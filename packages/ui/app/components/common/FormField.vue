<script setup lang="ts">
import { computed, useId } from 'vue';
import { Field, FieldDescription, FieldError, FieldLabel } from '#ui/components/ui/field';

/**
 * One labelled form control with description and error, wired for accessibility (label `for`,
 * `aria-describedby`, `aria-invalid`). The control goes in the slot and receives its props:
 *
 *   <FormField label="Nombre" :error="form.errors.name" required v-slot="field">
 *     <Input v-bind="field" v-model="form.values.name" />
 *   </FormField>
 *
 * For whole forms from a field list, use <FormFields>.
 */
const props = withDefaults(
  defineProps<{ label: string; id?: string; description?: string; error?: string | null; required?: boolean; orientation?: 'vertical' | 'horizontal'; hideLabel?: boolean }>(),
  { orientation: 'vertical', hideLabel: false },
);
const generated = useId();
const fieldId = computed(() => props.id ?? `field-${generated}`);
const describedBy = computed(() => [props.description ? `${fieldId.value}-description` : null, props.error ? `${fieldId.value}-error` : null].filter(Boolean).join(' ') || undefined);
const control = computed(() => ({ id: fieldId.value, 'aria-describedby': describedBy.value, 'aria-invalid': props.error ? true : undefined }));
</script>

<template>
  <Field :data-invalid="error ? true : undefined" :orientation="orientation">
    <FieldLabel :for="fieldId" :class="hideLabel ? 'sr-only' : undefined">
      <span>{{ label }}<span v-if="required" class="text-destructive" aria-hidden="true">&nbsp;*</span></span><span v-if="required" class="sr-only">(obligatorio)</span>
    </FieldLabel>
    <slot v-bind="control" />
    <FieldDescription v-if="description" :id="`${fieldId}-description`">{{ description }}</FieldDescription>
    <FieldError v-if="error" :id="`${fieldId}-error`" :errors="[error]" />
  </Field>
</template>
