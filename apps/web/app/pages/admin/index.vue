<script setup lang="ts">
import { adminDashboard } from '@starter/api-client';
import { Bot, Database, DollarSign, Users } from '@lucide/vue';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Button } from '#ui/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '#ui/components/ui/alert';
import { formatDate, formatUsd } from '#ui/lib/format';

useHead({ title: 'Inicio' });
const me = useMe();
const can = useCan();
const { data, status } = await useAsyncData('dashboard', () => unwrap(adminDashboard({ client: useApi() })));
const loading = computed(() => status.value === 'pending');
const CHECK_LABELS: Record<string, string> = { database: 'Base de datos', migrations: 'Migraciones', worker: 'Worker (trabajos en segundo plano)', contributor: 'Módulos' };
</script>

<template>
  <PageHeader title="Inicio" :description="`Hola${me?.user.name ? `, ${me.user.name}` : ''}. Estado general de ${me?.organization.name}.`" />

  <Alert v-if="me?.features.ai && data && !data.ai.configured && can('ai.providers.manage')" data-testid="ai-setup-hint">
    <Bot class="size-4" />
    <AlertTitle>Conecta un proveedor de IA</AlertTitle>
    <AlertDescription class="flex flex-wrap items-center gap-2">
      El asistente flotante necesita una conexión, un modelo verificado y un agente publicado.
      <Button size="sm" as-child><NuxtLink to="/admin/ai/connections">Configurar IA</NuxtLink></Button>
    </AlertDescription>
  </Alert>

  <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <StatCard v-if="can('users.read')" title="Usuarios activos" :value="data?.users.active" :hint="`${data?.users.disabled ?? 0} desactivados · ${data?.users.pendingInvitations ?? 0} invitaciones`" :icon="Users" :loading="loading" />
    <StatCard v-if="me?.features.ai && can('ai.usage.read')" title="Costo IA (7 días)" :value="data ? formatUsd(data.ai.cost7dUsd, 2) : null" :hint="`${data?.ai.requests7d ?? 0} solicitudes${data?.ai.unknownCostRequests7d ? ` · ${data.ai.unknownCostRequests7d} con costo desconocido` : ''}`" :icon="DollarSign" :loading="loading" />
    <StatCard v-if="me?.features.ai" title="Agentes publicados" :value="data?.ai.agentsPublished" :hint="`${data?.ai.connections ?? 0} conexiones`" :icon="Bot" :loading="loading" />
    <StatCard v-if="me?.features.rag && can('rag.collections.read')" title="Documentos" :value="data?.rag.documents" :hint="data?.rag.enabled ? `${data.rag.collections} colecciones · ${data.rag.runningJobs} trabajos en curso` : 'RAG desactivado'" :icon="Database" :loading="loading" />
  </div>

  <div class="grid gap-6 lg:grid-cols-3">
    <Card>
      <CardHeader><CardTitle>Salud del sistema</CardTitle><CardDescription>Versión {{ data?.health.version }}</CardDescription></CardHeader>
      <CardContent>
        <ul class="space-y-2 text-sm" data-testid="health-checks">
          <li v-for="(c, name) in data?.health.checks" :key="name" class="flex items-center justify-between gap-2">
            <span>{{ CHECK_LABELS[name] ?? name }}</span>
            <span class="flex items-center gap-2"><span class="text-muted-foreground text-xs">{{ c.detail }}</span><StatusBadge :status="c.status" /></span>
          </li>
        </ul>
      </CardContent>
    </Card>
    <Card v-if="can('audit.read')" class="lg:col-span-2">
      <CardHeader class="flex flex-row items-center justify-between"><CardTitle>Actividad reciente</CardTitle><Button variant="link" size="sm" as-child><NuxtLink to="/admin/audit">Ver auditoría</NuxtLink></Button></CardHeader>
      <CardContent>
        <ul class="divide-y text-sm">
          <li v-for="e in data?.recentAudit" :key="e.id" class="flex flex-wrap items-center gap-2 py-2">
            <span class="text-muted-foreground w-36 shrink-0 text-xs">{{ formatDate(e.occurredAt) }}</span>
            <code class="text-xs">{{ e.action }}</code>
            <StatusBadge :status="e.outcome" />
            <span class="text-muted-foreground truncate text-xs">{{ e.actorEmail ?? e.actorType }}</span>
          </li>
          <li v-if="!data?.recentAudit.length" class="text-muted-foreground py-2">Sin actividad</li>
        </ul>
      </CardContent>
    </Card>
  </div>
</template>
