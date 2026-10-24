<script setup lang="ts">
import { adminDiagnostics } from '@starter/api-client';
import { RefreshCw } from '@lucide/vue';
import { Button } from '#ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Badge } from '#ui/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { formatDate } from '#ui/lib/format';

definePageMeta({ permission: 'system.diagnostics' });
useHead({ title: 'Diagnósticos' });
const { data, refresh, status } = await useAsyncData('diagnostics', () => unwrap(adminDiagnostics({ client: useApi() })));
</script>

<template>
  <PageHeader title="Diagnósticos" description="Vista informativa. Las actualizaciones se aplican mediante PRs verificados por CI, nunca desde el contenedor.">
    <template #actions><Button variant="outline" :disabled="status === 'pending'" @click="refresh()"><RefreshCw class="size-4" /> Actualizar</Button></template>
  </PageHeader>
  <div v-if="data" class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
    <Card><CardHeader><CardTitle class="text-sm">Starter</CardTitle></CardHeader><CardContent class="text-2xl font-semibold">{{ data.starterVersion }}</CardContent></Card>
    <Card><CardHeader><CardTitle class="text-sm">Node.js</CardTitle><CardDescription>{{ data.node.lts ? `LTS ${data.node.lts}` : 'Current' }}</CardDescription></CardHeader><CardContent class="flex items-center gap-2 text-2xl font-semibold">{{ data.node.version }} <StatusBadge :status="data.node.supported ? 'ok' : 'degraded'" /></CardContent></Card>
    <Card><CardHeader><CardTitle class="text-sm">PostgreSQL</CardTitle><CardDescription>pgvector: {{ data.database.pgvector ?? 'no disponible' }}</CardDescription></CardHeader><CardContent class="text-sm">{{ data.database.version }} · {{ data.database.migrations }} migraciones</CardContent></Card>
    <Card><CardHeader><CardTitle class="text-sm">Trabajos</CardTitle><CardDescription>Worker visto {{ formatDate(data.jobs.workerSeenAt) }}</CardDescription></CardHeader><CardContent class="text-sm">{{ data.jobs.queued }} en cola · {{ data.jobs.active }} activos · {{ data.jobs.failed24h }} fallidos (24 h)</CardContent></Card>
    <Card><CardHeader><CardTitle class="text-sm">Correo</CardTitle></CardHeader><CardContent class="flex items-center gap-2 text-sm"><Badge variant="secondary">{{ data.mail.transport }}</Badge><StatusBadge :status="data.mail.ok ? 'ok' : 'error'" /><span class="text-muted-foreground text-xs">{{ data.mail.detail }}</span></CardContent></Card>
    <Card><CardHeader><CardTitle class="text-sm">Almacenamiento</CardTitle></CardHeader><CardContent class="flex items-center gap-2 text-sm"><Badge variant="secondary">{{ data.storage.driver }}</Badge><StatusBadge :status="data.storage.ok ? 'ok' : 'error'" /><span class="text-muted-foreground text-xs">{{ data.storage.detail }}</span></CardContent></Card>
    <Card class="md:col-span-2"><CardHeader><CardTitle class="text-sm">Módulos</CardTitle></CardHeader><CardContent class="flex gap-2"><Badge v-for="(on, k) in data.features" :key="k" :variant="on ? 'default' : 'outline'">{{ k }}: {{ on ? 'activo' : 'inactivo' }}</Badge></CardContent></Card>
  </div>
  <Card v-if="data">
    <CardHeader><CardTitle>Versiones</CardTitle><CardDescription>Última estable detectada por el trabajo de comprobación diario.</CardDescription></CardHeader>
    <CardContent class="overflow-x-auto">
      <Table>
        <TableHeader><TableRow><TableHead>Componente</TableHead><TableHead>Instalada</TableHead><TableHead>Última estable</TableHead><TableHead>Comprobado</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader>
        <TableBody>
          <TableRow v-for="d in data.dependencies" :key="d.name">
            <TableCell class="font-mono text-xs">{{ d.name }}<span v-if="d.support" class="text-muted-foreground ml-2">{{ d.support }}</span></TableCell>
            <TableCell class="font-mono text-xs">{{ d.installed }}</TableCell>
            <TableCell class="font-mono text-xs">{{ d.latest ?? '—' }}</TableCell>
            <TableCell class="text-xs">{{ formatDate(d.checkedAt) }}</TableCell>
            <TableCell><Badge v-if="d.updateAvailable === null" variant="outline">sin comprobar</Badge><Badge v-else-if="d.updateAvailable" variant="secondary">actualización pendiente</Badge><Badge v-else>al día</Badge></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </CardContent>
  </Card>
</template>
