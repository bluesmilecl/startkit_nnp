<script setup lang="ts">
import { Badge } from '#ui/components/ui/badge';

const props = defineProps<{ status: string }>();
type Variant = 'default' | 'secondary' | 'destructive' | 'outline';
const LABELS: Record<string, [string, Variant]> = {
  active: ['Activo', 'default'],
  disabled: ['Desactivado', 'destructive'],
  pending: ['Pendiente', 'secondary'],
  accepted: ['Aceptada', 'default'],
  revoked: ['Revocada', 'outline'],
  expired: ['Vencida', 'outline'],
  success: ['Éxito', 'default'],
  denied: ['Denegado', 'destructive'],
  failed: ['Fallido', 'destructive'],
  cancelled: ['Cancelado', 'outline'],
  ok: ['OK', 'default'],
  degraded: ['Degradado', 'secondary'],
  error: ['Error', 'destructive'],
  unverified: ['Sin verificar', 'secondary'],
  queued: ['En cola', 'secondary'],
  sent: ['Enviado', 'default'],
  running: ['En curso', 'secondary'],
  retrying: ['Reintentando', 'secondary'],
  paused: ['Pausado', 'outline'],
  succeeded: ['Completado', 'default'],
  draft: ['Borrador', 'secondary'],
  published: ['Publicado', 'default'],
  archived: ['Archivado', 'outline'],
  ready: ['Listo', 'default'],
  indexed: ['Indexado', 'default'],
  processing: ['Procesando', 'secondary'],
  deleted: ['Eliminado', 'outline'],
  skipped: ['Omitido', 'outline'],
  unknown: ['Desconocido', 'outline'],
  available: ['Disponible', 'default'],
  unavailable: ['No disponible', 'destructive'],
};
const entry = computed<[string, Variant]>(() => LABELS[props.status] ?? [props.status, 'outline']);
</script>

<template>
  <Badge :variant="entry[1]" :data-status="status">{{ entry[0] }}</Badge>
</template>
