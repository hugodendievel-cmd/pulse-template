// tests/today-fallback.test.mjs — Story 3.6: the `today` no-LLM fallback
// (analysis === null). No DOM/E2E harness exists (architecture §7), so this
// follows the source-scan + pure-import convention of the briefing/radar/
// streams tests: it asserts the pack contract, the pure ranking reuse, the
// note/empty-state wiring and the client literal guards without booting a
// browser. The view id `today` may appear here — tests/ is outside the client
// literal scan (architecture.test.mjs).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import example from "../domains/example.mjs";
import {
  aggregateByCategory,
  aggregateItems,
  viewPanels,
} from "../dashboard/public/render-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const appjs = readFileSync(resolve(root, "dashboard/public/app.js"), "utf-8");

const trendingPanel = example.panels.find((p) => p.id === "trending");
const newestPanel = example.panels.find((p) => p.id === "newest");

describe("no-LLM fallback panel selection (AC5)", () => {
  it("selects exactly the pack's fallbackPanels, in panels[] order", () => {
    expect(
      viewPanels(example.views, example.panels, "today", { fallback: true }).map(
        (p) => p.id,
      ),
    ).toEqual(["trending", "newest", "streams-preview", "editions-card"]);
  });

  it("drops the briefing and radar panels from the fallback list", () => {
    const ids = viewPanels(example.views, example.panels, "today", {
      fallback: true,
    }).map((p) => p.id);
    expect(ids).not.toContain("analysis");
    expect(ids).not.toContain("radar");
  });
});

describe("fallback sections reuse aggregateItems (AC1/AC6)", () => {
  // Sweep with engagement and dates in non-excluded categories (news/products).
  const engaged = {
    source: "Feed",
    status: "ok",
    data: {
      category: "news",
      items: [
        {
          title: "loud",
          url: "https://loud",
          score: 120,
          comments: 30,
          published: "2026-09-15T10:00:00Z",
        },
        { title: "quiet", url: "https://quiet", published: "2026-09-14T10:00:00Z" },
      ],
    },
  };
  // Empty-event corpus: no engagement and no dates anywhere.
  const bare = {
    source: "Feed",
    status: "ok",
    data: {
      category: "news",
      items: [
        { title: "no signals", url: "https://x" },
        { title: "still no signals", url: "https://y" },
      ],
    },
  };

  it("renders a trending and a newest section when items carry engagement/date", () => {
    const byCategory = aggregateByCategory([engaged]);
    // Two labelled sections, each backed by the pure ranking helper.
    expect(aggregateItems(trendingPanel, byCategory).length).toBeGreaterThanOrEqual(1);
    expect(aggregateItems(newestPanel, byCategory).length).toBeGreaterThanOrEqual(1);
  });

  it("drops non-engaged items from trending but keeps them in newest", () => {
    const byCategory = aggregateByCategory([engaged]);
    expect(aggregateItems(trendingPanel, byCategory).map((i) => i.title)).toEqual([
      "loud",
    ]);
    expect(
      aggregateItems(newestPanel, byCategory).map((i) => i.title),
    ).toEqual(["loud", "quiet"]);
  });

  it("returns both sections empty when nothing carries engagement or a date (AC6)", () => {
    const byCategory = aggregateByCategory([bare]);
    expect(aggregateItems(trendingPanel, byCategory)).toEqual([]);
    expect(aggregateItems(newestPanel, byCategory)).toEqual([]);
  });
});

describe("note + empty-state wiring (AC2/AC3/AC4)", () => {
  it("declares syncBriefingNote bound to the pack's noBriefingNote", () => {
    expect(appjs).toMatch(/function syncBriefingNote\(\)/);
    expect(appjs).toContain("noBriefingNote");
    expect(appjs).toContain("briefingNote");
    expect(appjs).toMatch(/note\.hidden = !show/);
    expect(appjs).toMatch(/note\.textContent = view\.noBriefingNote/);
  });

  it("syncs the note from renderBriefing and setView", () => {
    expect((appjs.match(/syncBriefingNote\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("renders an explicit empty state for empty aggregate panels (AC4)", () => {
    expect(appjs).toContain('class="panel-empty"');
    expect(appjs).toContain("no ranked items yet");
  });

  it("never forces panel display inline (visibility stays with setView)", () => {
    expect(appjs).not.toMatch(/analysisPanel\.style\.display|radarPanel\.style\.display/);
  });
});

describe("LLM path wins when analysis is present (AC2/AC5)", () => {
  it("gates fallback selection on a null analysis AND a declared fallbackPanels", () => {
    // Both panel loops (render and renderActiveView) must use the same gate, so
    // a view without fallbackPanels is never blanked and a present analysis
    // never falls back to the raw feed.
    const gate =
      "!data.analysis && Array.isArray(view?.fallbackPanels) ? { fallback: true } : {}";
    expect(appjs.split(gate).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("selects the full today panel list (briefing + radar) when not falling back", () => {
    const ids = viewPanels(example.views, example.panels, "today").map((p) => p.id);
    expect(ids).toContain("analysis");
    expect(ids).toContain("radar");
  });

  it("hides the note whenever analysis is present", () => {
    expect(appjs).toContain(
      "Boolean(view?.noBriefingNote) && !data?.analysis",
    );
  });

  it("creates exactly one briefingNote element (renders once)", () => {
    expect((appjs.match(/id="briefingNote"/g) ?? []).length).toBe(1);
  });
});

describe("panel-variant coverage", () => {
  it("has a client literal for every pack panel variant", () => {
    const variants = [...new Set(example.panels.map((p) => p.variant))];
    for (const variant of variants) {
      expect(appjs).toContain(`"${variant}"`);
    }
  });
});
