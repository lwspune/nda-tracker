import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // React Compiler skips components with manual useMemo it can't verify — not a runtime error
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
  // Node.js globals for Vite config (process, __dirname, etc.)
  {
    files: ['vite.config.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  // Vitest globals for test files (describe, it, expect, vi, etc.)
  {
    files: ['**/__tests__/**/*.{js,jsx}', '**/*.test.{js,jsx}'],
    languageOptions: {
      globals: {
        describe:  'readonly',
        it:        'readonly',
        test:      'readonly',
        expect:    'readonly',
        beforeEach: 'readonly',
        afterEach:  'readonly',
        beforeAll:  'readonly',
        afterAll:   'readonly',
        vi:        'readonly',
      },
    },
  },
])
