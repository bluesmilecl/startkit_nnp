# Kit de interfaz

La web (Nuxt 4, Vue 3, TypeScript estricto) extiende la capa compartida `@starter/ui`
(`packages/ui`): Tailwind CSS 4, componentes **shadcn-vue** vendorizados y, encima, el **kit del
starter**: formularios desde el esquema Zod, asistentes por pasos, listas con tabla o tarjetas,
gráficos, carruseles, menús de acciones, avisos, modales e íconos semánticos. Úsalo antes de
escribir un componente nuevo: así las vistas hechas por personas o agentes se ven y se comportan
igual.

**Catálogo vivo:** `/admin/components` (cualquier persona con sesión; no llama a la API). Cada
ejemplo muestra el componente real y su código. Pestañas enlazables:
`?tab=forms` · `wizard` · `data` · `charts` · `carousel` · `actions` · `feedback` · `icons` ·
`format` ([`components.vue`](../apps/web/app/pages/admin/components.vue), ejemplos en
[`components/catalog`](../apps/web/app/components/catalog)).

**Referencia en uso real:** la vista de [Proyectos](../apps/web/app/pages/admin/projects/index.vue)
(lista con URL, tabla o tarjetas, menú por fila, formulario lateral). El generador de módulos la
copia, así que cada módulo nuevo parte con el kit.

## Cómo se usa

- Los componentes de `packages/ui/app/components/common` y `charts` están **registrados
  globalmente**: en una página basta `<FormFields … />`. En funciones `h()` (celdas de tablas)
  impórtalos: `import ActionMenu from '#ui/components/common/ActionMenu.vue'`.
- Los composables (`useZodForm`, `useWizard`, `useListQuery`, `useViewMode`, `useNotify`,
  `useConfirm`) se **autoimportan**.
- Tipos del kit en `#ui/lib/kit` (`FormFieldDef`, `WizardStep`, `ActionItem`, `SectionNavItem`,
  `ChartSeries`, `ViewMode`, `FormLike`); íconos en `#ui/lib/icons`; formatos en `#ui/lib/format`.
- Primitivas shadcn-vue: `import { Button } from '#ui/components/ui/button'`.

## ¿Qué componente uso?

| Necesito… | Usa |
| --- | --- |
| Un formulario a partir del contrato de la API | `useZodForm` + `FormFields` (+ `FormActions`) |
| Un campo con un control propio | `FormField` (slot con `id` y atributos ARIA) |
| Crear o editar en un modal o panel lateral | `FormDialog` (`variant="dialog"` o `"sheet"`) |
| Un formulario largo por secciones / página de configuración | `FormSection` + `SectionNav` |
| Un alta o configuración por pasos | `FormWizard` (o `useWizard` para un diseño propio) |
| Una lista con búsqueda, filtros, orden y páginas | `useListQuery` + `DataToolbar` + `DataTable` |
| La misma lista como tarjetas | `DataTable :view="view"` + `useViewMode` (el toolbar trae el interruptor) |
| Acciones sobre varias filas | `DataTable selectable v-model:selected` + slot `#bulk` |
| El "⋯" de una fila o una página | `ActionMenu` (con `confirm` integrado) |
| Indicadores en un tablero | `StatCard` (`trend`, `sparkline`) |
| Series por fecha | `TimeSeriesChart` |
| Comparar categorías, rankings | `BarChart` (`horizontal`, `stacked`) |
| Distribución | `DonutChart` |
| Tendencia dentro de una tarjeta o tabla | `Sparkline` |
| Tarjetas o anuncios que se desplazan | `ContentCarousel` |
| Un aviso en la página | `AppAlert` (`info`, `success`, `warning`, `destructive`) |
| Un aviso temporal | `useNotify()` (toasts) |
| Confirmar una acción | `useConfirm()` o `confirm` en `ActionMenu` |
| Mostrar detalle sin salir de la página | `AppModal` |
| Un botón con carga, solo ícono o copiar | `Button :loading`, `IconButton`, `CopyButton` |
| Navegación secundaria dentro de una página | `SectionNav` |
| Un ícono | `<AppIcon name="…" />` / `ICONS.…` |
| Una lista vacía | `EmptyState` |

## Formularios

### `useZodForm(esquema, valoresIniciales)`

