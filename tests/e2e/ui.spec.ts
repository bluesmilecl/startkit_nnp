import { expect, test, waitHydrated } from './fixtures.js';

test.describe('interface', () => {
  test('keyboard navigation reaches the main content and sidebar links', async ({ ownerPage: page }) => {
    await page.goto('/admin');
    await waitHydrated(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('dark mode toggles the theme class', async ({ ownerPage: page }) => {
    await page.goto('/admin');
    await waitHydrated(page);
    await page.getByTestId('theme-toggle').click();
    await page.getByTestId('theme-dark').click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByTestId('theme-toggle').click();
    await page.getByTestId('theme-light').click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('mobile layout uses the collapsible sidebar @mobile', async ({ ownerPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/users');
    await waitHydrated(page);
    await page.getByRole('button', { name: 'Mostrar u ocultar navegación' }).click();
    await expect(page.getByRole('link', { name: 'Roles' })).toBeVisible();
  });
});
