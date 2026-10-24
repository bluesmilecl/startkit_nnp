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
          include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'tooling/*/src/**/*.test.ts'],
          environment: 'node',
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
