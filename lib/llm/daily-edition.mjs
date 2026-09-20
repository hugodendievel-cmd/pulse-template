// lib/llm/daily-edition.mjs — LLM-powered daily edition (TL;DR-newsletter style).
// Domain-neutral: the system prompt and freshSources come from the active
// domain pack. Mirrors weekly-digest.mjs with a 24-hour window; item
// collection/filtering is shared via items.mjs.
import log from "../logger.mjs";
import { parseLlmJson } from "./parse-json.mjs";
import { collectSourceItems } from "./items.mjs";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// How many previous editions count as "already covered" for cross-day
// dedupe. Promotion to an env knob only if the tuning week demands it.
const RECENT_EDITIONS_WINDOW = 3;

/**
 * Collect the titles (and their lowercase keys) already covered by recent
 * editions — stories, model releases, and the paper pick all count.
 */
function collectCovered(recentEditions) {
  const keys = new Set();
  const titles = [];
  const push = (title) => {
    const clean = String(title || "").trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (keys.has(key)) return;
    keys.add(key);
    titles.push(clean);
  };
  for (const ed of recentEditions || []) {
    for (const t of ed.topStories || []) push(t.title);
    for (const m of ed.modelReleases || []) push(m.name);
    if (ed.paperPick?.title) push(ed.paperPick.title);
  }
  return { keys, titles };
}

/**
 * Generate a daily edition from a dedicated 24h sweep.
 * @param {object} llm       – LLM provider instance
 * @param {object} sweepData – Single sweep result from runDigestSweep({ days: 1 })
 * @param {object} [opts]    – prompt override + freshSources (names whose
 *                             undated items are treated as inherently fresh) +
 *                             recentEditions (loaded editions — items already
 *                             covered there are excluded from the pool AND
 *                             named to the LLM so rephrased repeats are refused)
 * @returns {Promise<object|null>}
 */
export async function generateDailyEdition(
  llm,
  sweepData,
  { prompt, freshSources, recentEditions = [] } = {},
) {
  if (!llm || !sweepData) return null;
  if (!prompt || !freshSources)
    throw new Error(
      "generateDailyEdition: missing prompt/freshSources — the active domain pack must define prompts.daily and freshSources",
    );

  // Packs pass freshSources as a plain array; normalize to a Set.
  const fresh =
    freshSources instanceof Set ? freshSources : new Set(freshSources);

  // Cross-day dedupe: pre-seed the seen-set with every title covered in the
  // last RECENT_EDITIONS_WINDOW editions (excluding today's own draft), so
  // repeats are gone from the pool before the LLM ever sees the data.
  const window = recentEditions.slice(0, RECENT_EDITIONS_WINDOW);
  const covered = collectCovered(window);

  const seen = new Set(covered.keys);
  const sourceMap = {};
  collectSourceItems(sweepData, seen, sourceMap, fresh, ONE_DAY_MS);

  // Build the source summaries, keeping the top items per source
  const sourceSummaries = Object.entries(sourceMap)
    .map(([name, items]) => `## ${name}\n${items.slice(0, 15).join("\n")}`)
    .join("\n\n");

  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - ONE_DAY_MS)
    .toISOString()
    .split("T")[0];

  const coveredSection = covered.titles.length
    ? `\n\nALREADY COVERED — these stories were reported in a previous edition. Do NOT include them again, not even rephrased, combined into a roundup, or used as background for another item. If an item in the data below clearly matches one of these subjects, treat it as old news and skip it:\n${covered.titles.map((t) => `- ${t}`).join("\n")}`
    : "";

  const userPrompt = `Today is ${today}. Generate the daily edition covering ONLY the last 24 hours (${yesterday} to ${today}).\n\nBelow is fresh data collected today from ${sweepData.sourcesOk || "multiple"} sources. Dates in brackets show when items were published. ONLY include items from this data — do NOT add anything from your own knowledge.\n${coveredSection}\n\n${sourceSummaries}\n\nProduce your JSON daily edition using ONLY the items above.`;

  try {
    const raw = await llm.chat(
      [{ role: "user", content: `${prompt}\n\n${userPrompt}` }],
      { maxTokens: 3000 },
    );

    return parseLlmJson(raw, {
      required: ["tldr", "topStories"],
      defaults: {
        dateOf: "",
        modelReleases: [],
        paperPick: {},
        quickLinks: [],
      },
      provider: llm.name,
      model: llm.model,
    });
  } catch (err) {
    log.error(
      { err: err.message, provider: llm.name, model: llm.model },
      "[Daily Edition] LLM generation failed",
    );
    return null;
  }
}
