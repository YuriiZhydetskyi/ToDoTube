# ToDoTube

Replace YouTube's recommendation rail and end-of-video grid with your TickTick to-do list. Fewer distractions, more awareness.

Firefox + Chrome. Manifest V3. TypeScript + [WXT](https://wxt.dev). Vanilla DOM. MIT licensed.

> Full spec: see [REQUIREMENTS.md](REQUIREMENTS.md).

## Status

🚧 Alpha. All v1 features implemented (see [REQUIREMENTS.md](REQUIREMENTS.md) §12); not yet published to the stores.

## Quick start (development)

```bash
pnpm install
pnpm dev              # Chrome
pnpm dev:firefox      # Firefox
```

WXT opens a fresh browser window with the unpacked extension loaded. Navigate to any YouTube watch page (`youtube.com/watch?v=…`).

Before TickTick OAuth can succeed end-to-end you also need a `.env` file — see "TickTick OAuth setup" below.

## Loading the built extension manually

If you'd rather load the built bundle (e.g. to test the production build):

- **Chrome:** `pnpm build`, then open `chrome://extensions`, enable Developer Mode, click "Load unpacked", and select `.output/chrome-mv3`.
- **Firefox:** `pnpm build:firefox`, then open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on", and select any file inside `.output/firefox-mv3`.

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

## Features (v1)

- Replaces YouTube's right-side recommendation rail and end-of-video grid with your TickTick task list on every watch page.
- Defaults to the **Today** smart list (computed client-side in your local TZ since TickTick has no first-party Today endpoint).
- Click a task to mark it complete (optimistic UI; reverts on API failure).
- Settings page with Simple sections (account, display, behavior) and an Advanced section (verbose logging, debug overlay, selector override editor, force re-auth / re-sync, JSON export/import).
- Toolbar popup with a master on/off toggle and a status line.
- SPA-aware: re-renders on YouTube's pushState navigations.
- Zero telemetry. The extension only talks to YouTube and TickTick.

### How the Today smart list works

The Today list is computed in the browser because TickTick's open API has no Today endpoint. A task is in Today (in your local timezone) if **either**:

- its `dueDate` falls in the last 3 days (today, yesterday, or the day before yesterday) — this catches today's deadlines plus very-recent overdue, while keeping long-deferred items ("Later" projects with year-old dates) out; **OR**
- its `startDate` is today — rescues tasks scheduled to start today that don't have a `dueDate` yet.

We also explicitly fetch the Inbox project (`/project/inbox/data`) in addition to the project list, since TickTick's `/project` endpoint doesn't include it. The open-API response for Inbox is the same shape as a regular project's `data` payload minus the `project` wrapper — we tolerate that and read `tasks` directly.

Tasks with no `dueDate` and no `startDate` won't be in Today — pick the project directly from the in-panel dropdown to see them.

## Privacy

Zero telemetry. The extension stores TickTick OAuth tokens and UI preferences in `browser.storage.local` (never synced) and contacts only YouTube (DOM only, no API) and TickTick (so you can see and complete your own tasks). Full policy: [PRIVACY.md](PRIVACY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
