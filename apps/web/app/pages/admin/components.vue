<script setup lang="ts">
import { Badge } from '#ui/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#ui/components/ui/tabs';
import { formatClp, formatNumber, formatPercent, formatPercentChange, formatUsd } from '#ui/lib/format';
import CatalogForms from '~/components/catalog/CatalogForms.vue';
import CatalogWizard from '~/components/catalog/CatalogWizard.vue';
import CatalogData from '~/components/catalog/CatalogData.vue';
import CatalogCharts from '~/components/catalog/CatalogCharts.vue';
import CatalogCarousel from '~/components/catalog/CatalogCarousel.vue';
import CatalogActions from '~/components/catalog/CatalogActions.vue';
import CatalogFeedback from '~/components/catalog/CatalogFeedback.vue';
import CatalogIcons from '~/components/catalog/CatalogIcons.vue';

/**
 * Living catalog of the UI kit: every block renders the real component with sample data and the
 * snippet to reuse it, so screens built by people or agents stay consistent. Nothing here calls
 * the API. Each tab can be linked with ?tab=<value> (docs/frontend-components.md does).
 */
useHead({ title: 'Componentes UI' });
const route = useRoute();
const router = useRouter();
const TABS = [
  { value: 'forms', label: 'Formularios' },
  { value: 'wizard', label: 'Asistente' },
  { value: 'data', label: 'Datos y tablas' },
  { value: 'charts', label: 'Gráficos' },
  { value: 'carousel', label: 'Carrusel' },
  { value: 'actions', label: 'Botones, menús y navegación' },
  { value: 'feedback', label: 'Avisos y modales' },
  { value: 'icons', label: 'Íconos' },
  { value: 'format', label: 'Formatos' },
] as const;
// Shared between server and client render (Date.now() would differ and break hydration).
const threeHoursAgo = useState('catalog-3h-ago', () => new Date(Date.now() - 3 * 3600_000).toISOString());
const tab = computed({
  get: () => (TABS.some((t) => t.value === route.query.tab) ? String(route.query.tab) : 'forms'),
  set: (v: string) => void router.replace({ query: { ...route.query, tab: v === 'forms' ? undefined : v } }),
});
</script>

<template>
  <PageHeader title="Componentes UI" description="Kit de interfaz del starter con ejemplos vivos y el código para reutilizarlos (packages/ui y apps/web/components/shared). Úsalo como referencia al crear vistas; la guía completa está en docs/frontend-components.md.">
    <template #actions><Badge variant="outline">sin llamadas a la API</Badge></template>
  </PageHeader>

  <Tabs v-model="tab">
    <TabsList class="h-auto flex-wrap justify-start" aria-label="Familias de componentes">
      <TabsTrigger v-for="t in TABS" :key="t.value" :value="t.value" :data-testid="`catalog-tab-${t.value}`">{{ t.label }}</TabsTrigger>
    </TabsList>

    <TabsContent value="forms" class="pt-2"><CatalogForms /></TabsContent>
    <TabsContent value="wizard" class="pt-2"><CatalogWizard /></TabsContent>
    <TabsContent value="data" class="pt-2"><CatalogData /></TabsContent>
    <TabsContent value="charts" class="pt-2"><CatalogCharts /></TabsContent>
    <TabsContent value="carousel" class="pt-2"><CatalogCarousel /></TabsContent>
    <TabsContent value="actions" class="pt-2"><CatalogActions /></TabsContent>
    <TabsContent value="feedback" class="pt-2"><CatalogFeedback /></TabsContent>
    <TabsContent value="icons" class="pt-2"><CatalogIcons /></TabsContent>
    <TabsContent value="format" class="pt-2">
      <Card>
        <CardHeader><CardTitle class="text-base">Formato regional (es-CL)</CardTitle><CardDescription>Montos exactos en USD (escala 12), conversión visual a CLP, porcentajes y fechas relativas, con el locale y la zona de la persona.</CardDescription></CardHeader>
        <CardContent>
          <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <dt class="text-muted-foreground">formatUsd('0.000004') (sub-centavo)</dt><dd class="tabular-nums">{{ formatUsd('0.000004') }}</dd>
            <dt class="text-muted-foreground">formatUsd('18.4231')</dt><dd class="tabular-nums">{{ formatUsd('18.4231') }}</dd>
            <dt class="text-muted-foreground">formatClp('18.4231', 945.12)</dt><dd class="tabular-nums">{{ formatClp('18.4231', 945.12) }}</dd>
            <dt class="text-muted-foreground">formatNumber(1234567)</dt><dd class="tabular-nums">{{ formatNumber(1234567) }}</dd>
            <dt class="text-muted-foreground">formatPercent(0.62)</dt><dd class="tabular-nums">{{ formatPercent(0.62) }}</dd>
            <dt class="text-muted-foreground">formatPercentChange(-0.083)</dt><dd class="tabular-nums">{{ formatPercentChange(-0.083) }}</dd>
            <dt class="text-muted-foreground">RelativeTime (hace 3 h)</dt><dd><RelativeTime :value="threeHoursAgo" /></dd>
          </dl>
        </CardContent>
      </Card>
    </TabsContent>
  </Tabs>
</template>
