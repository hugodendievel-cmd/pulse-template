// lib/llm/weekly-digest.mjs — AI-powered weekly digest generation
import log from "../logger.mjs";
import { parseLlmJson } from "./parse-json.mjs";

export const WEEKLY_SYSTEM_PROMPT = `You are an AI industry intelligence analyst producing a weekly digest for a team of AI engineers. This digest is used every Friday for team briefings.

CRITICAL RULES:
- ONLY use information from the source data provided below. Do NOT add anything from your training data.
- Every item you mention MUST come directly from the provided source list.
- Every item in the source data is either dated within the last 7 days (shown as [YYYY-MM-DD]) or is from a live trending feed (shown as [trending]). Items outside the 7-day window have already been filtered out — you do not need to filter further.
- Trending items ([trending]) may be included but clearly represent *current popularity*, not a specific publication date.
- If there isn't enough data for a section, include fewer items. Never pad with old or made-up content.

Your output MUST be valid JSON with this structure:
{
  "weekOf": "March 17–21, 2026",
  "tldr": "3-4 sentence executive summary of the most important AI developments this week",
  "highlights": [
    {
      "title": "Clear headline for this highlight",
      "body": "2-3 sentences explaining the development and why it matters for AI engineers",
      "category": "model-release|research|product|funding|regulation|open-source|infrastructure",
      "impact": "high|medium|low",
      "url": "source URL if available, or empty string"
    }
  ],
  "modelUpdates": [
    {
      "name": "Model or tool name",
      "org": "Organization",
      "summary": "One sentence about what happened",
      "url": "URL if available, or empty string"
    }
  ],
  "paperPicks": [
    {
      "title": "Paper title",
      "authors": "First author et al.",
      "insight": "One sentence on the key finding or contribution",
      "url": "URL if available, or empty string"
    }
  ],
  "communityBuzz": [
    "Short bullet about what the community is talking about",
    "Another community talking point"
  ],
  "lookAhead": "1-2 sentences about what to watch for next week based on the trends in the data"
}

Guidelines:
- Focus on what matters to AI ENGINEERS: new models, libraries, frameworks, breakthroughs, significant open-source releases
- Limit highlights to 5-7 most important items
- Limit modelUpdates to 3-5 entries
- Limit paperPicks to 3-4 top papers
- Limit communityBuzz to 4-6 bullet points
- Be concrete and specific, not vague
- Include URLs when available from the provided data
- Write in a clear, professional tone suitable for a Friday team digest`;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Sources where items don't carry per-item dates but are inherently fresh
// (ranking algorithms prioritize recent content). Items from these may be
// included without a date.
const INHERENTLY_FRESH_SOURCES = new Set([
  "Hacker News",
  "Reddit",
  "Product Hunt",
  "GitHub Trending",
  "Hugging Face",
]);

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
  { prompt = WEEKLY_SYSTEM_PROMPT, freshSources = INHERENTLY_FRESH_SOURCES } = {},
) {
  if (!llm || !sweepData) return null;

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
