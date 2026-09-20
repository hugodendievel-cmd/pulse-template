// lib/newsletter/store.mjs — Daily edition persistence.
//
// Filesystem layout (sibling of lib/digest/ for the weekly digest):
//   .pulse/newsletters/{YYYY-MM-DD}.json
//   .pulse/newsletters/latest.json
//
// editionId is the Europe/Brussels calendar day, reusing the budget's
// day function so edition boundaries and the daily LLM budget rollover
// agree regardless of DST.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sanitizeDailyEdition } from "../../apis/utils/sanitize.mjs";
import { pulsePath } from "../data-dir.mjs";
import { todayBrussels } from "../llm/budget.mjs";

// Path is resolved lazily so PULSE_DATA_DIR (a mounted volume in production)
// and test cwd mocks both apply.
const editionDir = () => pulsePath("newsletters");

// editionId = Brussels calendar day. The strict format doubles as path-safety
// for loadDailyEdition() (no traversal, no dotfiles).
const EDITION_ID_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Save a daily edition with a Brussels-day identifier (YYYY-MM-DD).
 * Overwrites the same day's file on regeneration (operator escape hatch —
 * caller decides whether a once-per-day guard applies).
 */
export function saveDailyEdition(edition) {
  const editionId = todayBrussels();
  const dir = editionDir();
  const filePath = resolve(dir, `${editionId}.json`);
  const clean = sanitizeDailyEdition(edition);
  const payload = {
    ...clean,
    generatedAt: new Date().toISOString(),
    editionId,
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2));
  writeFileSync(
    resolve(dir, "latest.json"),
    JSON.stringify(payload, null, 2),
  );
  return payload;
}

/**
 * Load a specific saved edition by id (YYYY-MM-DD).
 * Returns null for malformed ids (also guards path traversal).
 */
export function loadDailyEdition(editionId) {
  if (typeof editionId !== "string" || !EDITION_ID_RE.test(editionId))
    return null;
  const file = resolve(editionDir(), `${editionId}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * List all saved edition ids (YYYY-MM-DD), newest first.
 */
export function listDailyEditions() {
  try {
    return readdirSync(editionDir())
      .map((f) => f.replace(/\.json$/, ""))
      .filter((id) => EDITION_ID_RE.test(id))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Load the N most recent saved editions, newest first — the cross-day
 * dedupe window. `excludeDay` normally is today's editionId so a forced
 * regeneration doesn't dedupe against its own draft.
 */
export function loadRecentEditions({ excludeDay = "", days = 3 } = {}) {
  return listDailyEditions()
    .filter((id) => id !== excludeDay)
    .slice(0, days)
    .map((id) => loadDailyEdition(id))
    .filter(Boolean);
}

/**
 * Load the latest saved daily edition.
 */
export function loadLatestDailyEdition() {
  const latest = resolve(editionDir(), "latest.json");
  if (!existsSync(latest)) return null;
  try {
    return JSON.parse(readFileSync(latest, "utf-8"));
  } catch {
    return null;
  }
}