Valida con **el mismo esquema Zod** que usa la API (`@starter/contracts`) y devuelve los errores
`VALIDATION_FAILED` del servidor a cada campo.

| Devuelve | Para qué |
| --- | --- |
| `values`, `errors`, `formError`, `submitting` | Estado reactivo (errores por ruta `a.b.0`). |
| `handleSubmit(fn)` | Valida todo y llama `fn(datos)`; un error lanzado se mapea a campos y a `formError`. |
| `validate()`, `validateField(nombre)`, `validateFields(nombres)` | Validación total, de un campo o de un grupo (pasos, secciones). |
| `setValues(parcial)`, `reset(valores?)`, `firstErrorField(orden?)` | Cargar datos al editar, reiniciar, ubicar el primer error. |
| `applyServerError(err)` | Mapeo manual de un error del servidor. |

### `FormFields`

Formulario completo desde una lista de definiciones (`FormFieldDef`). Valida al salir de cada
campo y al corregir.

```ts
const form = useZodForm(CreateCustomerInput, { name: '', email: '', plan: 'basic', active: true });
const fields: FormFieldDef[] = [
  { name: 'name', label: 'Nombre', required: true },
  { name: 'email', label: 'Correo', type: 'email', autocomplete: 'email' },
  { name: 'plan', label: 'Plan', type: 'select', options: [{ value: 'basic', label: 'Básico' }, { value: 'pro', label: 'Profesional' }] },
  { name: 'active', label: 'Activo', type: 'switch', description: 'Puede ingresar' },
];
const submit = form.handleSubmit(async (values) => {
  await customersCreate({ client: api, body: values });
  notify.success('Cliente creado');
});
```

```vue
<form novalidate @submit="submit">
  <FormFields :form="form" :fields="fields" :columns="2" />
  <FormActions :loading="form.submitting.value" :error="form.formError.value" />
</form>
```

| Prop | |
| --- | --- |
| `form` | El objeto de `useZodForm`. |
| `fields` | `FormFieldDef[]`. |
| `columns` | `1` (por defecto), `2` o `3`; en teléfonos siempre una. |
| `id-prefix` | Prefijo de los `id` (útil si hay dos formularios con los mismos nombres). |
| `disabled` | Deshabilita todo. |

`FormFieldDef`: `name`, `label`, `type` (`text`, `email`, `password`, `url`, `tel`, `number`,
`textarea`, `select`, `radio`, `checkbox` —uno o, con `options`, una lista—, `switch`, `date`,
`tags`, `slider`), `required` (solo marca visual: lo obligatorio lo decide el esquema),
`description`, `placeholder`, `options` (`value`, `label`, `description?`, `disabled?`), `span`
(`1`, `2`, `3`, `full`), `rows`, `min`, `max`, `step`, `prefix`/`suffix` (p. ej. `US$`, `%`),
`autocomplete`, `disabled`, `testid` (va al control como `data-testid`).

Un campo con control propio: slot `#field-<name>` (recibe `field`, `id`, `value`, `setValue`,
`error`). Las opciones de `select` son estáticas; si vienen de la API, usa un selector propio en
ese slot dentro de `<ClientOnly>` (ver reglas).

### `FormField`

Un campo suelto con etiqueta, ayuda y error. El slot recibe `id`, `aria-describedby` y
`aria-invalid` para el control:

```vue
<FormField v-slot="field" label="Código interno" description="Formato AAA-000" :error="form.errors.code" required>
  <Input v-bind="field" v-model="form.values.code" @blur="form.validateField('code')" />
</FormField>
```

Props: `label`, `id?`, `description?`, `error?`, `required?`, `orientation` (`vertical` u
`horizontal`), `hide-label?`.

### `FormActions` y `FormSection`

- `FormActions`: error general (opcional) y Cancelar / Enviar. Props `submit-label`
  (`Guardar`), `cancel-label` (sin él no hay Cancelar), `loading`, `disabled`, `error`, `form`
  (id del formulario si el botón está fuera de él), `align` (`end`, `start`, `between`), `sticky`,
  `testid`; evento `cancel`; slot por defecto para botones extra.
- `FormSection`: título y descripción a la izquierda, campos en una tarjeta, pie con slot
  `#footer`. Para páginas de configuración y formularios largos.

### `FormDialog`

Formulario en un diálogo o panel lateral, con Cancelar / Enviar (el botón usa `form="<id>"`, así
Enter envía), estado de carga y error general.

