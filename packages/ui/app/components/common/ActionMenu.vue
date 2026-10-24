<script setup lang="ts">
import { computed, type Component } from 'vue';
import { Ellipsis } from '@lucide/vue';
import { Button, type ButtonVariants } from '#ui/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '#ui/components/ui/dropdown-menu';
import { ICONS } from '#ui/lib/icons';
import { useConfirm } from '#ui/composables/useConfirm';
import type { ActionItem } from '#ui/lib/kit';

/**
 * Declarative action menu (the "⋯" of rows and pages). Works in templates and in TanStack cells:
 *
 *   h(ActionMenu, { label: `Acciones para ${p.name}`, items: [
 *     { label: 'Editar', icon: 'edit', onSelect: () => edit(p) },
 *     { label: 'Eliminar', icon: 'delete', destructive: true, separator: true,
 *       confirm: { title: `¿Eliminar «${p.name}»?`, destructive: true, confirmLabel: 'Eliminar' },
 *       onSelect: () => remove(p) },
 *   ] })
 *
 * When every item is hidden the menu is not rendered.
 */
const props = withDefaults(
  defineProps<{
    items: ActionItem[];
    /** Accessible name of the trigger, e.g. "Acciones para Proyecto X". */
    label: string;
    heading?: string;
    align?: 'start' | 'center' | 'end';
    triggerVariant?: ButtonVariants['variant'];
    triggerIcon?: Component;
    triggerText?: string;
    testid?: string;
  }>(),
  { align: 'end', triggerVariant: 'ghost' },
);
const { confirm } = useConfirm();
const visible = computed(() => props.items.filter((i) => !i.hidden));
const iconOf = (i: ActionItem) => (typeof i.icon === 'string' ? ICONS[i.icon] : i.icon);

async function run(item: ActionItem) {
  if (item.confirm && !(await confirm(item.confirm))) return;
  await item.onSelect();
}
</script>

<template>
  <DropdownMenu v-if="visible.length">
    <DropdownMenuTrigger as-child>
      <slot name="trigger">
        <Button :variant="triggerVariant" :size="triggerText ? 'sm' : 'icon'" :aria-label="label" :data-testid="testid" @click.stop>
          <component :is="triggerIcon ?? Ellipsis" class="size-4" aria-hidden="true" />
          <span v-if="triggerText">{{ triggerText }}</span>
        </Button>
      </slot>
    </DropdownMenuTrigger>
    <DropdownMenuContent :align="align" class="min-w-44">
      <DropdownMenuLabel v-if="heading" class="text-muted-foreground text-xs">{{ heading }}</DropdownMenuLabel>
      <template v-for="(item, i) in visible" :key="item.label">
        <DropdownMenuSeparator v-if="item.separator && i > 0" />
        <DropdownMenuItem :variant="item.destructive ? 'destructive' : 'default'" :disabled="item.disabled" :data-testid="item.testid" @select="run(item)">
          <component :is="iconOf(item)" v-if="item.icon" aria-hidden="true" />
          {{ item.label }}
          <DropdownMenuShortcut v-if="item.shortcut">{{ item.shortcut }}</DropdownMenuShortcut>
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
