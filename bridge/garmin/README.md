# ToDoTube — Garmin activity bridge

A tiny self-hosted service that exposes **today's** Garmin Connect metrics as
local JSON, so the ToDoTube **activity-budget** gate ("earn YouTube with
activity") can read them. Your Garmin credentials live **only here** — the
browser extension talks solely to the local `http://127.0.0.1:8930/today`
endpoint and never to Garmin directly.

## Why a bridge?

Garmin has **no official personal API** (the Garmin Connect Developer Program
is business-only), and a browser extension can't run Garmin's mobile-SSO login
or store credentials safely. So a small local process does the talking and
hands the extension a clean JSON value over localhost.

## Contract

```
GET http://127.0.0.1:8930/today
→ 200 { "steps": 8421, "intensityMinutes": 45, "hrZoneMinutes": 45, "reps": 250, "asOf": 1748500000000 }
```

- `steps`, `reps` — plain counts.
- `intensityMinutes`, `hrZoneMinutes` — whole **minutes** (the extension scales
  these to milliseconds; see `gates/activity-budget/constants.ts`).

This shape is the single source of truth shared with the extension. If you
change a field name, change it in `gates/activity-budget/constants.ts` too.

## Setup

```bash
cd bridge/garmin
npm install
cp .env.example .env      # fill in GARMIN_EMAIL / GARMIN_PASSWORD
npm start                 # node --env-file=.env server.js
curl http://127.0.0.1:8930/today
```

Then in the extension's options → **Focus mode**:

1. Choose **Earn time with activity**.
2. Pick a metric (e.g. *Strength reps*), set *Effort required* + *Minutes
   earned* (e.g. `200 reps = 30 min`).
3. Click **Allow access to bridge**, then **Test bridge connection**.

## Caveats (by design / known limits)

- **Sync lag** — Garmin data updates on watch→phone→cloud sync (minutes), so
  the gate unlocks a little *after* you exercise.
- **`reps` is all strength reps today**, not "squats" specifically — Garmin
  doesn't expose a per-exercise "squat" metric reliably; the named exercise
  depends on the watch's category detection.
- **`hrZoneMinutes` is approximated** by Garmin's intensity minutes in v1
  (vigorous counts double). A precise "minutes above HR X" needs per-activity
  HR time-series — a future enhancement in `garmin.js`.
- **Unofficial API** — `garmin.js` uses a reverse-engineered library against
  Garmin's undocumented endpoints. Method names / paths there are marked and
  may need confirming against your installed library version and a live login
  (first login may prompt for MFA). If `garmin-connect` stops authenticating,
  try the actively-maintained fork `@flow-js/garmin-connect`.

## Security

`.env` and any cached token files are git-ignored. Run this only on your own
machine; the server binds to `127.0.0.1` (localhost) only.
