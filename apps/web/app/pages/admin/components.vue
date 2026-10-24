<script setup lang="ts">
import { h } from 'vue';
import type { ColumnDef } from '@tanstack/vue-table';
import { z } from 'zod';
import { Bot, Inbox, Sparkles, Users } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Badge } from '#ui/components/ui/badge';
import { Input } from '#ui/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '#ui/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Field, FieldDescription, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#ui/components/ui/tabs';
import StatCard from '#ui/components/common/StatCard.vue';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import FileDropzone from '#ui/components/common/FileDropzone.vue';
import TimeSeriesChart from '#ui/components/charts/TimeSeriesChart.vue';
import DonutChart from '#ui/components/charts/DonutChart.vue';
import { formatClp, formatNumber, formatUsd } from '#ui/lib/format';
import StatusBadge from '~/components/shared/StatusBadge.vue';

/**
 * Living catalog of the shared UI: every block renders the real component with sample data, so
 * screens built by people or agents stay consistent. Nothing here calls the API.
 */
useHead({ title: 'Componentes UI' });
const { confirm } = useConfirm();

// DataTable with local sample data (in real pages the server paginates and sorts).
interface Row {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
}
const allRows: Row[] = Array.from({ length: 23 }, (_, i) => ({
  id: String(i + 1),
  name: `Registro de ejemplo ${String(i + 1).padStart(2, '0')}`,
  status: ['active', 'pending', 'disabled', 'archived'][i % 4]!,
  updatedAt: new Date(Date.UTC(2026, 9, 24 - (i % 9), 12)).toISOString(),
}));
const table = reactive({ page: 1, sort: { id: 'name', desc: false } as { id: string; desc: boolean } | null });
const sorted = computed(() => {
  const s = table.sort;
  const rows = [...allRows];
  if (s) rows.sort((a, b) => (a[s.id as keyof Row] < b[s.id as keyof Row] ? -1 : 1) * (s.desc ? -1 : 1));
  return rows.slice((table.page - 1) * 8, table.page * 8);
});
const columns: ColumnDef<Row>[] = [
  { id: 'name', header: 'Nombre', enableSorting: true, cell: ({ row }) => h('span', { class: 'font-medium' }, row.original.name) },
  { id: 'status', header: 'Estado', enableSorting: false, cell: ({ row }) => h(StatusBadge, { status: row.original.status }) },
  { id: 'updatedAt', header: 'Actualizado', enableSorting: true, cell: ({ row }) => h(RelativeTime, { value: row.original.updatedAt }) },
];

// Charts
const series = Array.from({ length: 14 }, (_, i) => ({ x: `2026-10-${String(i + 10).padStart(2, '0')}`, chat: 40 + ((i * 17) % 30), lab: 5 + ((i * 7) % 12) }));
const donut = [
  { key: 'gpt', label: 'gpt-5-mini', value: 12.4 },
  { key: 'claude', label: 'claude-sonnet', value: 8.1 },
  { key: 'emb', label: 'embeddings', value: 1.3 },
];

// Forms with the shared Zod contract pattern
const Demo = z.object({ name: z.string().trim().min(2, 'Mínimo 2 caracteres'), email: z.email('Correo inválido') });
const form = useZodForm(Demo, { name: '', email: '' });
const submit = form.handleSubmit(async (v) => {
  toast.success(`Formulario válido: ${v.name}`);
});

async function demoConfirm(kind: 'simple' | 'destructive' | 'typed') {
  const ok = await confirm(
    kind === 'simple'
      ? { title: '¿Publicar la versión 3?', description: 'El chat empezará a usarla de inmediato.', confirmLabel: 'Publicar' }
      : kind === 'destructive'
        ? { title: '¿Desactivar a Ana?', description: 'Se cerrarán todas sus sesiones.', confirmLabel: 'Desactivar', destructive: true }
        : { title: '¿Eliminar la colección «manual»?', description: 'Se purgan documentos, fragmentos y vectores.', confirmLabel: 'Eliminar', destructive: true, typeToConfirm: 'manual' },
  );
  toast(ok ? 'Confirmado' : 'Cancelado');
}
const files = ref<string[]>([]);
function onFiles(list: File[]) {
  files.value = list.map((x) => `${x.name} (${x.size} B)`);
}
function onFileError(message: string) {
  toast.error(message);
}
</script>

