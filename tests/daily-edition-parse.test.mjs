import { describe, expect, it, vi } from "vitest";

import { generateDailyEdition } from "../lib/llm/daily-edition.mjs";

const PROSE_WRAPPED_EDITION = `
Certainly! Here is the daily edition.

{"dateOf":"September 10, 2026","tldr":"One big model release dominates a otherwise quiet morning.","topStories":[{"title":"GPT-5.5 lands","body":"OpenAI shipped GPT-5.5 with native tool use.","category":"model-release","impact":"high","url":"https://example.com"}],"modelReleases":[{"name":"Gemini 3 Flash","org":"Google","summary":"Faster flash tier announced.","url":""}],"paperPick":{"title":"Flash Attention 4","authors":"Dao et al.","insight":"2x speedup on H100.","url":""},"quickLinks":[{"text":"Open-weights momentum","url":"https://example.com/ow"},{"text":"Local llama scene buzzing","url":"https://example.com/llama"}]}

Hope this helps with your morning briefing!
`;

const SWEEP = {
  sources: [],
  sourcesOk: 0,
  timestamp: "2026-09-10T00:00:00.000Z",
};

const makeLlm = (response) => ({
  chat: vi.fn().mockResolvedValue(response),
  name: "test-provider",
  model: "test-model",
});

const OPTS = { prompt: "Test daily prompt", freshSources: ["Hacker News"] };

describe("generateDailyEdition — prose-wrapped JSON response", () => {
  it("extracts JSON from prose and returns a populated edition", async () => {
    const result = await generateDailyEdition(
      makeLlm(PROSE_WRAPPED_EDITION),
      SWEEP,
      OPTS,
    );

    expect(result).not.toBeNull();
    expect(result.tldr).toBe(
      "One big model release dominates a otherwise quiet morning.",
    );
    expect(result.topStories).toHaveLength(1);
    expect(result.topStories[0].title).toBe("GPT-5.5 lands");
    expect(result.modelReleases).toHaveLength(1);
    expect(result.paperPick.title).toBe("Flash Attention 4");
    expect(result.quickLinks).toHaveLength(2);
    expect(result.quickLinks[0]).toEqual({
      text: "Open-weights momentum",
      url: "https://example.com/ow",
    });
  });

  it("defaults array fields when LLM omits them", async () => {
    const result = await generateDailyEdition(
      makeLlm('{"tldr":"short summary","topStories":[]}'),
      SWEEP,
      OPTS,
    );

    expect(result).not.toBeNull();
    expect(result.tldr).toBe("short summary");
    expect(result.topStories).toEqual([]);
    expect(result.modelReleases).toEqual([]);
    expect(result.paperPick).toEqual({});
    expect(result.quickLinks).toEqual([]);
    expect(result.dateOf).toBe("");
  });

  it("returns null when topStories are missing (required field)", async () => {
    const result = await generateDailyEdition(
      makeLlm('{"tldr":"only a summary, no stories"}'),
      SWEEP,
      OPTS,
    );

    expect(result).toBeNull();
  });

  it("throws a loud error when the pack has no daily prompt", async () => {
    await expect(
      generateDailyEdition(makeLlm("{}"), SWEEP),
    ).rejects.toThrow(/prompts\.daily/);
  });

  it("cross-day dedupe: pool items matching a recent edition are excluded and named to the LLM", async () => {
    const llm = makeLlm('{"tldr":"x","topStories":[]}');
    const fresh24h = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const sweepData = {
      sources: [
        {
          source: "TechCrunch",
          status: "ok",
          data: {
            items: [
              { title: "GPT-5.5 lands", url: "https://example.com/gpt55", published: fresh24h },
              { title: "Brand new story", url: "https://example.com/brand-new", published: fresh24h },
            ],
          },
        },
      ],
      sourcesOk: 1,
    };

    const result = await generateDailyEdition(llm, sweepData, {
      ...OPTS,
      recentEditions: [
        {
          editionId: "2026-09-09",
          topStories: [{ title: "GPT-5.5 lands", url: "" }],
          modelReleases: [{ name: "Gemini 3 Flash", org: "Google", summary: "", url: "" }],
        },
      ],
    });

    expect(result).not.toBeNull();
    const prompt = llm.chat.mock.calls[0][0][0].content;
    // Repeatsource dropped BEFORE the LLM sees the pool…
    expect(prompt).not.toContain("https://example.com/gpt55");
    // …fresh items still present…
    expect(prompt).toContain("https://example.com/brand-new");
    // …and covered titles are named explicitly so rephrased variants are refused.
    expect(prompt).toContain("ALREADY COVERED");
    expect(prompt).toContain("- GPT-5.5 lands");
    expect(prompt).toContain("- Gemini 3 Flash");
  });
});
