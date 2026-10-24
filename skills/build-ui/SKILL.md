---
name: build-ui
description: Construye vistas del panel con el kit de interfaz del starter (formularios desde el esquema Zod, asistentes por pasos, listas con tabla o tarjetas, gráficos, carruseles, menús, avisos, modales e íconos). Úsala cuando pidan una pantalla, un formulario, un asistente, un tablero, una lista, un modal o cambios visuales en apps/web.
---

# Construir vistas con el kit

Guía completa con la API de cada componente: [docs/frontend-components.md](../../docs/frontend-components.md).
Ejemplos vivos con su código: `/admin/components` (`?tab=forms`, `wizard`, `data`, `charts`,
`carousel`, `actions`, `feedback`, `icons`). Referencia en uso real:
[`pages/admin/projects/index.vue`](../../apps/web/app/pages/admin/projects/index.vue).

## Antes de escribir

1. Busca el caso en la tabla «¿Qué componente uso?» de la guía. **No crees un componente si el kit
   ya lo cubre**; si falta algo reutilizable, agrégalo a `packages/ui/app/components/common` con
   su ejemplo en el catálogo y su fila en la guía.
2. Los datos llegan con el cliente generado (`unwrap(miOperacion({ client: useApi(), … }))`) y los
   formularios validan con el contrato de `@starter/contracts`. Nunca `$fetch` a mano.
3. Protege la página con `definePageMeta({ permission })` y oculta acciones con `useCan()`; la
   seguridad real está en el servidor.

## Recetas

**Lista (CRUD)**

```ts
const list = useListQuery({ page: 1, pageSize: 20, search: '', status: undefined as string | undefined, sort: 'updatedAt', direction: 'desc' });
const view = useViewMode('clientes');
const { data, status, refresh, problem } = await useApiData('clientes', () => unwrap(customersList({ client: api, query: list.params.value })), { watch: [list.params] });
const columns: ColumnDef<Customer>[] = [/* …, { id: 'actions', cell: ({ row }) => h(ActionMenu, { label, items }) } */];
```

```vue
<PageHeader title="Clientes"><template #actions><Button @click="openCreate"><AppIcon name="create" /> Nuevo cliente</Button></template></PageHeader>
<DataToolbar v-model:search="list.search.value" v-model:view="view" :filtered="list.filtered.value" testid="customer" @clear="list.reset()" />
<LoadError v-if="problem" :error="problem" :retrying="status === 'pending'" @retry="refresh()" />
<DataTable v-else :columns="columns" :data="data?.items ?? []" :total="data?.total ?? 0" :view="view" :page="list.query.page"
  :page-size="list.query.pageSize" :sort="list.sort.value" :loading="status === 'pending'" caption="Clientes"
  @update:page="list.query.page = $event" @update:sort="list.setSort" />
<FormDialog v-model:open="open" variant="sheet" title="Nuevo cliente" :loading="form.submitting.value" :error="form.formError.value" testid="customer-form" @submit="submit">
  <FormFields :form="form" :fields="fields" />
</FormDialog>
```

**Formulario**: `useZodForm(Contrato, iniciales)` + `FormFields` (lista `FormFieldDef`) +
`FormActions`, o `FormDialog` si es modal. Campos con control propio: slot `#field-<name>` o
`FormField`.

**Asistente**: un esquema, `FormWizard` con `fields` por paso, `before-next` si un paso guarda,
paso «Resumen» y `@complete="form.handleSubmit(…)"`.

**Tablero**: `StatCard` (`trend`, `sparkline`), `TimeSeriesChart`, `BarChart` (`horizontal`
para rankings), `DonutChart`.

**Configuración**: `SectionNav` + `FormSection` por sección.

**Detalle**: `await useApiData(`cliente-${id}`, () => …, { fatal: [404] })`: un id inexistente
muestra la página de error en español (con estado 404 también en SSR).

**Errores** ([docs/errors.md](../../docs/errors.md)): cargas con `useApiData` + `LoadError`;
acciones con `try { … } catch (err) { notify.error(err) }` (mensaje de la API + código de solicitud,
`{ retry }` para «Reintentar»); formularios con `form.handleSubmit` (errores por campo). Para
decidir por tipo usa `normalizeError(err).code`, nunca el texto. Nunca `toast.error(err.message)`.

**Avisos**: `useNotify()` para resultados, `AppAlert` para estados de la página, `useConfirm()` o
`confirm` en `ActionMenu` para acciones destructivas (`typeToConfirm` si es irreversible).

**Íconos**: `<AppIcon name="…" />` con nombres semánticos (`create`, `edit`, `delete`, `archive`,
`warning`, `money`…); busca en `/admin/components?tab=icons`.

## Reglas (evitan errores conocidos)

- Textos de interfaz en español (es-CL); identificadores en inglés.
- Sin `Badge` dentro de `<p>`; `<ClientOnly>` en `Select` con ítems asíncronos; nada que cambie
  entre servidor y cliente en el primer render (`Date.now()`, `localStorage`, números sin locale:
  usa `#ui/lib/format` y `useState`).
- Sin tipos unión en expresiones de plantilla (`(v: A | B) =>`): el linter los lee como filtros.
- `data-testid` con el prefijo del módulo; botones de solo ícono con `IconButton` y `label`.
- Paginación, orden y búsqueda en el servidor; nunca recortes datos en el cliente.

## Verificación

```bash
pnpm lint && pnpm typecheck
pnpm test:e2e tests/e2e/<modulo>.spec.ts   # flujo principal, permisos y, si aplica, vista en tarjetas
```

Abre la vista en claro, oscuro y a 390 px de ancho y revisa que la consola no tenga advertencias
de hidratación (`components.spec.ts` muestra cómo comprobarlo en E2E).
