<script setup lang="ts">
import { adminPermissionsList, adminRolesDelete, adminRolesGet, adminRolesSetPermissions, adminRolesUpdate } from '@starter/api-client';
import { UpdateRoleInput } from '@starter/contracts';
import { ArrowLeft, Lock, Trash2 } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Input } from '#ui/components/ui/input';
import { Textarea } from '#ui/components/ui/textarea';
import { Field, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Alert, AlertDescription, AlertTitle } from '#ui/components/ui/alert';

definePageMeta({ permission: 'roles.read', breadcrumb: 'Detalle' });
const route = useRoute();
const api = useApi();
const notify = useNotify();
const can = useCan();
const { confirm } = useConfirm();
const id = computed(() => String(route.params.id));
const { data: role, refresh, problem } = await useApiData(`role-${id.value}`, () => unwrap(adminRolesGet({ client: api, path: { id: id.value } })), { fatal: [404] });
const { data: catalog } = await useAsyncData('perm-catalog', async () => (can('permissions.read') ? unwrap(adminPermissionsList({ client: api })) : []));
useHead({ title: computed(() => role.value?.name ?? 'Rol') });

const form = useZodForm(UpdateRoleInput, { name: '', description: null, rank: 40 });
const perms = ref<string[]>([]);
const description = nullableModel(form.values, 'description');
watch(
  role,
  (r) => {
    if (!r) return;
    form.reset({ name: r.name, description: r.description, rank: r.rank });
    perms.value = [...r.permissions];
  },
  { immediate: true },
);
const mine = computed(() => new Set(useMe().value?.permissions ?? []));
const dirtyPerms = computed(() => JSON.stringify([...perms.value].sort()) !== JSON.stringify([...(role.value?.permissions ?? [])].sort()));

const save = form.handleSubmit(async (values) => {
  role.value = await unwrap(adminRolesUpdate({ client: api, path: { id: id.value }, body: { ...values, expectedVersion: role.value?.version } }));
  toast.success('Rol actualizado');
});
async function savePerms() {
  if (!role.value) return;
  const added = perms.value.filter((p) => !role.value!.permissions.includes(p));
  const removed = role.value.permissions.filter((p) => !perms.value.includes(p));
  if (!(await confirm({ title: `¿Aplicar cambios de permisos a ${role.value.name}?`, description: `Se agregan ${added.length} y se quitan ${removed.length}. Afecta a ${role.value.userCount} usuario(s).`, confirmLabel: 'Aplicar' }))) return;
  try {
    role.value = await unwrap(adminRolesSetPermissions({ client: api, path: { id: id.value }, body: { permissions: perms.value, expectedVersion: role.value.version } }));
    toast.success('Permisos actualizados');
  } catch (err) {
    notify.error(err);
    await refresh();
  }
}
async function remove() {
  if (!role.value) return;
  if (!(await confirm({ title: `¿Eliminar el rol ${role.value.name}?`, confirmLabel: 'Eliminar', destructive: true }))) return;
  try {
    await adminRolesDelete({ client: api, path: { id: id.value } });
    toast.success('Rol eliminado');
    await navigateTo('/admin/roles');
  } catch (err) {
    notify.error(err);
  }
}
</script>

<template>
  <div><Button variant="ghost" size="sm" as-child><NuxtLink to="/admin/roles"><ArrowLeft class="size-4" /> Roles</NuxtLink></Button></div>
  <LoadError v-if="problem" :error="problem" @retry="refresh()" />
  <template v-if="role">
    <PageHeader :title="role.name" :description="`Clave ${role.key} · jerarquía ${role.rank} · ${role.userCount} usuario(s)`">
      <template #actions>
        <Button v-if="role.editable && !role.isSystem" variant="destructive" data-testid="role-delete" @click="remove"><Trash2 class="size-4" /> Eliminar</Button>
      </template>
    </PageHeader>
    <Alert v-if="!role.editable">
      <Lock class="size-4" />
      <AlertTitle>Solo lectura</AlertTitle>
      <AlertDescription>{{ role.key === 'owner' ? 'El rol propietario tiene todos los permisos y no se puede modificar.' : 'No puedes administrar este rol: su jerarquía es igual o superior a la tuya o no tienes permiso.' }}</AlertDescription>
    </Alert>
    <Card>
      <CardHeader><CardTitle>Datos del rol</CardTitle></CardHeader>
      <CardContent>
        <form class="grid gap-4 sm:grid-cols-3" novalidate @submit="save">
          <Field :data-invalid="!!form.errors.name"><FieldLabel for="re-name">Nombre</FieldLabel><Input id="re-name" v-model="form.values.name" :disabled="!role.editable" /><FieldError :errors="[form.errors.name]" /></Field>
          <Field><FieldLabel for="re-rank">Jerarquía</FieldLabel><Input id="re-rank" v-model.number="form.values.rank" type="number" min="1" max="99" :disabled="!role.editable || role.isSystem" /></Field>
          <Field class="sm:col-span-3"><FieldLabel for="re-desc">Descripción</FieldLabel><Textarea id="re-desc" v-model="description" rows="2" :disabled="!role.editable" /></Field>
          <Alert v-if="form.formError.value" variant="destructive" class="sm:col-span-3"><AlertDescription>{{ form.formError.value }}</AlertDescription></Alert>
          <div v-if="role.editable" class="sm:col-span-3"><Button type="submit" :disabled="form.submitting.value">Guardar</Button></div>
        </form>
      </CardContent>
    </Card>
    <Card v-if="catalog?.length">
      <CardHeader>
        <CardTitle>Permisos</CardTitle>
        <CardDescription>Solo se muestran permisos implementados. No puedes conceder permisos que no posees.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <PermissionGroups v-model="perms" :permissions="catalog" :disabled="!role.editable || !can('permissions.manage')" :grantable="(k) => mine.has(k)" />
        <Button v-if="role.editable && can('permissions.manage')" :disabled="!dirtyPerms" data-testid="role-save-permissions" @click="savePerms">Guardar permisos</Button>
      </CardContent>
    </Card>
  </template>
</template>
