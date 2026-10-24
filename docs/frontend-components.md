# Componentes de interfaz

La web (Nuxt 4, Vue 3, TypeScript estricto) extiende la capa compartida `@starter/ui`
(`packages/ui`), que aporta Tailwind CSS 4, los componentes **shadcn-vue** vendorizados, los
componentes comunes del starter, gráficos y utilidades. Importa con el alias `#ui/...`:

```ts
import { Button } from '#ui/components/ui/button';
import DataTable from '#ui/components/common/DataTable.vue';
import { formatUsd } from '#ui/lib/format';
```

El catálogo vivo de componentes con ejemplos está en **`/admin/components`**
([`components.vue`](../apps/web/app/pages/admin/components.vue)). Es visible para cualquier persona
con sesión (no requiere permiso: solo muestra ejemplos y nunca llama a la API).

## shadcn-vue (`packages/ui/app/components/ui`)

accordion, alert, alert-dialog, aspect-ratio, attachment, avatar, badge, breadcrumb, bubble,
button, button-group, calendar, card, carousel, chart, checkbox, code-block, collapsible,
combobox, command, context-menu, dialog, drawer, dropdown-menu, empty, field, hover-card, input,
input-group, input-otp, item, kbd, label, marker, menubar, message, message-scroller,
native-select, navigation-menu, number-field, pagination, pin-input, popover, progress,
questionnaire, radio-group, range-calendar, resizable, scroll-area, select, separator, sheet,
sidebar, skeleton, slider, sonner, spinner, stepper, switch, table, tabs, tags-input, textarea,
toggle, toggle-group, tooltip, trace.

Son código del proyecto (se pueden ajustar) y se actualizan con `pnpm --filter @starter/ui
shadcn:diff` / `shadcn:sync` (ver [dependency-updates.md](dependency-updates.md)). El componente
`form` del registro no se incluye: los formularios usan `field` + `useZodForm`.

## Componentes comunes (`packages/ui/app/components/common`)

| Componente | Uso | API principal |
| --- | --- | --- |
| `PageHeader` | Título y descripción de cada página, con acciones a la derecha. | props `title`, `description`; slot `actions`. |
| `DataTable` | Tabla sobre TanStack Table con **paginación y orden en el servidor** (nunca recorta datos parciales en el cliente). | props `columns`, `data`, `total`, `page`, `pageSize`, `loading`, `sort`, `emptyText`, `caption`, `rowKey`; eventos `update:page`, `update:sort`, `rowClick`. |
| `StatCard` | Indicador con título, valor, ayuda e ícono; muestra *skeleton* mientras carga. | `title`, `value`, `hint`, `icon`, `loading`. |
| `EmptyState` | Estado vacío con ícono, texto y acción (slot). | `title`, `description`, `icon`. |
| `FileDropzone` | Arrastrar o elegir archivos con validación de tipo y tamaño en el cliente (el servidor vuelve a validar por contenido). | `accept`, `maxBytes`, `multiple`, `disabled`, `label`; eventos `files(File[])`, `error(mensaje)`. |
| `ConfirmHost` + `useConfirm()` | Confirmación con *alert-dialog* basada en promesas. Montado una vez en `app.vue`. | `confirm({ title, description, confirmLabel, cancelLabel, destructive, typeToConfirm })` → `Promise<boolean>`. |
| `RelativeTime` | Fecha absoluta en SSR y relativa ("hace 5 min") tras hidratar; `<time datetime>` accesible. | `value`. |
| `ThemeToggle` | Claro / oscuro / sistema (persistido). | — |

`typeToConfirm` exige escribir un texto (por ejemplo el correo o el identificador) para habilitar
el botón en acciones irreversibles:

```ts
const { confirm } = useConfirm();
if (!(await confirm({ title: `¿Eliminar «${p.name}»?`, destructive: true, confirmLabel: 'Eliminar', typeToConfirm: p.name }))) return;
```

## Gráficos (`packages/ui/app/components/charts`)

Basados en el componente `chart` de shadcn-vue sobre Unovis. Se renderizan solo en el cliente
(`ClientOnly` con *skeleton*), ofrecen **tabla equivalente** (accesibilidad) y **exportación CSV**.

