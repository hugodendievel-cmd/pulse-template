// lib/newsletter/scheduler.mjs — internal daily scheduler.
//
// No external cron, no public trigger URL: the running server arms a
// timer for the next Europe/Brussels run and catches up after restarts
// (a deploy at 10:00 that missed the 07:30 slot generates a late edition;
// a deploy at 12:00 where today's edition exists just arms for tomorrow).
// Dependency-free: real-clock arithmetic + Intl for Brussels time.

import log from "../logger.mjs";
import { todayBrussels } from "../llm/budget.mjs";
import { loadDailyEdition } from "./store.mjs";

const CATCH_UP_DELAY_MS = 30_000; // let the boot settle before firing late

/** HH:MM (Brussels local) → minutes of day. Throws on garbage. */
export function parseRunAtMinutes(value, fallback = "07:30") {
  const raw = String(value || "").trim() || fallback;
  const m = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m)
    throw new Error(
      `Invalid NEWSLETTER_RUN_AT "${value}" — expected HH:MM (e.g. "07:30")`,
    );
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes-of-day for Europe/Brussels at `date` (DST-transparent). */
export function brusselsMinutesNow(date = new Date()) {
  const map = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Brussels",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return Number(map.hour) * 60 + Number(map.minute);
}

/** Milliseconds from `now` until the target minutes-of-day recurs. */
export function msUntilRun(targetMinutes, now = Date.now()) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const nowMin = brusselsMinutesNow(new Date(now));
  return nowMin < targetMinutes
    ? (targetMinutes - nowMin) * 60_000
    : DAY_MS - (nowMin - targetMinutes) * 60_000;
}

/**
 * Arm the scheduler.
 * @param {(reason: string) => Promise<void>} runOnce – generation callback
 * @param {object} [opts] – { runAt } ("HH:MM", Brussels; default 07:30)
 * @returns {() => void} cancel — clears the pending timer
 */
export function startNewsletterScheduler(runOnce, { runAt } = {}) {
  const targetMinutes = parseRunAtMinutes(runAt);
  let timer = null;
  let running = false;

  async function fire(reason) {
    if (running) return;
    running = true;
    try {
      await runOnce(reason);
    } catch (err) {
      log.error(
        { err: err.message, reason },
        "[Newsletter] scheduled generation failed",
      );
    } finally {
      running = false;
      arm();
    }
  }

  function arm() {
    const missed =
      brusselsMinutesNow() >= targetMinutes && !loadDailyEdition(todayBrussels());
    const delay = missed ? CATCH_UP_DELAY_MS : msUntilRun(targetMinutes);
    log.info(
      { runAt: runAt || "07:30", missed, delayMin: Math.round(delay / 60_000) },
      "[Newsletter] scheduler armed",
    );
    timer = setTimeout(() => fire("timer"), delay);
  }

  arm();
  return () => clearTimeout(timer);
}
