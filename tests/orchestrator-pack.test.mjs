// tests/orchestrator-pack.test.mjs — Story 2.3: briefing.mjs builds its source
// list from the active pack; analysis/digest prompts are overridable.
// No network: every pack source module is stubbed via vi.doMock + vi.resetModules.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import example from "../domains/example.mjs";

// [displayName, moduleSlug, config] — current orchestrator order (FR6 guard)
const EXAMPLE_SOURCES = example.sources.map((s) => [
  s.name,
  s.module,
  s.config,
]);

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

describe("runSweep — pack-driven sources (FR6 shape)", () => {
  it("queries the pack's sources in order, config flows, opts empty", async () => {
    const mocks = stubAllSources();
    const { runSweep } = await import("../apis/briefing.mjs");
    const result = await runSweep();

    expect(result.sourcesTotal).toBe(EXAMPLE_SOURCES.length);
    expect(result.sourcesOk).toBe(EXAMPLE_SOURCES.length);
    expect(result.sources.map((s) => s.source)).toEqual(
      EXAMPLE_SOURCES.map(([name]) => name),
    );
    expect(result).toMatchObject({
      sourcesOk: EXAMPLE_SOURCES.length,
      sourcesTotal: EXAMPLE_SOURCES.length,
    });
    expect(typeof result.timestamp).toBe("string");
    expect(typeof result.sweepDurationMs).toBe("number");

    for (const [name, , config] of EXAMPLE_SOURCES) {
      expect(mocks[name]).toHaveBeenCalledWith(config, undefined);
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
  it("calls every source with (config, { days: 7 })", async () => {
    const mocks = stubAllSources();
    const { runDigestSweep } = await import("../apis/briefing.mjs");
    const result = await runDigestSweep();

    expect(result.sourcesTotal).toBe(EXAMPLE_SOURCES.length);
    for (const [name, , config] of EXAMPLE_SOURCES) {
      expect(mocks[name]).toHaveBeenCalledWith(config, { days: 7 });
    }
  });

  it("window override: days:1 flows to every source (daily edition)", async () => {
    const mocks = stubAllSources();
    const { runDigestSweep } = await import("../apis/briefing.mjs");
    await runDigestSweep({ days: 1 });

    for (const [name, , config] of EXAMPLE_SOURCES) {
      expect(mocks[name]).toHaveBeenCalledWith(config, { days: 1 });
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

  it("no default prompt — a pack-less call is a loud misconfiguration", async () => {
    const { analyzeWithLLM } = await import("../lib/llm/analysis.mjs");
    const llm = makeLlm();
    await expect(analyzeWithLLM(llm, sweep)).rejects.toThrow(
      /prompt.*prompts\.analysis/,
    );
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
      "MacWidget ships",
    );
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

  it("freshSources override includes undated items from that source", async () => {
    const { generateWeeklyDigest } = await import(
      "../lib/llm/weekly-digest.mjs"
    );
    const llm = makeLlm();
    await generateWeeklyDigest(llm, sweep, {
      prompt: "P",
      freshSources: ["Mac Source"],
    });
    expect(llm.chat.mock.calls[0][0][0].content).toContain("MacWidget ships");
  });
});

describe("SOURCE_COUNT / SOURCE_NAMES exports", () => {
  it("resolve the env-selected pack at import time (default example)", async () => {
    process.env.PULSE_DOMAIN = "example";
    vi.resetModules();
    const m = await import("../apis/briefing.mjs");
    expect(m.SOURCE_COUNT).toBe(EXAMPLE_SOURCES.length);
    expect(m.SOURCE_NAMES).toEqual(EXAMPLE_SOURCES.map(([name]) => name));
  });
});
