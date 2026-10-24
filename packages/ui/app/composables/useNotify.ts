import { toast } from 'vue-sonner';
import { describeError, normalizeError, type Problem } from '#ui/lib/errors';

export { describeError, normalizeError };

export interface NotifyOptions {
  description?: string;
  /** Milliseconds; errors stay longer by default. */
  duration?: number;
  action?: { label: string; onClick: () => unknown };
  id?: string | number;
}

/**
 * Toasts with the starter's conventions (Spanish copy, API errors with their request id, undo
 * actions, promises). Mounted once by <Toaster> in app.vue.
 *
 *   const notify = useNotify();
 *   notify.success('Proyecto creado');
 *   notify.error(err);                                  // API error → message + "Código de solicitud: …"
 *   notify.error(err, { retry: () => save() });         // "Reintentar" when the error is transient
 *   notify.error(err, { context: `«${file.name}»` });   // "«informe.pdf»: El archivo supera…"
 *   notify.undo('Proyecto archivado', () => restore()); // action button
 *   await notify.promise(save(), { loading: 'Guardando…', success: 'Guardado' });
 */
export function useNotify() {
  function success(message: string, options: NotifyOptions = {}) {
    return toast.success(message, options);
  }
  function info(message: string, options: NotifyOptions = {}) {
    return toast.info(message, options);
  }
  function warning(message: string, options: NotifyOptions = {}) {
    return toast.warning(message, options);
  }
  /**
   * Error toast from anything thrown (see `normalizeError`): the server's Spanish message, the
   * request id to quote to support and, with `retry`, a "Reintentar" button for transient errors.
   */
  function error(err: unknown, options: NotifyOptions & { fallback?: string; context?: string; retry?: () => unknown } = {}) {
    const { retry, fallback, context, ...rest } = options;
    const p = normalizeError(err, fallback);
    return toast.error(context ? `${context}: ${p.message}` : p.message, {
      duration: 8000,
      action: retry && p.retryable ? { label: 'Reintentar', onClick: () => void retry() } : undefined,
      ...rest,
      description: rest.description ?? problemDescription(p),
    });
  }
  function undo(message: string, onUndo: () => unknown, options: NotifyOptions & { label?: string } = {}) {
    return toast.success(message, { duration: 6000, ...options, action: { label: options.label ?? 'Deshacer', onClick: () => void onUndo() } });
  }
  async function promise<T>(work: Promise<T>, messages: { loading: string; success: string | ((value: T) => string); error?: string }): Promise<T> {
    const id = toast.loading(messages.loading);
    try {
      const value = await work;
      toast.success(typeof messages.success === 'function' ? messages.success(value) : messages.success, { id });
      return value;
    } catch (err) {
      const p = normalizeError(err, messages.error);
      toast.error(messages.error ?? p.message, { id, duration: 8000, description: problemDescription(p) });
      throw err;
    }
  }
  return { success, info, warning, error, undo, promise, dismiss: toast.dismiss };
}

function problemDescription(p: Problem): string | undefined {
  const wait = p.retryAfterSeconds ? `Intenta de nuevo en ${p.retryAfterSeconds} s.` : undefined;
  const id = p.requestId ? `Código de solicitud: ${p.requestId}` : undefined;
  return [wait, id].filter(Boolean).join(' · ') || undefined;
}
