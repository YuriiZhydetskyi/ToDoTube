# Privacy Policy

_Last updated: 2026-06-14_

## TL;DR

ToDoTube collects nothing. No analytics, no crash reports, no "anonymous
metrics", no background pings, and no maintainer-run server — ever. By
default the only network requests the extension makes are to YouTube (DOM
only, no API calls) and to TickTick (so you can see and complete your own
tasks). Two opt-in Focus-mode features can add network access, and only
to destinations you control — local apps on your own machine, or a sync
backend you host yourself (see "Optional multi-device sync" below).

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

By default the extension uses `browser.storage.local` only — nothing
leaves your device. The following is stored:

- **TickTick OAuth tokens** (access token, optional refresh token,
  expiry). These let the extension talk to TickTick on your behalf
  within the scope you granted (`tasks:read tasks:write`).
- **Provider state** — your currently selected TickTick list and the
  timestamp of the last sync.
- **UI preferences** — master on/off, theme, sort order, refresh
  interval, debug toggles, and any selector overrides you have
  authored.
- **Focus-mode usage data** (only if you enable Focus mode) — your
  daily viewing-time budget and the per-day intervals of time spent on
  blocked sites, used to compute how much time you have left.

You can wipe all of this at any time from the Settings page
("Disconnect / forget my tokens"), or by uninstalling the extension.

## Optional multi-device sync

Focus mode has an optional setting to share your daily viewing-time
budget across your own devices (for example, desktop and phone), so the
same limit applies everywhere. It is **off by default**. When you turn
it on, you pick the transport:

- **Browser sync** — uses `browser.storage.sync`, i.e. the sync your
  browser vendor already provides. No third party beyond that; works
  desktop-to-desktop within the same browser only.
- **Self-hosted backend** — you point the extension at a small backend
  you run yourself (ready-made templates for Supabase, Cloudflare
  Workers, and Upstash live in the repository). The extension then
  reads and writes the budget against the single origin you entered.

Only the budget data is synced — per-device, per-day intervals of time
spent on blocked sites. Your tasks, tokens, and browsing are never
synced. ToDoTube ships no default endpoint and the author runs no
server: nothing is sent anywhere until you opt in and supply your own
endpoint.

## Third-party services

By default, ToDoTube contacts exactly two domains. You can verify this
yourself by grepping the source: `rg -n 'fetch\(|XMLHttpRequest|WebSocket' src/`.

- **TickTick** (`ticktick.com`, `api.ticktick.com`) — the extension
  authenticates against TickTick's OAuth endpoint and then calls
  TickTick's task API to read your tasks and mark them complete.
  TickTick's own privacy policy applies to that data; see
  <https://ticktick.com/about/privacy>.
- **YouTube** (`youtube.com`) — the extension does not call any
  YouTube API. It reads the watch page's DOM locally to find the
  recommendation rail's location so it can replace it with your task
  list. Nothing from the page leaves your machine.

Beyond these two defaults, the extension reaches the network only when
you turn on a matching optional feature:

- **Local Focus-mode signals** — if you enable the Anki or activity
  unlock condition, the extension reads a value from a server on your
  own machine (`127.0.0.1`). Local only; it never leaves your computer.
- **Your own sync backend** — if you enable self-hosted multi-device
  sync, the extension contacts the endpoint you configured (see
  "Optional multi-device sync" above). That destination is yours, not
  the author's.

Apart from these, no other domain is contacted, ever. Optional host
permissions are requested at runtime only when you enable the
corresponding feature, and the browser blocks anything the manifest
does not declare.

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
