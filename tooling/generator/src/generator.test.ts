import { describe, expect, it } from 'vitest';
import { deriveNames, planModule, transform } from './index.js';

const root = new URL('../../..', import.meta.url).pathname;
const spec = { key: 'ordenes-compra', entity: 'PurchaseOrder', label: 'Órdenes de compra', labelSingular: 'Orden de compra', gender: 'f' as const, icon: 'ClipboardList' };

describe('module generator', () => {
  it('derives every naming form from the key and entity', () => {
    expect(deriveNames(spec)).toMatchObject({ kebab: 'ordenes-compra', snake: 'ordenes_compra', camel: 'ordenesCompra', entityPlural: 'PurchaseOrders', kebabSingular: 'purchase-order', snakeSingular: 'purchase_order', prefix: 'oc' });
    expect(() => deriveNames({ ...spec, key: 'users' })).toThrow(/reservada/);
    expect(() => deriveNames({ ...spec, key: 'Ordenes' })).toThrow(/kebab-case/);
    expect(() => deriveNames({ ...spec, entity: 'purchaseOrder' })).toThrow(/PascalCase/);
  });

  it('rewrites identifiers, routes, permissions, tables and labels by context', () => {
    const n = deriveNames(spec);
    const out = transform(
      [
        "export const projects = pgTable('projects', {}, (t) => [index('projects_org_idx')]);",
        "@Controller('projects') @Endpoint({ operationId: 'projects_list', permission: 'projects.read' })",
        "import { ProjectsService } from './projects.service.js'; projectsList({ client }); '/api/projects'",
        "recordAudit(db, actor, { action: 'projects.archive', resourceType: 'project' }); data-testid=\"project-new\" id=\"pj-name\"",
        "toast.success('Proyecto creado'); 'Nuevo proyecto'; 'Aún no hay proyectos'",
      ].join('\n'),
      n,
    );
    expect(out).toContain("export const ordenesCompra = pgTable('ordenes_compra'");
    expect(out).toContain("index('ordenes_compra_org_idx')");
    expect(out).toContain("@Controller('ordenes-compra')");
    expect(out).toContain("operationId: 'ordenes_compra_list', permission: 'ordenes_compra.read'");
    expect(out).toContain("import { PurchaseOrdersService } from './ordenes-compra.service.js'; ordenesCompraList({ client }); '/api/ordenes-compra'");
    expect(out).toContain("action: 'ordenes_compra.archive', resourceType: 'purchase_order'");
    expect(out).toContain('data-testid="purchase-order-new" id="oc-name"');
    expect(out).toContain("toast.success('Orden de compra creada'); 'Nueva orden de compra'; 'Aún no hay órdenes de compra'");
    expect(out).not.toMatch(/project|Project|proyecto/i);
  });

  it('plans files from the live reference module and patches catalog, roles and navigation', () => {
    const plan = planModule(root, spec);
    expect(plan.files.map((f) => f.path)).toEqual([
      'packages/contracts/src/ordenes-compra.ts',
      'packages/db/src/schema/ordenes-compra.ts',
      'apps/api/src/modules/ordenes-compra/ordenes-compra.module.ts',
      'apps/api/src/modules/ordenes-compra/ordenes-compra.controller.ts',
      'apps/api/src/modules/ordenes-compra/ordenes-compra.service.ts',
      'apps/web/app/pages/admin/ordenes-compra/index.vue',
      'tests/e2e/ordenes-compra.spec.ts',
    ]);
    // (Playwright's `test.info().project` is an API, not the reference module.)
    for (const f of plan.files) expect(f.content.replaceAll('test.info().project', ''), f.path).not.toMatch(/\bprojects?\b|Projects?(?![a-z])|proyectos?\b/i);

    const nav = plan.patches.find((p) => p.path.endsWith('navigation.ts'))!;
    const patched = nav.apply("import {\n  FolderKanban,\n  Wallet,\n} from '@lucide/vue';\n      { title: 'Proyectos', to: '/admin/projects', icon: FolderKanban, permission: 'projects.read' },\n")!;
    expect(patched).toContain('  ClipboardList,\n  FolderKanban,\n  Wallet,\n}');
    expect(patched).toContain("{ title: 'Órdenes de compra', to: '/admin/ordenes-compra', icon: ClipboardList, permission: 'ordenes_compra.read' }");

    const perms = plan.patches.find((p) => p.path.endsWith('permissions.ts'))!;
    const catalog = perms.apply("  'projects.manage': { group: 'projects', description: 'x' },\n} as const;\n  editor: [\n    'projects.manage',\n  ],\n  viewer: ['ai.chat', 'projects.read'],\n")!;
    expect(catalog).toContain("'ordenes_compra.manage': { group: 'ordenes_compra'");
    expect(catalog).toContain("    'ordenes_compra.read',\n    'ordenes_compra.manage',\n");
    expect(catalog).toContain("viewer: ['ai.chat', 'projects.read', 'ordenes_compra.read']");
    // Missing anchors are reported for manual work instead of corrupting the file.
    expect(perms.apply('export const PERMISSIONS = {};')).toBeNull();
  });
});
