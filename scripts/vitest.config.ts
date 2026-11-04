import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['*.test.ts'],
    exclude: ['*.unit.test.ts', 'node_modules/**'],
    globalSetup: ['./vitest.global-setup.ts'],
    testTimeout: 30_000,
  },
});
