<script setup lang="ts">
import {
  adminAuditList,
  adminUsersAssignRole,
  adminUsersDelete,
  adminUsersDisable,
  adminUsersEnable,
  adminUsersGet,
  adminUsersRemoveRole,
  adminUsersRevokeSessions,
  adminUsersUpdate,
} from '@starter/api-client';
import { UpdateUserInput } from '@starter/contracts';
import { ArrowLeft, LogOut, Trash2, UserCheck, UserX, X } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Input } from '#ui/components/ui/input';
import { Badge } from '#ui/components/ui/badge';
import { Field, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Alert, AlertDescription } from '#ui/components/ui/alert';
import { Skeleton } from '#ui/components/ui/skeleton';
import { formatDate } from '#ui/lib/format';

definePageMeta({ permission: 'users.read', breadcrumb: 'Detalle' });

const route = useRoute();
const api = useApi();
const can = useCan();
const me = useMe();
const { confirm } = useConfirm();
const id = computed(() => String(route.params.id));

const { data: user, refresh, error } = await useAsyncData(`user-${id.value}`, () => unwrap(adminUsersGet({ client: api, path: { id: id.value } })));
const { data: audit, refresh: refreshAudit } = await useAsyncData(`user-audit-${id.value}`, async () =>
  can('audit.read') ? unwrap(adminAuditList({ client: api, query: { resourceId: id.value, page: 1, pageSize: 10 } })) : null,
);
useHead({ title: computed(() => user.value?.name || user.value?.email || 'Usuario') });

const isSelf = computed(() => me.value?.user.id === id.value);
const form = useZodForm(UpdateUserInput, { name: '', locale: null, timezone: null });
watch(
  user,
  (u) => {
    if (u) form.reset({ name: u.name, locale: u.locale, timezone: u.timezone });
  },
  { immediate: true },
);

const locale = nullableModel(form.values, 'locale');
const timezone = nullableModel(form.values, 'timezone');
const save = form.handleSubmit(async (values) => {
  user.value = await unwrap(adminUsersUpdate({ client: api, path: { id: id.value }, body: { ...values, expectedVersion: user.value?.version } }));
  toast.success('Cambios guardados');
  await refreshAudit();
});

const newRole = ref<string | undefined>();
async function assignRole() {
  if (!newRole.value) return;
  try {
    user.value = await unwrap(adminUsersAssignRole({ client: api, path: { id: id.value }, body: { roleId: newRole.value } }));
    newRole.value = undefined;
    toast.success('Rol asignado');
    await refreshAudit();
  } catch (err) {
    toast.error(apiError(err).message);
  }
}
async function removeRole(roleId: string, name: string, organizationId: string | null) {
  if (!(await confirm({ title: `¿Quitar el rol ${name}?`, description: 'Perderá los permisos de ese rol en su siguiente solicitud.', confirmLabel: 'Quitar rol', destructive: true }))) return;
  try {
    user.value = await unwrap(adminUsersRemoveRole({ client: api, path: { id: id.value, roleId }, query: organizationId ? { organizationId } : {} }));
    toast.success('Rol quitado');
    await refreshAudit();
  } catch (err) {
    toast.error(apiError(err).message);
  }
}
async function toggle() {
  if (!user.value) return;
  try {
    if (user.value.status === 'disabled') user.value = await unwrap(adminUsersEnable({ client: api, path: { id: id.value } }));
    else {
      if (!(await confirm({ title: '¿Desactivar este usuario?', description: 'Se cerrarán todas sus sesiones.', confirmLabel: 'Desactivar', destructive: true }))) return;
      user.value = await unwrap(adminUsersDisable({ client: api, path: { id: id.value }, body: {} }));
    }
    toast.success('Estado actualizado');
    await refreshAudit();
  } catch (err) {
    toast.error(apiError(err).message);
  }
}
async function revoke() {
  if (!(await confirm({ title: '¿Cerrar todas sus sesiones?', confirmLabel: 'Cerrar sesiones' }))) return;
  try {
    const r = await unwrap(adminUsersRevokeSessions({ client: api, path: { id: id.value } }));
    toast.success(`${r.revoked} sesión(es) cerrada(s)`);
    await refresh();
  } catch (err) {
    toast.error(apiError(err).message);
  }
}
async function remove() {
  if (!user.value) return;
  if (!(await confirm({ title: `¿Eliminar a ${user.value.email}?`, description: 'Acción irreversible. La auditoría se conserva.', confirmLabel: 'Eliminar', destructive: true, typeToConfirm: user.value.email }))) return;
  try {
    await adminUsersDelete({ client: api, path: { id: id.value } });
    toast.success('Usuario eliminado');
    await navigateTo('/admin/users');
  } catch (err) {
    toast.error(apiError(err).message);
  }
}
</script>

