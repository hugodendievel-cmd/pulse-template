// lib/newsletter/pipeline.mjs — the single daily-edition generation routine,
// shared by the internal scheduler (server) and the edition:save CLI.
//
// Encapsulates, in order: LLM budget check → once-per-Brussels-day guard
// (skippable with `force` for operators) → 24h sweep → budget increment →
// LLM generation with cross-day dedupe → save → optional SSE broadcast.
// No public HTTP trigger exists; this module is the only way in.
import { runDigestSweep } from "../../apis/briefing.mjs";
import {
  incrementBudget,
  isBudgetExhausted,
  todayBrussels,
} from "../llm/budget.mjs";
import { generateDailyEdition } from "../llm/daily-edition.mjs";
import log from "../logger.mjs";
import {
  loadDailyEdition,
  loadRecentEditions,
  saveDailyEdition,
} from "./store.mjs";

export const SKIP_REASONS = Object.freeze({
  budget: "budget-exhausted",
  alreadyGenerated: "already-generated",
});

/**
 * Generate today's daily edition end-to-end.
 * @param {object} llm       – LLM provider instance
 * @param {object} opts      – { prompt, freshSources, cap, broadcast, force }
 * @returns {Promise<{edition?: object, skipped?: string, error?: string}>}
 */
export async function generateDailyEditionPipeline(
  llm,
  { prompt, freshSources, cap, broadcast, force = false } = {},
) {
  if (!llm)
    throw new Error(
      "generateDailyEditionPipeline: missing llm — configure LLM_PROVIDER/LLM_API_KEY",
    );
  if (!prompt || !freshSources)
    throw new Error(
      "generateDailyEditionPipeline: missing prompt/freshSources — the active domain pack must define prompts.daily and freshSources",
    );

  const today = todayBrussels();

  // Budget check (persisted, Brussels day boundary) always applies,
  // including forced regenerations.
  const budget = isBudgetExhausted({ cap });
  if (budget.exhausted) {
    log.warn(
      { callsToday: budget.count, cap: budget.cap },
      "[Newsletter] generation skipped — daily LLM budget exhausted",
    );
    return { skipped: SKIP_REASONS.budget, day: today };
  }

  // Once-per-Brussels-day guard (internal truth is the store on disk).
  if (!force && loadDailyEdition(today)) {
    log.info({ day: today }, "[Newsletter] edition already exists — skipping");
    return { skipped: SKIP_REASONS.alreadyGenerated, editionId: today };
  }

  // Dedicated 24h sweep across all sources.
  const sweepData = await runDigestSweep({ days: 1 });
  incrementBudget();

  const edition = await generateDailyEdition(llm, sweepData, {
    prompt,
    freshSources,
    // Cross-day dedupe: exclude the last 3 editions (minus today's own
    // draft, so a forced regeneration is judged against previous days only).
    recentEditions: loadRecentEditions({ excludeDay: today }),
  });
  if (!edition) return { error: "generation-failed", day: today };

  const saved = saveDailyEdition(edition);
  log.info({ editionId: saved.editionId }, "Daily edition generated");
  broadcast?.({ type: "newsletter", data: saved });
  return { edition: saved };
}
