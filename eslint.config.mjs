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
  ...nextVitals.map((c) => ({ ...c, files: ['apps/web/**/*.{js,jsx,ts,tsx}'] })),
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
);
