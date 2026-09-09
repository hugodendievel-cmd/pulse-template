// tests/domain-mac-apps.test.mjs — Story 2.5: mac-apps pack validity, name
// coherence, env selection, config flow, prompt schema parity. No network:
// fetch utils are stubbed via vi.doMock + vi.resetModules.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDomain } from "../domains/index.mjs";
import macApps from "../domains/mac-apps.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const PACK_SOURCE_NAMES = [
  "GitHub Trending",
  "Hacker News",
  "Reddit",
  "Product Hunt",
  "9to5Mac",
  "Google News",
];

const VALID_VARIANTS = ["briefing", "radar", "digest", "news", "cards", "aggregate"];

function readFileSyncSafe(relPath) {
  return readFileSync(resolve(root, relPath), "utf8");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  delete process.env.PULSE_DOMAIN;
  vi.doUnmock("../apis/utils/fetch.mjs");
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("mac-apps pack validity", () => {
  it("loadDomain('mac-apps') does not throw (validateDomain passes)", () => {
    expect(loadDomain("mac-apps").id).toBe("mac-apps");
  });

  it("every source module resolves to an existing file", () => {
    for (const s of macApps.sources) {
      expect(
        existsSync(resolve(root, "apis/sources", `${s.module}.mjs`)),
        `apis/sources/${s.module}.mjs`,
      ).toBe(true);
    }
  });

  it("panels reference valid variants and existing icon sprites", () => {
    const html = readFileSyncSafe("dashboard/public/index.html");
    for (const p of macApps.panels) {
      expect(VALID_VARIANTS).toContain(p.variant);
      expect(html, `#ic-${p.icon}`).toContain(`id="ic-${p.icon}"`);
    }
  });

  it("stats reference categories the pack's sources can produce", () => {
    // Categories each source module emits (source modules are unchanged —
    // the 9to5Mac entry reuses techcrunch.mjs, which reports "news").
    const producible = new Set(["news", "community", "products", "code"]);
    for (const stat of macApps.stats) {
      for (const c of stat.categories) {
        expect(producible).toContain(c);
      }
    }
  });
});

describe("mac-apps name coherence", () => {
  it("every panels[].sources name exists in sources[].name", () => {
    const names = new Set(macApps.sources.map((s) => s.name));
    for (const p of macApps.panels) {
      for (const n of p.sources ?? []) {
        expect(names, `panel ${p.id} → ${n}`).toContain(n);
      }
    }
  });

  it("every colors key exists in sources[].name", () => {
    const names = new Set(macApps.sources.map((s) => s.name));
    for (const n of Object.keys(macApps.colors)) {
      expect(names, `colors key ${n}`).toContain(n);
    }
  });

  it("every freshSources entry exists in sources[].name", () => {
    const names = new Set(macApps.sources.map((s) => s.name));
    for (const n of macApps.freshSources) {
      expect(names, `freshSources ${n}`).toContain(n);
    }
  });
});

describe("env selection", () => {
  it("PULSE_DOMAIN=mac-apps → loadDomain() returns the mac pack and briefing exposes 6 sources", async () => {
    process.env.PULSE_DOMAIN = "mac-apps";
    vi.resetModules();
    const { loadDomain: load } = await import("../domains/index.mjs");
    expect(load().id).toBe("mac-apps");
    const briefing = await import("../apis/briefing.mjs");
    expect(briefing.SOURCE_COUNT).toBe(6);
    expect(briefing.SOURCE_NAMES).toEqual(PACK_SOURCE_NAMES);
  });

  it("FR6 guard: with PULSE_DOMAIN unset the default pack is ai (12 sources)", async () => {
    delete process.env.PULSE_DOMAIN;
    vi.resetModules();
    const briefing = await import("../apis/briefing.mjs");
    expect(briefing.SOURCE_COUNT).toBe(12);
  });
});

describe("config flows to sources", () => {
  it("reddit briefing({ subreddits: ['macapps'] }) requests /r/macapps", async () => {
    const calls = [];
    vi.doMock("../apis/utils/fetch.mjs", () => ({
      safeFetch: vi.fn(async (url) => {
        calls.push(url);
        return { data: { children: [] } };
      }),
    }));
    vi.resetModules();
    const { briefing } = await import("../apis/sources/reddit.mjs");
    const result = await briefing(macApps.sources[2].config);
    // Pack config is subreddits ["macapps", "macOS"] → both are fetched.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((u) => u.includes("/r/macapps"))).toBe(true);
    expect(calls.some((u) => u.includes("/r/macOS"))).toBe(true);
    // No AI-default subreddits leak through when config is provided.
    expect(calls.every((u) => u.includes("/r/macapps") || u.includes("/r/macOS"))).toBe(true);
    expect(result.source).toBe("Reddit");
    expect(result.category).toBe("community");
  });

  it("hackernews briefing({ keywords }) keeps macOS titles and drops GPT titles", async () => {
    vi.doMock("../apis/utils/fetch.mjs", () => ({
      safeFetch: vi.fn(async (url) => {
        if (url.includes("topstories")) return [1, 2];
        if (url.includes("/item/1.json"))
          return { id: 1, title: "A new macOS app for notes", score: 5, by: "x", time: 1700000000 };
        if (url.includes("/item/2.json"))
          return { id: 2, title: "New GPT model released", score: 9, by: "y", time: 1700000000 };
        throw new Error(`unexpected ${url}`);
      }),
    }));
    vi.resetModules();
    const { briefing } = await import("../apis/sources/hackernews.mjs");
    const result = await briefing(macApps.sources[1].config);
    expect(result.items.map((i) => i.title)).toEqual([
      "A new macOS app for notes",
    ]);
    expect(result.source).toBe("Hacker News");
    expect(result.category).toBe("community");
  });
});

describe("prompt schema parity with the ai prompts", () => {
  it("analysis prompt keeps the exact JSON field names", () => {
    for (const field of [
      '"summary"',
      '"topStories"',
      '"headline"',
      '"significance"',
      '"category"',
      '"impact"',
      '"url"',
      '"trends"',
      '"modelRadar"',
      '"name"',
      '"org"',
      '"status"',
      '"note"',
      '"signals"',
      '"signal"',
      '"source"',
      '"confidence"',
    ]) {
      expect(macApps.prompts.analysis).toContain(field);
    }
    expect(macApps.prompts.analysis).toContain("macOS ecosystem");
  });

  it("digest prompt keeps the exact JSON field names", () => {
    for (const field of [
      '"weekOf"',
      '"tldr"',
      '"highlights"',
      '"title"',
      '"body"',
      '"category"',
      '"impact"',
      '"url"',
      '"modelUpdates"',
      '"name"',
      '"org"',
      '"summary"',
      '"paperPicks"',
      '"authors"',
      '"insight"',
      '"communityBuzz"',
      '"lookAhead"',
    ]) {
      expect(macApps.prompts.digest).toContain(field);
    }
    expect(macApps.prompts.digest).toContain("weekly digest");
  });
});

