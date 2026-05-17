# Contributing to ToDoTube

Thanks for your interest. ToDoTube is small and opinionated — read the spec ([REQUIREMENTS.md](REQUIREMENTS.md)) first; it explains the constraints.

## Local setup

```bash
pnpm install
pnpm dev              # Chrome dev with HMR
pnpm dev:firefox      # Firefox dev with HMR
pnpm test             # Vitest
pnpm compile          # Type-check the whole project
pnpm lint             # ESLint + Prettier
pnpm format           # Auto-format with Prettier
```

## Architecture rules (enforced by ESLint)

Three layers, no cross-layer imports:

- `src/providers/**` → may import only `src/shared/**`
- `src/surfaces/**` → may import only `src/shared/**`
- `src/ui/**` → may import only `src/shared/**`
- `src/core/**` → may import any of the above
- `entrypoints/**` → may import only `src/core/**` and `src/shared/**`
- `src/shared/**` → may import none of the above

A breaking import fails CI. If you think a rule needs to bend, surface it in the PR description — don't disable the rule.

## Selector rules

YouTube identifiers (`ytd-…` tags, `#secondary`, `#related`, etc.) may appear **only** in `src/surfaces/<surface>/selectors.ts` and `heuristics.ts`. CI greps the rest of the source for these patterns and fails if any leak. If YouTube changes a selector, fix it in `selectors.ts` and bump the version. See [docs/SELECTORS.md](docs/SELECTORS.md).

## Code style

- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any` outside boundary parsers.
- No utility-belt deps (lodash, moment, etc.).
- Comments only where the **why** is non-obvious — not what the code does.
- Vanilla DOM only. No React/Preact/Vue/Svelte.

## Commits

Conventional Commits style preferred (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`).

## Reporting a YouTube DOM breakage

Open an issue with the **Selector breakage** template. It pre-fills your user agent and asks for the outerHTML of the relevant container — see the template for details.
