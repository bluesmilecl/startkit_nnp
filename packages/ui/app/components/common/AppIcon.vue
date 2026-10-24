<script setup lang="ts">
import { computed, useAttrs } from 'vue';
import { cn } from '#ui/lib/utils';
import { ICONS, type IconName } from '#ui/lib/icons';

/**
 * Icon from the semantic registry (`#ui/lib/icons`). Decorative by default (`aria-hidden`); pass
 * `label` when the icon alone carries meaning. Size with classes: `<AppIcon name="warning" class="size-5" />`.
 */
defineOptions({ inheritAttrs: false });
const props = defineProps<{ name: IconName; label?: string }>();
const attrs = useAttrs();
const component = computed(() => ICONS[props.name]);
</script>

<template>
  <component
    :is="component"
    v-bind="{ ...attrs, class: undefined }"
    :class="cn('size-4 shrink-0', attrs.class as string)"
    :data-icon="name"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
  />
</template>
