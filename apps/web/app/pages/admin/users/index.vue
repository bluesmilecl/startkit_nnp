<script setup lang="ts">
import { h } from 'vue';
import type { ColumnDef } from '@tanstack/vue-table';
import { adminUsersCreate, adminUsersDelete, adminUsersDisable, adminUsersEnable, adminUsersList, type UserSummary } from '@starter/api-client';
import { CreateUserInput } from '@starter/contracts';
import { MoreHorizontal, Plus, Search, Users } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Input } from '#ui/components/ui/input';
import { Checkbox } from '#ui/components/ui/checkbox';
import { Label } from '#ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '#ui/components/ui/sheet';
import { Field, FieldError, FieldLabel, FieldDescription } from '#ui/components/ui/field';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '#ui/components/ui/dropdown-menu';
import { Alert, AlertDescription } from '#ui/components/ui/alert';
import { formatDate } from '#ui/lib/format';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import StatusBadge from '~/components/shared/StatusBadge.vue';
import RoleBadges from '~/components/shared/RoleBadges.vue';

definePageMeta({ permission: 'users.read' });
useHead({ title: 'Usuarios' });

const api = useApi();
const notify = useNotify();
const can = useCan();
const { confirm } = useConfirm();
const route = useRoute();
const router = useRouter();

const query = reactive({
  page: Number(route.query.page ?? 1),
  pageSize: 20,
  search: String(route.query.search ?? ''),
  status: (route.query.status as 'active' | 'disabled' | 'pending' | undefined) ?? undefined,
  sort: 'createdAt' as 'createdAt' | 'name' | 'email' | 'lastLoginAt',
  direction: 'desc' as 'asc' | 'desc',
});
const searchInput = ref(query.search);
let debounce: ReturnType<typeof setTimeout> | undefined;
watch(searchInput, (v) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    query.search = v;
    query.page = 1;
  }, 300);
});
watch(
  () => ({ ...query }),
  (q) => router.replace({ query: { page: q.page > 1 ? q.page : undefined, search: q.search || undefined, status: q.status } }),
);

const { data, status, refresh } = await useAsyncData(
  'admin-users',
  () => unwrap(adminUsersList({ client: api, query: { ...query, search: query.search || undefined } })),
  { watch: [query] },
);

const statusFilter = computed({
  get: () => query.status ?? 'all',
  set: (v: string) => {
    query.status = v === 'all' ? undefined : (v as typeof query.status);
    query.page = 1;
  },
});

async function toggleDisabled(u: UserSummary) {
  try {
    if (u.status === 'disabled') {
      await adminUsersEnable({ client: api, path: { id: u.id } });
      toast.success(`${u.email} reactivado`);
    } else {
      const ok = await confirm({ title: `¿Desactivar a ${u.name || u.email}?`, description: 'Se cerrarán todas sus sesiones y no podrá ingresar hasta ser reactivado.', confirmLabel: 'Desactivar', destructive: true });
      if (!ok) return;
      await adminUsersDisable({ client: api, path: { id: u.id }, body: {} });
      toast.success(`${u.email} desactivado`);
    }
    await refresh();
  } catch (err) {
    notify.error(err);
  }
}

async function remove(u: UserSummary) {
  const ok = await confirm({
    title: `¿Eliminar a ${u.name || u.email}?`,
    description: 'Se revoca el acceso y se eliminan sus conversaciones y archivos. La auditoría se conserva. No se puede deshacer.',
    confirmLabel: 'Eliminar',
    destructive: true,
    typeToConfirm: u.email,
  });
  if (!ok) return;
  try {
    await adminUsersDelete({ client: api, path: { id: u.id } });
    toast.success('Usuario eliminado');
    await refresh();
  } catch (err) {
    notify.error(err);
  }
}

const columns: ColumnDef<UserSummary>[] = [
  {
    id: 'name',
    header: 'Usuario',
    enableSorting: true,
    cell: ({ row }) =>
      h('div', { class: 'flex flex-col' }, [
        h(resolveComponent('NuxtLink'), { to: `/admin/users/${row.original.id}`, class: 'font-medium hover:underline', 'data-testid': 'user-link' }, () => row.original.name || '—'),
        h('span', { class: 'text-muted-foreground text-xs' }, row.original.email),
      ]),
  },
  { id: 'roles', header: 'Roles', enableSorting: false, cell: ({ row }) => h(RoleBadges, { roles: row.original.roles }) },
  { id: 'status', header: 'Estado', enableSorting: false, cell: ({ row }) => h(StatusBadge, { status: row.original.status }) },
  { id: 'lastLoginAt', header: 'Último ingreso', enableSorting: true, cell: ({ row }) => h(RelativeTime, { value: row.original.lastLoginAt }) },
  { id: 'createdAt', header: 'Creado', enableSorting: true, cell: ({ row }) => formatDate(row.original.createdAt, { dateStyle: 'medium' }) },
  {
    id: 'actions',
    header: () => h('span', { class: 'sr-only' }, 'Acciones'),
    enableSorting: false,
    cell: ({ row }) =>
      h(DropdownMenu, null, {
        default: () => [
          h(DropdownMenuTrigger, { asChild: true }, () => h(Button, { variant: 'ghost', size: 'icon', 'aria-label': `Acciones para ${row.original.email}`, 'data-testid': 'user-actions' }, () => h(MoreHorizontal, { class: 'size-4' }))),
          h(DropdownMenuContent, { align: 'end' }, () => [
            h(DropdownMenuItem, { onClick: () => navigateTo(`/admin/users/${row.original.id}`) }, () => 'Ver y editar'),
            can('users.disable')
              ? h(DropdownMenuItem, { onClick: () => toggleDisabled(row.original), 'data-testid': 'user-toggle-disabled' }, () => (row.original.status === 'disabled' ? 'Reactivar' : 'Desactivar'))
              : null,
            can('users.delete') ? h(DropdownMenuSeparator) : null,
            can('users.delete') ? h(DropdownMenuItem, { class: 'text-destructive', onClick: () => remove(row.original), 'data-testid': 'user-delete' }, () => 'Eliminar') : null,
          ]),
        ],
      }),
  },
];