```vue
<FormDialog v-model:open="open" title="Nuevo cliente" submit-label="Crear cliente" variant="sheet"
  :loading="form.submitting.value" :error="form.formError.value" testid="customer-form" @submit="submit">
  <FormFields :form="form" :fields="fields" />
</FormDialog>
```

Props: `title`, `description`, `submit-label`, `cancel-label`, `loading`, `disabled`, `error`,
`destructive`, `size` (`sm`, `md`, `lg`, `xl`), `variant` (`dialog`, `sheet`), `testid`
(prefijo: `<testid>`, `<testid>-submit`, `<testid>-error`). Evento `submit`; slot `footer-start`.

## Asistente por pasos

### `FormWizard`

Cada paso declara sus campos; «Siguiente» valida solo esos con el esquema Zod, ejecuta
`before-next` (p. ej. guardar el paso) y avanza. En el último paso valida todo: si un paso
anterior tiene errores vuelve a él; si no, emite `complete`. Los pasos ya alcanzados se pueden
revisitar desde el encabezado; en teléfonos muestra «Paso n de N» con barra de progreso. El foco
pasa al título de cada paso.

```ts
const steps: WizardStep[] = [
  { id: 'company', title: 'Empresa', fields: ['company', 'contactEmail'], icon: 'organization' },
  { id: 'plan', title: 'Plan', description: 'Se puede cambiar después.', fields: ['plan', 'seats'] },
  { id: 'summary', title: 'Resumen' },
];
const beforeNext = async (step: WizardStep) => { if (step.id === 'plan') await savePlan(); }; // false o un error detienen
const submit = form.handleSubmit(async (values) => { await create(values); });
```

```vue
<FormWizard v-model:step="step" :steps="steps" :form="form" :before-next="beforeNext"
  :loading="form.submitting.value" submit-label="Confirmar alta" @complete="submit">
  <template #step-company><FormFields :form="form" :fields="companyFields" /></template>
  <template #step-plan><FormFields :form="form" :fields="planFields" :columns="2" /></template>
  <template #step-summary>…</template>
</FormWizard>
```

Props: `steps` (`id`, `title`, `description?`, `fields?`, `icon?`, `optional?`), `form?`,
`before-next?`, `loading`, `next-label`, `back-label`, `submit-label`, `testid` (`wizard`:
`-next`, `-back`, `-title`, `-step-<id>`, `-error`). Eventos `complete`, `change`; `v-model:step`.
Slots `step-<id>` (o el por defecto con `{ step, index }`) y `actions`.

### `useWizard(steps, opciones)`

La misma lógica sin la interfaz: `index`, `step`, `isFirst`, `isLast`, `progress`, `furthest`,
`busy`, `error`, `next()`, `back()`, `goTo(i)`, `canGoTo(i)`, `stepOfField(campo)`, `reset()`.
Opciones: `validate(campos)`, `beforeNext(paso, i)`, `onComplete()`, `initial`.

## Listas y datos

### `useListQuery(valoresPorDefecto, opciones?)`

Estado de una lista del servidor (página, tamaño, búsqueda, orden y filtros) **sincronizado con la
URL**: sobrevive a recargas y se puede compartir. Cambiar cualquier cosa que no sea la página
vuelve a la página 1. El tipo de cada clave sale de su valor por defecto.

```ts
const list = useListQuery({ page: 1, pageSize: 20, search: '', status: undefined as string | undefined, sort: 'updatedAt', direction: 'desc' });
const status = list.filter('status'); // modelo para Select: 'all' ⇄ undefined
const { data, status: fetchStatus } = await useAsyncData('customers', () => unwrap(customersList({ client: api, query: list.params.value })), { watch: [list.params] });
```

Devuelve `query` (reactivo), `search` (copia con espera de 300 ms para el campo de búsqueda),
`sort` (`{ id, desc }` para `DataTable`), `setSort`, `filter(clave, valorTodos = 'all')`,
`filtered` (hay filtros activos), `reset()` y `params` (para la API, sin valores vacíos).
Opción `syncUrl: false` para listas que no deben tocar la URL.

### `DataToolbar`

Búsqueda, filtros (slot `filters`), «Limpiar» cuando hay filtros, acciones (slot `actions`) y el
interruptor tabla/tarjetas.

