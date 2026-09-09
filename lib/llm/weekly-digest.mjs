// lib/llm/weekly-digest.mjs — LLM-powered weekly digest generation.
// Domain-neutral: the system prompt and freshSources come from the
// active domain pack.
import log from "../logger.mjs";
import { parseLlmJson } from "./parse-json.mjs";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;


const DATE_FIELDS = [
  "published",
  "pubDate",
  "publishedAt",
  "lastModified",
  "updated",
  "updated_at",
  "updatedAt",
  "created",
  "created_at",
  "createdAt",
  "pushed_at",
  "pushedAt",
  "time",
  "date",
  "isoDate",
];

function extractDate(item) {
  for (const field of DATE_FIELDS) {
    const v = item[field];
    if (!v) continue;
    // time as unix seconds (Hacker News)
    if (typeof v === "number") {
      const ms = v < 1e12 ? v * 1000 : v;
      if (!Number.isNaN(ms)) return new Date(ms).toISOString();
    }
    const ts = new Date(v).getTime();
    if (!Number.isNaN(ts)) return new Date(ts).toISOString();
  }
  return "";
}

function isRecent(dateStr) {
  if (!dateStr) return false;
  const ts = new Date(dateStr).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < SEVEN_DAYS_MS;
}

function formatItem(item, sourceName, freshSources) {
  const title = item.title || item.name || item.id || "";
  if (!title) return null;
  const date = extractDate(item);

  if (date) {
    // Has a date — must be within the last 7 days
    if (!isRecent(date)) return null;
  } else {
    // No date — only allow if the source is inherently fresh
    if (!freshSources.has(sourceName)) return null;
  }

  const url = item.url || item.permalink || item.hnLink || "";
  const datePart = date ? ` [${date.split("T")[0]}]` : " [trending]";
  return {
    key: title.toLowerCase(),
    text: url ? `${title}${datePart} | ${url}` : `${title}${datePart}`,
  };
}

function collectSourceItems(sweep, seen, sourceMap, freshSources) {
  for (const s of sweep.sources || []) {
    if (s.status !== "ok") continue;
    const name = s.source;
    if (!sourceMap[name]) sourceMap[name] = [];

    const items = s.data?.items || [];
    const models = s.data?.models?.items || [];

    for (const item of [...items, ...models]) {
      const entry = formatItem(item, name, freshSources);
      if (!entry || seen.has(entry.key)) continue;
      seen.add(entry.key);
      sourceMap[name].push(entry.text);
    }
  }
}

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
  collectSourceItems(sweepData, seen, sourceMap, fresh);

  // Build the source summaries, keeping the top items per source
  const sourceSummaries = Object.entries(sourceMap)
    .map(([name, items]) => `## ${name}\n${items.slice(0, 15).join("\n")}`)
    .join("\n\n");

  const today = new Date().toISOString().split("T")[0];
  const weekAgo = new Date(Date.now() - SEVEN_DAYS_MS)
    .toISOString()
    .split("T")[0];

  const userPrompt = `Today is ${today}. Generate a weekly AI digest covering ONLY the period ${weekAgo} to ${today}.\n\nBelow is fresh data collected today from ${sweepData.sourcesOk || "multiple"} sources. Dates in brackets show when items were published. ONLY include items from this data — do NOT add anything from your own knowledge.\n\n${sourceSummaries}\n\nProduce your JSON weekly digest using ONLY the items above.`;

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
