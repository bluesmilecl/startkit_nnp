<script setup lang="ts">
import { computed, type Component } from 'vue';
import { Loader2Icon } from '@lucide/vue';
import { Button, type ButtonVariants } from '#ui/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '#ui/components/ui/tooltip';
import { ICONS, type IconName } from '#ui/lib/icons';

/**
 * Icon-only button with a required accessible name, shown as a tooltip. Pass a semantic `icon`
 * name from the registry (`edit`, `delete`, …) or any Lucide component.
 *
 *   <IconButton icon="edit" label="Editar proyecto" @click="edit" />
 */
const props = withDefaults(
  defineProps<{
    icon: IconName | Component;
    label: string;
    variant?: ButtonVariants['variant'];
    size?: 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg';
    tooltip?: boolean;
    side?: 'top' | 'right' | 'bottom' | 'left';
    loading?: boolean;
    disabled?: boolean;
    pressed?: boolean;
  }>(),
  { variant: 'ghost', size: 'icon', tooltip: true, side: 'top', loading: false, disabled: false, pressed: undefined },
);
const component = computed(() => (typeof props.icon === 'string' ? ICONS[props.icon] : props.icon));
</script>

<template>
  <TooltipProvider v-if="tooltip" :delay-duration="300">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button :variant="variant" :size="size" :disabled="disabled || loading" :aria-busy="loading || undefined" :aria-label="label" :aria-pressed="pressed">
          <Loader2Icon v-if="loading" class="animate-spin" aria-hidden="true" />
          <component :is="component" v-else aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent :side="side">{{ label }}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
  <Button v-else :variant="variant" :size="size" :disabled="disabled || loading" :aria-busy="loading || undefined" :aria-label="label" :aria-pressed="pressed">
    <Loader2Icon v-if="loading" class="animate-spin" aria-hidden="true" />
    <component :is="component" v-else aria-hidden="true" />
  </Button>
</template>