```vue
<DataToolbar v-model:search="list.search.value" v-model:view="view" placeholder="Buscar clientes"
  :filtered="list.filtered.value" testid="customer" @clear="list.reset()">
  <template #filters><Select v-model="status">…</Select></template>
</DataToolbar>
```

Sin `v-model:view` no muestra el interruptor; sin `v-model:search`, la búsqueda. `testid` da
`<testid>-search`, `<testid>-clear`, `<testid>-view-table` y `<testid>-view-cards`.

### `DataTable`

TanStack Table con **paginación y orden en el servidor** (nunca recorta datos parciales en el
cliente).

```vue
<DataTable :columns="columns" :data="data?.items ?? []" :total="data?.total ?? 0" :view="view"
  :page="list.query.page" :page-size="list.query.pageSize" :page-sizes="[10, 20, 50]"
  :sort="list.sort.value" :loading="fetchStatus === 'pending'" caption="Clientes"
  selectable v-model:selected="selected"
  @update:page="list.query.page = $event" @update:page-size="list.query.pageSize = $event" @update:sort="list.setSort">
  <template #bulk="{ selected, clear }"><Button size="sm" @click="archive(selected).then(clear)">Archivar</Button></template>
  <template #empty><EmptyState title="Sin resultados" /></template>
</DataTable>
```

| Prop | |
| --- | --- |
| `columns`, `data`, `total`, `page`, `page-size`, `sort`, `loading`, `caption`, `empty-text`, `row-key` | Base. `caption` queda oculto pero accesible. |
| `view` | `table` (por defecto), `cards` o `auto` (tarjetas bajo `md`, tabla encima). |
| `card-title` | Columna que titula cada tarjeta (por defecto la primera). La columna `actions` va arriba a la derecha y el resto como pares etiqueta/valor; la etiqueta sale de `meta.label` o de un `header` de texto. Slot `#card="{ row, selected, toggle }"` para una tarjeta propia. |
| `card-grid-class` | Grilla de tarjetas (`grid gap-3 sm:grid-cols-2 xl:grid-cols-3`). |
| `selectable`, `v-model:selected` | Casillas por fila y por página; los ids se mantienen entre páginas; slot `bulk`. |
| `page-sizes` | Selector de filas por página (evento `update:pageSize`). |

Eventos: `update:page`, `update:sort`, `update:pageSize`, `rowClick`. Test ids: `row-<id>` en la
tabla, `card-<id>` en tarjetas, `bulk-bar`.

Columna de acciones con `ActionMenu`:

```ts
{ id: 'actions', header: () => h('span', { class: 'sr-only' }, 'Acciones'),
  cell: ({ row }) => h(ActionMenu, { label: `Acciones para ${row.original.name}`, items: [
    { label: 'Editar', icon: 'edit', onSelect: () => edit(row.original) },
    { label: 'Eliminar', icon: 'delete', destructive: true, separator: true, hidden: !can('customers.manage'),
      confirm: { title: `¿Eliminar «${row.original.name}»?`, destructive: true, confirmLabel: 'Eliminar', typeToConfirm: row.original.name },
      onSelect: () => remove(row.original) },
  ] }) }
```

### `useViewMode(clave)` y `ViewToggle`

Preferencia tabla/tarjetas por lista, recordada en el navegador y aplicada después de montar (sin
diferencias de hidratación). `ViewToggle v-model="view"` es el interruptor suelto.

### `StatCard` y `EmptyState`

- `StatCard`: `title`, `value`, `hint`, `icon`, `loading`, `trend` (cambio relativo: `0.12` =
  +12 %), `trend-label`, `invert-trend` (cuando bajar es bueno: costos, errores, latencia),
  `sparkline` (números).
- `EmptyState`: `title`, `description`, `icon`; slot para la acción.

## Gráficos

Basados en el componente `chart` de shadcn-vue sobre Unovis (salvo `Sparkline`, que es SVG). Se
dibujan solo en el cliente con un marcador del mismo tamaño en SSR, y ofrecen **tabla
equivalente** y **CSV**.