<template>
  <div class="flex items-center gap-2">
    <Button variant="ghost" size="sm" as-child><NuxtLink to="/admin/users"><ArrowLeft class="size-4" /> Usuarios</NuxtLink></Button>
  </div>
  <Alert v-if="error" variant="destructive"><AlertDescription>{{ apiError(error).message }}</AlertDescription></Alert>
  <template v-else-if="user">
    <PageHeader :title="user.name || user.email" :description="user.email">
      <template #actions>
        <StatusBadge :status="user.status" />
        <Button v-if="can('users.disable') && !isSelf" variant="outline" data-testid="user-detail-toggle" @click="toggle">
          <UserCheck v-if="user.status === 'disabled'" class="size-4" /><UserX v-else class="size-4" />
          {{ user.status === 'disabled' ? 'Reactivar' : 'Desactivar' }}
        </Button>
        <Button v-if="can('users.disable')" variant="outline" @click="revoke"><LogOut class="size-4" /> Cerrar sesiones ({{ user.sessionCount }})</Button>
        <Button v-if="can('users.delete') && !isSelf" variant="destructive" data-testid="user-detail-delete" @click="remove"><Trash2 class="size-4" /> Eliminar</Button>
      </template>
    </PageHeader>

    <div class="grid gap-6 lg:grid-cols-3">
      <Card class="lg:col-span-2">
        <CardHeader><CardTitle>Datos</CardTitle><CardDescription>Creado {{ formatDate(user.createdAt) }} · último ingreso {{ formatDate(user.lastLoginAt) }}</CardDescription></CardHeader>
        <CardContent>
          <form class="grid gap-4 sm:grid-cols-2" novalidate data-testid="user-edit-form" @submit="save">
            <Field :data-invalid="!!form.errors.name" class="sm:col-span-2">
              <FieldLabel for="ue-name">Nombre</FieldLabel>
              <Input id="ue-name" v-model="form.values.name" :disabled="!can('users.update')" data-testid="user-edit-name" />
              <FieldError :errors="[form.errors.name]" />
            </Field>
            <Field>
              <FieldLabel for="ue-locale">Idioma</FieldLabel>
              <Input id="ue-locale" v-model="locale" placeholder="es-CL" :disabled="!can('users.update')" />
            </Field>
            <Field>
              <FieldLabel for="ue-tz">Zona horaria</FieldLabel>
              <Input id="ue-tz" v-model="timezone" placeholder="America/Santiago" :disabled="!can('users.update')" />
            </Field>
            <Alert v-if="form.formError.value" variant="destructive" class="sm:col-span-2"><AlertDescription>{{ form.formError.value }}</AlertDescription></Alert>
            <div v-if="can('users.update')" class="sm:col-span-2"><Button type="submit" :disabled="form.submitting.value" data-testid="user-edit-save">Guardar</Button></div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Roles</CardTitle><CardDescription>Los cambios aplican en la siguiente solicitud del usuario.</CardDescription></CardHeader>
        <CardContent class="space-y-3">
          <ul class="space-y-2" data-testid="user-roles">
            <li v-for="r in user.roles" :key="r.id + (r.organizationId ?? '')" class="flex items-center justify-between gap-2">
              <span>{{ r.name }} <Badge v-if="r.organizationId" variant="outline" class="ml-1">organización</Badge></span>
              <Button v-if="can('roles.manage') && !isSelf" variant="ghost" size="icon" :aria-label="`Quitar rol ${r.name}`" @click="removeRole(r.id, r.name, r.organizationId)"><X class="size-4" /></Button>
            </li>
            <li v-if="!user.roles.length" class="text-muted-foreground text-sm">Sin roles</li>
          </ul>
          <div v-if="can('roles.manage') && !isSelf" class="flex gap-2">
            <RoleSelect v-model="newRole" :exclude="user.roles.map((r) => r.id)" placeholder="Agregar rol" />
            <Button :disabled="!newRole" data-testid="user-assign-role" @click="assignRole">Asignar</Button>
          </div>
          <p v-if="isSelf" class="text-muted-foreground text-xs">No puedes cambiar tus propios roles.</p>
        </CardContent>
      </Card>
    </div>

    <Card v-if="audit">
      <CardHeader><CardTitle>Actividad reciente</CardTitle></CardHeader>
      <CardContent>
        <ul class="divide-y text-sm">
          <li v-for="e in audit.items" :key="e.id" class="flex flex-wrap items-center gap-2 py-2">
            <span class="text-muted-foreground w-40 shrink-0 text-xs">{{ formatDate(e.occurredAt) }}</span>
            <code class="text-xs">{{ e.action }}</code>
            <StatusBadge :status="e.outcome" />
            <span class="text-muted-foreground text-xs">por {{ e.actorEmail ?? e.actorType }}</span>
          </li>
          <li v-if="!audit.items.length" class="text-muted-foreground py-2">Sin actividad registrada</li>
        </ul>
      </CardContent>
    </Card>
  </template>
  <Skeleton v-else class="h-64 w-full" />
</template>
