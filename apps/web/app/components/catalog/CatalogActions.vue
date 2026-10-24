<script setup lang="ts">
import { Button } from '#ui/components/ui/button';
import { ButtonGroup } from '#ui/components/ui/button-group';
import { Badge } from '#ui/components/ui/badge';
import { Kbd } from '#ui/components/ui/kbd';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#ui/components/ui/tabs';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '#ui/components/ui/breadcrumb';
import type { ActionItem, SectionNavItem } from '#ui/lib/kit';
import CatalogExample from './CatalogExample.vue';

/** Buttons, menus and navigation (secondary navigation, tabs, breadcrumb, main sidebar). */
const notify = useNotify();
const saving = ref(false);
async function save() {
  saving.value = true;
  await new Promise((r) => setTimeout(r, 1200));
  saving.value = false;
  notify.success('Guardado');
}
const starred = ref(false);

const pageActions: ActionItem[] = [
  { label: 'Exportar CSV', icon: 'export', onSelect: () => notify.success('CSV exportado'), shortcut: '⌘E' },
  { label: 'Compartir enlace', icon: 'share', onSelect: () => notify.info('Enlace copiado') },
  { label: 'Ver historial', icon: 'history', onSelect: () => notify.info('Historial') },
  { label: 'Solo administradores', icon: 'locked', hidden: true, onSelect: () => {} },
  { label: 'Archivar', icon: 'archive', separator: true, onSelect: () => notify.undo('Archivado', () => notify.info('Restaurado')) },
  {
    label: 'Eliminar',
    icon: 'delete',
    destructive: true,
    testid: 'menu-delete',
    confirm: { title: '¿Eliminar el registro «Comercial Andes»?', description: 'Escribe el nombre para confirmar.', confirmLabel: 'Eliminar', destructive: true, typeToConfirm: 'Comercial Andes' },
    onSelect: () => notify.success('Eliminado'),
  },
];

const section = ref('general');
const sections: SectionNavItem[] = [
  { value: 'general', label: 'General', icon: 'settings' },
  { value: 'team', label: 'Equipo', icon: 'users', badge: 8 },
  { value: 'billing', label: 'Facturación', icon: 'payment' },
  { value: 'notifications', label: 'Avisos', icon: 'notification' },
  { value: 'api', label: 'API', icon: 'permission', disabled: true },
];

const buttonsCode = `<Button>Principal</Button>   <!-- variant: default | secondary | outline | ghost | destructive | link -->
<Button size="sm"><AppIcon name="create" /> Nuevo</Button>   <!-- size: xs | sm | default | lg | icon* -->
<Button :loading="form.submitting.value">Guardar</Button>    <!-- deshabilita, marca aria-busy y muestra spinner -->
<IconButton icon="edit" label="Editar" />                    <!-- solo ícono: etiqueta obligatoria + tooltip -->
<CopyButton :value="token" label="Copiar token" />
<ButtonGroup><Button variant="outline">Día</Button><Button variant="outline">Semana</Button></ButtonGroup>`;
const menuCode = `<ActionMenu label="Más acciones" trigger-text="Acciones" :items="[
  { label: 'Exportar CSV', icon: 'export', onSelect: exportCsv, shortcut: '⌘E' },
  { label: 'Archivar', icon: 'archive', separator: true, onSelect: archive },
  { label: 'Eliminar', icon: 'delete', destructive: true, hidden: !can('x.manage'),
    confirm: { title: '¿Eliminar?', destructive: true, confirmLabel: 'Eliminar', typeToConfirm: name }, onSelect: remove },
]" />
// En columnas de DataTable: h(ActionMenu, { label: \`Acciones para \${row.original.name}\`, items: [...] })`;
const navCode = `<SectionNav v-model="section" label="Secciones de configuración" :items="[
  { value: 'general', label: 'General', icon: 'settings' },
  { value: 'team', label: 'Equipo', icon: 'users', badge: 8 },
  { value: 'billing', label: 'Facturación', icon: 'payment', to: '/admin/settings/billing' },  // o navega
]">
  <GeneralSettings v-if="section === 'general'" />
</SectionNav>`;
const tabsCode = `<Tabs default-value="summary">
  <TabsList><TabsTrigger value="summary">Resumen</TabsTrigger><TabsTrigger value="activity">Actividad</TabsTrigger></TabsList>
  <TabsContent value="summary">…</TabsContent>
</Tabs>`;
const sidebarCode = `// apps/web/app/utils/navigation.ts — la barra lateral principal se arma desde aquí,
// filtrada por permisos y módulos (AppSidebar). Agregar una entrada:
{ title: 'Clientes', to: '/admin/customers', icon: ICONS.users, permission: 'customers.read' }
// El generador de módulos (pnpm starter generate module) la agrega solo.`;
</script>

