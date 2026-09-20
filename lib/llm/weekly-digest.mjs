// lib/llm/weekly-digest.mjs — LLM-powered weekly digest generation.
// Domain-neutral: the system prompt and freshSources come from the
// active domain pack. Item collection/freshness filtering lives in
// items.mjs, shared with the daily edition.
import log from "../logger.mjs";
import { parseLlmJson } from "./parse-json.mjs";
import { collectSourceItems } from "./items.mjs";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Generate a weekly digest from a dedicated 7-day sweep.
 * @param {object} llm       – LLM provider instance
 * @param {object} sweepData – Single sweep result from runDigestSweep()
 * @param {object} [opts]    – prompt override + freshSources (names whose
 *                             undated items are treated as inherently fresh)
 * @returns {Promise<object|null>}
 */
export async function generateWeeklyDigest(
  llm,
  sweepData,
  { prompt, freshSources } = {},
) {
  if (!llm || !sweepData) return null;
  if (!prompt || !freshSources)
    throw new Error(
      "generateWeeklyDigest: missing prompt/freshSources — the active domain pack must define prompts.digest and freshSources",
    );

  // Packs pass freshSources as a plain array; normalize to a Set.
  const fresh =
    freshSources instanceof Set ? freshSources : new Set(freshSources);

  const seen = new Set();
  const sourceMap = {};
  collectSourceItems(sweepData, seen, sourceMap, fresh, SEVEN_DAYS_MS);

  // Build the source summaries, keeping the top items per source
  const sourceSummaries = Object.entries(sourceMap)
    .map(([name, items]) => `## ${name}\n${items.slice(0, 15).join("\n")}`)
    .join("\n\n");

  const today = new Date().toISOString().split("T")[0];
  const weekAgo = new Date(Date.now() - SEVEN_DAYS_MS)
    .toISOString()
    .split("T")[0];

  const userPrompt = `Today is ${today}. Generate a weekly digest covering ONLY the period ${weekAgo} to ${today}.\n\nBelow is fresh data collected today from ${sweepData.sourcesOk || "multiple"} sources. Dates in brackets show when items were published. ONLY include items from this data — do NOT add anything from your own knowledge.\n\n${sourceSummaries}\n\nProduce your JSON weekly digest using ONLY the items above.`;

  try {
    const raw = await llm.chat(
      [{ role: "user", content: `${prompt}\n\n${userPrompt}` }],
      { maxTokens: 4000 },
    );

    return parseLlmJson(raw, {
      required: ["tldr"],
      defaults: {
        highlights: [],
        modelUpdates: [],
        paperPicks: [],
        communityBuzz: [],
        lookAhead: "",
      },
      provider: llm.name,
      model: llm.model,
    });
  } catch (err) {
    log.error(
      { err: err.message, provider: llm.name, model: llm.model },
      "[Weekly Digest] LLM generation failed",
    );
    return null;
  }
}