| Componente | Props |
| --- | --- |
| `TimeSeriesChart` | `data` (filas con `x` y una clave por serie), `series` (`key`, `label`, `color?`), `kind` (`line`, `area`, `bar`, `stacked`), `title`, `xLabel`, `valueFormat`, `csvName`, `height`. Con un solo punto, líneas y áreas se muestran como barras. |
| `DonutChart` | `data` (`key`, `label`, `value`), `title`, `valueFormat`, `csvName`; leyenda con porcentajes. |

## Formularios: `useZodForm`

Valida con **el mismo esquema Zod** que usa la API (`@starter/contracts`) y mapea los errores
`VALIDATION_FAILED` del servidor a cada campo:

```ts
const form = useZodForm(CreateProjectInput, { name: '', description: '' });
const submit = form.handleSubmit(async (values) => {
  await projectsCreate({ client: api, body: values });
});
// form.values, form.errors, form.formError, form.submitting, form.reset()
```

```vue
<Field :data-invalid="!!form.errors.name">
  <FieldLabel for="pj-name">Nombre</FieldLabel>
  <Input id="pj-name" v-model="form.values.name" />
  <FieldError :errors="[form.errors.name]" />
</Field>
```

## Utilidades (`#ui/lib`)

- `format.ts`: `formatDate`, `formatRelative`, `formatNumber`, `formatBytes`, `formatUsd`
  (montos menores a un centavo con dígitos significativos), `formatClp` (conversión visual con la
  tasa del día), `formatPerMillion`, `setFormatLocale` (locale y zona de la persona).
- `csv.ts`: `toCsv`, `downloadCsv`.
- `utils.ts`: `cn` para clases condicionales.

## Componentes de la aplicación (`apps/web/app/components`)

| Componente | Uso |
| --- | --- |
| `AppSidebar` | Barra lateral desde `utils/navigation.ts`, filtrada por permisos y módulos. |
| `FloatingChat` | Chat flotante (AI SDK + `@ai-sdk/vue`), adjuntos, dictado, propuestas, citas y valoración. |
| `OrganizationSwitcher` | Cambio de organización activa (si hay más de una). |
| `shared/StatusBadge` | Estado con etiqueta en español y variante de color. |
| `shared/ModelSelect`, `AgentSelect`, `RoleSelect`, `UserPicker` | Selectores con datos de la API. |
| `shared/CollectionsSelect` | Selección múltiple de colecciones de conocimiento. |
| `shared/CapabilityBadges`, `RoleBadges`, `PermissionGroups`, `JsonDiff` | Presentación de capacidades, roles, permisos y diferencias (antes/después). |
| `chat/MessageText`, `chat/ProposalCard` | Texto con citas `[f1]` y tarjeta de propuesta con confirmación. |
| `knowledge/JobProgress`, `DocumentChunksSheet`, `RolesAclInput` | Progreso de trabajos, visor de fragmentos y ACL por rol. |

Llamadas a la API: usa el cliente generado con `useApi()` y `unwrap(...)`; los errores se
normalizan con `apiError(err)`:

```ts
const api = useApi();
const { data, refresh } = await useAsyncData('projects', () => unwrap(projectsList({ client: api, query })));
```

## Reglas aprendidas (evitan errores de hidratación)

1. **Nunca pongas `Badge` (renderiza un `div`) dentro de `<p>`**: produce HTML inválido y
   *hydration mismatch*. Usa un `div` o `span` contenedor.
2. **Envuelve en `<ClientOnly>` los `Select` de reka-ui cuyos ítems vienen de datos asíncronos**:
   con un valor seleccionado renderizan un *teleport* que difiere entre servidor y cliente
   (`ModelSelect`, `AgentSelect` y los filtros de colección ya lo hacen).
3. Fechas relativas con `RelativeTime`; gráficos solo en el cliente.
4. Claves de `useAsyncData` únicas por página y parámetro.

## Accesibilidad

- Cada control tiene etiqueta (`FieldLabel for`, `aria-label` en botones de ícono) y los grupos de
  acciones usan `role="group"` con nombre.
- Los íconos decorativos llevan `aria-hidden="true"`; el estado de botones conmutables usa
  `aria-pressed`.
- Las tablas tienen `caption` (oculto visualmente) y los gráficos su tabla equivalente.
- Navegación por teclado completa (enlace "Saltar al contenido", foco visible) y contraste en modo
  claro y oscuro; `ui.spec.ts` lo verifica en E2E.
- Mensajes de estado con `role="status"` / `role="alert"` y regiones `aria-live` en el chat.
- Textos en español; formatos con el locale y la zona horaria de la persona.
