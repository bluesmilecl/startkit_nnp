<script setup lang="ts">
import { h } from 'vue';
import type { ColumnDef } from '@tanstack/vue-table';
import { projectsCreate, projectsDelete, projectsList, projectsUpdate, type Project } from '@starter/api-client';
import { CreateProjectInput } from '@starter/contracts';
import { FolderKanban, MoreHorizontal, Plus, Search } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Input } from '#ui/components/ui/input';
import { Textarea } from '#ui/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '#ui/components/ui/sheet';
import { Field, FieldError, FieldLabel } from '#ui/components/ui/field';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '#ui/components/ui/dropdown-menu';
import { Alert, AlertDescription } from '#ui/components/ui/alert';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import StatusBadge from '~/components/shared/StatusBadge.vue';

/**
 * Reference module page: server-side list (search, filter, sort, pagination synced to the URL),
 * create/edit in a sheet validated with the shared Zod contract, archive/restore and delete with
 * confirmation, and optimistic-concurrency conflicts surfaced to the user.
 */
definePageMeta({ permission: 'projects.read' });
useHead({ title: 'Proyectos' });

const api = useApi();
const can = useCan();
const { confirm } = useConfirm();
const route = useRoute();
const router = useRouter();

type Sort = 'name' | 'createdAt' | 'updatedAt';
const query = reactive({
  page: Number(route.query.page ?? 1),
  pageSize: 20,
  search: String(route.query.search ?? ''),
  status: (route.query.status as Project['status'] | undefined) ?? undefined,
  sort: 'updatedAt' as Sort,
  direction: 'desc' as 'asc' | 'desc',
});
const searchInput = ref(query.search);
let debounce: ReturnType<typeof setTimeout> | undefined;
watch(searchInput, (v) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => Object.assign(query, { search: v, page: 1 }), 300);
});
watch(
  () => ({ ...query }),
  (q) => router.replace({ query: { page: q.page > 1 ? q.page : undefined, search: q.search || undefined, status: q.status } }),
);
const { data, status, refresh } = await useAsyncData('projects', () => unwrap(projectsList({ client: api, query: { ...query, search: query.search || undefined } })), { watch: [query] });
const statusFilter = computed({
  get: () => query.status ?? 'all',
  set: (v: string) => Object.assign(query, { status: v === 'all' ? undefined : v, page: 1 }),
});

// ── create / edit ───────────────────────────────────────────────────────
const sheetOpen = ref(false);
const editing = ref<Project | null>(null);
const form = useZodForm(CreateProjectInput, { name: '', description: '' });
function openCreate() {
  editing.value = null;
  form.reset();
  sheetOpen.value = true;
}
function openEdit(p: Project) {
  editing.value = p;
  form.reset();
  Object.assign(form.values, { name: p.name, description: p.description ?? '' });
  sheetOpen.value = true;
}
const submit = form.handleSubmit(async (values) => {
  const body = { name: values.name, description: values.description || null };
  if (editing.value) {
    await projectsUpdate({ client: api, path: { id: editing.value.id }, body: { ...body, version: editing.value.version } });
    toast.success('Proyecto actualizado');
  } else {
    await projectsCreate({ client: api, body });
    toast.success('Proyecto creado');
  }
  sheetOpen.value = false;
  await refresh();
});

async function setStatus(p: Project, next: Project['status']) {
  try {
    await projectsUpdate({ client: api, path: { id: p.id }, body: { status: next, version: p.version } });
    toast.success(next === 'archived' ? `«${p.name}» archivado` : `«${p.name}» restaurado`);
  } catch (err) {
    toast.error(apiError(err).message);
  }
  await refresh();
}
async function remove(p: Project) {
  if (!(await confirm({ title: `¿Eliminar «${p.name}»?`, description: 'Se elimina de forma permanente. La auditoría conserva el registro.', confirmLabel: 'Eliminar', destructive: true, typeToConfirm: p.name }))) return;
  try {
    await projectsDelete({ client: api, path: { id: p.id } });
    toast.success('Proyecto eliminado');
    await refresh();
  } catch (err) {
    toast.error(apiError(err).message);
  }
}