<template>
  <PageHeader title="Componentes UI" description="Catálogo vivo de los componentes compartidos (packages/ui y apps/web/components/shared) con datos de ejemplo. Úsalo como referencia al crear vistas.">
    <template #actions><Badge variant="outline">sin llamadas a la API</Badge></template>
  </PageHeader>

  <Tabs default-value="data">
    <TabsList class="flex-wrap">
      <TabsTrigger value="data">Datos</TabsTrigger>
      <TabsTrigger value="charts">Gráficos</TabsTrigger>
      <TabsTrigger value="forms">Formularios</TabsTrigger>
      <TabsTrigger value="feedback">Estados y diálogos</TabsTrigger>
      <TabsTrigger value="format">Formatos</TabsTrigger>
    </TabsList>

    <TabsContent value="data" class="space-y-6">
      <section class="space-y-3">
        <h2 class="text-lg font-semibold">StatCard</h2>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Usuarios activos" :value="formatNumber(128)" hint="+6 esta semana" :icon="Users" />
          <StatCard title="Costo del mes" :value="formatUsd('18.4231')" hint="62 % del presupuesto" :icon="Sparkles" />
          <StatCard title="Conversaciones" :value="formatNumber(1932)" :icon="Bot" />
          <StatCard title="Cargando" loading />
        </div>
      </section>
      <section class="space-y-3">
        <h2 class="text-lg font-semibold">DataTable</h2>
        <p class="text-muted-foreground text-sm">TanStack Table con paginación y orden controlados por el servidor (aquí, datos locales). Incluye estados de carga y vacío, y caption accesible.</p>
        <DataTable :columns="columns" :data="sorted" :total="allRows.length" :page="table.page" :page-size="8" :sort="table.sort" caption="Tabla de ejemplo" @update:page="table.page = $event" @update:sort="table.sort = $event" />
      </section>
      <section class="space-y-3">
        <h2 class="text-lg font-semibold">EmptyState</h2>
        <EmptyState title="Aún no hay registros" description="Crea el primero para comenzar." :icon="Inbox"><Button size="sm">Crear registro</Button></EmptyState>
      </section>
    </TabsContent>

    <TabsContent value="charts" class="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle class="text-base">TimeSeriesChart</CardTitle><CardDescription>Línea, área, barras o apiladas; tabla equivalente y CSV incluidos.</CardDescription></CardHeader>
        <CardContent><TimeSeriesChart title="Solicitudes por día" kind="stacked" :data="series" :series="[{ key: 'chat', label: 'Chat' }, { key: 'lab', label: 'Laboratorio' }]" csv-name="ejemplo.csv" /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle class="text-base">DonutChart</CardTitle><CardDescription>Distribución con leyenda, total y tabla.</CardDescription></CardHeader>
        <CardContent><DonutChart title="Costo por modelo" :data="donut" :value-format="(v) => formatUsd(String(v))" csv-name="distribucion.csv" /></CardContent>
      </Card>
    </TabsContent>

    <TabsContent value="forms" class="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle class="text-base">useZodForm + Field</CardTitle><CardDescription>Mismo contrato Zod que la API; los errores del servidor (VALIDATION_FAILED) vuelven a cada campo.</CardDescription></CardHeader>
        <CardContent>
          <form class="space-y-4" novalidate @submit="submit">
            <Field :data-invalid="!!form.errors.name"><FieldLabel for="demo-name">Nombre</FieldLabel><Input id="demo-name" v-model="form.values.name" /><FieldError :errors="[form.errors.name]" /></Field>
            <Field :data-invalid="!!form.errors.email"><FieldLabel for="demo-email">Correo</FieldLabel><Input id="demo-email" v-model="form.values.email" type="email" /><FieldDescription>Se valida en el cliente y en el servidor.</FieldDescription><FieldError :errors="[form.errors.email]" /></Field>
            <Button type="submit">Validar</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle class="text-base">FileDropzone</CardTitle><CardDescription>Arrastrar o seleccionar, filtro por tipo y tamaño; el servidor valida por contenido.</CardDescription></CardHeader>
        <CardContent class="space-y-3">
          <FileDropzone accept=".pdf,.md,.txt" multiple label="Arrastra PDF, Markdown o texto" @files="onFiles" @error="onFileError" />
          <ul class="text-muted-foreground text-sm"><li v-for="f in files" :key="f">{{ f }}</li></ul>
        </CardContent>
      </Card>
    </TabsContent>

    <TabsContent value="feedback" class="space-y-6">
      <section class="space-y-3">
        <h2 class="text-lg font-semibold">StatusBadge</h2>
        <div class="flex flex-wrap gap-2">
          <StatusBadge v-for="s in ['active', 'pending', 'disabled', 'ready', 'indexed', 'running', 'failed', 'succeeded', 'draft', 'published', 'archived', 'unverified']" :key="s" :status="s" />
        </div>
      </section>
      <section class="space-y-3">
        <h2 class="text-lg font-semibold">useConfirm (ConfirmHost)</h2>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" @click="demoConfirm('simple')">Confirmación simple</Button>
          <Button variant="outline" @click="demoConfirm('destructive')">Acción destructiva</Button>
          <Button variant="outline" @click="demoConfirm('typed')">Escribir para confirmar</Button>
        </div>
      </section>
      <section class="space-y-3">
        <h2 class="text-lg font-semibold">Toasts y alertas</h2>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" @click="toast.success('Guardado')">Éxito</Button>
          <Button variant="outline" @click="toast.warning('Revisa el diagnóstico')">Advertencia</Button>
          <Button variant="outline" @click="toast.error('No se pudo completar la solicitud')">Error</Button>
        </div>
        <Alert><AlertTitle>Configuración pendiente</AlertTitle><AlertDescription>Sin proveedor de IA verificado; el chat no está disponible.</AlertDescription></Alert>
        <Alert variant="destructive"><AlertTitle>Presupuesto agotado</AlertTitle><AlertDescription>Las llamadas se bloquean antes de llegar al proveedor.</AlertDescription></Alert>
      </section>
      <section class="space-y-3">
        <h2 class="text-lg font-semibold">Botones e insignias</h2>
        <div class="flex flex-wrap items-center gap-2">
          <Button>Principal</Button><Button variant="secondary">Secundario</Button><Button variant="outline">Contorno</Button><Button variant="ghost">Fantasma</Button><Button variant="destructive">Destructivo</Button><Button disabled>Deshabilitado</Button>
          <Badge>Insignia</Badge><Badge variant="secondary">Secundaria</Badge><Badge variant="outline">Contorno</Badge><Badge variant="destructive">Error</Badge>
        </div>
      </section>
    </TabsContent>

    <TabsContent value="format">
      <Card>
        <CardHeader><CardTitle class="text-base">Formato regional (es-CL)</CardTitle><CardDescription>Montos exactos en USD (escala 12), conversión visual a CLP y fechas relativas.</CardDescription></CardHeader>
        <CardContent>
          <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <dt class="text-muted-foreground">formatUsd('0.000004') (sub-centavo)</dt><dd class="tabular-nums">{{ formatUsd('0.000004') }}</dd>
            <dt class="text-muted-foreground">formatUsd('18.4231')</dt><dd class="tabular-nums">{{ formatUsd('18.4231') }}</dd>
            <dt class="text-muted-foreground">formatClp('18.4231', 945.12)</dt><dd class="tabular-nums">{{ formatClp('18.4231', 945.12) }}</dd>
            <dt class="text-muted-foreground">formatNumber(1234567)</dt><dd class="tabular-nums">{{ formatNumber(1234567) }}</dd>
            <dt class="text-muted-foreground">RelativeTime (hace 3 h)</dt><dd><RelativeTime :value="new Date(Date.now() - 3 * 3600_000).toISOString()" /></dd>
          </dl>
        </CardContent>
      </Card>
    </TabsContent>
  </Tabs>
</template>
