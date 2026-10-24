<script setup lang="ts">
import { ref } from 'vue';
import { Check, Copy } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button, type ButtonVariants } from '#ui/components/ui/button';

/**
 * Copies `value` to the clipboard and confirms in place for two seconds. With `iconOnly` it is a
 * compact icon button (the label becomes its accessible name).
 *
 *   <CopyButton :value="apiKeyPrefix" label="Copiar prefijo" />
 */
const props = withDefaults(
  defineProps<{ value: string; label?: string; copiedLabel?: string; iconOnly?: boolean; variant?: ButtonVariants['variant']; size?: ButtonVariants['size'] }>(),
  { label: 'Copiar', copiedLabel: 'Copiado', iconOnly: false, variant: 'outline', size: undefined },
);
const emit = defineEmits<{ copied: [string] }>();
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value);
    copied.value = true;
    emit('copied', props.value);
    clearTimeout(timer);
    timer = setTimeout(() => (copied.value = false), 2000);
  } catch {
    toast.error('No se pudo copiar: el navegador no dio acceso al portapapeles');
  }
}
</script>

<template>
  <Button
    type="button"
    :variant="variant"
    :size="size ?? (iconOnly ? 'icon-sm' : 'sm')"
    :aria-label="iconOnly ? (copied ? copiedLabel : label) : undefined"
    data-slot="copy-button"
    @click="copy"
  >
    <Check v-if="copied" aria-hidden="true" />
    <Copy v-else aria-hidden="true" />
    <span v-if="!iconOnly">{{ copied ? copiedLabel : label }}</span>
    <span class="sr-only" aria-live="polite">{{ copied ? copiedLabel : '' }}</span>
  </Button>
</template>
