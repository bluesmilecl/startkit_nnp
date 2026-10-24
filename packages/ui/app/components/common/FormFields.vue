<script setup lang="ts">
import { computed, useId } from 'vue';
import { Input } from '#ui/components/ui/input';
import { Textarea } from '#ui/components/ui/textarea';
import { Checkbox } from '#ui/components/ui/checkbox';
import { Switch } from '#ui/components/ui/switch';
import { Slider } from '#ui/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '#ui/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { TagsInput, TagsInputInput, TagsInputItem, TagsInputItemDelete, TagsInputItemText } from '#ui/components/ui/tags-input';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '#ui/components/ui/input-group';
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldSet, FieldLegend } from '#ui/components/ui/field';
import type { FormFieldDef, FormLike } from '#ui/lib/kit';
import FormField from './FormField.vue';

/**
 * Renders a list of field definitions bound to a useZodForm form: label, control, description and
 * error per field, in a responsive grid. Validation messages come from the same Zod schema as the
 * API, on blur and as the person fixes them.
 *
 *   const form = useZodForm(CreateCustomerInput, { name: '', email: '', plan: 'basic', active: true });
 *   const fields: FormFieldDef[] = [
 *     { name: 'name', label: 'Nombre', required: true },
 *     { name: 'email', label: 'Correo', type: 'email' },
 *     { name: 'plan', label: 'Plan', type: 'select', options: [{ value: 'basic', label: 'Básico' }] },
 *     { name: 'active', label: 'Activo', type: 'switch', description: 'Puede ingresar' },
 *   ];
 *   <FormFields :form="form" :fields="fields" :columns="2" />
 *
 * Override any field with a slot named `field-<name>` (receives `{ field, id, value, setValue, error }`).
 */
