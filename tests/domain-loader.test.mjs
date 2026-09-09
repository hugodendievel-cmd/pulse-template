// tests/domain-loader.test.mjs — domains/index.mjs pack loading + ai pack shape.
// No network, no DOM.
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { listDomains, loadDomain, validateDomain } from "../domains/index.mjs";
import ai from "../domains/ai.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const AI_SOURCE_ORDER = [
  "Hacker News",
  "ArXiv",
  "Hugging Face",
  "GitHub Trending",
  "TechCrunch",
  "The Verge",
  "VentureBeat",
  "Reddit",
  "Google News",
  "NewsAPI",
  "Product Hunt",
  "Simon Willison",
];

afterEach(() => {
  delete process.env.PULSE_DOMAIN;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("domains/index.mjs loader", () => {
  it("loadDomain() returns the ai pack by default", () => {
    expect(loadDomain().id).toBe("ai");
  });

  it("loadDomain('ai') returns the same object (cache)", () => {
    expect(loadDomain("ai")).toBe(loadDomain());
  });

  it("listDomains() includes ai", () => {
    expect(listDomains()).toContain("ai");
  });

  it("loadDomain('nope') throws Unknown domain pack", () => {
    expect(() => loadDomain("nope")).toThrow("Unknown domain pack: nope");
  });

  it("validateDomain({}) throws mentioning the first missing key", () => {
    expect(() => validateDomain({})).toThrow(/Invalid domain pack.*"id"/);
  });

  it("PULSE_DOMAIN env selects the pack", async () => {
    process.env.PULSE_DOMAIN = "ai";
    vi.resetModules();
    const mod = await import("../domains/index.mjs");
    expect(mod.loadDomain().id).toBe("ai");
  });
});

describe("domains/ai.mjs pack shape", () => {
  it("declares the 12 sources in orchestrator order", () => {
    expect(ai.sources).toHaveLength(12);
    expect(ai.sources.map((s) => s.name)).toEqual(AI_SOURCE_ORDER);
  });

  it("every source module resolves to an existing file", () => {
    for (const s of ai.sources) {
      expect(
        existsSync(resolve(root, "apis/sources", `${s.module}.mjs`)),
        `apis/sources/${s.module}.mjs`,
      ).toBe(true);
    }
  });

  it("every ai source entry carries config: {} (defaults live in modules)", () => {
    for (const s of ai.sources) {
      expect(s.config).toEqual({});
    }
  });

  it("prompts are the verbatim lib/llm strings", () => {
    expect(ai.prompts.analysis).toContain("AI industry intelligence analyst");
    expect(ai.prompts.digest).toContain("weekly digest");
  });

  it("panels/stats/nav reproduce the current dashboard chrome", () => {
    expect(ai.panels.map((p) => p.id)).toEqual([
      "analysis",
      "radar",
      "trending",
      "newest",
      "models",
      "papers",
      "repos",
      "blog",
      "reddit",
      "hackernews",
      "producthunt",
      "digest",
    ]);
    expect(ai.stats.map((s) => s.key)).toEqual([
      "articles",
      "models",
      "papers",
      "repos",
    ]);
    expect(ai.nav.map((n) => n.filter)).toEqual([
      "all",
      "briefing",
      "news",
      "research",
      "code",
      "community",
      "digest",
    ]);
  });
});
