import { computed, reactive, ref, toRaw } from 'vue';
import type { z } from 'zod';
import { normalizeError } from '#ui/lib/errors';

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

  /**
   * Validates only the given fields (wizard steps, sections). Errors of other fields are left as
   * they are; returns true when none of `names` (or their nested paths) has an issue.
   */
  function validateFields(names: string[]): boolean {
    for (const n of names) for (const k of Object.keys(errors)) if (k === n || k.startsWith(`${n}.`)) delete errors[k];
    const result = schema.safeParse(toRaw(values));
    if (result.success) return true;
    let ok = true;
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!names.some((n) => key === n || key.startsWith(`${n}.`))) continue;
      errors[key] ??= issue.message;
      ok = false;
    }
    return ok;
  }

  function validateField(name: string) {
    touched[name] = true;
    const result = schema.safeParse(toRaw(values));
    errors[name] = result.success ? undefined : result.error.issues.find((i) => i.path.join('.') === name)?.message;
  }

  /**
   * Maps a failed submit onto the form: field-level details (VALIDATION_FAILED, a uniqueness
   * CONFLICT) next to each field, and the message above the actions. Server failures (5xx) add
   * the request id so the person can quote it.
   */
  function applyServerError(err: unknown) {
    const p = normalizeError(err, 'No se pudo guardar');
    for (const [path, message] of Object.entries(p.fieldErrors)) errors[path] = message;
    formError.value = p.status >= 500 && p.requestId ? `${p.message} Código de solicitud: ${p.requestId}` : p.message;
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

  /** Assigns several values at once (e.g. when opening an edit form). */
  function setValues(next: Partial<z.input<S>>) {
    Object.assign(values, next);
  }

  /** First field with an error, in the order of `order` (or insertion order). */
  function firstErrorField(order?: string[]): string | undefined {
    const keys = Object.keys(errors).filter((k) => errors[k]);
    if (!order) return keys[0];
    return order.find((n) => keys.some((k) => k === n || k.startsWith(`${n}.`)));
  }

  function reset(next?: Partial<z.input<S>>) {
    Object.assign(values, { ...initial, ...(next ?? {}) });
    clearErrors();
  }

  const hasErrors = computed(() => Object.values(errors).some(Boolean));
  return { values, errors, touched, formError, submitting, hasErrors, validate, validateField, validateFields, firstErrorField, setValues, handleSubmit, applyServerError, reset };
}
