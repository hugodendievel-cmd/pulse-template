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

  it("strips non-http(s) URLs from untrusted signal/radar/story links", async () => {
    const raw = JSON.stringify({
      summary: "s",
      topStories: [{ headline: "h", url: "javascript:alert(1)" }],
      modelRadar: [{ name: "m", org: "o", status: "released", url: "data:text/html,x" }],
      signals: [{ signal: "sig", source: "src", confidence: "high", url: "https://ok.test/a" }],
    });
    const mockLlm = { chat: vi.fn().mockResolvedValue(raw), name: "p", model: "m" };
    const sweepData = { sources: [], sourcesOk: 0, timestamp: "2026-04-18T00:00:00.000Z" };

    const result = await analyzeWithLLM(mockLlm, sweepData, { prompt: "p" });

    expect(result.topStories[0].url).toBe("");
    expect(result.modelRadar[0].url).toBe("");
    expect(result.signals[0].url).toBe("https://ok.test/a");
  });

  it("drops non-object array entries instead of crashing the client render", async () => {
    const raw = '{"summary":"s","signals":[null,"nope"],"modelRadar":[null]}';
    const mockLlm = { chat: vi.fn().mockResolvedValue(raw), name: "p", model: "m" };
    const sweepData = { sources: [], sourcesOk: 0, timestamp: "2026-04-18T00:00:00.000Z" };

    const result = await analyzeWithLLM(mockLlm, sweepData, { prompt: "p" });

    expect(result.signals).toEqual([]);
    expect(result.modelRadar).toEqual([]);
  });

  // A malformed sample used to discard the day's briefing silently. One retry
  // turns a transient failure into a delivered briefing.
  it("retries once and returns the analysis when the first reply is unparseable", async () => {
    const good =
      '{"summary":"second time lucky","topStories":[],"trends":[],"modelRadar":[],"signals":[]}';
    const mockLlm = {
      chat: vi
        .fn()
        .mockResolvedValueOnce("I cannot produce JSON right now.")
        .mockResolvedValueOnce(good),
      name: "p",
      model: "m",
    };
    const sweepData = { sources: [], sourcesOk: 0, timestamp: "2026-04-18T00:00:00.000Z" };

    const result = await analyzeWithLLM(mockLlm, sweepData, { prompt: "p" });

    expect(mockLlm.chat).toHaveBeenCalledTimes(2);
    expect(result.summary).toBe("second time lucky");
  });

  it("gives up after a single retry and returns null", async () => {
    const mockLlm = {
      chat: vi.fn().mockResolvedValue("Sorry, no JSON today."),
      name: "p",
      model: "m",
    };
    const sweepData = { sources: [], sourcesOk: 0, timestamp: "2026-04-18T00:00:00.000Z" };

    const result = await analyzeWithLLM(mockLlm, sweepData, { prompt: "p" });

    expect(mockLlm.chat).toHaveBeenCalledTimes(2);
    expect(result).toBeNull();
  });

  it("does not retry when the first reply parses", async () => {
    const good =
      '{"summary":"first try","topStories":[],"trends":[],"modelRadar":[],"signals":[]}';
    const mockLlm = { chat: vi.fn().mockResolvedValue(good), name: "p", model: "m" };
    const sweepData = { sources: [], sourcesOk: 0, timestamp: "2026-04-18T00:00:00.000Z" };

    const result = await analyzeWithLLM(mockLlm, sweepData, { prompt: "p" });

    expect(mockLlm.chat).toHaveBeenCalledTimes(1);
    expect(result.summary).toBe("first try");
  });
});
