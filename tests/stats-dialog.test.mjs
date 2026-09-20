// tests/stats-dialog.test.mjs — the live pill's intelligence dialog.
//
// The dialog restores the pack's `stats` (articles/models/papers/repos) and the
// sweep freshness after the standing metrics strip was removed. Computation is
// pure (render-core); app.js only paints. There is no DOM harness, so the
// client wiring is asserted by source scan and the maths by direct import.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceCountsFor, freshness, statValue } from "../dashboard/public/render-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(
  resolve(__dirname, "../dashboard/public/index.html"),
  "utf-8",
);
const appjs = readFileSync(
  resolve(__dirname, "../dashboard/public/app.js"),
  "utf-8",
);

const src = (source, category, times) => ({
  source,
  status: "ok",
  data: {
    category,
    items: times.map((published, i) => ({ title: `${source} ${i}`, published })),
  },
});

describe("sourceCountsFor (stat sparkline data)", () => {
  it("filters to the stat's categories and ok sources only", () => {
    const bars = sourceCountsFor(
      { categories: ["news", "community"] },
      [
        src("Busy", "news", ["2026-09-17T10:00:00Z", "2026-09-17T11:00:00Z"]),
        src("Quiet", "community", ["2026-09-17T10:00:00Z"]),
        src("Code", "code", ["2026-09-17T10:00:00Z"]),
        { source: "Down", status: "error", data: { category: "news" } },
      ],
    );
    expect(bars).toEqual([
      { source: "Busy", count: 2 },
      { source: "Quiet", count: 1 },
    ]);
  });

  it("caps the bar count and tie-breaks by name for a stable order", () => {
    const sources = ["H", "G", "F", "E", "D", "C", "B", "A"].map((s) =>
      src(s, "news", ["2026-09-17T10:00:00Z"]),
    );
    const bars = sourceCountsFor({ categories: ["news"] }, sources, 6);
    expect(bars).toHaveLength(6);
    expect(bars.map((b) => b.source)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("returns no bars when the category has no items", () => {
    expect(sourceCountsFor({ categories: ["models"] }, [])).toEqual([]);
  });
});

describe("freshness (sweep age)", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");
  it("labels a fresh sweep and formats minutes", () => {
    const f = freshness([src("A", "news", ["2026-09-17T11:44:00Z"])], now);
    expect(f).toEqual({ minutes: 16, text: "16m", label: "very fresh" });
  });

  it("steps to hours and 'recent' past an hour", () => {
    const f = freshness([src("A", "news", ["2026-09-17T09:00:00Z"])], now);
    expect(f).toEqual({ minutes: 180, text: "3h", label: "recent" });
  });

  it("labels an old sweep 'aging'", () => {
    const f = freshness([src("A", "news", ["2026-09-16T12:00:00Z"])], now);
    expect(f.label).toBe("aging");
    expect(f.text).toBe("24h");
  });

  it("reports unknown rather than a false 'very fresh' when nothing is dated", () => {
    expect(freshness([src("A", "news", [])], now)).toEqual({
      minutes: null,
      text: "—",
      label: "unknown",
    });
  });
});

describe("statValue still drives the dialog rows", () => {
  it("counts and sub-lines each stat from the pack config", () => {
    const byCategory = {
      news: [{ pipeline: "text-generation" }, { pipeline: "text-generation" }],
    };
    const { value, sub } = statValue(
      {
        key: "models",
        categories: ["news"],
        sub: { type: "topValue", field: "pipeline", prefix: "Top: " },
      },
      byCategory,
    );
    expect(value).toBe(2);
    expect(sub).toBe("Top: text-generation");
  });
});

describe("wiring (source scan, no DOM harness)", () => {
  it("makes the live pill the dialog trigger without losing its live region", () => {
    expect(html).toMatch(/id="statsTrigger"[^>]*aria-haspopup="dialog"/);
    expect(html).toMatch(/id="statsTrigger"[^>]*aria-controls="statsDialog"/);
    // The status contract from Story 6.8/6.4 must survive the button change.
    expect(html).toMatch(
      /id="sourceCount"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="false"/,
    );
    expect(html).toMatch(/id="statsDialog"[^>]*aria-labelledby="statsTitle"/);
    // The old standing strip must not come back.
    expect(html).not.toContain('id="statsBar"');
  });

  it("paints the dialog from the pack's stats — no hardcoded metric names", () => {
    expect(appjs).toContain("function renderStatsDialog");
    expect(appjs).toContain("DOMAIN.stats");
    expect(appjs).toContain("RC.statValue(");
    expect(appjs).toContain("RC.sourceCountsFor(");
    expect(appjs).toContain("RC.freshness(");
    for (const label of ["Articles", "Models", "Papers", "Repos"]) {
      expect(appjs).not.toContain(label);
    }
  });

  it("anchors a non-modal popover under the pill and refreshes it on a sweep", () => {
    expect(html).toMatch(/class="stats-popover"/);
    expect(appjs).toContain('getElementById("statsDialog")');
    expect(appjs).toContain('classList.contains("open")');
    expect(appjs).toContain('classList.add("open")');
    // No native modal: it would centre itself and blur the page behind.
    expect(appjs).not.toContain("showModal");
    expect(appjs).toMatch(
      /classList\.contains\("open"\)\s*\)\s*renderStatsDialog\(\)/,
    );
  });

  it("overlays without a backdrop or blur (the page must stay crisp)", () => {
    const css = readFileSync(
      resolve(__dirname, "../dashboard/public/style.css"),
      "utf-8",
    );
    const popover = css.match(/\.stats-popover\s*\{[^}]*\}/)?.[0] ?? "";
    expect(popover).toMatch(/position:\s*absolute/);
    expect(popover).toMatch(/top:\s*calc\(100% \+ 10px\)/);
    expect(css).not.toContain(".stats-dialog::backdrop");
    expect(css).not.toMatch(/\.stats-popover[^}]*backdrop-filter/);
  });
});
