import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default tseslint.config(
  {
    ignores: [
      '**/database.types.ts',
      '**/.next/**',
      '**/.expo/**',
      '**/ios/**',
      '**/android/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/node_modules/**',
      '.superpowers/**',
      '**/.open-next/**',
      '**/.wrangler/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...nextVitals.map((c) => ({ ...c, files: ['apps/web/**/*.{js,jsx,ts,tsx}', 'apps/admin/**/*.{js,jsx,ts,tsx}'] })),
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Expo config plugins are plain CommonJS that Node loads with require().
    files: ['apps/mobile/plugins/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'writable', require: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Analytics goes through one wrapper per app, which strips anything personal before it leaves.
    files: ['apps/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/lib/analytics/**', 'apps/mobile/src/lib/analytics/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['posthog-js', 'posthog-js/*', 'posthog-react-native', 'posthog-react-native/*'], message: 'Use @/lib/analytics/client instead.' }] },
      ],
    },
  },
  {
    // Every on-screen error goes through ErrorText, which carries a code from the shared error list.
    files: ['apps/web/**/*.{ts,tsx}', 'apps/mobile/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/components/ui/text-field.tsx', 'apps/mobile/src/components/ui/text-field.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        // Any spelling: role="alert", role={'alert'}, role={`alert`}, role={bad ? 'alert' : undefined}.
        { selector: "JSXAttribute[name.name=/^(role|accessibilityRole)$/] Literal[value='alert']", message: 'Use ErrorText with a code' },
        { selector: "JSXAttribute[name.name=/^(role|accessibilityRole)$/] TemplateElement[value.raw='alert']", message: 'Use ErrorText with a code' },
      ],
    },
  },
);
