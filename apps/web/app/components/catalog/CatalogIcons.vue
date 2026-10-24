<script setup lang="ts">
import { Input } from '#ui/components/ui/input';
import { ICON_GROUPS, ICON_LUCIDE, searchIcons, type IconName } from '#ui/lib/icons';
import CatalogExample from './CatalogExample.vue';

/** Semantic icon registry: search, click to copy the usage. */
const notify = useNotify();
const term = ref('');
const matches = computed(() => new Set(searchIcons(term.value)));
const groups = computed(() => ICON_GROUPS.map((g) => ({ ...g, names: g.names.filter((n) => matches.value.has(n)) })).filter((g) => g.names.length));
async function copy(name: IconName) {
  try {
    await navigator.clipboard.writeText(`<AppIcon name="${name}" />`);
    notify.success(`Copiado: <AppIcon name="${name}" />`);
  } catch {
    notify.error('No se pudo copiar');
  }
}
const code = `<AppIcon name="create" />                          <!-- decorativo (aria-hidden) -->
<AppIcon name="warning" label="Advertencia" class="size-5 text-amber-600" />  <!-- con significado -->
<StatCard :icon="ICONS.money" … />   <EmptyState :icon="ICONS.inbox" … />   <IconButton icon="edit" label="Editar" />
// Registro: packages/ui/app/lib/icons.ts (nombre semántico → Lucide). Para agregar uno, súmalo allí.`;
</script>

<template>
  <CatalogExample title="Íconos" description="Registro semántico sobre Lucide: cada acción se ve igual en toda la app. Haz clic para copiar el uso." :code="code">
    <div class="space-y-6">
      <Input v-model="term" type="search" placeholder="Buscar ícono: eliminar, usuario, dinero…" aria-label="Buscar ícono" class="max-w-sm" data-testid="icon-search" />
      <p v-if="!groups.length" class="text-muted-foreground text-sm">Ningún ícono coincide.</p>
      <section v-for="g in groups" :key="g.title" class="space-y-2">
        <h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{{ g.title }}</h3>
        <ul class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <li v-for="n in g.names" :key="n">
            <button
              type="button"
              class="hover:bg-accent focus-visible:ring-ring/50 flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left outline-none focus-visible:ring-3"
              :title="`Copiar <AppIcon name=&quot;${n}&quot; />`"
              :data-testid="`icon-tile-${n}`"
              @click="copy(n)"
            >
              <AppIcon :name="n" class="size-5" />
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium">{{ n }}</span>
                <span class="text-muted-foreground block truncate text-xs">{{ ICON_LUCIDE[n] }}</span>
              </span>
            </button>
          </li>
        </ul>
      </section>
    </div>
  </CatalogExample>
</template>
