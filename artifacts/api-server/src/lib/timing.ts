/**
 * SAFE TIMING LOGIC FOR TELEGRAM ACCOUNT PROTECTION
 *
 * Target: 80–90 joins per account per 18 active hours
 * Formula:
 *   baseInterval = (18h × 3600s) / 85 joins = 762s per join
 *   safeInterval = 762 × 1.35 safety factor ≈ 1029s ≈ 17.2 min per join per account
 *   actionInterval = safeInterval / N accounts (min 180s between any two actions)
 *   + ±25% jitter for human-like randomness
 *
 * The bot also observes:
 *   - BLACKOUT_START (2:00) to BLACKOUT_END (8:00) — no joins
 *   - Per-account daily limit: DAILY_LIMIT joins per ACTIVE_HOURS
 *   - Extra delay after any error
 */

export const DAILY_LIMIT = 85;
export const ACTIVE_HOURS = 18;
const ACTIVE_SECONDS = ACTIVE_HOURS * 3600; // 64800
const SAFETY_FACTOR = 1.35;

export const SAFE_INTERVAL_PER_ACCOUNT_SECS = Math.ceil(
  (ACTIVE_SECONDS / DAILY_LIMIT) * SAFETY_FACTOR
); // ≈ 1029 seconds (~17.2 min)

const MIN_ACTION_INTERVAL_SECS = 180; // never less than 3 min between any two actions
const JITTER_FACTOR = 0.25; // ±25%

const BLACKOUT_START_HOUR = 2; // 2:00 AM
const BLACKOUT_END_HOUR = 8;   // 8:00 AM

/**
 * Compute delay in MILLISECONDS before the next join action.
 * This is the delay between consecutive bot ticks (across all accounts).
 */
export function computeActionIntervalMs(activeAccountCount: number): number {
  const count = Math.max(1, activeAccountCount);
  const base = Math.max(
    MIN_ACTION_INTERVAL_SECS,
    Math.floor(SAFE_INTERVAL_PER_ACCOUNT_SECS / count)
  );
  const jitter = Math.floor(base * JITTER_FACTOR * (Math.random() * 2 - 1));
  return (base + jitter) * 1000;
}

/**
 * True if the current wall-clock hour is in the blackout window (no joins).
 */
export function isBlackoutHour(): boolean {
  const hour = new Date().getHours();
  return hour >= BLACKOUT_START_HOUR && hour < BLACKOUT_END_HOUR;
}

/**
 * How many milliseconds until the blackout window ends (8 AM).
 */
export function msUntilBlackoutEnd(): number {
  const now = new Date();
  const end = new Date(now);
  end.setHours(BLACKOUT_END_HOUR, 0, 0, 0);
  if (end <= now) end.setDate(end.getDate() + 1);
  return end.getTime() - now.getTime();
}

/**
 * Return the flood-wait duration in ms: exactly waitSeconds + 20% safety buffer.
 */
export function floodWaitMs(waitSeconds: number): number {
  return Math.ceil(waitSeconds * 1.2) * 1000;
}

/**
 * Check if the account daily counter should be reset (it's a new day vs last reset).
 */
export function shouldResetDailyCounter(dailyResetAt: Date | null): boolean {
  if (!dailyResetAt) return true;
  const now = new Date();
  return (
    now.getFullYear() !== dailyResetAt.getFullYear() ||
    now.getMonth() !== dailyResetAt.getMonth() ||
    now.getDate() !== dailyResetAt.getDate()
  );
}

// ─── P2-3: Configurable Sleep Schedule ──────────────────────────────────────────

/**
 * Jitter cache: per calendar day we pick a random ±1h offset so the start time
 * varies slightly day to day, making activity less predictable.
 */
const jitterCache = new Map<string, number>(); // date string → offset hours (-1|0|1)

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function getDailyJitter(): number {
  const key = todayKey();
  if (!jitterCache.has(key)) {
    // Clear old entries
    jitterCache.clear();
    // Pick -1, 0, or +1 hour randomly
    const offsets = [-1, 0, 0, 1]; // weighted: 50% no jitter
    jitterCache.set(key, offsets[Math.floor(Math.random() * offsets.length)]);
  }
  return jitterCache.get(key)!;
}

/**
 * P2-3: Is the current time within the BLACKOUT (inactive) window?
 *
 * @param activeStartHour - Hour of day (0–23) when bot becomes active (default 8 = 8am)
 * @param activeHoursCount - How many hours the bot is active per day (default 18)
 * @param applyJitter - Apply daily ±1h random jitter to start time
 */
export function isBlackoutHourConfigurable(
  activeStartHour = BLACKOUT_END_HOUR,
  activeHoursCount = ACTIVE_HOURS,
  applyJitter = true
): boolean {
  const jitter = applyJitter ? getDailyJitter() : 0;
  const start = ((activeStartHour + jitter) % 24 + 24) % 24;
  const end = (start + activeHoursCount) % 24;
  const hour = new Date().getHours();

  if (end > start) {
    // e.g. active 8→2: in blackout if hour < 8 or hour >= 26%24=2
    return hour < start || hour >= end;
  } else {
    // Wraps midnight: e.g. active 22→16, blackout 16→22
    return hour >= end && hour < start;
  }
}

/**
 * P2-3: Milliseconds until the active window starts (end of blackout).
 */
export function msUntilActiveStartConfigurable(
  activeStartHour = BLACKOUT_END_HOUR,
  applyJitter = true
): number {
  const jitter = applyJitter ? getDailyJitter() : 0;
  const start = ((activeStartHour + jitter) % 24 + 24) % 24;
  const now = new Date();
  const next = new Date(now);
  next.setHours(start, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}
