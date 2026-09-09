// tests/orchestrator-pack.test.mjs — briefing.mjs builds its source list from
// the active pack; analysis/digest prompts/freshSources are pack-provided.
// No network: the example pack's source modules are stubbed via vi.doMock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import example from "../domains/example.mjs";

// [displayName, moduleSlug] — example pack order
const EXAMPLE_SOURCES = [
  ["GitHub Trending", "github-trending"],
  ["Hacker News", "hackernews"],
  ["Tech News", "techcrunch"],
  ["Google News", "google-news"],
];

function stubAllSources({ titleByName = {} } = {}) {
  const mocks = {};
  for (const [name, slug] of EXAMPLE_SOURCES) {
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
  for (const [, slug] of EXAMPLE_SOURCES) {
    vi.doUnmock(`../apis/sources/${slug}.mjs`);
  }
  delete process.env.PULSE_DOMAIN;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("runSweep — pack-driven sources", () => {
  it("queries the pack sources in order, config flows, opts empty", async () => {
    const mocks = stubAllSources();
    const { runSweep } = await import("../apis/briefing.mjs");
    const result = await runSweep();

    expect(result.sourcesTotal).toBe(EXAMPLE_SOURCES.length);
    expect(result.sourcesOk).toBe(EXAMPLE_SOURCES.length);
    expect(result.sources.map((s) => s.source)).toEqual(
      EXAMPLE_SOURCES.map(([name]) => name),
    );
    expect(typeof result.timestamp).toBe("string");
    expect(typeof result.sweepDurationMs).toBe("number");

    for (const [index, [name]] of EXAMPLE_SOURCES.entries()) {
      // The pack's per-source config flows into the module call.
      expect(mocks[name]).toHaveBeenCalledWith(
        example.sources[index].config,
        undefined,
      );
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

    expect(result.sourcesTotal).toBe(EXAMPLE_SOURCES.length);
    for (const [index, [name]] of EXAMPLE_SOURCES.entries()) {
      // Digest sweep passes the 7-day window as opts; config unchanged.
      expect(mocks[name]).toHaveBeenCalledWith(
        example.sources[index].config,
        { days: 7 },
      );
    }
  });
});

describe("analyzeWithLLM — pack-provided prompt", () => {
  const sweep = { sources: [], sourcesOk: 0, timestamp: "2026-04-18T00:00:00.000Z" };
  const makeLlm = () => ({
    name: "t",
    model: "m",
    chat: vi.fn().mockResolvedValue('{"summary":"s"}'),
  });

  it("uses the pack prompt when provided", async () => {
    const { analyzeWithLLM } = await import("../lib/llm/analysis.mjs");
    const llm = makeLlm();
    await analyzeWithLLM(llm, sweep, { prompt: "EXAMPLE PACK PROMPT" });
    expect(llm.chat.mock.calls[0][0][0].content.startsWith("EXAMPLE PACK PROMPT")).toBe(
      true,
    );
  });

  it("no default prompt — a pack-less call is a loud misconfiguration", async () => {
    const { analyzeWithLLM } = await import("../lib/llm/analysis.mjs");
    const llm = makeLlm();
    await expect(analyzeWithLLM(llm, sweep)).rejects.toThrow(
      /prompt.*prompts\.analysis/,
    );
  });
});

describe("generateWeeklyDigest — pack-provided prompt + freshSources", () => {
  const sweep = {
    sourcesOk: 1,
    timestamp: "2026-04-18T00:00:00.000Z",
    sources: [
      {
        source: "Undated Source",
        status: "ok",
        data: {
          category: "news",
          items: [{ title: "UndatedWidget ships", url: "https://example.test/u" }],
        },
      },
    ],
  };
  const makeLlm = () => ({
    name: "t",
    model: "m",
    chat: vi.fn().mockResolvedValue('{"tldr":"x"}'),
  });

  it("undated items from non-fresh sources are excluded", async () => {
    const { generateWeeklyDigest } = await import(
      "../lib/llm/weekly-digest.mjs"
    );
    const llm = makeLlm();
    await generateWeeklyDigest(llm, sweep, {
      prompt: "P",
      freshSources: ["Hacker News"],
    });
    expect(llm.chat.mock.calls[0][0][0].content).not.toContain(
      "UndatedWidget ships",
    );
  });

  it("freshSources override includes undated items from that source", async () => {
    const { generateWeeklyDigest } = await import(
      "../lib/llm/weekly-digest.mjs"
    );
    const llm = makeLlm();
    await generateWeeklyDigest(llm, sweep, {
      prompt: "P",
      freshSources: ["Undated Source"],
    });
    expect(llm.chat.mock.calls[0][0][0].content).toContain("UndatedWidget ships");
  });

  it("no defaults — missing prompt/freshSources throws loudly", async () => {
    const { generateWeeklyDigest } = await import(
      "../lib/llm/weekly-digest.mjs"
    );
    const llm = makeLlm();
    await expect(generateWeeklyDigest(llm, sweep, { prompt: "P" })).rejects.toThrow(
      /freshSources/,
    );
  });
});

describe("SOURCE_COUNT / SOURCE_NAMES exports", () => {
  it("resolve the env-selected pack at import time", async () => {
    process.env.PULSE_DOMAIN = "example";
    vi.resetModules();
    const m = await import("../apis/briefing.mjs");
    expect(m.SOURCE_COUNT).toBe(EXAMPLE_SOURCES.length);
    expect(m.SOURCE_NAMES).toEqual(EXAMPLE_SOURCES.map(([name]) => name));
  });
});
