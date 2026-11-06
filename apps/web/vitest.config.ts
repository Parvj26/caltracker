import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Components under test are rendered to static markup; Next's own JSX transform is not in play here.
  oxc: { jsx: { runtime: 'automatic' } },
  test: { include: ['src/**/*.test.ts'] },
});
