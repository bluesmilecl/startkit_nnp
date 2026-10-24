import { onMounted, ref, watch } from 'vue';
import type { ViewMode } from '#ui/lib/kit';

/**
 * Table/cards preference of a list, remembered per browser. The stored value is applied after
 * mount so server and client render the same HTML first (no hydration mismatch).
 *
 *   const view = useViewMode('projects');      // 'table' | 'cards'
 *   <ViewToggle v-model="view" />  <DataTable :view="view" … />
 */
export function useViewMode(key: string, initial: ViewMode = 'table') {
  const mode = ref<ViewMode>(initial);
  const storageKey = `starter:view:${key}`;
  onMounted(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === 'table' || stored === 'cards') mode.value = stored;
    } catch {
      // Storage blocked (private mode, policies): keep the default.
    }
    watch(mode, (v) => {
      try {
        localStorage.setItem(storageKey, v);
      } catch {
        // ignore
      }
    });
  });
  return mode;
}
