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
      // The activity bridge is a separate self-hosted package with its own
      // toolchain; it isn't part of the extension build or tsconfig.
      'bridge/**',
      // Sync backend templates (Cloudflare Worker / Supabase SQL) are
      // self-hosted by the user with their own runtime globals; not part of the
      // extension build or tsconfig. See docs/SYNC.md.
      'backends/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
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
        // The entry pattern must come BEFORE the layer patterns: files
        // under src/entrypoints/ would otherwise be matched as e.g.
        // `core` if a core/* pattern came first.
        { type: 'entry', pattern: 'src/entrypoints/**/*', mode: 'file' },
        { type: 'shared', pattern: 'src/shared/**/*', mode: 'file' },
        { type: 'providers', pattern: 'src/providers/**/*', mode: 'file' },
        { type: 'signals', pattern: 'src/signals/**/*', mode: 'file' },
        { type: 'gates', pattern: 'src/gates/**/*', mode: 'file' },
        { type: 'surfaces', pattern: 'src/surfaces/**/*', mode: 'file' },
        { type: 'ui', pattern: 'src/ui/**/*', mode: 'file' },
        { type: 'core', pattern: 'src/core/**/*', mode: 'file' },
      ],
    },
    rules: {
      // Underscore-prefixed unused vars are intentional (e.g. positional
      // callback args we want to keep for future use).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'boundaries/dependencies': [
        'error',
        {
          // With `default: 'disallow'`, EVERY cross-element edge is
          // forbidden unless explicitly allowed below. Same-element edges
          // must also be allowed explicitly (e.g. shared -> shared), so
          // every type appears in its own allow list.
          default: 'disallow',
          rules: [
            { from: { type: 'shared' }, allow: { to: { type: ['shared'] } } },
            { from: { type: 'providers' }, allow: { to: { type: ['providers', 'shared'] } } },
            // signals + gates are pure (like providers): they may use shared
            // and their own layer, nothing else. Gates receive signal VALUES
            // via GateContext (a shared DTO), so they need no edge to signals.
            { from: { type: 'signals' }, allow: { to: { type: ['signals', 'shared'] } } },
            { from: { type: 'gates' }, allow: { to: { type: ['gates', 'shared'] } } },
            { from: { type: 'surfaces' }, allow: { to: { type: ['surfaces', 'shared'] } } },
            { from: { type: 'ui' }, allow: { to: { type: ['ui', 'shared'] } } },
            {
              from: { type: 'core' },
              allow: {
                to: { type: ['core', 'shared', 'providers', 'signals', 'gates', 'surfaces', 'ui'] },
              },
            },
            { from: { type: 'entry' }, allow: { to: { type: ['entry', 'shared', 'core'] } } },
          ],
        },
      ],
    },
  },
  prettier,
);
