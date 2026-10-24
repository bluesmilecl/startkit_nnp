import { computed, reactive, ref, toRaw } from 'vue';
import type { z } from 'zod';

export interface ServerErrorLike {
  error?: { code?: string; message?: string; details?: unknown };
}

/**
 * Minimal form state for shadcn-vue `Field` components validated with the same Zod 4 contracts
 * used by the API. Server VALIDATION_FAILED details are mapped back onto fields.
 */
export function useZodForm<S extends z.ZodObject>(schema: S, initial: z.input<S>) {
  const values = reactive({ ...initial }) as z.input<S>;
  const errors = reactive<Record<string, string | undefined>>({});
  const formError = ref<string | null>(null);
  const submitting = ref(false);
  const touched = reactive<Record<string, boolean>>({});

  function clearErrors() {
    for (const k of Object.keys(errors)) delete errors[k];
    formError.value = null;
  }

  function validate(): z.output<S> | null {
    clearErrors();
    const result = schema.safeParse(toRaw(values));
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      errors[key] ??= issue.message;
    }
    return null;
  }

  function validateField(name: string) {
    touched[name] = true;
    const result = schema.safeParse(toRaw(values));
    errors[name] = result.success ? undefined : result.error.issues.find((i) => i.path.join('.') === name)?.message;
  }

  function applyServerError(err: unknown) {
    const body = ((err as { data?: ServerErrorLike })?.data ?? err) as ServerErrorLike;
    const details = body?.error?.details;
    if (Array.isArray(details)) {
      for (const d of details as { path?: string; message?: string }[]) if (d.path) errors[d.path] = d.message;
    }
    formError.value = body?.error?.message ?? (err instanceof Error ? err.message : 'No se pudo guardar');
  }

  function handleSubmit(fn: (data: z.output<S>) => Promise<unknown> | unknown) {
    return async (event?: Event) => {
      event?.preventDefault();
      const data = validate();
      if (!data) return;
      submitting.value = true;
      try {
        await fn(data);
      } catch (err) {
        applyServerError(err);
      } finally {
        submitting.value = false;
      }
    };
  }

  function reset(next?: Partial<z.input<S>>) {
    Object.assign(values, { ...initial, ...(next ?? {}) });
    clearErrors();
  }

  const hasErrors = computed(() => Object.values(errors).some(Boolean));
  return { values, errors, touched, formError, submitting, hasErrors, validate, validateField, handleSubmit, applyServerError, reset };
}
