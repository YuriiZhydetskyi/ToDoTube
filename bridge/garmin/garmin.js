// Garmin Connect adapter. Logs in once, then derives TODAY's metrics from
// the (unofficial) Garmin Connect API and returns them in the shape the
// ToDoTube activity-budget gate expects.
//
// ⚠️  IMPORTANT — this talks to Garmin's UNDOCUMENTED endpoints via a
// reverse-engineered library. There is no official personal API (the Garmin
// Connect Developer Program is business-only). Consequences:
//   • The exact library method names / endpoint paths below can drift between
//     library versions and Garmin-side changes. Confirm them against the
//     installed library's README and a live login before relying on this.
//   • Garmin's auth uses mobile SSO and may prompt for MFA on first login.
//   • Data lags the watch by minutes (watch → phone → cloud sync), so the
//     gate unlocks a little after you actually exercise — by design.
//
// Everything Garmin-specific lives in THIS file; server.js stays a generic
// cache + HTTP layer.

import { GarminConnect } from 'garmin-connect';

// Garmin counts "intensity minutes" with vigorous activity worth double.
const VIGOROUS_WEIGHT = 2;

let client = null;

async function getClient() {
  if (client) return client;
  const username = process.env.GARMIN_EMAIL;
  const password = process.env.GARMIN_PASSWORD;
  if (!username || !password) {
    throw new Error('Set GARMIN_EMAIL and GARMIN_PASSWORD (see .env.example)');
  }
  const c = new GarminConnect({ username, password });
  await c.login(); // may require MFA on first run depending on the library
  client = c;
  return c;
}

// Local calendar date as YYYY-MM-DD (Garmin's daily endpoints are date-keyed).
function todayLocalDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Returns { steps, intensityMinutes, hrZoneMinutes, reps }. Each metric is
// fetched independently and falls back to 0 on failure, so a partial outage
// (e.g. reps unavailable) still serves the rest rather than 500-ing.
export async function fetchToday() {
  const c = await getClient();
  const date = todayLocalDate();

  const [steps, intensity, reps] = await Promise.all([
    safe(() => readSteps(c, date), 'steps'),
    safe(() => readIntensityMinutes(c, date), 'intensityMinutes'),
    safe(() => readStrengthReps(c, date), 'reps'),
  ]);

  return {
    steps,
    intensityMinutes: intensity,
    // v1 approximation: a precise "minutes above HR X" needs per-activity HR
    // time-series; until that's wired up we expose intensity minutes here so
    // the HR-zone metric is usable. See README → Caveats.
    hrZoneMinutes: intensity,
    reps,
  };
}

// --- per-metric readers (confirm endpoints against your library version) ---

async function readSteps(c, date) {
  // Daily summary carries totalSteps. `getSteps` exists in most forks; the
  // generic `.get` against the user-summary service is the stable fallback.
  const summary = await dailySummary(c, date);
  return toInt(summary?.totalSteps ?? summary?.steps);
}

async function readIntensityMinutes(c, date) {
  const summary = await dailySummary(c, date);
  const moderate = toInt(summary?.moderateIntensityMinutes);
  const vigorous = toInt(summary?.vigorousIntensityMinutes);
  return moderate + VIGOROUS_WEIGHT * vigorous;
}

async function readStrengthReps(c, date) {
  // Today's activities → strength sessions → sum of set reps. Endpoint shapes
  // vary; treat anything missing as 0. "Squats" specifically aren't a Garmin
  // metric — this is the sum of ALL strength reps logged today.
  const activities = await c.getActivities(0, 20).catch(() => []);
  let total = 0;
  for (const a of activities ?? []) {
    if (!isToday(a, date) || !isStrength(a)) continue;
    const details = await safe(() => activityExerciseSets(c, a.activityId), 'exerciseSets', null);
    total += sumReps(details);
  }
  return total;
}

// --- low-level helpers ---

// User daily summary. Tries a typed method first, then the generic request.
async function dailySummary(c, date) {
  if (typeof c.getDailySummary === 'function') return c.getDailySummary(new Date(date));
  // Generic fallback against the user-summary service.
  const displayName = c.userHash ?? (await c.getUserProfile?.())?.displayName;
  return c.get(`/usersummary-service/usersummary/daily/${displayName}`, { calendarDate: date });
}

async function activityExerciseSets(c, activityId) {
  if (typeof c.getActivityExerciseSets === 'function') return c.getActivityExerciseSets(activityId);
  return c.get(`/activity-service/activity/${activityId}/exerciseSets`);
}

function sumReps(details) {
  const sets = details?.exerciseSets ?? details?.sets ?? [];
  let total = 0;
  for (const s of sets) {
    const reps = toInt(s?.repetitionCount ?? s?.reps);
    if (reps > 0) total += reps;
  }
  return total;
}

function isStrength(a) {
  const key = a?.activityType?.typeKey ?? a?.activityTypeDTO?.typeKey ?? '';
  return String(key).includes('strength');
}

function isToday(a, date) {
  const start = a?.startTimeLocal ?? a?.startTimeGMT ?? '';
  return String(start).startsWith(date);
}

function toInt(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
}

// Run a reader, log + swallow failures so one bad metric can't sink the rest.
async function safe(fn, label, fallback = 0) {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[garmin] ${label} failed:`, e?.message ?? e);
    return fallback;
  }
}
