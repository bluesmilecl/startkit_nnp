import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the real Docker stack (scripts/e2e-stack.mjs): Nuxt + NestJS + worker +
 * PostgreSQL/pgvector + Mailpit. Business APIs are never mocked; only the AI provider is the
 * deterministic test adapter (real tool-execution path).
 */
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // Serial: tests share one owner session and the per-email OTP resend cooldown.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: executablePath ? { executablePath } : {} } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: executablePath ? { executablePath } : {} }, grep: /@mobile/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
