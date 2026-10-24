<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Check } from '@lucide/vue';
import { Button } from '#ui/components/ui/button';
import { Progress } from '#ui/components/ui/progress';
import { ICONS } from '#ui/lib/icons';
import { cn } from '#ui/lib/utils';
import type { FormLike, WizardStep } from '#ui/lib/kit';
import { useWizard } from '#ui/composables/useWizard';
import AppAlert from './AppAlert.vue';

/**
 * Multi-step form. Each step names the fields it owns; "Siguiente" validates only those (same Zod
 * schema as the API), runs `beforeNext` (e.g. save the step) and moves on. On the last step the
 * whole form is validated: if a previous step has errors the wizard goes back to it, otherwise it
 * emits `complete`. Steps already reached can be revisited from the header.
 *
 *   const steps: WizardStep[] = [
 *     { id: 'datos', title: 'Datos', fields: ['name', 'email'] },
 *     { id: 'plan', title: 'Plan', fields: ['plan'] },
 *     { id: 'resumen', title: 'Resumen' },
 *   ];
 *   <FormWizard :steps="steps" :form="form" :loading="form.submitting.value" @complete="submit">
 *     <template #step-datos><FormFields :form="form" :fields="datos" /></template>
 *     <template #step-plan>…</template>
 *     <template #step-resumen>…</template>
 *   </FormWizard>
 */
const props = withDefaults(
  defineProps<{
    steps: WizardStep[];
    form?: FormLike;
    beforeNext?: (step: WizardStep, index: number) => Promise<boolean | void> | boolean | void;
    loading?: boolean;
    nextLabel?: string;
    backLabel?: string;
    submitLabel?: string;
    testid?: string;
  }>(),
  { loading: false, nextLabel: 'Siguiente', backLabel: 'Atrás', submitLabel: 'Finalizar', testid: 'wizard' },
);
const emit = defineEmits<{ complete: []; change: [number] }>();
const model = defineModel<number>('step', { default: 0 });

const wizard = useWizard(() => props.steps, {
  initial: model.value,
  validate: (fields) => props.form?.validateFields(fields) ?? true,
  beforeNext: (step, i) => props.beforeNext?.(step, i),
  onComplete: () => {
    if (props.form && !props.form.validate()) {
      const field = props.form.firstErrorField(props.steps.flatMap((s) => s.fields ?? []));
      const target = field ? wizard.stepOfField(field) : -1;
      if (target >= 0 && target !== wizard.index.value) wizard.goTo(target);
      return;
    }
    emit('complete');
  },
});

const heading = ref<HTMLElement | null>(null);
watch(wizard.index, async (i) => {
  model.value = i;
  emit('change', i);
  // Move focus to the new step's title so keyboard and screen-reader users land on it.
  await nextTick();
  heading.value?.focus();
});
watch(model, (i) => {
  // Only reached steps can be opened from outside; anything else snaps back to the current one.
  if (i !== wizard.index.value && !wizard.goTo(i)) model.value = wizard.index.value;
});

const iconOf = (s: WizardStep) => (typeof s.icon === 'string' ? ICONS[s.icon] : s.icon);
const percent = computed(() => Math.round(wizard.progress.value * 100));
// Steps before the furthest one reached were validated; the furthest one (if not current) is reachable but pending.
const state = (i: number) => (i === wizard.index.value ? 'active' : i < wizard.furthest.value ? 'completed' : 'upcoming');
</script>

<template>
  <div class="space-y-6" :data-testid="testid">
    <!-- Step list (tablet and desktop) -->
    <nav aria-label="Pasos" class="hidden sm:block">
      <ol class="flex items-start gap-2">
        <li v-for="(s, i) in steps" :key="s.id" class="flex min-w-0 flex-1 items-start gap-2">
          <button
            type="button"
            class="group flex min-w-0 flex-1 items-start gap-2 rounded-md p-1 text-left disabled:cursor-default"
            :disabled="!wizard.canGoTo(i) || i === wizard.index.value"
            :aria-current="i === wizard.index.value ? 'step' : undefined"
            :data-state="state(i)"
            :data-testid="`${testid}-step-${s.id}`"
            @click="wizard.goTo(i)"
          >
            <span
              :class="
                cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium tabular-nums transition-colors',
                  state(i) === 'active' && 'bg-primary text-primary-foreground border-primary',
                  state(i) === 'completed' && 'bg-accent text-accent-foreground group-enabled:group-hover:border-primary',
                  state(i) === 'upcoming' && 'text-muted-foreground',
                )
              "
              aria-hidden="true"
            >
              <Check v-if="state(i) === 'completed'" class="size-4" />
              <component :is="iconOf(s)" v-else-if="s.icon" class="size-4" />
              <template v-else>{{ i + 1 }}</template>
            </span>
            <span class="min-w-0 pt-1">
              <span class="block truncate text-sm font-medium" :class="state(i) === 'upcoming' ? 'text-muted-foreground' : undefined">{{ s.title }}</span>
              <span v-if="s.optional" class="text-muted-foreground block text-xs">Opcional</span>
            </span>
          </button>
          <span v-if="i < steps.length - 1" class="bg-border mt-5 hidden h-px min-w-4 flex-1 lg:block" aria-hidden="true" />
        </li>
      </ol>
    </nav>
    <!-- Compact header (phones) -->
    <div class="space-y-2 sm:hidden">
      <p class="text-muted-foreground text-xs">Paso {{ wizard.index.value + 1 }} de {{ wizard.count.value }}</p>
      <Progress :model-value="percent" :aria-label="`Progreso: paso ${wizard.index.value + 1} de ${wizard.count.value}`" />
    </div>

    <form novalidate class="space-y-6" :data-testid="`${testid}-form`" @submit.prevent="wizard.next()">
      <header v-if="wizard.step.value" class="space-y-1">
        <h2 ref="heading" tabindex="-1" class="text-lg font-semibold outline-none" :data-testid="`${testid}-title`">{{ wizard.step.value.title }}</h2>
        <p v-if="wizard.step.value.description" class="text-muted-foreground text-sm">{{ wizard.step.value.description }}</p>
      </header>
      <p class="sr-only" aria-live="polite">Paso {{ wizard.index.value + 1 }} de {{ wizard.count.value }}: {{ wizard.step.value?.title }}</p>

      <div v-if="wizard.step.value" :data-step="wizard.step.value.id">
        <slot :name="`step-${wizard.step.value.id}`" :step="wizard.step.value" :index="wizard.index.value">
          <slot :step="wizard.step.value" :index="wizard.index.value" />
        </slot>
      </div>

      <AppAlert v-if="wizard.error.value" variant="destructive" :description="wizard.error.value" :data-testid="`${testid}-error`" />

      <div class="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="outline" :disabled="wizard.isFirst.value || wizard.busy.value || loading" :data-testid="`${testid}-back`" @click="wizard.back()">{{ backLabel }}</Button>
        <div class="flex flex-col-reverse gap-2 sm:flex-row">
          <slot name="actions" :step="wizard.step.value" :index="wizard.index.value" />
          <Button type="submit" :loading="wizard.busy.value || loading" :data-testid="`${testid}-next`">{{ wizard.isLast.value ? submitLabel : nextLabel }}</Button>
        </div>
      </div>
    </form>
  </div>
</template>
