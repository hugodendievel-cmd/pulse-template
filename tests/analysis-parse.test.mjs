import { describe, expect, it, vi } from "vitest";

import { analyzeWithLLM } from "../lib/llm/analysis.mjs";

const FENCED_ANALYSIS = `
Here is my analysis of the AI landscape:

\`\`\`json
{
  "summary": "A busy week for open-source models.",
  "topStories": [{ "headline": "LLaMA 4 drops", "significance": "Open weights", "category": "model-release", "impact": "high", "url": "https://example.com" }],
  "trends": ["Open-source momentum"],
  "modelRadar": [{ "name": "LLaMA 4", "org": "Meta", "status": "released", "note": "Huge context window", "url": "" }],
  "signals": [{ "signal": "GPU demand rising", "source": "Reddit", "confidence": "medium", "url": "" }]
}
\`\`\`

Let me know if you need more detail.
`;

describe("analyzeWithLLM — fenced JSON response", () => {
  it("parses fenced JSON and returns a populated analysis", async () => {
    const mockLlm = {
      chat: vi.fn().mockResolvedValue(FENCED_ANALYSIS),
      name: "test-provider",
      model: "test-model",
    };
    const sweepData = {
      sources: [],
      sourcesOk: 0,
      timestamp: "2026-04-18T00:00:00.000Z",
    };

    const result = await analyzeWithLLM(mockLlm, sweepData, { prompt: "Test analysis prompt" });

    expect(result).not.toBeNull();
    expect(result.summary).toBe("A busy week for open-source models.");
    expect(result.topStories).toHaveLength(1);
    expect(result.topStories[0].headline).toBe("LLaMA 4 drops");
    expect(result.trends).toEqual(["Open-source momentum"]);
    expect(result.modelRadar).toHaveLength(1);
    expect(result.signals).toHaveLength(1);
  });

  it("defaults array fields when LLM omits them", async () => {
    const mockLlm = {
      chat: vi.fn().mockResolvedValue('{"summary":"short"}'),
      name: "test-provider",
      model: "test-model",
    };
    const sweepData = {
      sources: [],
      sourcesOk: 0,
      timestamp: "2026-04-18T00:00:00.000Z",
    };

    const result = await analyzeWithLLM(mockLlm, sweepData, { prompt: "Test analysis prompt" });

    expect(result).not.toBeNull();
    expect(result.summary).toBe("short");
    expect(result.topStories).toEqual([]);
    expect(result.trends).toEqual([]);
    expect(result.modelRadar).toEqual([]);
    expect(result.signals).toEqual([]);
  });
});
