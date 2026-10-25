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

  test('wide charts and tables never make the page scroll sideways on laptop widths', async ({ ownerPage: page }) => {
    for (const [width, url] of [[1024, '/admin/audit'], [1024, '/admin/ai/usage'], [1280, '/admin/ai/usage'], [1280, '/admin/mail/deliveries']] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(url);
      await waitHydrated(page);
      await expect(page.getByRole('main')).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${url} at ${width}px`).toBeLessThanOrEqual(width);
    }
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
