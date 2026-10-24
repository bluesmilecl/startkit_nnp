<script setup lang="ts">
import { computed, type Component } from 'vue';
import { Alert, AlertDescription, AlertTitle } from '#ui/components/ui/alert';
import { ICONS } from '#ui/lib/icons';
import IconButton from './IconButton.vue';

type Variant = 'default' | 'info' | 'success' | 'warning' | 'destructive';

/**
 * Inline message with a semantic variant and its icon. `warning` and `destructive` are announced
 * immediately (role="alert"); the rest politely (role="status").
 *
 *   <AppAlert variant="warning" title="Configuración pendiente" description="…">
 *     <template #actions><Button size="sm">Configurar</Button></template>
 *   </AppAlert>
 *
 * `dismissible` adds a close button; use `v-model:open` to control or remember it.
 */
const props = withDefaults(defineProps<{ variant?: Variant; title?: string; description?: string; icon?: Component | false; dismissible?: boolean }>(), {
  variant: 'info',
  icon: undefined,
  dismissible: false,
});
const open = defineModel<boolean>('open', { default: true });
const DEFAULT_ICONS: Record<Variant, Component> = { default: ICONS.info, info: ICONS.info, success: ICONS.success, warning: ICONS.warning, destructive: ICONS.error };
const iconComponent = computed(() => (props.icon === false ? null : (props.icon ?? DEFAULT_ICONS[props.variant])));
const role = computed(() => (props.variant === 'warning' || props.variant === 'destructive' ? 'alert' : 'status'));
</script>

<template>
  <Alert v-if="open" :variant="variant" :role="role" :data-variant="variant" :class="dismissible ? 'pr-10' : undefined">
    <component :is="iconComponent" v-if="iconComponent" aria-hidden="true" />
    <AlertTitle v-if="title">{{ title }}</AlertTitle>
    <AlertDescription v-if="description || $slots.default || $slots.actions">
      <slot>{{ description }}</slot>
      <div v-if="$slots.actions" class="mt-2 flex flex-wrap gap-2"><slot name="actions" /></div>
    </AlertDescription>
    <IconButton v-if="dismissible" icon="close" label="Cerrar aviso" size="icon-xs" :tooltip="false" class="absolute top-2.5 right-2.5" @click="open = false" />
  </Alert>
</template>