<template>
  <div class="grid gap-6">
    <CatalogExample title="Botones" description="Variantes, tamaños, carga, solo ícono con tooltip, copiar y grupos." :code="buttonsCode">
      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          <Button>Principal</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="outline">Contorno</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button variant="link">Enlace</Button>
          <Button variant="destructive"><AppIcon name="delete" /> Eliminar</Button>
          <Button disabled>Deshabilitado</Button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button size="xs">Mini</Button>
          <Button size="sm"><AppIcon name="create" /> Nuevo</Button>
          <Button>Normal</Button>
          <Button size="lg">Grande</Button>
          <Button :loading="saving" data-testid="loading-button" @click="save">{{ saving ? 'Guardando…' : 'Guardar' }}</Button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <IconButton icon="edit" label="Editar" />
          <IconButton icon="share" label="Compartir" variant="outline" />
          <IconButton icon="favorite" :label="starred ? 'Quitar de favoritos' : 'Marcar como favorito'" :pressed="starred" :variant="starred ? 'secondary' : 'ghost'" @click="starred = !starred" />
          <IconButton icon="delete" label="Eliminar" variant="destructive" size="icon-sm" />
          <CopyButton value="sk-demo-4f2a9c" label="Copiar token" />
          <CopyButton value="https://ejemplo.cl/invitacion/abc" icon-only label="Copiar enlace" />
          <ButtonGroup aria-label="Período">
            <Button variant="outline" size="sm">Día</Button>
            <Button variant="outline" size="sm">Semana</Button>
            <Button variant="outline" size="sm">Mes</Button>
          </ButtonGroup>
        </div>
      </div>
    </CatalogExample>

    <div class="grid gap-6 lg:grid-cols-2">
      <CatalogExample title="ActionMenu" description="Menú declarativo: íconos, atajos, separadores, ítems ocultos por permiso y confirmación integrada (también «escribir para confirmar»)." :code="menuCode">
        <div class="flex flex-wrap items-center gap-3">
          <ActionMenu label="Más acciones" trigger-text="Acciones" trigger-variant="outline" :items="pageActions" heading="Comercial Andes" testid="demo-menu" />
          <ActionMenu label="Acciones de la fila" :items="pageActions" />
          <span class="text-muted-foreground text-sm">Atajo de ejemplo: <Kbd>⌘</Kbd> <Kbd>E</Kbd></span>
        </div>
      </CatalogExample>
      <CatalogExample title="Barra lateral principal" description="La navegación de la app sale de una sola lista con permisos y módulos; el sidebar (colapsable a íconos, panel en teléfono) la dibuja." :code="sidebarCode">
        <div class="text-muted-foreground text-sm">Prueba el botón <Badge variant="outline">☰</Badge> de la barra superior o <Kbd>Ctrl</Kbd> <Kbd>B</Kbd> para contraerla. En teléfonos se abre como panel.</div>
      </CatalogExample>
    </div>

    <CatalogExample title="SectionNav" description="Navegación secundaria dentro de una página (configuración, ficha de un registro): vertical en escritorio, fila desplazable en teléfono." :code="navCode">
      <SectionNav v-model="section" label="Secciones de ejemplo" :items="sections" testid="demo-section-nav">
        <div class="rounded-lg border p-4 text-sm" data-testid="demo-section-content">
          <p class="font-medium">{{ sections.find((s) => s.value === section)?.label }}</p>
          <p class="text-muted-foreground">Contenido de la sección «{{ section }}».</p>
        </div>
      </SectionNav>
    </CatalogExample>

    <div class="grid gap-6 lg:grid-cols-2">
      <CatalogExample title="Tabs" description="Pestañas para vistas de un mismo registro." :code="tabsCode">
        <Tabs default-value="summary">
          <TabsList>
            <TabsTrigger value="summary">Resumen</TabsTrigger>
            <TabsTrigger value="activity">Actividad</TabsTrigger>
            <TabsTrigger value="files">Archivos</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" class="text-muted-foreground pt-2 text-sm">Datos principales del registro.</TabsContent>
          <TabsContent value="activity" class="text-muted-foreground pt-2 text-sm">Últimos cambios (auditoría).</TabsContent>
          <TabsContent value="files" class="text-muted-foreground pt-2 text-sm">Adjuntos.</TabsContent>
        </Tabs>
      </CatalogExample>
      <CatalogExample title="Breadcrumb" description="El layout ya muestra la ruta desde la navegación; agrega un nivel con definePageMeta({ breadcrumb: 'Detalle' })." code="definePageMeta({ permission: 'customers.read', breadcrumb: 'Detalle' });">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink href="#">Inicio</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbLink href="#">Clientes</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Comercial Andes</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </CatalogExample>
    </div>
  </div>
</template>