// Create user
const createOpen = ref(false);
const roleId = ref<string | undefined>();
const form = useZodForm(CreateUserInput, { email: '', name: '', roleIds: [], sendInvitation: true });
const submitCreate = form.handleSubmit(async (values) => {
  const created = await unwrap(
    adminUsersCreate({ client: api, body: { ...values, roleIds: roleId.value ? [roleId.value] : [], sendInvitation: can('users.invite') && values.sendInvitation } }),
  );
  toast.success(`Usuario ${created.email} creado`);
  createOpen.value = false;
  form.reset();
  roleId.value = undefined;
  await refresh();
});
</script>

<template>
  <PageHeader title="Usuarios" description="Cuentas, roles y estado de acceso.">
    <template #actions>
      <Button v-if="can('users.create')" data-testid="user-create-open" @click="createOpen = true"><Plus class="size-4" /> Nuevo usuario</Button>
    </template>
  </PageHeader>

  <div class="flex flex-col gap-2 sm:flex-row">
    <div class="relative flex-1">
      <Search class="text-muted-foreground absolute top-2.5 left-2.5 size-4" aria-hidden="true" />
      <Input v-model="searchInput" placeholder="Buscar por nombre o correo" class="pl-8" aria-label="Buscar usuarios" data-testid="user-search" />
    </div>
    <Select v-model="statusFilter">
      <SelectTrigger class="sm:w-48" aria-label="Filtrar por estado"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos los estados</SelectItem>
        <SelectItem value="active">Activos</SelectItem>
        <SelectItem value="pending">Pendientes</SelectItem>
        <SelectItem value="disabled">Desactivados</SelectItem>
      </SelectContent>
    </Select>
  </div>

  <EmptyState v-if="data && data.total === 0 && !query.search && !query.status" title="Aún no hay usuarios" :icon="Users" />
  <DataTable
    v-else
    :columns="columns"
    :data="data?.items ?? []"
    :total="data?.total ?? 0"
    :page="query.page"
    :page-size="query.pageSize"
    :loading="status === 'pending'"
    :sort="{ id: query.sort, desc: query.direction === 'desc' }"
    caption="Usuarios"
    @update:page="query.page = $event"
    @update:sort="(s) => { query.sort = (s?.id ?? 'createdAt') as typeof query.sort; query.direction = s?.desc === false ? 'asc' : 'desc'; }"
  />

  <Sheet v-model:open="createOpen">
    <SheetContent class="flex flex-col gap-0 sm:max-w-md">
      <SheetHeader>
        <SheetTitle>Nuevo usuario</SheetTitle>
        <SheetDescription>La persona ingresará con un código enviado a su correo.</SheetDescription>
      </SheetHeader>
      <form id="create-user" class="flex-1 space-y-4 overflow-y-auto p-4" novalidate data-testid="user-create-form" @submit="submitCreate">
        <Field :data-invalid="!!form.errors.email">
          <FieldLabel for="cu-email">Correo</FieldLabel>
          <Input id="cu-email" v-model="form.values.email" type="email" autocomplete="off" data-testid="user-create-email" />
          <FieldError :errors="[form.errors.email]" />
        </Field>
        <Field :data-invalid="!!form.errors.name">
          <FieldLabel for="cu-name">Nombre</FieldLabel>
          <Input id="cu-name" v-model="form.values.name" data-testid="user-create-name" />
          <FieldError :errors="[form.errors.name]" />
        </Field>
        <Field v-if="can('roles.manage')">
          <FieldLabel for="cu-role">Rol</FieldLabel>
          <RoleSelect id="cu-role" v-model="roleId" />
          <FieldDescription>Solo puedes asignar roles de menor jerarquía que la tuya.</FieldDescription>
        </Field>
        <div v-if="can('users.invite')" class="flex items-center gap-2">
          <Checkbox id="cu-invite" v-model="form.values.sendInvitation" />
          <Label for="cu-invite" class="font-normal">Enviar correo de invitación</Label>
        </div>
        <Alert v-if="form.formError.value" variant="destructive"><AlertDescription>{{ form.formError.value }}</AlertDescription></Alert>
      </form>
      <SheetFooter>
        <Button type="submit" form="create-user" :disabled="form.submitting.value" data-testid="user-create-submit">Crear usuario</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