const columns: ColumnDef<Project>[] = [
  {
    id: 'name',
    header: 'Proyecto',
    enableSorting: true,
    cell: ({ row }) =>
      h('div', { class: 'flex flex-col' }, [
        h('span', { class: 'font-medium', 'data-testid': 'project-name' }, row.original.name),
        row.original.description ? h('span', { class: 'text-muted-foreground line-clamp-1 max-w-md text-xs' }, row.original.description) : null,
      ]),
  },
  { id: 'status', header: 'Estado', enableSorting: false, cell: ({ row }) => h(StatusBadge, { status: row.original.status }) },
  { id: 'createdBy', header: 'Creado por', enableSorting: false, cell: ({ row }) => h('span', { class: 'text-sm' }, row.original.createdBy?.name || row.original.createdBy?.email || '—') },
  { id: 'updatedAt', header: 'Actualizado', enableSorting: true, cell: ({ row }) => h(RelativeTime, { value: row.original.updatedAt }) },
  {
    id: 'actions',
    header: () => h('span', { class: 'sr-only' }, 'Acciones'),
    enableSorting: false,
    cell: ({ row }) =>
      can('projects.manage')
        ? h(DropdownMenu, null, {
            default: () => [
              h(DropdownMenuTrigger, { asChild: true }, () => h(Button, { variant: 'ghost', size: 'icon', 'aria-label': `Acciones para ${row.original.name}`, 'data-testid': 'project-actions' }, () => h(MoreHorizontal, { class: 'size-4' }))),
              h(DropdownMenuContent, { align: 'end' }, () => [
                h(DropdownMenuItem, { onClick: () => openEdit(row.original), 'data-testid': 'project-edit' }, () => 'Editar'),
                h(DropdownMenuItem, { onClick: () => setStatus(row.original, row.original.status === 'active' ? 'archived' : 'active'), 'data-testid': 'project-toggle-archive' }, () => (row.original.status === 'active' ? 'Archivar' : 'Restaurar')),
                h(DropdownMenuSeparator),
                h(DropdownMenuItem, { class: 'text-destructive', onClick: () => remove(row.original), 'data-testid': 'project-delete' }, () => 'Eliminar'),
              ]),
            ],
          })
        : null,
  },
];
</script>

<template>
  <PageHeader title="Proyectos" description="Módulo de referencia: así se construye un módulo de negocio del starter (contrato, permisos, API, auditoría y vista).">
    <template #actions>
      <Button v-if="can('projects.manage')" data-testid="project-new" @click="openCreate"><Plus class="size-4" /> Nuevo proyecto</Button>
    </template>
  </PageHeader>

  <div class="flex flex-col gap-2 sm:flex-row">
    <div class="relative flex-1">
      <Search class="text-muted-foreground absolute top-2.5 left-2.5 size-4" aria-hidden="true" />
      <Input v-model="searchInput" placeholder="Buscar por nombre o descripción" class="pl-8" aria-label="Buscar proyectos" data-testid="project-search" />
    </div>
    <Select v-model="statusFilter">
      <SelectTrigger class="sm:w-48" aria-label="Filtrar por estado"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos los estados</SelectItem>
        <SelectItem value="active">Activos</SelectItem>
        <SelectItem value="archived">Archivados</SelectItem>
      </SelectContent>
    </Select>
  </div>

  <EmptyState v-if="data && data.total === 0 && !query.search && !query.status" title="Aún no hay proyectos" description="Crea el primero para ver cómo funciona un módulo completo." :icon="FolderKanban">
    <Button v-if="can('projects.manage')" @click="openCreate"><Plus class="size-4" /> Nuevo proyecto</Button>
  </EmptyState>
  <DataTable
    v-else
    :columns="columns"
    :data="data?.items ?? []"
    :total="data?.total ?? 0"
    :page="query.page"
    :page-size="query.pageSize"
    :loading="status === 'pending'"
    :sort="{ id: query.sort, desc: query.direction === 'desc' }"
    caption="Proyectos"
    @update:page="query.page = $event"
    @update:sort="(s) => Object.assign(query, { sort: (s?.id ?? 'updatedAt') as Sort, direction: s?.desc === false ? 'asc' : 'desc' })"
  />

  <Sheet v-model:open="sheetOpen">
    <SheetContent class="flex flex-col gap-0 sm:max-w-md">
      <SheetHeader>
        <SheetTitle>{{ editing ? 'Editar proyecto' : 'Nuevo proyecto' }}</SheetTitle>
        <SheetDescription>{{ editing ? `Versión ${editing.version}: si alguien lo cambia antes de guardar, se te avisará.` : 'Visible para quienes tienen el permiso de ver proyectos.' }}</SheetDescription>
      </SheetHeader>
      <form id="project-form" class="flex-1 space-y-4 overflow-y-auto p-4" novalidate @submit="submit">
        <Field :data-invalid="!!form.errors.name">
          <FieldLabel for="pj-name">Nombre</FieldLabel>
          <Input id="pj-name" v-model="form.values.name" data-testid="project-form-name" />
          <FieldError :errors="[form.errors.name]" />
        </Field>
        <Field :data-invalid="!!form.errors.description">
          <FieldLabel for="pj-desc">Descripción</FieldLabel>
          <Textarea id="pj-desc" :model-value="form.values.description ?? ''" rows="4" data-testid="project-form-description" @update:model-value="(v) => (form.values.description = String(v))" />
          <FieldError :errors="[form.errors.description]" />
        </Field>
        <Alert v-if="form.formError.value" variant="destructive" data-testid="project-form-error"><AlertDescription>{{ form.formError.value }}</AlertDescription></Alert>
      </form>
      <SheetFooter>
        <Button type="submit" form="project-form" :disabled="form.submitting.value" data-testid="project-form-submit">{{ editing ? 'Guardar cambios' : 'Crear proyecto' }}</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
