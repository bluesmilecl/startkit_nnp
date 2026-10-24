<script setup lang="ts">
import { ICONS } from '#ui/lib/icons';
import { cn } from '#ui/lib/utils';
import type { SectionNavItem } from '#ui/lib/kit';

/**
 * Secondary navigation inside a page (settings sections, a record's tabs on the side). Vertical
 * list from `md` up, horizontal scrollable row on phones. Items select a value (`v-model`) or
 * navigate (`to`). With a default slot it also lays out the content next to the menu:
 *
 *   <SectionNav v-model="section" label="Secciones de configuración" :items="items">
 *     <GeneralSettings v-if="section === 'general'" />
 *   </SectionNav>
 *
 * The main app sidebar is AppSidebar (apps/web), driven by utils/navigation.ts.
 */
withDefaults(defineProps<{ items: SectionNavItem[]; label: string; testid?: string }>(), {});
const model = defineModel<string>();
const iconOf = (i: SectionNavItem) => (typeof i.icon === 'string' ? ICONS[i.icon] : i.icon);
const itemClass = (active: boolean, disabled?: boolean) =>
  cn(
    'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors md:w-full',
    active ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
    disabled && 'pointer-events-none opacity-50',
  );
</script>

<template>
  <div :class="$slots.default ? 'grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]' : undefined">
    <nav :aria-label="label" :data-testid="testid" class="min-w-0">
      <ul class="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
        <li v-for="item in items" :key="item.value">
          <NuxtLink v-if="item.to" :to="item.to" :class="itemClass($route.path === item.to, item.disabled)" :aria-current="$route.path === item.to ? 'page' : undefined">
            <component :is="iconOf(item)" v-if="item.icon" class="size-4" aria-hidden="true" />
            <span class="truncate">{{ item.label }}</span>
            <span v-if="item.badge !== undefined" class="bg-muted text-muted-foreground ml-auto rounded px-1.5 text-xs tabular-nums">{{ item.badge }}</span>
          </NuxtLink>
          <button
            v-else
            type="button"
            :class="itemClass(model === item.value, item.disabled)"
            :aria-current="model === item.value ? 'true' : undefined"
            :disabled="item.disabled"
            :data-value="item.value"
            @click="model = item.value"
          >
            <component :is="iconOf(item)" v-if="item.icon" class="size-4" aria-hidden="true" />
            <span class="truncate">{{ item.label }}</span>
            <span v-if="item.badge !== undefined" class="bg-muted text-muted-foreground ml-auto rounded px-1.5 text-xs tabular-nums">{{ item.badge }}</span>
          </button>
        </li>
      </ul>
    </nav>
    <div v-if="$slots.default" class="min-w-0"><slot /></div>
  </div>
</template>
