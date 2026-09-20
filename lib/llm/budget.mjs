// lib/llm/budget.mjs — Persistent LLM daily budget (Europe/Brussels day boundary)
//
// Owns all budget state. No module-level side effects: the file paths are
// resolved lazily (function calls, not import-time constants) so env loading
// order, PULSE_DATA_DIR overrides and test cwd mocks all apply; no disk I/O
// runs at import time.
//
// Single-process concurrency note: `incrementBudget()` calls `loadBudget()`
// internally, so two near-simultaneous callers (an analysis sweep racing a
// digest generation) could both read count=N and both persist count=N+1.
// This is accepted for the single-process monolith; a cluster-safe version
// is a separate story.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { pulsePath } from "../data-dir.mjs";
import { ensureMemoryDir } from "../delta/memory.mjs";
import log from "../logger.mjs";

const budgetFile = () => pulsePath("memory", "llm-budget.json");
const tmpFile = () => `${budgetFile()}.tmp`;

// Internal helper, exported for downstream story 3.3 (ISO-week boundary).
// Must be called at runtime, never hoisted to a module-level constant —
// otherwise the value freezes at import time and never rolls over.
export function todayBrussels() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Reads the persisted state. Applies day rollover on read. Returns a fresh
// {day: todayBrussels(), count: 0} on any error (missing, malformed,
// unreadable, wrong shape) and logs a pino.warn for corrupt/unreadable
// files. Never throws.
export function loadBudget() {
  const today = todayBrussels();
  if (!existsSync(budgetFile())) {
    return { day: today, count: 0 };
  }
  try {
    const parsed = JSON.parse(readFileSync(budgetFile(), "utf-8"));
    if (typeof parsed.day !== "string" || typeof parsed.count !== "number") {
      throw new Error("invalid shape");
    }
    if (parsed.day !== today) {
      return { day: today, count: 0 };
    }
    return { day: parsed.day, count: parsed.count };
  } catch (err) {
    log.warn(
      { err: err.message, file: budgetFile() },
      "llm-budget.json corrupt or unreadable — resetting to 0",
    );
    return { day: today, count: 0 };
  }
}

// Reads (rolling over if stale), adds 1, persists atomically
// (writeFileSync → renameSync). Returns the new {day, count}.
export function incrementBudget() {
  const { count } = loadBudget();
  const today = todayBrussels();
  const next = { day: today, count: count + 1 };
  ensureMemoryDir();
  writeFileSync(tmpFile(), JSON.stringify(next, null, 2));
  renameSync(tmpFile(), budgetFile());
  return next;
}

// Returns {exhausted, count, cap, day, skipReason?}. `skipReason` is present
// only when the budget is exhausted (AC: `{count, cap, skipReason?}`).
export function isBudgetExhausted({ cap }) {
  const { day, count } = loadBudget();
  const exhausted = count >= cap;
  return {
    exhausted,
    count,
    cap,
    day,
    ...(exhausted ? { skipReason: "Daily LLM budget exhausted" } : {}),
  };
}
