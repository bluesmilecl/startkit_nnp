import type { Page } from '@playwright/test';
import { expect, test, waitHydrated } from './fixtures.js';

/**
 * UI kit catalog (/admin/components): every family renders without console errors or hydration
 * warnings, and the interactive components behave as documented (validation from the Zod schema,
 * wizard steps, table/cards, selection, menus with confirmation, carousel, toasts and modals).
 */
const TABS = ['forms', 'wizard', 'data', 'charts', 'carousel', 'actions', 'feedback', 'icons', 'format'];

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !/Download the Vue Devtools|VUE_ROUTER_R0004/.test(m.text())) problems.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

async function openTab(page: Page, tab: string) {
  await page.goto(`/admin/components?tab=${tab}`);
  await waitHydrated(page);
}

test.describe('UI kit catalog', () => {
  test('every tab renders without errors or hydration warnings (SSR + client)', async ({ ownerPage: page }) => {
    const problems = watchConsole(page);
    for (const tab of TABS) {
      await openTab(page, tab);
      await expect(page.getByTestId(`catalog-tab-${tab}`)).toHaveAttribute('data-state', 'active');
      await page.waitForTimeout(300);
      expect(problems, `tab ${tab}`).toEqual([]);
    }
    // Switching tabs updates the URL so each family can be linked.
    await page.getByTestId('catalog-tab-icons').click();
    await expect(page).toHaveURL(/tab=icons/);
  });

  test('FormFields validates with the Zod schema and maps server errors to fields', async ({ ownerPage: page }) => {
    await openTab(page, 'forms');
    const form = page.getByTestId('demo-form');
    await form.getByTestId('demo-form-submit').click();
    await expect(form.getByText('Mínimo 2 caracteres')).toBeVisible();
    await expect(form.getByText('Correo inválido')).toBeVisible();
    await expect(form.getByText('Elige al menos un canal')).toBeVisible();
    await expect(form.getByText('Debes aceptar los términos')).toBeVisible();
    await expect(page.getByTestId('demo-name')).toHaveAttribute('aria-invalid', 'true');

    // Errors clear as the person fixes the field.
    await page.getByTestId('demo-name').fill('Comercial Andes');
    await page.getByTestId('demo-name').blur();
    await expect(form.getByText('Mínimo 2 caracteres')).toHaveCount(0);

    await form.getByRole('button', { name: 'Simular error del servidor' }).click();
    await expect(form.getByText('Ese correo ya está registrado')).toBeVisible();
    await expect(page.getByTestId('demo-form-error')).toContainText('Revisa los campos marcados');

    // Modal form: Cancel/Submit, validation and closing on success.
    await page.getByTestId('open-form-dialog').click();
    const dialog = page.getByRole('dialog', { name: 'Nuevo contacto' });
    await dialog.getByTestId('contact-form-submit').click();
    await expect(dialog.getByText('Mínimo 2 caracteres')).toBeVisible();
    await page.getByTestId('contact-name').fill('Ana Rojas');
    await dialog.getByLabel('Cargo').fill('Gerenta de TI');
    await dialog.getByTestId('contact-form-submit').click();
    await expect(page.getByText('Contacto «Ana Rojas» agregado')).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });

  test('FormWizard validates each step, saves a step, revisits and completes', async ({ ownerPage: page }) => {
    await openTab(page, 'wizard');
    const next = page.getByTestId('demo-wizard-next');
    await expect(page.getByTestId('demo-wizard-back')).toBeDisabled();
    await next.click();
    await expect(page.getByText('Mínimo 2 caracteres')).toBeVisible();
    await expect(page.getByTestId('demo-wizard-title')).toHaveText('Empresa');

    await page.getByTestId('wz-company').fill('Comercial Andes SpA');
    await page.getByTestId('wz-email').fill('ti@andes.cl');
    await next.click();
    await expect(page.getByTestId('demo-wizard-title')).toHaveText('Plan');
    await expect(page.getByTestId('demo-wizard-title')).toBeFocused();
    // A later step cannot be reached from the header before passing through it.
    await expect(page.getByTestId('demo-wizard-step-summary')).toBeDisabled();
    await page.getByTestId('demo-wizard-back').click();
    await expect(page.getByTestId('demo-wizard-title')).toHaveText('Empresa');
    await page.getByTestId('demo-wizard-step-plan').click();
    await expect(page.getByTestId('demo-wizard-title')).toHaveText('Plan');

    await next.click(); // plan has valid defaults
    await expect(page.getByTestId('demo-wizard-title')).toHaveText('Avisos');
    await next.click(); // beforeNext "saves" this step
    await expect(page.getByText('Preferencias de aviso guardadas')).toBeVisible();
    await expect(page.getByTestId('wz-summary')).toContainText('Comercial Andes SpA');
    await expect(page.getByTestId('wz-summary')).toContainText('US$ 190');
    await expect(next).toHaveText('Confirmar alta');
    await next.click();
    await expect(page.getByText('Alta de «Comercial Andes SpA» completada')).toBeVisible();
    await expect(page.getByTestId('demo-wizard-title')).toHaveText('Empresa');
  });

  test('lists: search, filter, table/cards (remembered), selection with bulk actions and row menus', async ({ ownerPage: page }) => {
    await openTab(page, 'data');
    const table = page.locator('[data-slot=data-table]').first();
    await expect(table.getByRole('row')).toHaveCount(11); // header + 10 per page
    await page.getByTestId('orders-search').fill('Patagonia');
    await expect(table.getByRole('row')).toHaveCount(6); // OC-1046, 1053, 1060, 1067, 1074
    await expect(page.getByTestId('orders-clear')).toBeVisible();
    await page.getByTestId('orders-clear').click();
    await expect(page.getByTestId('orders-search')).toHaveValue('');

    // Selection keeps ids across the page and offers bulk actions.
    await table.getByRole('checkbox', { name: 'Seleccionar fila OC-1040' }).click();
    await table.getByRole('checkbox', { name: 'Seleccionar fila OC-1041' }).click();
    await expect(page.getByTestId('bulk-bar')).toContainText('2 seleccionados');
    await page.getByTestId('bulk-archive').click();
    await expect(page.getByText('2 órdenes archivadas')).toBeVisible();
    await expect(page.getByTestId('bulk-bar')).toHaveCount(0);

    // Row menu with confirmation.
    await table.getByRole('row', { name: /OC-1042/ }).getByTestId('order-actions').click();
    await page.getByTestId('order-delete').click();
    await page.getByTestId('confirm-accept').click();
    await expect(page.getByText('OC-1042 eliminada')).toBeVisible();

    // Cards view, remembered after reload.
    await page.getByTestId('orders-view-cards').click();
    await expect(page.getByTestId('card-OC-1040')).toBeVisible();
    await expect(page.getByTestId('card-OC-1040')).toContainText('Estado');
    await expect(table.getByRole('table')).toHaveCount(0);
    await page.reload();
    await waitHydrated(page);
    await expect(page.getByTestId('card-OC-1040')).toBeVisible();
    await page.getByTestId('orders-view-table').click();
    await expect(page.getByTestId('row-OC-1040')).toBeVisible();
  });

  test('carousel, menus, alerts, toasts, confirmations, modals and icons', async ({ ownerPage: page }) => {
    await openTab(page, 'carousel');
    const status = page.getByTestId('demo-carousel-status');
    await expect(status).toHaveText('Diapositiva 1 de 4');
    await page.getByTestId('demo-carousel-next').click();
    await expect(status).toHaveText('Diapositiva 2 de 4');
    await page.getByRole('button', { name: 'Ir a la diapositiva 4' }).first().click();
    await expect(status).toHaveText('Diapositiva 4 de 4');
    await expect(page.getByTestId('demo-carousel-next')).toBeDisabled();

    await openTab(page, 'actions');
    await page.getByTestId('demo-menu').click();
    await expect(page.getByRole('menuitem', { name: 'Solo administradores' })).toHaveCount(0);
    await page.getByTestId('menu-delete').click();
    await expect(page.getByTestId('confirm-accept')).toBeDisabled();
    await page.getByTestId('confirm-type').fill('Comercial Andes');
    await page.getByTestId('confirm-accept').click();
    await expect(page.getByText('Eliminado', { exact: true })).toBeVisible();
    await page.getByTestId('demo-section-nav').getByRole('button', { name: /Facturación/ }).click();
    await expect(page.getByTestId('demo-section-content')).toContainText('billing');
    await expect(page.getByTestId('demo-section-nav').getByRole('button', { name: /API/ })).toBeDisabled();
    await page.getByTestId('loading-button').click();
    await expect(page.getByTestId('loading-button')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByText('Guardado', { exact: true })).toBeVisible();

    await openTab(page, 'feedback');
    await expect(page.getByTestId('demo-alerts').getByRole('alert')).toHaveCount(2); // warning + destructive
    await page.getByRole('button', { name: 'Cerrar aviso' }).click();
    await expect(page.getByText('Aviso que se puede cerrar')).toHaveCount(0);
    await page.getByTestId('toast-api-error').click();
    await expect(page.getByText('Presupuesto «Chat por persona» agotado')).toBeVisible();
    await expect(page.getByText('Código de solicitud: req_7f3a2c')).toBeVisible();
    await page.getByTestId('open-modal').click();
    await expect(page.getByRole('dialog', { name: 'Orden OC-1044' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Orden OC-1044' })).toHaveCount(0);

    await openTab(page, 'icons');
    await page.getByTestId('icon-search').fill('eliminar');
    await expect(page.getByTestId('icon-tile-delete')).toBeVisible();
    await expect(page.getByTestId('icon-tile-user')).toHaveCount(0);
  });

  test('wizard and lists adapt to phones @mobile', async ({ ownerPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTab(page, 'wizard');
    await expect(page.getByText('Paso 1 de 4', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Pasos' })).toBeHidden();
    await openTab(page, 'data');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
