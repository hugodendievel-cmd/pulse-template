// lib/llm/analysis.mjs — AI-powered news analysis and synthesis
import log from "../logger.mjs";
import { parseLlmJson } from "./parse-json.mjs";

export const SYSTEM_PROMPT = `You are an AI industry intelligence analyst. Given raw data from multiple sources about AI news, models, research, and industry events, produce a concise intelligence briefing.

Your output MUST be valid JSON with this structure:
{
  "summary": "2-3 sentence overview of the most important AI developments right now",
  "topStories": [
    {
      "headline": "Short headline",
      "significance": "Why this matters (1 sentence)",
      "category": "one of: model-release, acquisition, funding, research, product, regulation, rumor",
      "impact": "high|medium|low",
      "url": "URL of the source article if available, or empty string"
    }
  ],
  "trends": ["Trend 1", "Trend 2", "Trend 3"],
  "modelRadar": [
    {
      "name": "Model name",
      "org": "Organization",
      "status": "released|rumored|announced|in-development",
      "note": "Brief note",
      "url": "URL of the model page or announcement if available, or empty string"
    }
  ],
  "signals": [
    {
      "signal": "Brief description of a notable signal",
      "source": "Where this came from",
      "confidence": "high|medium|low",
      "url": "URL of the source article if available, or empty string"
    }
  ]
}

IMPORTANT: For topStories and signals, include the url field with the actual URL from the source data when available. Match headlines to the provided titles and use their URLs.`;

export async function analyzeWithLLM(
  llm,
  sweepData,
  { prompt = SYSTEM_PROMPT } = {},
) {
  if (!llm) return null;

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

  const userPrompt = `Analyze the following AI industry intelligence data from ${sweepData.sourcesOk} sources gathered at ${sweepData.timestamp}:\n\n${sourceSummaries}\n\nProduce your JSON analysis.`;

  try {
    const raw = await llm.chat(
      [{ role: "user", content: `${prompt}\n\n${userPrompt}` }],
      { maxTokens: 3000 },
    );

    return parseLlmJson(raw, {
      required: ["summary"],
      defaults: { topStories: [], trends: [], modelRadar: [], signals: [] },
      provider: llm.name,
      model: llm.model,
    });
  } catch (err) {
    log.error(
      { err: err.message, provider: llm.name, model: llm.model },
      "[LLM Analysis] Failed",
    );
    return null;
  }
}
