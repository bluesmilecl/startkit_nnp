import { toast } from 'vue-sonner';
import { describeError } from '#ui/lib/errors';

export { describeError };

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
 *   notify.error(err);                                  // API error → message + "Código: …"
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
  function error(err: unknown, options: NotifyOptions & { fallback?: string } = {}) {
    const d = describeError(err, options.fallback);
    return toast.error(d.message, { duration: 8000, ...options, description: options.description ?? (d.requestId ? `Código de solicitud: ${d.requestId}` : undefined) });
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
      const d = describeError(err, messages.error);
      toast.error(messages.error ?? d.message, { id, duration: 8000, description: d.requestId ? `Código de solicitud: ${d.requestId}` : undefined });
      throw err;
    }
  }
  return { success, info, warning, error, undo, promise, dismiss: toast.dismiss };
}
