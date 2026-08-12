// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Flat ESLint config for the NestJS backend (ESLint 9 + typescript-eslint 8).
 *
 * Deliberately "syntactic, not type-checked": we run the fast, no-project
 * recommended set so CI catches real mistakes (unreachable code, obvious
 * bugs, floating patterns) without a wall of stylistic noise on an existing
 * codebase. Rules that would flag pre-existing intentional patterns
 * (`any` at Prisma/SAP boundaries, decorator metadata, `require` in seeds)
 * are relaxed to warnings or off.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'prisma/migrations/**',
      'coverage/**',
      '**/*.js',
      '**/*.mjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: { sourceType: 'module' },
    },
    rules: {
      // Prisma/SAP/CFDI payloads and dynamic tariff variables are legitimately
      // untyped at the boundary; enforcing this would be pure noise here.
      '@typescript-eslint/no-explicit-any': 'off',
      // Unused symbols are worth surfacing but not worth failing the build;
      // allow the `_`-prefix escape hatch for intentionally-ignored params.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // NestJS relies on empty constructors/lifecycle stubs and interface-style
      // abstract methods; these are idiomatic, not smells.
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      // A handful of inline `require('fs')` calls for lazy fs access; worth a
      // nudge but not a build break (frontend treats the same as a warning).
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },
  {
    // Test specs mock freely; loosen the rules that fight that.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
