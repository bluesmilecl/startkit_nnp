<script setup lang="ts">
import { h } from 'vue';
import type { ColumnDef } from '@tanstack/vue-table';
import { projectsCreate, projectsDelete, projectsList, projectsUpdate, type Project } from '@starter/api-client';
import { CreateProjectInput } from '@starter/contracts';
import { FolderKanban, Plus } from '@lucide/vue';
import { Button } from '#ui/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import ActionMenu from '#ui/components/common/ActionMenu.vue';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import type { FormFieldDef } from '#ui/lib/kit';
import StatusBadge from '~/components/shared/StatusBadge.vue';

/**
 * Reference module page, built with the UI kit: server-side list whose state lives in the URL
 * (useListQuery), table or cards (useViewMode), row actions with confirmation (ActionMenu),
 * create/edit in a side form validated with the shared Zod contract (FormDialog + FormFields),
 * archive/restore, and optimistic-concurrency conflicts surfaced to the person.
 */
definePageMeta({ permission: 'projects.read' });
useHead({ title: 'Proyectos' });

const api = useApi();
const can = useCan();
const notify = useNotify();

type Sort = 'name' | 'createdAt' | 'updatedAt';
const list = useListQuery({ page: 1, pageSize: 20, search: '', status: undefined as Project['status'] | undefined, sort: 'updatedAt' as Sort, direction: 'desc' as 'asc' | 'desc' });
const statusFilter = list.filter('status');
const view = useViewMode('projects');
const { data, status, refresh, problem } = await useApiData('projects', () => unwrap(projectsList({ client: api, query: list.params.value })), { watch: [list.params] });

// ── create / edit ───────────────────────────────────────────────────────
const formOpen = ref(false);
const editing = ref<Project | null>(null);
const form = useZodForm(CreateProjectInput, { name: '', description: '' });
const fields: FormFieldDef[] = [
  { name: 'name', label: 'Nombre', required: true, testid: 'project-form-name' },
  { name: 'description', label: 'Descripción', type: 'textarea', rows: 4, testid: 'project-form-description' },
];
function openCreate() {
  editing.value = null;
  form.reset();
  formOpen.value = true;
}
function openEdit(p: Project) {
  editing.value = p;
  form.reset({ name: p.name, description: p.description ?? '' });
  formOpen.value = true;
}
const submit = form.handleSubmit(async (values) => {
  const body = { name: values.name, description: values.description || null };
  if (editing.value) {
    await projectsUpdate({ client: api, path: { id: editing.value.id }, body: { ...body, version: editing.value.version } });
    notify.success('Proyecto actualizado');
  } else {
    await projectsCreate({ client: api, body });
    notify.success('Proyecto creado');
  }
  formOpen.value = false;
  await refresh();
});

async function setStatus(p: Project, next: Project['status']) {
  try {
    await projectsUpdate({ client: api, path: { id: p.id }, body: { status: next, version: p.version } });
    notify.success(next === 'archived' ? `«${p.name}» archivado` : `«${p.name}» restaurado`);
  } catch (err) {
    notify.error(err);
  }
  await refresh();
}
async function remove(p: Project) {
  try {
    await projectsDelete({ client: api, path: { id: p.id } });
    notify.success('Proyecto eliminado');
    await refresh();
  } catch (err) {
    notify.error(err);
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
    cell: ({ row }) => {
      const p = row.original;
      return h(ActionMenu, {
        label: `Acciones para ${p.name}`,
        testid: 'project-actions',
        items: [
          { label: 'Editar', icon: 'edit', hidden: !can('projects.manage'), testid: 'project-edit', onSelect: () => openEdit(p) },
          {
            label: p.status === 'active' ? 'Archivar' : 'Restaurar',
            icon: p.status === 'active' ? 'archive' : 'restore',
            hidden: !can('projects.manage'),
            testid: 'project-toggle-archive',
            onSelect: () => setStatus(p, p.status === 'active' ? 'archived' : 'active'),
          },
          {
            label: 'Eliminar',
            icon: 'delete',
            destructive: true,
            separator: true,
            hidden: !can('projects.manage'),
            testid: 'project-delete',
            confirm: { title: `¿Eliminar «${p.name}»?`, description: 'Se elimina de forma permanente. La auditoría conserva el registro.', confirmLabel: 'Eliminar', destructive: true, typeToConfirm: p.name },
            onSelect: () => remove(p),
          },
        ],
      });
    },
  },
];
</script>

<template>
  <PageHeader title="Proyectos" description="Módulo de referencia: así se construye un módulo de negocio del starter (contrato, permisos, API, auditoría y vista).">
    <template #actions>
      <Button v-if="can('projects.manage')" data-testid="project-new" @click="openCreate"><Plus class="size-4" /> Nuevo proyecto</Button>
    </template>
  </PageHeader>

  <DataToolbar v-model:search="list.search.value" v-model:view="view" placeholder="Buscar por nombre o descripción" :filtered="list.filtered.value" testid="project" @clear="list.reset()">
    <template #filters>
      <Select v-model="statusFilter">
        <SelectTrigger class="sm:w-48" aria-label="Filtrar por estado"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los estados</SelectItem>
          <SelectItem value="active">Activos</SelectItem>
          <SelectItem value="archived">Archivados</SelectItem>
        </SelectContent>
      </Select>
    </template>
  </DataToolbar>

  <LoadError v-if="problem" :error="problem" :retrying="status === 'pending'" testid="project-load-error" @retry="refresh()" />
  <EmptyState v-else-if="data && data.total === 0 && !list.filtered.value" title="Aún no hay proyectos" description="Crea el primero para ver cómo funciona un módulo completo." :icon="FolderKanban">
    <Button v-if="can('projects.manage')" @click="openCreate"><Plus class="size-4" /> Nuevo proyecto</Button>
  </EmptyState>
  <DataTable
    v-else
    :columns="columns"
    :data="data?.items ?? []"
    :total="data?.total ?? 0"
    :view="view"
    :page="list.query.page"
    :page-size="list.query.pageSize"
    :loading="status === 'pending'"
    :sort="list.sort.value"
    caption="Proyectos"
    @update:page="list.query.page = $event"
    @update:sort="list.setSort"
  />

  <FormDialog
    v-model:open="formOpen"
    variant="sheet"
    :title="editing ? 'Editar proyecto' : 'Nuevo proyecto'"
    :description="editing ? `Versión ${editing.version}: si alguien lo cambia antes de guardar, se te avisará.` : 'Visible para quienes tienen el permiso de ver proyectos.'"
    :submit-label="editing ? 'Guardar cambios' : 'Crear proyecto'"
    :loading="form.submitting.value"
    :error="form.formError.value"
    testid="project-form"
    @submit="submit"
  >
    <FormFields :form="form" :fields="fields" id-prefix="pj" />
  </FormDialog>
</template>
