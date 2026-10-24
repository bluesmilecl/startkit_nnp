import { isNuxtError } from '#app';
import { isApiError } from '#ui/lib/errors';

/**
 * Safety net for API failures nobody handled: an action whose promise was not awaited or an
 * event handler without try/catch. The person gets the usual error toast (message + request id)
 * instead of a silent failure. Handled errors never reach here; fatal ones go to error.vue.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const notify = useNotify();
  const seen = new WeakSet<object>();
  const report = (err: unknown) => {
    if (!isApiError(err) || seen.has(err)) return false;
    // 401 already sends the person to /session-expired (api plugin).
    if (err.status === 401) return true;
    seen.add(err);
    notify.error(err);
    return true;
  };
  nuxtApp.hook('vue:error', (err) => {
    if (isNuxtError(err) && err.fatal) return;
    report(err);
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (report(event.reason)) event.preventDefault();
  });
});
