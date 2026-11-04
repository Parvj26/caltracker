import { defineConfig } from 'vitest/config';

// DB-free tests only (run by `pnpm check`): no Supabase global setup.
export default defineConfig({
  test: { include: ['*.unit.test.ts'] },
});
