<script setup lang="ts">
import { Check, CircleHelp, X } from '@lucide/vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '#ui/components/ui/tooltip';

/** Capability states: yes (verified or declared), no, unknown (never shown as supported). */
const props = withDefaults(defineProps<{ capabilities: Record<string, string>; only?: string[]; compact?: boolean }>(), { compact: false });
const entries = computed(() => Object.entries(CAPABILITY_LABELS).filter(([k]) => (!props.only || props.only.includes(k)) && (props.capabilities[k] || !props.compact)));
const STATE: Record<string, string> = { yes: 'Soportado', no: 'No soportado', unknown: 'Desconocido' };
</script>

<template>
  <ul class="flex flex-wrap gap-1" aria-label="Capacidades">
    <li v-for="[key, label] in entries" :key="key">
      <Tooltip>
        <TooltipTrigger as-child>
          <span
            class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs"
            :class="{ 'border-transparent bg-primary/10 text-foreground': capabilities[key] === 'yes', 'text-muted-foreground line-through decoration-1': capabilities[key] === 'no', 'text-muted-foreground border-dashed': !capabilities[key] || capabilities[key] === 'unknown' }"
            :data-capability="key"
            :data-state="capabilities[key] ?? 'unknown'"
          >
            <Check v-if="capabilities[key] === 'yes'" class="size-3" aria-hidden="true" />
            <X v-else-if="capabilities[key] === 'no'" class="size-3" aria-hidden="true" />
            <CircleHelp v-else class="size-3" aria-hidden="true" />
            {{ label }}
          </span>
        </TooltipTrigger>
        <TooltipContent>{{ label }}: {{ STATE[capabilities[key] ?? 'unknown'] }}</TooltipContent>
      </Tooltip>
    </li>
  </ul>
</template>
