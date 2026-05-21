# Privacy Policy

_Last updated: 2026-05-19_

## TL;DR

ToDoTube collects nothing. No analytics, no crash reports, no "anonymous
metrics", no background pings. The only network requests the extension
makes are to YouTube (DOM only, no API calls) and to TickTick (so you
can see and complete your own tasks).

## What is not collected

ToDoTube does **not** collect, transmit, log, or share:

- personal information of any kind
- browsing history, page contents, or watch history
- timing, performance, or "diagnostic" metrics
- error reports, stack traces, or crash dumps
- any identifier that could distinguish one user from another

There is no server. There is no developer dashboard. The author cannot
see what you have installed, what you are doing, or that you exist.

## What is stored locally

The extension uses `browser.storage.local` only — data never syncs
across browsers or devices unless you manually export it from the
Advanced settings tab. Three things are stored:

- **TickTick OAuth tokens** (access token, optional refresh token,
  expiry). These let the extension talk to TickTick on your behalf
  within the scope you granted (`tasks:read tasks:write`).
- **Provider state** — your currently selected TickTick list and the
  timestamp of the last sync.
- **UI preferences** — master on/off, theme, sort order, refresh
  interval, debug toggles, and any selector overrides you have
  authored.

You can wipe all of this at any time from the Settings page
("Disconnect / forget my tokens"), or by uninstalling the extension.

## Third-party services

ToDoTube contacts exactly two domains. You can verify this yourself by
grepping the source: `rg -n 'fetch\(|XMLHttpRequest|WebSocket' src/`.

- **TickTick** (`ticktick.com`, `api.ticktick.com`) — the extension
  authenticates against TickTick's OAuth endpoint and then calls
  TickTick's task API to read your tasks and mark them complete.
  TickTick's own privacy policy applies to that data; see
  <https://ticktick.com/about/privacy>.
- **YouTube** (`youtube.com`) — the extension does not call any
  YouTube API. It reads the watch page's DOM locally to find the
  recommendation rail's location so it can replace it with your task
  list. Nothing from the page leaves your machine.

No other domain is contacted, ever. The extension declares only the
host permissions listed above in its manifest; the browser would block
any other request.

## Tracking

There is no tracking. No cookies are set by the extension. No
fingerprinting. No background pings. No identifiers are generated or
stored.

## Open source

ToDoTube is MIT-licensed and published on GitHub. The full source is
available for audit at the project repository linked in the extension
listing. If anything in this policy is contradicted by the code, the
code is a bug — please open an issue.

## Contact

For privacy questions: <zhidetskij@gmail.com>.

For bugs and feature requests, use the project's GitHub issue tracker.

## Changes to this policy

If this policy changes, the change will land as a commit to this file
together with an extension version bump. The latest version is always
the copy of `PRIVACY.md` on the `main` branch of the repository.
