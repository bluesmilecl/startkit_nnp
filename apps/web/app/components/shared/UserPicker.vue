<script setup lang="ts">
import { adminUsersList, type UserSummary } from '@starter/api-client';
import { Check, ChevronsUpDown } from '@lucide/vue';
import { refDebounced } from '@vueuse/core';
import { Button } from '#ui/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '#ui/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '#ui/components/ui/command';

/** Searches users server-side (paginated API) and selects one. */
const model = defineModel<UserSummary | null>({ default: null });
const open = ref(false);
const term = ref('');
const debounced = refDebounced(term, 250);
const results = ref<UserSummary[]>([]);
const loading = ref(false);
watch(
  [debounced, open],
  async () => {
    if (!open.value) return;
    loading.value = true;
    try {
      const page = await unwrap(adminUsersList({ client: useApi(), query: { search: debounced.value || undefined, pageSize: 10, page: 1, sort: 'name', direction: 'asc' } }));
      results.value = page.items;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button variant="outline" role="combobox" :aria-expanded="open" class="w-full justify-between" data-testid="user-picker">
        <span class="truncate">{{ model ? `${model.name || model.email} (${model.email})` : 'Buscar usuario…' }}</span>
        <ChevronsUpDown class="size-4 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-(--reka-popover-trigger-width) p-0">
      <Command :should-filter="false">
        <CommandInput v-model="term" placeholder="Nombre o correo" />
        <CommandList>
          <CommandEmpty>{{ loading ? 'Buscando…' : 'Sin resultados' }}</CommandEmpty>
          <CommandGroup>
            <CommandItem v-for="u in results" :key="u.id" :value="u.id" @select="model = u; open = false">
              <Check class="size-4" :class="model?.id === u.id ? 'opacity-100' : 'opacity-0'" />
              <span class="truncate">{{ u.name || '—' }}</span>
              <span class="text-muted-foreground ml-auto truncate text-xs">{{ u.email }}</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
