import { defineConfig } from 'vitest/config';

/**
 * unit: pure logic, no infrastructure.
 * integration: real PostgreSQL + pgvector (and Mailpit) — run `pnpm db:migrate` first.
 * Tests import compiled workspace packages (`pnpm build:ts`) exactly as the apps do.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'packages/ui/test/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'tooling/*/src/**/*.test.ts'],
          environment: 'node',
          // The UI layer's pure logic is tested from source; `#ui` is its Nuxt alias.
          alias: { '#ui': new URL('./packages/ui/app', import.meta.url).pathname },
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          setupFiles: ['tests/integration/setup.ts'],
        },
      },
    ],
  },
});
