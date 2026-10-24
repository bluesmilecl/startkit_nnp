import { ref } from 'vue';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Requires typing this text to enable the confirm button (for irreversible actions). */
  typeToConfirm?: string;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

const pending = ref<Pending | null>(null);

/** Promise-based confirmation rendered by <ConfirmHost/> (alert-dialog). */
export function useConfirm() {
  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      pending.value = { ...options, resolve };
    });
  }
  function settle(ok: boolean) {
    pending.value?.resolve(ok);
    pending.value = null;
  }
  return { confirm, pending, settle };
}
