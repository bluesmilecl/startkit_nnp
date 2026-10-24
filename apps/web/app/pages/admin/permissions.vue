<script setup lang="ts">
import { adminPermissionsMatrix, adminRolesSetPermissions, type RoleDetail } from '@starter/api-client';
import { toast } from 'vue-sonner';
import { Checkbox } from '#ui/components/ui/checkbox';
import { Button } from '#ui/components/ui/button';
import { Badge } from '#ui/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '#ui/components/ui/tooltip';

definePageMeta({ permission: ['permissions.read', 'roles.read'] });
useHead({ title: 'Matriz de permisos' });
const api = useApi();
const can = useCan();
const { confirm } = useConfirm();
const { data, refresh } = await useAsyncData('perm-matrix', () => unwrap(adminPermissionsMatrix({ client: api })));
const draft = ref<Record<string, Set<string>>>({});
watch(
  data,
  (d) => {
    draft.value = Object.fromEntries((d?.roles ?? []).map((r) => [r.id, new Set(r.permissions)]));
  },
  { immediate: true },
);
const mine = computed(() => new Set(useMe().value?.permissions ?? []));
function toggle(role: RoleDetail, key: string, on: boolean | 'indeterminate') {
  const set = new Set(draft.value[role.id]);
  if (on === true) set.add(key);
  else set.delete(key);
  draft.value = { ...draft.value, [role.id]: set };
}
const dirtyRoles = computed(() =>
  (data.value?.roles ?? []).filter((r) => JSON.stringify([...(draft.value[r.id] ?? [])].sort()) !== JSON.stringify([...r.permissions].sort())),
);
async function save() {
  const roles = dirtyRoles.value;
  if (!(await confirm({ title: '¿Guardar cambios de la matriz?', description: `Se modificarán ${roles.length} rol(es): ${roles.map((r) => r.name).join(', ')}.`, confirmLabel: 'Guardar' }))) return;
  for (const r of roles) {
    try {
      await adminRolesSetPermissions({ client: api, path: { id: r.id }, body: { permissions: [...(draft.value[r.id] ?? [])], expectedVersion: r.version } });
    } catch (err) {
      toast.error(`${r.name}: ${apiError(err).message}`);
    }
  }
  toast.success('Matriz actualizada');
  await refresh();
}
</script>

<template>
  <PageHeader title="Matriz de permisos" description="Permisos implementados por rol. Los cambios surten efecto en la siguiente solicitud de cada usuario.">
    <template #actions>
      <Button v-if="can('permissions.manage')" :disabled="!dirtyRoles.length" data-testid="matrix-save" @click="save">Guardar cambios ({{ dirtyRoles.length }})</Button>
    </template>
  </PageHeader>
  <TooltipProvider>
    <div v-if="data" class="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader class="bg-background sticky top-0">
          <TableRow>
            <TableHead class="min-w-64">Permiso</TableHead>
            <TableHead v-for="r in data.roles" :key="r.id" class="text-center">{{ r.name }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="p in data.permissions" :key="p.key">
            <TableCell>
              <Tooltip>
                <TooltipTrigger as-child><code class="text-xs">{{ p.key }}</code></TooltipTrigger>
                <TooltipContent>{{ p.description }}</TooltipContent>
              </Tooltip>
              <Badge v-if="p.sensitive" variant="outline" class="ml-2 text-[10px]">sensible</Badge>
            </TableCell>
            <TableCell v-for="r in data.roles" :key="r.id" class="text-center">
              <Checkbox
                :model-value="draft[r.id]?.has(p.key) ?? false"
                :disabled="!r.editable || !can('permissions.manage') || (!draft[r.id]?.has(p.key) && !mine.has(p.key))"
                :aria-label="`${p.key} para ${r.name}`"
                :data-testid="`matrix-${r.key}-${p.key}`"
                @update:model-value="toggle(r, p.key, $event)"
              />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </TooltipProvider>
</template>
