// tests/orchestrator-pack.test.mjs — Story 2.3: briefing.mjs builds its source
// list from the active pack; analysis/digest prompts are overridable.
// No network: all 12 source modules are stubbed via vi.doMock + vi.resetModules.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// [displayName, moduleSlug] — current orchestrator order (FR6 guard)
const AI_SOURCES = [
  ["Hacker News", "hackernews"],
  ["ArXiv", "arxiv"],
  ["Hugging Face", "huggingface"],
  ["GitHub Trending", "github-trending"],
  ["TechCrunch", "techcrunch"],
  ["The Verge", "theverge"],
  ["VentureBeat", "venturebeat"],
  ["Reddit", "reddit"],
  ["Google News", "google-news"],
  ["NewsAPI", "newsapi"],
  ["Product Hunt", "producthunt"],
  ["Simon Willison", "simonwillison"],
];

function stubAllSources({ titleByName = {} } = {}) {
  const mocks = {};
  for (const [name, slug] of AI_SOURCES) {
    const fn = vi.fn(async (config = {}, opts = {}) => ({
      source: name,
      category: "news",
      count: 1,
      items: [{ title: titleByName[name] ?? "x" }],
    }));
    mocks[name] = fn;
    vi.doMock(`../apis/sources/${slug}.mjs`, () => ({ briefing: fn }));
  }
  return mocks;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  for (const [, slug] of AI_SOURCES) {
    vi.doUnmock(`../apis/sources/${slug}.mjs`);
  }
  delete process.env.PULSE_DOMAIN;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("runSweep — pack-driven sources (FR6 shape)", () => {
  it("queries the same 12 sources in order, config flows, opts empty", async () => {
    const mocks = stubAllSources();
    const { runSweep } = await import("../apis/briefing.mjs");
    const result = await runSweep();

    expect(result.sourcesTotal).toBe(12);
    expect(result.sourcesOk).toBe(12);
    expect(result.sources.map((s) => s.source)).toEqual(
      AI_SOURCES.map(([name]) => name),
    );
    expect(result).toMatchObject({
      sourcesOk: 12,
      sourcesTotal: 12,
    });
    expect(typeof result.timestamp).toBe("string");
    expect(typeof result.sweepDurationMs).toBe("number");

    for (const [name] of AI_SOURCES) {
      expect(mocks[name]).toHaveBeenCalledWith({}, undefined);
    }
  });

  it("still sanitizes source items", async () => {
    stubAllSources({ titleByName: { "Hacker News": "<b>html</b>" } });
    const { runSweep } = await import("../apis/briefing.mjs");
    const result = await runSweep();
    const hn = result.sources.find((s) => s.source === "Hacker News");
    expect(hn.data.items[0].title).toBe("html");
  });
});

describe("runDigestSweep — opts flow", () => {
  it("calls every source with ({}, { days: 7 })", async () => {
    const mocks = stubAllSources();
    const { runDigestSweep } = await import("../apis/briefing.mjs");
    const result = await runDigestSweep();

    expect(result.sourcesTotal).toBe(12);
    for (const [name] of AI_SOURCES) {
      expect(mocks[name]).toHaveBeenCalledWith({}, { days: 7 });
    }
  });
});

describe("analyzeWithLLM — prompt override", () => {
  const sweep = { sources: [], sourcesOk: 0, timestamp: "2026-04-18T00:00:00.000Z" };
  const makeLlm = () => ({
    name: "t",
    model: "m",
    chat: vi.fn().mockResolvedValue('{"summary":"s"}'),
  });

  it("uses the override prompt when provided", async () => {
    const { analyzeWithLLM } = await import("../lib/llm/analysis.mjs");
    const llm = makeLlm();
    await analyzeWithLLM(llm, sweep, { prompt: "MAC PROMPT" });
    expect(llm.chat.mock.calls[0][0][0].content.startsWith("MAC PROMPT")).toBe(
      true,
    );
  });

  it("defaults to the AI analyst prompt (2-arg calls unchanged)", async () => {
    const { analyzeWithLLM } = await import("../lib/llm/analysis.mjs");
    const llm = makeLlm();
    await analyzeWithLLM(llm, sweep);
    expect(
      llm.chat.mock.calls[0][0][0].content.startsWith(
        "You are an AI industry intelligence analyst",
      ),
    ).toBe(true);
  });
});

describe("generateWeeklyDigest — freshSources override", () => {
  const sweep = {
    sourcesOk: 1,
    timestamp: "2026-04-18T00:00:00.000Z",
    sources: [
      {
        source: "Mac Source",
        status: "ok",
        data: {
          category: "news",
          items: [{ title: "MacWidget ships", url: "https://example.test/mac" }],
        },
      },
    ],
  };
  const makeLlm = () => ({
    name: "t",
    model: "m",
    chat: vi.fn().mockResolvedValue('{"tldr":"x"}'),
  });

  it("undated items from unknown sources are excluded by default", async () => {
    const { generateWeeklyDigest } = await import(
      "../lib/llm/weekly-digest.mjs"
    );
    const llm = makeLlm();
    await generateWeeklyDigest(llm, sweep);
    expect(llm.chat.mock.calls[0][0][0].content).not.toContain(
      "MacWidget ships",
    );
  });

  it("freshSources override includes undated items from that source", async () => {
    const { generateWeeklyDigest } = await import(
      "../lib/llm/weekly-digest.mjs"
    );
    const llm = makeLlm();
    await generateWeeklyDigest(llm, sweep, { freshSources: ["Mac Source"] });
    expect(llm.chat.mock.calls[0][0][0].content).toContain("MacWidget ships");
  });
});

describe("SOURCE_COUNT / SOURCE_NAMES exports", () => {
  it("resolve the env-selected pack at import time (default ai → 12)", async () => {
    process.env.PULSE_DOMAIN = "ai";
    vi.resetModules();
    const m = await import("../apis/briefing.mjs");
    expect(m.SOURCE_COUNT).toBe(12);
    expect(m.SOURCE_NAMES).toEqual(AI_SOURCES.map(([name]) => name));
  });
});
