// Flat config — see https://eslint.org/docs/latest/use/configure/configuration-files
//
// The most important rule here is `boundaries/dependencies`. It enforces
// the three-layer architecture from REQUIREMENTS.md §5 — see
// CONTRIBUTING.md → "Architecture rules" for the human-readable summary.
// Uses eslint-plugin-boundaries v6 object-selector syntax.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '.wxt/**',
      '.output/**',
      'node_modules/**',
      'coverage/**',
      'web-ext-artifacts/**',
      'dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'entrypoints/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      // boundaries' dependency rule uses eslint-module-utils/resolve under
      // the hood, which reads `import/resolver`. Without a TS-aware
      // resolver here, relative imports like `../foo` would fail to
      // resolve to a `.ts` file and the rule would silently no-op.
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
        node: true,
      },
      'boundaries/elements': [
        { type: 'shared', pattern: 'src/shared/**/*', mode: 'file' },
        { type: 'providers', pattern: 'src/providers/**/*', mode: 'file' },
        { type: 'surfaces', pattern: 'src/surfaces/**/*', mode: 'file' },
        { type: 'ui', pattern: 'src/ui/**/*', mode: 'file' },
        { type: 'core', pattern: 'src/core/**/*', mode: 'file' },
        { type: 'entry', pattern: 'entrypoints/**/*', mode: 'file' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: { type: 'shared' }, disallow: { to: { type: '*' } } },
            { from: { type: 'providers' }, allow: { to: { type: 'shared' } } },
            { from: { type: 'surfaces' }, allow: { to: { type: 'shared' } } },
            { from: { type: 'ui' }, allow: { to: { type: 'shared' } } },
            {
              from: { type: 'core' },
              allow: { to: { type: ['shared', 'providers', 'surfaces', 'ui'] } },
            },
            { from: { type: 'entry' }, allow: { to: { type: ['shared', 'core'] } } },
          ],
        },
      ],
    },
  },
  prettier,
);
