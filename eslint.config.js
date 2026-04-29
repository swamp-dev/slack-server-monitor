import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },
  {
    // Disable type-aware rules for test files (not in tsconfig.json)
    files: ['tests/**/*.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Test fixtures invoked as standalone scripts (e.g. fake-agentbox.mjs)
    // aren't in tsconfig.json's include list and don't benefit from
    // typescript-eslint's project-aware checks.
    ignores: ['dist/', 'node_modules/', '*.config.js', '*.config.cjs', 'tests/fixtures/**/*.mjs'],
  }
);
