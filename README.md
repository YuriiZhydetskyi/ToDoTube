# ToDoTube

Replace YouTube's recommendation rail and end-of-video grid with your TickTick to-do list. Fewer distractions, more awareness.

Firefox + Chrome. Manifest V3. TypeScript + [WXT](https://wxt.dev). Vanilla DOM. MIT licensed.

> Full spec: see [REQUIREMENTS.md](REQUIREMENTS.md).

## Status

🚧 Pre-alpha. v1 in active development.

## Quick start (development)

```bash
pnpm install
pnpm dev              # Chrome
pnpm dev:firefox      # Firefox
```

WXT opens a fresh browser window with the unpacked extension loaded. Navigate to any YouTube watch page (`youtube.com/watch?v=…`).

## Build

```bash
pnpm build            # Chrome MV3 → .output/chrome-mv3
pnpm build:firefox    # Firefox MV3 → .output/firefox-mv3
pnpm zip              # Both, zipped for store upload
```

## TickTick OAuth setup

Before the TickTick provider works end-to-end you must register a developer app:

1. Go to https://developer.ticktick.com/manage and create a new app.
2. Capture the `Client ID` and `Client Secret`.
3. Copy `.env.example` to `.env` and paste them in.
4. Register two redirect URIs in TickTick:
   - **Chrome:** `https://<chrome-extension-id>.chromiumapp.org/`
   - **Firefox:** `https://<addon-uuid>.extensions.allizom.org/`
5. To get a **stable** Chrome extension ID, pack the extension once locally to generate a key, then add `manifest.key` to `wxt.config.ts`. Until then, the dev ID changes whenever you reload from a different path.

> **Public-client note.** TickTick does not document PKCE support, so the
> classic client-secret OAuth flow is required. The secret ships inside the
> extension bundle and is therefore a **public** value, not a real secret.
> Do not commit a personal `.env` to a public fork.

## Architecture

Three-layer model with hard ESLint-enforced import boundaries:

```
┌─ surfaces/ ───────────────────┐    Knows YouTube DOM. No task logic.
└──────────────↑────────────────┘
┌─ core/ ──────┴────────────────┐    Orchestrator. The only layer that
└──────────────↓────────────────┘    knows surfaces AND providers exist.
┌─ providers/ ──────────────────┐    Knows the task API. No DOM logic.
└───────────────────────────────┘
```

YouTube selectors live in **exactly one place**: `src/surfaces/desktop-watch/selectors.ts`. See [docs/SELECTORS.md](docs/SELECTORS.md) for how the multi-strategy resolver works and how to author an override when YouTube changes things.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