| Componente | Props |
| --- | --- |
| `TimeSeriesChart` | `data` (filas con `x` = fecha ISO o etiqueta y una clave por serie), `series` (`key`, `label`, `color?`), `kind` (`line`, `area`, `bar`, `stacked`), `title`, `x-label`, `value-format`, `csv-name`, `height`. Con un solo punto, líneas y áreas se muestran como barras. |
| `BarChart` | `data` (filas con `label` y una clave por serie), `series`, `title`, `label-key`, `horizontal` (rankings, etiquetas largas), `stacked`, `value-format`, `csv-name`, `height`. |
| `DonutChart` | `data` (`key`, `label`, `value`), `title`, `value-format`, `csv-name`; total al centro, leyenda. |
| `Sparkline` | `values`, `label` (nombre accesible), `area`, `color`, `width`, `height`, `value-format`. Se dibuja también en el servidor. |

Colores: variables `--chart-1` … `--chart-5` del tema (claro y oscuro).

## Carrusel

### `ContentCarousel`

```vue
<ContentCarousel :items="plans" label="Planes" :per-view="{ base: 1, sm: 2, lg: 3 }" :item-key="(p) => p.id">
  <template #item="{ item }"><Card>…</Card></template>
</ContentCarousel>
```

Props: `items`, `label` (nombre de la región), `item-key`, `per-view` (`base`, `sm`, `md`, `lg`,
`xl` con 1–4), `loop`, `autoplay` (ms; 0 apaga), `dots`, `arrows`, `align` (`start`, `center`),
`testid` (`-prev`, `-next`, `-status`). Teclado ← →. El avance automático se pausa con el mouse
o el foco encima, tiene botón de pausa y no corre si la persona pidió reducir el movimiento.

## Botones y menús

- `Button`: variantes `default`, `secondary`, `outline`, `ghost`, `destructive`, `link`;
  tamaños `xs`, `sm`, `default`, `lg`, `icon`, `icon-xs`, `icon-sm`, `icon-lg`. **`loading`**
  deshabilita, marca `aria-busy` y muestra un spinner.
- `IconButton`: `icon` (nombre del registro o componente), **`label` obligatorio** (nombre
  accesible y tooltip), `variant` (`ghost`), `size`, `tooltip`, `side`, `loading`, `disabled`,
  `pressed` (`aria-pressed` para conmutadores).
- `CopyButton`: `value`, `label`, `copied-label`, `icon-only`, `variant`, `size`; evento `copied`.
- `ButtonGroup` (shadcn) para opciones contiguas.
- `ActionMenu`: `items` (`ActionItem`: `label`, `icon`, `onSelect`, `destructive`, `disabled`,
  `hidden`, `separator`, `shortcut`, `confirm` con las opciones de `useConfirm`, `testid`),
  `label` (nombre del disparador), `heading`, `align`, `trigger-variant`, `trigger-icon`,
  `trigger-text`, `testid`; slot `trigger`. Si todos los ítems están ocultos no se dibuja.

## Navegación

- **Barra lateral principal**: `AppSidebar` dibuja
  [`utils/navigation.ts`](../apps/web/app/utils/navigation.ts) filtrada por permisos y módulos
  (colapsable a íconos, panel en teléfonos, `Ctrl/⌘ + B`). Para una entrada nueva agrega
  `{ title, to, icon, permission }` en su sección; el generador de módulos lo hace solo.
- **Ruta (breadcrumb)**: sale de la navegación; agrega un nivel con
  `definePageMeta({ breadcrumb: 'Detalle' })`.
- `SectionNav`: navegación secundaria dentro de una página (configuración, ficha de un registro):
  vertical desde `md`, fila desplazable en teléfonos. `items` (`SectionNavItem`: `value`,
  `label`, `icon`, `badge`, `to`, `disabled`), `v-model`, `label`, `testid`. Con contenido en el
  slot arma también el diseño de dos columnas.
- `Tabs` (shadcn) para vistas de un mismo registro.

## Avisos y modales

- `AppAlert`: `variant` (`info`, `success`, `warning`, `destructive`, `default`), `title`,
  `description`, `icon` (o `false`), `dismissible`, `v-model:open`; slots por defecto y
  `actions`. `warning` y `destructive` usan `role="alert"`; el resto `role="status"`.
- `useNotify()`: `success`, `info`, `warning`, `error(err)` (errores de la API con su mensaje y
  «Código de solicitud»), `undo(mensaje, deshacer)`, `promise(trabajo, { loading, success,
  error? })`, `dismiss`. `describeError(err)` da el mensaje sin mostrar trazas.