const props = withDefaults(defineProps<{ form: FormLike; fields: FormFieldDef[]; columns?: 1 | 2 | 3; idPrefix?: string; disabled?: boolean }>(), { columns: 1, disabled: false });
const prefix = props.idPrefix ?? `ff-${useId()}`;
const GRID = { 1: 'grid gap-4', 2: 'grid gap-4 sm:grid-cols-2', 3: 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3' } as const;
const SPAN = { 1: '', 2: 'sm:col-span-2', 3: 'sm:col-span-2 lg:col-span-3', full: 'col-span-full' } as const;
const gridClass = computed(() => GRID[props.columns]);
const idOf = (f: FormFieldDef) => `${prefix}-${f.name}`;
const errorOf = (f: FormFieldDef) => props.form.errors[f.name];

function setValue(f: FormFieldDef, value: unknown) {
  // The form object (useZodForm) owns its reactive state: writing through the prop is intended.
  // eslint-disable-next-line vue/no-mutating-props
  props.form.values[f.name] = value;
  // Clear the message as soon as the value becomes valid.
  if (props.form.errors[f.name]) props.form.validateField(f.name);
}
function onBlur(f: FormFieldDef) {
  props.form.validateField(f.name);
}
function numberValue(v: unknown) {
  if (v === '' || v === null) return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}
function toggleOption(f: FormFieldDef, option: string, checked: boolean) {
  const current = Array.isArray(props.form.values[f.name]) ? [...(props.form.values[f.name] as string[])] : [];
  setValue(f, checked ? [...new Set([...current, option])] : current.filter((v) => v !== option));
}
const asString = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const asInput = (v: unknown): string | number => (typeof v === 'number' ? v : v === undefined || v === null ? '' : String(v));
const describedBy = (f: FormFieldDef) => [f.description ? `${idOf(f)}-description` : null, errorOf(f) ? `${idOf(f)}-error` : null].filter(Boolean).join(' ') || undefined;
</script>

<template>
  <div :class="gridClass" data-slot="form-fields">
    <div v-for="f in fields" :key="f.name" :class="SPAN[f.span ?? 1]" :data-field="f.name">
      <slot :id="idOf(f)" :name="`field-${f.name}`" :field="f" :value="form.values[f.name]" :set-value="(v: unknown) => setValue(f, v)" :error="errorOf(f)">
        <!-- Switch and single checkbox: control and label in one row -->
        <Field v-if="f.type === 'switch' || (f.type === 'checkbox' && !f.options)" orientation="horizontal" :data-invalid="errorOf(f) ? true : undefined" class="rounded-md border p-3">
          <FieldContent>
            <FieldLabel :for="idOf(f)">{{ f.label }}</FieldLabel>
            <FieldDescription v-if="f.description" :id="`${idOf(f)}-description`">{{ f.description }}</FieldDescription>
            <FieldError v-if="errorOf(f)" :id="`${idOf(f)}-error`" :errors="[errorOf(f)]" />
          </FieldContent>
          <Switch
            v-if="f.type === 'switch'"
            :id="idOf(f)"
            :model-value="!!form.values[f.name]"
            :disabled="disabled || f.disabled"
            :aria-describedby="describedBy(f)"
            :data-testid="f.testid"
            @update:model-value="(v: boolean) => setValue(f, v)"
          />
          <Checkbox
            v-else
            :id="idOf(f)"
            :model-value="!!form.values[f.name]"
            :disabled="disabled || f.disabled"
            :aria-describedby="describedBy(f)"
            :data-testid="f.testid"
            @update:model-value="(v) => setValue(f, v === true)"
          />
        </Field>

        <!-- Radio group and checkbox list: a fieldset with a legend -->
        <FieldSet v-else-if="f.type === 'radio' || f.type === 'checkbox'" :data-invalid="errorOf(f) ? true : undefined" :aria-describedby="describedBy(f)">
          <FieldLegend variant="label">{{ f.label }}<span v-if="f.required" class="text-destructive" aria-hidden="true">&nbsp;*</span><span v-if="f.required" class="sr-only"> (obligatorio)</span></FieldLegend>
          <FieldDescription v-if="f.description" :id="`${idOf(f)}-description`">{{ f.description }}</FieldDescription>
          <RadioGroup
            v-if="f.type === 'radio'"
            :model-value="asString(form.values[f.name])"
            :disabled="disabled || f.disabled"
            :data-testid="f.testid"
            class="gap-2"
            @update:model-value="(v) => setValue(f, v)"
          >
            <Field v-for="o in f.options ?? []" :key="o.value" orientation="horizontal">
              <RadioGroupItem :id="`${idOf(f)}-${o.value}`" :value="o.value" :disabled="o.disabled" />
              <FieldContent>
                <FieldLabel :for="`${idOf(f)}-${o.value}`" class="font-normal">{{ o.label }}</FieldLabel>
                <FieldDescription v-if="o.description">{{ o.description }}</FieldDescription>
              </FieldContent>
            </Field>
          </RadioGroup>
          <div v-else class="grid gap-2" :data-testid="f.testid">
            <Field v-for="o in f.options ?? []" :key="o.value" orientation="horizontal">
              <Checkbox
                :id="`${idOf(f)}-${o.value}`"
                :model-value="asList(form.values[f.name]).includes(o.value)"
                :disabled="disabled || f.disabled || o.disabled"
                @update:model-value="(v) => toggleOption(f, o.value, v === true)"
              />
              <FieldContent>
                <FieldLabel :for="`${idOf(f)}-${o.value}`" class="font-normal">{{ o.label }}</FieldLabel>
                <FieldDescription v-if="o.description">{{ o.description }}</FieldDescription>
              </FieldContent>
            </Field>
          </div>
          <FieldError v-if="errorOf(f)" :id="`${idOf(f)}-error`" :errors="[errorOf(f)]" />
        </FieldSet>

        <!-- Everything else: label above the control -->
        <FormField v-else :id="idOf(f)" :label="f.label" :description="f.description" :error="errorOf(f)" :required="f.required">
          <template #default="control">
            <Textarea
              v-if="f.type === 'textarea'"
              v-bind="control"
              :model-value="(asString(form.values[f.name])) ?? ''"
              :rows="f.rows ?? 4"
              :placeholder="f.placeholder"
              :disabled="disabled || f.disabled"
              :data-testid="f.testid"
              @update:model-value="(v) => setValue(f, String(v))"
              @blur="onBlur(f)"
            />
            <Select v-else-if="f.type === 'select'" :model-value="asString(form.values[f.name])" :disabled="disabled || f.disabled" @update:model-value="(v) => setValue(f, v)">
              <SelectTrigger v-bind="control" class="w-full" :data-testid="f.testid"><SelectValue :placeholder="f.placeholder ?? 'Selecciona…'" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="o in f.options ?? []" :key="o.value" :value="o.value" :disabled="o.disabled">{{ o.label }}</SelectItem>
              </SelectContent>
            </Select>
            <TagsInput
              v-else-if="f.type === 'tags'"
              :model-value="asList(form.values[f.name])"
              :disabled="disabled || f.disabled"
              :data-testid="f.testid"
              @update:model-value="(v) => setValue(f, v.map(String))"
            >
              <TagsInputItem v-for="tag in asList(form.values[f.name])" :key="tag" :value="tag">
                <TagsInputItemText />
                <TagsInputItemDelete />
              </TagsInputItem>
              <TagsInputInput v-bind="control" :placeholder="f.placeholder ?? 'Escribe y presiona Enter'" @blur="onBlur(f)" />
            </TagsInput>
            <div v-else-if="f.type === 'slider'" class="flex items-center gap-3">
              <Slider
                v-bind="control"
                class="flex-1"
                :model-value="[Number(form.values[f.name] ?? f.min ?? 0)]"
                :min="f.min ?? 0"
                :max="f.max ?? 100"
                :step="f.step ?? 1"
                :disabled="disabled || f.disabled"
                :data-testid="f.testid"
                @update:model-value="(v) => v && setValue(f, v[0])"
              />
              <span class="w-12 text-right text-sm tabular-nums">{{ form.values[f.name] ?? f.min ?? 0 }}{{ f.suffix ?? '' }}</span>
            </div>
            <InputGroup v-else-if="f.prefix || f.suffix">
              <InputGroupAddon v-if="f.prefix"><InputGroupText>{{ f.prefix }}</InputGroupText></InputGroupAddon>
              <InputGroupInput
                v-bind="control"
                :type="f.type === 'number' ? 'number' : (f.type ?? 'text')"
                :model-value="asInput(form.values[f.name])"
                :placeholder="f.placeholder"
                :min="f.min"
                :max="f.max"
                :step="f.step"
                :autocomplete="f.autocomplete"
                :disabled="disabled || f.disabled"
                :data-testid="f.testid"
                @update:model-value="(v: unknown) => setValue(f, f.type === 'number' ? numberValue(v) : v)"
                @blur="onBlur(f)"
              />
              <InputGroupAddon v-if="f.suffix" align="inline-end"><InputGroupText>{{ f.suffix }}</InputGroupText></InputGroupAddon>
            </InputGroup>
            <Input
              v-else
              v-bind="control"
              :type="f.type ?? 'text'"
              :model-value="asInput(form.values[f.name])"
              :placeholder="f.placeholder"
              :min="f.min"
              :max="f.max"
              :step="f.step"
              :autocomplete="f.autocomplete"
              :disabled="disabled || f.disabled"
              :data-testid="f.testid"
              @update:model-value="(v) => setValue(f, f.type === 'number' ? numberValue(v) : v)"
              @blur="onBlur(f)"
            />
          </template>
        </FormField>
      </slot>
    </div>
  </div>
</template>
