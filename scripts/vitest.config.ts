import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['*.test.ts'],
    globalSetup: ['./vitest.global-setup.ts'],
    testTimeout: 30_000,
  },
});
