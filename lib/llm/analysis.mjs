// lib/llm/analysis.mjs — LLM-powered sweep analysis and synthesis.
// Domain-neutral: the system prompt comes from the active domain pack.
import log from "../logger.mjs";
import { parseLlmJson } from "./parse-json.mjs";
import { sanitizeAnalysis } from "../../apis/utils/sanitize.mjs";

export async function analyzeWithLLM(
  llm,
  sweepData,
  { prompt } = {},
) {
  if (!llm) return null;
  if (!prompt)
    throw new Error(
      "analyzeWithLLM: no prompt — the active domain pack must define prompts.analysis",
    );

  const sourceSummaries = sweepData.sources
    .filter((s) => s.status === "ok")
    .map((s) => {
      const items = s.data?.items || s.data?.models?.items || [];
      const topItems = items.slice(0, 8).map((i) => {
        const title = i.title || i.name || i.id || "untitled";
        const url = i.url || i.permalink || i.hnLink || "";
        return url ? `${title} | ${url}` : title;
      });
      return `## ${s.source}\n${topItems.join("\n")}`;
    })
    .join("\n\n");

  const userPrompt = `Analyze the following intelligence data from ${sweepData.sourcesOk} sources gathered at ${sweepData.timestamp}:\n\n${sourceSummaries}\n\nProduce your JSON analysis.`;

  const messages = [
    { role: "user", content: `${prompt}\n\n${userPrompt}` },
  ];

  try {
    // One retry: an LLM intermittently returns malformed JSON (a stray quote,
    // a truncated object). A second sample almost always parses, and the
    // alternative is silently losing the day's briefing.
    let analysis = null;
    for (let attempt = 0; attempt < 2 && !analysis; attempt++) {
      if (attempt > 0) {
        log.info(
          { provider: llm.name, model: llm.model },
          "analyzeWithLLM: retrying after an unparseable response",
        );
      }
      const raw = await llm.chat(messages, { maxTokens: 3000 });
      analysis = sanitizeAnalysis(
        parseLlmJson(raw, {
          required: ["summary"],
          defaults: { topStories: [], trends: [], modelRadar: [], signals: [] },
          provider: llm.name,
          model: llm.model,
        }),
      );
    }
    // Attribution for the briefing byline (design 3a). parseLlmJson takes
    // provider/model only as log bindings, so carry them on the payload.
    return analysis && typeof analysis === "object"
      ? { ...analysis, provider: llm.name, model: llm.model }
      : analysis;
  } catch (err) {
    log.error(
      { err: err.message, provider: llm.name, model: llm.model },
      "[LLM Analysis] Failed",
    );
    return null;
  }
}
