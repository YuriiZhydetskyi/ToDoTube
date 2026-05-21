# Store Listing Copy

Single source of truth for the AMO listing (and, later, the Chrome Web
Store listing). Update this file before changing the store pages so the
two stay in sync.

---

## Add-on name

```
ToDoTube
```

## Summary

AMO field: _"Give a brief explanation of what your extension does."_
Hard limit: **250 characters**. Current draft is 132 characters.

```
Swap YouTube's recommendation rail for your TickTick to-do list. Fewer distractions, more focus on what you actually planned to do.
```

## Detailed description

AMO field: _"This add-on's description"_. Markdown is rendered.

```markdown
YouTube is a great place to watch the thing you came for, and a
terrible place to remember what else you were going to do. ToDoTube
replaces the recommendation rail on the right side of every watch
page, and the end-of-video recommendation grid, with **your own
TickTick to-do list**. The recommended-video rabbit hole goes away.
Your priorities stay in view.

### What it does

- Replaces the YouTube right-side rail and end-of-video grid on every
  `/watch` page with your TickTick task list.
- Defaults to the **Today** smart list, computed in your local
  timezone (TickTick has no first-party Today endpoint, so the
  extension computes it from your tasks).
- Click a task to mark it complete. The UI updates immediately and
  reverts if the API call fails.
- Settings page with a Simple section (account, display, behavior)
  and an Advanced section (verbose logging, debug overlay, selector
  override editor, force re-auth / re-sync, JSON export/import).
- A toolbar popup with a master on/off toggle and a status line.
- SPA-aware — re-renders cleanly on YouTube's client-side navigation.

### What it does not do

- It does **not** touch the YouTube home feed, search results, the
  subscriptions feed, Shorts, or comments. Scope is the watch page
  only.
- It does **not** create or edit tasks. Read and complete only — task
  authoring stays in TickTick where it belongs.
- It does **not** track you. Zero telemetry, no analytics, no third-
  party calls. The extension contacts only YouTube (DOM only, no API)
  and TickTick (so you can see and complete your own tasks). See the
  privacy policy linked below.

### Setup

1. Install the extension and pin the toolbar icon (optional but
   handy).
2. Open the options page (right-click the icon → Options, or via the
   popup).
3. Sign in to TickTick once. The OAuth window is TickTick's own — the
   extension never sees your password.
4. Pick a list (or stick with the default **Today**) and open any
   YouTube watch page.

### Privacy & open source

- Full privacy policy: see PRIVACY.md in the project repository.
- MIT-licensed. The full source is on GitHub — audit it, fork it,
  send a PR. If something in the listing or the policy is
  contradicted by the code, the code is the source of truth and the
  contradiction is a bug.
```

## Categories

| Slot                          | Value                  |
| ----------------------------- | ---------------------- |
| Primary                       | Productivity           |
| Secondary (if AMO offers one) | Other (no exact match) |

## Tags

Suggested 5-7 tags (AMO allows up to 10):

```
youtube, todo, productivity, ticktick, focus, distraction-free, recommendations
```

## Support

| Field           | Value                 |
| --------------- | --------------------- |
| Support email   | zhidetskij@gmail.com  |
| Support website | GitHub repository URL |
| License         | MIT                   |

## Privacy policy URL

Public URL of `PRIVACY.md` on the `main` branch:

```
https://github.com/<user>/ToDoTube/blob/main/PRIVACY.md
```

Replace `<user>` with the GitHub account that owns the published repo
before submitting.

## Screenshot plan

Mozilla recommends 1280×800 PNGs (other sizes also accepted). At least
1 screenshot is required; 3-4 is the sweet spot.

| #   | Subject                                                                            | Caption                                                                                                           |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | A YouTube watch page with the right-hand rail replaced by the ToDoTube task panel. | "Your to-do list replaces YouTube's recommendation rail on every watch page."                                     |
| 2   | A close-up of the panel mid-completion (task fading out after a click).            | "Click a task to mark it complete — same one-click experience as TickTick."                                       |
| 3   | The toolbar popup with the master on/off toggle and the status line.               | "One-click toggle from the toolbar. Status line shows last sync time and any provider error."                     |
| 4   | The options page, Simple section visible, Advanced section collapsed.              | "Settings cover the common cases up top; advanced power-user toggles are tucked under a single Advanced section." |

Optional 5th: the end-of-video grid replaced by the same task panel —
shows the "no fallback to recommendations" behavior.

## Submission checklist

When you are ready to upload:

- [ ] `pnpm exec wxt zip -b firefox` to produce
      `.output/todotube-<version>-firefox.zip`.
- [ ] Confirm `.output/firefox-mv3/manifest.json` declares
      `data_collection_permissions: { required: ["none"] }`.
- [ ] AMO account created at addons.mozilla.org/developers.
- [ ] Privacy policy URL points at the live `PRIVACY.md` on
      `main`.
- [ ] All four screenshots captured at 1280×800.
- [ ] Detailed description pasted in, summary pasted in.
- [ ] When AMO asks for source-code review steps, paste a link to
      `docs/AMO-REVIEW.md`.
