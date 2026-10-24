<script setup lang="ts">
import { adminProposalsCancel, adminProposalsConfirm, adminProposalsGet, type ActionProposal } from '@starter/api-client';
import { ArrowRight, ShieldAlert } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Badge } from '#ui/components/ui/badge';
import RelativeTime from '#ui/components/common/RelativeTime.vue';

/**
 * Pending change prepared by the assistant. Only these buttons can apply it: the confirmation is
 * bound to the stored proposal (actor, arguments, target version, expiry, single use).
 */
const props = defineProps<{ proposal: ActionProposal }>();
const emit = defineEmits<{ decided: [{ status: string; title: string; href: string | null }] }>();
const api = useApi();
const current = ref<ActionProposal>(props.proposal);
const busy = ref(false);
const error = ref<string | null>(null);
const href = ref<string | null>(null);

onMounted(async () => {
  // Reflect the real state (executed / expired / cancelled) after reloads.
  try {
    current.value = await unwrap(adminProposalsGet({ client: api, path: { id: props.proposal.id } }));
  } catch {
    /* keep the streamed snapshot */
  }
});

const destructive = computed(() => /delete|disable|removeRole/.test(current.value.action));
const fmt = (v: unknown) => (Array.isArray(v) ? v.join(', ') || '—' : v === true ? 'sí' : v === false ? 'no' : v === null || v === undefined ? '—' : String(v));

async function confirmIt() {
  busy.value = true;
  error.value = null;
  try {
    const r = await unwrap(adminProposalsConfirm({ client: api, path: { id: current.value.id } }));
    current.value = r.proposal;
    href.value = r.href;
    toast.success('Cambio aplicado', { description: current.value.title });
    emit('decided', { status: 'executed', title: current.value.title, href: r.href });
    // Tables on the current page reflect the change without a manual reload.
    await refreshNuxtData();
  } catch (err) {
    error.value = apiError(err).message;
    try {
      current.value = await unwrap(adminProposalsGet({ client: api, path: { id: current.value.id } }));
    } catch {
      /* ignore */
    }
  } finally {
    busy.value = false;
  }
}
async function cancelIt() {
  busy.value = true;
  try {
    current.value = await unwrap(adminProposalsCancel({ client: api, path: { id: current.value.id } }));
    emit('decided', { status: 'cancelled', title: current.value.title, href: null });
  } catch (err) {
    error.value = apiError(err).message;
  } finally {
    busy.value = false;
  }
}
const STATUS: Record<string, string> = { pending: 'Pendiente', executing: 'Ejecutando', executed: 'Aplicado', cancelled: 'Cancelado', expired: 'Vencido', failed: 'Falló' };
</script>

<template>
  <div class="bg-card space-y-3 rounded-lg border p-3 text-sm shadow-xs" role="group" :aria-label="current.title" data-testid="proposal-card" :data-status="current.status">
    <div class="flex items-start justify-between gap-2">
      <div class="flex items-start gap-2">
        <ShieldAlert class="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <p class="font-medium">{{ current.title }}</p>
          <NuxtLink v-if="current.target.href" :to="current.target.href" class="text-muted-foreground text-xs underline-offset-4 hover:underline">{{ current.target.label }}</NuxtLink>
          <p v-else class="text-muted-foreground text-xs">{{ current.target.label }}</p>
        </div>
      </div>
      <Badge :variant="current.status === 'executed' ? 'default' : current.status === 'pending' ? 'secondary' : 'outline'" data-testid="proposal-status">{{ STATUS[current.status] ?? current.status }}</Badge>
    </div>
    <ul class="space-y-1">
      <li v-for="(c, i) in current.changes" :key="i" class="flex flex-wrap items-center gap-1.5 text-xs">
        <span class="font-medium">{{ c.field }}:</span>
        <span class="text-muted-foreground line-through">{{ fmt(c.before) }}</span>
        <ArrowRight class="size-3" aria-hidden="true" />
        <span>{{ fmt(c.after) }}</span>
      </li>
    </ul>
    <ul v-if="current.effects.length" class="text-muted-foreground list-disc space-y-0.5 pl-4 text-xs">
      <li v-for="e in current.effects" :key="e">{{ e }}</li>
    </ul>
    <p v-if="error" class="text-destructive text-xs" role="alert">{{ error }}</p>
    <div v-if="current.status === 'pending'" class="flex items-center justify-between gap-2">
      <span class="text-muted-foreground text-xs">Vence <RelativeTime :value="current.expiresAt" /></span>
      <span class="flex gap-2">
        <Button size="sm" variant="ghost" :disabled="busy" data-testid="proposal-cancel" @click="cancelIt">Cancelar</Button>
        <Button size="sm" :variant="destructive ? 'destructive' : 'default'" :disabled="busy" data-testid="proposal-confirm" @click="confirmIt">Confirmar</Button>
      </span>
    </div>
    <NuxtLink v-else-if="current.status === 'executed' && (href || current.target.href)" :to="href ?? current.target.href!" class="text-xs underline-offset-4 hover:underline">Ver resultado</NuxtLink>
    <p v-else-if="current.error" class="text-muted-foreground text-xs">{{ current.error }}</p>
  </div>
</template>