- `useConfirm()` + `ConfirmHost` (montado en `app.vue`): `confirm({ title, description,
  confirmLabel, cancelLabel, destructive, typeToConfirm })` → `Promise<boolean>`.
  `typeToConfirm` exige escribir un texto para acciones irreversibles.
- `AppModal`: `v-model:open`, `title`, `description`, `size`, `variant` (`dialog` o `sheet`),
  `side`, `testid`; cuerpo con scroll propio y slot `footer`. Para formularios, `FormDialog`.

## Íconos

Registro semántico sobre Lucide en [`lib/icons.ts`](../packages/ui/app/lib/icons.ts): las
pantallas nombran el significado (`create`, `edit`, `delete`, `warning`, `money`…), no el
dibujo, así cada acción se ve igual en toda la app.

```vue
<AppIcon name="create" />                                        <!-- decorativo -->
<AppIcon name="warning" label="Advertencia" class="size-5" />     <!-- con significado -->
<StatCard :icon="ICONS.money" … />   <IconButton icon="edit" label="Editar" />
```

`ICONS` (nombre → componente), `ICON_LUCIDE` (nombre Lucide), `ICON_KEYWORDS` (términos en
español), `ICON_GROUPS` y `searchIcons(texto)`. Para agregar uno: impórtalo de `@lucide/vue` y
súmalo a los cuatro (una prueba unitaria verifica que sigan coherentes).

## Formatos (`#ui/lib/format`)

`formatDate`, `formatRelative`, `formatNumber`, `formatBytes`, `formatUsd(valor, dígitos = 4)`
(montos menores a un centavo con dígitos significativos; acepta cualquier cantidad de dígitos),
`formatClp` (conversión visual con la tasa del día), `formatPerMillion`, `formatPercent`,
`formatPercentChange` (con signo), `setFormatLocale`. Usan el locale y la zona de la persona en
servidor y cliente, por eso no producen diferencias de hidratación. Además: `csv.ts` (`toCsv`,
`downloadCsv`) y `utils.ts` (`cn`, combina clases y resuelve conflictos de Tailwind).

## Recetas

**Lista de un módulo** — copia la estructura de Proyectos: `useListQuery` → `useAsyncData` con
`watch: [list.params]` → `DataToolbar` → `EmptyState` si no hay registros ni filtros →
`DataTable` con `ActionMenu` en la columna `actions` → `FormDialog` + `FormFields` para crear y
editar → `useNotify` para el resultado.

**Alta en varios pasos** — un esquema Zod para todo, `FormWizard` con `fields` por paso, un paso
«Resumen» que muestra `form.values` y `@complete` con `form.handleSubmit`.

**Página de configuración** — `SectionNav` a la izquierda y, por sección, `FormSection` +
`FormFields` + `FormActions`.

**Tablero** — fila de `StatCard` con `trend` y `sparkline`, `TimeSeriesChart` para la evolución,
`BarChart horizontal` para rankings, `DonutChart` para la distribución.

## shadcn-vue (`packages/ui/app/components/ui`)

accordion, alert, alert-dialog, aspect-ratio, attachment, avatar, badge, breadcrumb, bubble,
button, button-group, calendar, card, carousel, chart, checkbox, code-block, collapsible,
combobox, command, context-menu, dialog, drawer, dropdown-menu, empty, field, hover-card, input,
input-group, input-otp, item, kbd, label, marker, menubar, message, message-scroller,
native-select, navigation-menu, number-field, pagination, pin-input, popover, progress,
questionnaire, radio-group, range-calendar, resizable, scroll-area, select, separator, sheet,
sidebar, skeleton, slider, sonner, spinner, stepper, switch, table, tabs, tags-input, textarea,
toggle, toggle-group, tooltip, trace.

Son código del proyecto y se actualizan con `pnpm --filter @starter/ui shadcn:diff` /
`shadcn:sync` (ver [dependency-updates.md](dependency-updates.md)). Los cambios locales llevan un
comentario `starter:` (por ejemplo `loading` en `Button`, las variantes `info`, `success` y
`warning` de `alert`, las etiquetas accesibles en español). El componente `form` del registro no
se incluye: los formularios usan `field` + `useZodForm`.

## Otros componentes comunes

