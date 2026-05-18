import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

// WxtVitest() wires up:
//   - the same vite config WXT uses (alias `@/*`, etc.)
//   - `fakeBrowser` so `browser.storage.local` etc. work in jsdom/node
//   - WXT's auto-imports (we don't rely on these but they don't hurt)
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    // jsdom only where we explicitly opt in (surface tests use a
    // `// @vitest-environment jsdom` directive in the file).
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
