# Custom user-added blocked sites — design (deferred)

> Status: **planned, not built.** The current release ships a fixed
> blocklist (YouTube, TikTok, Facebook, Threads, X, Instagram) declared in
> [`src/shared/blocklist.ts`](../src/shared/blocklist.ts) with static
> `host_permissions`. This document captures how to let users add their own
> domains later, and why we deferred it.

## Goal

Let a user type an arbitrary domain (e.g. `reddit.com`) into the **Blocking**
tab and have it blocked under the same shared budget as the built-in sites —
without shipping a new extension version.

## Why it's deferred

The built-in sites can use **static** `host_permissions` declared up front,
which is transparent to store reviewers and works the moment the extension is
installed. Arbitrary user domains can't be known at build time, so they need
**runtime** permission requests + **runtime** content-script registration.
That is feasible under MV3 (below) but adds real complexity — a broad
optional permission, a re-registration step on every service-worker wake (a
Firefox limitation), and extra options-page UI — so we shipped the fixed list
first and left this as a clean follow-up.

## MV3 feasibility (checked, both engines)

- **Runtime content-script registration** —
  `browser.scripting.registerContentScripts([{ id, matches, excludeMatches, js, runAt: 'document_start' }])`
  is supported in Chrome and in Firefox 102+. Requires the `"scripting"`
  permission. **Firefox caveat:** it does **not** support
  `persistAcrossSessions`, so registrations do not survive a service-worker
  restart — we must re-register from the stored custom list on background
  startup. WXT exposes the same idea via a content script with
  `registration: 'runtime'`.
- **Runtime host permissions** — a broad
  `optional_host_permissions: ["*://*/*"]` granted per domain via
  `browser.permissions.request({ origins: ["*://*.example.com/*"] })`.
  Supported in Chrome and Firefox 128+. **Must run inside a user gesture**
  (the "Add site" button click), so the request cannot be awaited behind any
  prior `await`.
- **Subdomain carve-outs** — `excludeMatches` works the same way it does for
  the built-in `music.youtube.com` exclusion, so a user could block
  `youtube.com` but keep a subdomain usable, if we expose that.

## Sketch of the implementation

1. **Manifest** (`wxt.config.ts`): add `"scripting"` to `permissions` and
   `"*://*/*"` to `optional_host_permissions` (not granted until requested).
2. **Settings** (`shared/types.ts`): add
   `gating.customSites: { id: string; host: string }[]`. Merge it into
   `siteForHostname` and the broadcast/match unions in `shared/blocklist.ts`
   (likely splitting the static list from a `getAllBlockedSites(settings)`
   helper).
3. **Add flow** (Blocking tab, `ui/options/sections.ts`): a text input + "Add
   site" button. On click (user gesture):
   - validate/normalise the domain;
   - `requestHostPermission("*://*.<host>/*")` (reuse the `FocusSectionDeps`
     permission callbacks already injected by `core/options.ts`);
   - on grant, persist to `customSites` and
     `registerContentScripts` the gate script for that host.
4. **Startup re-registration** (`entrypoints/background.ts`): on wake, read
   `customSites`, drop stale dynamic registrations, and re-register the
   currently-granted ones (covers the Firefox no-persist limitation). Drop a
   custom site whose permission the user later revoked.
5. **Remove flow**: unregister the script, optionally
   `permissions.remove({ origins })`, and drop it from `customSites`.

## Store-review notes

- The broad `optional_host_permissions: "*://*/*"` is **opt-in and
  user-gesture-gated** — the user explicitly types each domain and approves
  the browser prompt. That keeps it low-risk for both AMO and the Chrome Web
  Store, but it must be justified in the review notes (update
  [`AMO-REVIEW.md`](AMO-REVIEW.md) when this lands): the extension still makes
  **no network calls** to user sites — it only injects the block overlay.
- Do **not** request the broad permission at install; only on first custom-site
  add.

## Open questions to settle before building

- Per-custom-site subdomain excludes — expose, or keep it simple (block the
  whole host)?
- Validation: reject obviously-wrong input (no scheme, paths, wildcards) and
  show a clear error.
- Should custom sites be individually toggleable like the built-ins, or just
  add/remove?
