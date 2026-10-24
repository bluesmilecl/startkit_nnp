<script setup lang="ts">
import { ref } from 'vue';
import { Upload } from '@lucide/vue';
import { cn } from '#ui/lib/utils';
import { formatBytes } from '#ui/lib/format';

const props = withDefaults(defineProps<{ accept?: string; maxBytes?: number; multiple?: boolean; disabled?: boolean; label?: string }>(), {
  accept: '',
  maxBytes: 20 * 1024 * 1024,
  multiple: false,
  disabled: false,
  label: 'Arrastra archivos o haz clic para seleccionar',
});
const emit = defineEmits<{ files: [File[]]; error: [string] }>();
const input = ref<HTMLInputElement>();
const dragging = ref(false);

function accepted(file: File): boolean {
  if (!props.accept) return true;
  return props.accept.split(',').some((rule) => {
    const r = rule.trim();
    if (r.startsWith('.')) return file.name.toLowerCase().endsWith(r.toLowerCase());
    if (r.endsWith('/*')) return file.type.startsWith(r.slice(0, -1));
    return file.type === r;
  });
}

function handle(list: FileList | null) {
  if (!list || props.disabled) return;
  const files = [...list];
  const bad = files.find((f) => !accepted(f));
  if (bad) return emit('error', `Tipo no permitido: ${bad.name}`);
  const big = files.find((f) => f.size > props.maxBytes);
  if (big) return emit('error', `${big.name} supera ${formatBytes(props.maxBytes)}`);
  emit('files', props.multiple ? files : files.slice(0, 1));
  if (input.value) input.value.value = '';
}
</script>

<template>
  <label
    :class="cn(
      'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm transition-colors',
      dragging ? 'border-primary bg-accent' : 'hover:bg-accent/50',
      disabled && 'pointer-events-none opacity-50',
    )"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="dragging = false; handle($event.dataTransfer?.files ?? null)"
  >
    <Upload class="text-muted-foreground size-6" aria-hidden="true" />
    <span>{{ label }}</span>
    <span class="text-muted-foreground text-xs">Máximo {{ formatBytes(maxBytes) }}{{ accept ? ` · ${accept}` : '' }}</span>
    <input ref="input" type="file" class="sr-only" :accept="accept" :multiple="multiple" :disabled="disabled" data-testid="file-input" @change="handle(($event.target as HTMLInputElement).files)" />
  </label>
</template>
