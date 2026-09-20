import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    // Forks isolate each test file's SQLite handles and its process-level
    // warning filter from the others.
    pool: 'forks',
    testTimeout: 20_000,
  },
});
