import { describe, expect, it, vi } from "vitest";

import { generateWeeklyDigest } from "../lib/llm/weekly-digest.mjs";

const PROSE_WRAPPED_DIGEST = `
Certainly! Here is the weekly digest you requested.

{"weekOf":"April 14-18, 2026","tldr":"A notable week for reasoning models and open-source releases.","highlights":[{"title":"GPT-5 rumours","body":"Community speculation is high.","category":"model-release","impact":"high","url":""}],"modelUpdates":[{"name":"Gemini 2.5","org":"Google","summary":"New reasoning mode announced.","url":""}],"paperPicks":[{"title":"Flash Attention 3","authors":"Dao et al.","insight":"3x speedup on H100.","url":""}],"communityBuzz":["Open-source models closing the gap","CUDA alternatives gaining traction"],"lookAhead":"Watch for Meta's next Llama announcement."}

I hope this helps with your team briefing!
`;

describe("generateWeeklyDigest — prose-wrapped JSON response", () => {
  it("extracts JSON from prose and returns a populated digest", async () => {
    const mockLlm = {
      chat: vi.fn().mockResolvedValue(PROSE_WRAPPED_DIGEST),
      name: "test-provider",
      model: "test-model",
    };
    const sweepData = {
      sources: [],
      sourcesOk: 0,
      timestamp: "2026-04-18T00:00:00.000Z",
    };

    const result = await generateWeeklyDigest(mockLlm, sweepData, { prompt: "Test digest prompt", freshSources: ["Hacker News"] });

    expect(result).not.toBeNull();
    expect(result.tldr).toBe(
      "A notable week for reasoning models and open-source releases.",
    );
    expect(result.highlights).toHaveLength(1);
    expect(result.highlights[0].title).toBe("GPT-5 rumours");
    expect(result.modelUpdates).toHaveLength(1);
    expect(result.paperPicks).toHaveLength(1);
    expect(result.communityBuzz).toHaveLength(2);
    expect(typeof result.lookAhead).toBe("string");
  });

  it("defaults array fields when LLM omits them", async () => {
    const mockLlm = {
      chat: vi.fn().mockResolvedValue('{"tldr":"short summary"}'),
      name: "test-provider",
      model: "test-model",
    };
    const sweepData = {
      sources: [],
      sourcesOk: 0,
      timestamp: "2026-04-18T00:00:00.000Z",
    };

    const result = await generateWeeklyDigest(mockLlm, sweepData, { prompt: "Test digest prompt", freshSources: ["Hacker News"] });

    expect(result).not.toBeNull();
    expect(result.tldr).toBe("short summary");
    expect(result.highlights).toEqual([]);
    expect(result.modelUpdates).toEqual([]);
    expect(result.paperPicks).toEqual([]);
    expect(result.communityBuzz).toEqual([]);
    expect(result.lookAhead).toBe("");
  });
});
