<script setup lang="ts">
import { adminPermissionsList, adminRolesCreate, adminRolesList } from '@starter/api-client';
import { CreateRoleInput } from '@starter/contracts';
import { Plus, ShieldCheck } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Badge } from '#ui/components/ui/badge';
import { Input } from '#ui/components/ui/input';
import { Textarea } from '#ui/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#ui/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Alert, AlertDescription } from '#ui/components/ui/alert';

definePageMeta({ permission: 'roles.read' });
useHead({ title: 'Roles' });
const api = useApi();
const can = useCan();
const { data: roles, refresh } = await useAsyncData('roles', () => unwrap(adminRolesList({ client: api })));
const { data: catalog } = await useAsyncData('perm-catalog', async () => (can('permissions.read') ? unwrap(adminPermissionsList({ client: api })) : []));

const open = ref(false);
const form = useZodForm(CreateRoleInput, { key: '', name: '', description: null, rank: 40, scope: 'platform', permissions: [] });
const perms = ref<string[]>([]);
const description = nullableModel(form.values, 'description');
const submit = form.handleSubmit(async (values) => {
  const role = await unwrap(adminRolesCreate({ client: api, body: { ...values, permissions: perms.value } }));
  toast.success(`Rol ${role.name} creado`);
  open.value = false;
  form.reset();
  perms.value = [];
  await refresh();
  await navigateTo(`/admin/roles/${role.id}`);
});
const mine = computed(() => new Set(useMe().value?.permissions ?? []));
</script>

<template>
  <PageHeader title="Roles" description="Agrupan permisos. La jerarquía impide administrar roles iguales o superiores al propio.">
    <template #actions>
      <Button variant="outline" as-child><NuxtLink to="/admin/permissions">Matriz de permisos</NuxtLink></Button>
      <Button v-if="can('roles.manage')" data-testid="role-create-open" @click="open = true"><Plus class="size-4" /> Nuevo rol</Button>
    </template>
  </PageHeader>
  <div class="overflow-x-auto rounded-md border">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Rol</TableHead>
          <TableHead>Clave</TableHead>
          <TableHead class="text-right">Jerarquía</TableHead>
          <TableHead class="text-right">Permisos</TableHead>
          <TableHead class="text-right">Usuarios</TableHead>
          <TableHead>Tipo</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="r in roles" :key="r.id" :data-testid="`role-row-${r.key}`">
          <TableCell><NuxtLink :to="`/admin/roles/${r.id}`" class="font-medium hover:underline">{{ r.name }}</NuxtLink><p class="text-muted-foreground text-xs">{{ r.description }}</p></TableCell>
          <TableCell><code class="text-xs">{{ r.key }}</code></TableCell>
          <TableCell class="text-right tabular-nums">{{ r.rank }}</TableCell>
          <TableCell class="text-right tabular-nums">{{ r.permissionCount }}</TableCell>
          <TableCell class="text-right tabular-nums">{{ r.userCount }}</TableCell>
          <TableCell><Badge :variant="r.isSystem ? 'secondary' : 'outline'">{{ r.isSystem ? 'Sistema' : 'Personalizado' }}</Badge></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
  <EmptyState v-if="roles && !roles.length" title="Sin roles" :icon="ShieldCheck" />

  <Dialog v-model:open="open">
    <DialogContent class="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Nuevo rol</DialogTitle>
        <DialogDescription>Solo puedes incluir permisos que posees; los sensibles requieren propietario.</DialogDescription>
      </DialogHeader>
      <form id="role-create" class="grid gap-4 sm:grid-cols-2" novalidate data-testid="role-create-form" @submit="submit">
        <Field :data-invalid="!!form.errors.name">
          <FieldLabel for="rc-name">Nombre</FieldLabel>
          <Input id="rc-name" v-model="form.values.name" data-testid="role-create-name" />
          <FieldError :errors="[form.errors.name]" />
        </Field>
        <Field :data-invalid="!!form.errors.key">
          <FieldLabel for="rc-key">Clave</FieldLabel>
          <Input id="rc-key" v-model="form.values.key" placeholder="soporte" data-testid="role-create-key" />
          <FieldError :errors="[form.errors.key]" />
        </Field>
        <Field class="sm:col-span-2">
          <FieldLabel for="rc-desc">Descripción</FieldLabel>
          <Textarea id="rc-desc" v-model="description" rows="2" />
        </Field>
        <Field :data-invalid="!!form.errors.rank">
          <FieldLabel for="rc-rank">Jerarquía (1–99)</FieldLabel>
          <Input id="rc-rank" v-model.number="form.values.rank" type="number" min="1" max="99" />
          <FieldDescription>Debe ser menor a la tuya.</FieldDescription>
          <FieldError :errors="[form.errors.rank]" />
        </Field>
        <div v-if="catalog?.length && can('permissions.manage')" class="sm:col-span-2">
          <PermissionGroups v-model="perms" :permissions="catalog" :grantable="(k) => mine.has(k)" />
        </div>
        <Alert v-if="form.formError.value" variant="destructive" class="sm:col-span-2"><AlertDescription>{{ form.formError.value }}</AlertDescription></Alert>
      </form>
      <DialogFooter><Button type="submit" form="role-create" :disabled="form.submitting.value" data-testid="role-create-submit">Crear rol</Button></DialogFooter>
    </DialogContent>
  </Dialog>
</template>