| Componente | Uso |
| --- | --- |
| `PageHeader` | Título y descripción de cada página; slot `actions`. |
| `FileDropzone` | Arrastrar o elegir archivos con validación de tipo y tamaño (el servidor vuelve a validar por contenido). `accept`, `max-bytes`, `multiple`, `label`; eventos `files`, `error`. |
| `RelativeTime` | Fecha absoluta en SSR y relativa tras hidratar; `<time datetime>` accesible. |
| `ThemeToggle` | Claro / oscuro / sistema. |

## Componentes de la aplicación (`apps/web/app/components`)

| Componente | Uso |
| --- | --- |
| `AppSidebar` | Barra lateral desde `utils/navigation.ts`, filtrada por permisos y módulos. |
| `FloatingChat` | Chat flotante (AI SDK + `@ai-sdk/vue`), adjuntos, dictado, propuestas, citas y valoración. |
| `OrganizationSwitcher` | Cambio de organización activa (si hay más de una). |
| `shared/StatusBadge` | Estado con etiqueta en español y variante de color. |
| `shared/ModelSelect`, `AgentSelect`, `RoleSelect`, `UserPicker` | Selectores con datos de la API. |
| `shared/CollectionsSelect` | Selección múltiple de colecciones de conocimiento. |
| `shared/CapabilityBadges`, `RoleBadges`, `PermissionGroups`, `JsonDiff` | Capacidades, roles, permisos y diferencias (antes/después). |
| `chat/MessageText`, `chat/ProposalCard` | Texto con citas `[f1]` y tarjeta de propuesta con confirmación. |
| `knowledge/JobProgress`, `DocumentChunksSheet`, `RolesAclInput` | Progreso de trabajos, visor de fragmentos y ACL por rol. |
| `catalog/*` | Ejemplos del catálogo `/admin/components`. |

Llamadas a la API: usa el cliente generado con `useApi()` y `unwrap(...)`; nunca `$fetch` a mano.

```ts
const api = useApi();
const { data, refresh } = await useAsyncData('projects', () => unwrap(projectsList({ client: api, query })));
```

## Reglas aprendidas

1. **Nunca pongas `Badge` (renderiza un `div`) dentro de `<p>`**: HTML inválido y diferencia de
   hidratación. Usa un `div` o `span` contenedor.
2. **Envuelve en `<ClientOnly>` los `Select` de reka-ui cuyos ítems vienen de datos
   asíncronos** (`ModelSelect`, `AgentSelect` y los filtros de colección ya lo hacen). Las
   opciones estáticas de `FormFields` no lo necesitan.
3. **Nada que cambie entre servidor y cliente en el primer render**: `Date.now()`, números con
   `toLocaleString()` sin locale, `localStorage`. Usa `useState` para valores calculados una vez,
   los formatos de `#ui/lib/format` y aplica preferencias guardadas después de montar
   (`useViewMode`).
4. Fechas relativas con `RelativeTime`; gráficos solo en el cliente.
5. Claves de `useAsyncData` únicas por página y parámetro.
6. En plantillas, no uses tipos unión (`(v: A | B) => …`, `x as A | B`): el linter de Vue los lee
   como filtros. Deja que el tipo se infiera o mueve la función al `<script>`.
7. `data-testid` con prefijo del módulo (`project-…`): el generador los renombra y las pruebas E2E
   los usan.

## Accesibilidad

- Cada control tiene etiqueta (`FormField`/`FormFields` enlazan `label for`, `aria-describedby`
  y `aria-invalid`; `IconButton` exige `label`). Los obligatorios se anuncian («obligatorio»).
- Los íconos decorativos llevan `aria-hidden`; `AppIcon` con `label` pasa a `role="img"`.
- Las tablas tienen `caption` (oculto visualmente) y `aria-sort`; los gráficos su tabla
  equivalente; `Sparkline` un resumen como nombre accesible.
- El asistente usa `aria-current="step"`, mueve el foco al título de cada paso y anuncia «Paso n
  de N»; el carrusel anuncia la diapositiva y su avance automático se puede pausar.
- Avisos con `role="alert"`/`role="status"`; mensajes de error de campo con `role="alert"`.
- Navegación completa por teclado (enlace «Saltar al contenido», foco visible) y contraste en
  modo claro y oscuro; `ui.spec.ts` y `components.spec.ts` lo verifican en E2E.
- Textos en español; formatos con el locale y la zona horaria de la persona.
