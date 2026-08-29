import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Root ESLint flat config. Layer-boundary rules (D1-D7, SDD §4.7) are documented in
 * docs/ARCHITECTURE.md and enforced primarily by code review + the directory
 * structure itself; `no-restricted-imports` below covers the two highest-risk edges.
 */
export default [
  js.configs.recommended,
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'contracts/cache/**',
      'contracts/artifacts/**',
      'contracts/typechain-types/**',
    ],
  },
  {
    files: ['**/*.js', '**/*.jsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly' },
    },
    rules: {
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/api/src/**/*.js', 'apps/worker/src/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'pg',
              message: 'Only modules under repositories/ may import pg (rule D3).',
            },
            {
              name: 'ethers',
              message: 'Only chain.adapter.js may import ethers (rule D4).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.jsx', 'apps/web/src/**/*.js'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'no-console': 'error',
    },
  },
];
