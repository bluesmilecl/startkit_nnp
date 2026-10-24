import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue';
import type { WizardStep } from '#ui/lib/kit';

export interface WizardOptions {
  /** Validates the fields of a step (usually `form.validateFields`); false keeps the step. */
  validate?: (fields: string[]) => boolean;
  /**
   * Runs after validation and before moving on (e.g. save the step). Returning false or throwing
   * keeps the current step; a thrown error's message is exposed in `error`.
   */
  beforeNext?: (step: WizardStep, index: number) => Promise<boolean | void> | boolean | void;
  /** Called when `next()` succeeds on the last step. */
  onComplete?: () => Promise<unknown> | unknown;
  initial?: number;
}

/**
 * State of a multi-step flow: current step, steps already reached, validation per step and async
 * hooks. Used by <FormWizard>; usable alone for custom layouts.
 */
export function useWizard(steps: MaybeRefOrGetter<WizardStep[]>, options: WizardOptions = {}) {
  const list = computed(() => toValue(steps));
  const initial = Math.max(0, options.initial ?? 0);
  const index = ref(initial);
  const furthest = ref(initial);
  const busy = ref(false);
  const error = ref<string | null>(null);

  const count = computed(() => list.value.length);
  const step = computed(() => list.value[index.value]);
  const isFirst = computed(() => index.value === 0);
  const isLast = computed(() => index.value >= count.value - 1);
  /** 0..1, counting the current step as done only on the last one. */
  const progress = computed(() => (count.value ? (index.value + 1) / count.value : 0));

  /** Validates and runs hooks for the current step; advances or completes. */
  async function next(): Promise<boolean> {
    const current = step.value;
    if (!current || busy.value) return false;
    error.value = null;
    if (current.fields?.length && options.validate && !options.validate(current.fields)) return false;
    busy.value = true;
    try {
      if ((await options.beforeNext?.(current, index.value)) === false) return false;
      if (isLast.value) {
        await options.onComplete?.();
        return true;
      }
      index.value += 1;
      furthest.value = Math.max(furthest.value, index.value);
      return true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      return false;
    } finally {
      busy.value = false;
    }
  }

  function back(): boolean {
    if (index.value === 0 || busy.value) return false;
    index.value -= 1;
    error.value = null;
    return true;
  }

  /** Steps already reached can be revisited; later ones need `next()`. */
  function canGoTo(i: number): boolean {
    return i >= 0 && i < count.value && i <= furthest.value && !busy.value;
  }

  function goTo(i: number): boolean {
    if (!canGoTo(i)) return false;
    index.value = i;
    error.value = null;
    return true;
  }

  /** Index of the first step that owns one of these fields (e.g. after a server validation error). */
  function stepOfField(field: string): number {
    return list.value.findIndex((s) => s.fields?.some((f) => field === f || field.startsWith(`${f}.`)));
  }

  function reset() {
    index.value = initial;
    furthest.value = initial;
    error.value = null;
  }

  return { steps: list, index, step, count, isFirst, isLast, progress, furthest, busy, error, next, back, goTo, canGoTo, stepOfField, reset };
}
