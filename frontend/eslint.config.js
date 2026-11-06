import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/** The frontend's lint rules (ARCHITECTURE.md §13).
 *
 *  Three rules here exist for architectural reasons rather than stylistic ones:
 *
 *  * `no-restricted-syntax` on colour literals — a theme is a document that
 *    overrides CSS custom properties, and one hardcoded `#0b0b0f` is a theme
 *    that no longer works (§10).
 *  * `no-restricted-globals` on `fetch` — every call goes through the client in
 *    `core/api`, which is where the token, the deadline and the error shape
 *    live. A bare `fetch` in a component is three policies quietly skipped.
 *  * `react-hooks` — the exhaustive-deps rule is how a stale closure is caught
 *    by a machine instead of by a user.
 */
export default tseslint.config(
  { ignores: ['dist', 'coverage', 'src/core/api/contract.ts'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'use core/api/client.ts — it carries the token and the deadline',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i]',
          message: 'colours are theme tokens, not literals — see src/styles/theme.css',
        },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
);
