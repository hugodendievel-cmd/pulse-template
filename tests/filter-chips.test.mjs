// tests/filter-chips.test.mjs — Story 4.3: the streams filter bar (chips + sort).
// No DOM/E2E harness exists (architecture §7), so this follows the source-scan
// convention of source-card.test.mjs: it asserts the pure-helper wiring, the
// toolbar markup contract, session persistence and the semantic-token CSS
// bindings without booting a browser. View/source names may appear here — tests/
// is outside the client literal scan.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const appjs = readFileSync(resolve(root, "dashboard/public/app.js"), "utf-8");
const css = readFileSync(resolve(root, "dashboard/public/style.css"), "utf-8");

const fnBody = (name) =>
  appjs.match(new RegExp(`function ${name}\\([^)]*\\)[\\s\\S]*?\\n\\}`))?.[0] ?? "";

const setViewFn = fnBody("setView");
const applyVisibilityFn = fnBody("applyVisibility");
const applyCardOrderFn = fnBody("applyCardOrder");
const renderViewToolbarFn = fnBody("renderViewToolbar");
const setCategoryFilterFn = fnBody("setCategoryFilter");
const setStreamSortFn = fnBody("setStreamSort");
const renderSourcesPreviewFn = fnBody("renderSourcesPreview");

// Body of the first `@media (<query>) { … }` block (closes with `}` at col 0).
function mediaBlock(query) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    css.match(new RegExp(`@media\\s*\\(${escaped}\\)\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ??
    ""
  );
}

// Selector rule at the start of a line, tolerating extra comma selectors.
const rule = (sel) =>
  css.match(new RegExp(`(?:^|\\n)${sel}\\s*(?:,[^{]*)?\\{[^}]*\\}`, "s"))?.[0] ?? "";

describe("filter state and session persistence (AC3/AC4)", () => {
  it("declares state.filters with all/freshest defaults", () => {
    expect(appjs).toMatch(
      /filters:\s*\{\s*category:\s*"all",\s*sort:\s*"freshest"\s*\}/,
    );
  });

  it("knows the four sort options with freshest as the default", () => {
    expect(appjs).toMatch(
      /SORT_OPTIONS\s*=\s*\[\s*"freshest",\s*"engagement",\s*"name",\s*"status"\s*\]/,
    );
  });

  it("persists with sessionStorage under keys free of a view-id substring", () => {
    expect(appjs).toContain("sessionStorage.setItem");
    expect(appjs).toContain("sessionStorage.getItem");
    expect(appjs).toContain('"pulse-filter-category"');
    expect(appjs).toContain('"pulse-sort"');
    for (const id of ["today", "streams", "editions"]) {
      const keys = appjs
        .match(/["'`]ai-pulse-[a-z-]+["'`]/g)
        ?.map((k) => k.replace(/["'`]/g, "")) ?? [];
      for (const key of keys) expect(key).not.toContain(id);
    }
  });

  it("restores + validates both filters from sessionStorage", () => {
    expect(appjs).toMatch(/function (restoreFilters|loadFilterState)\(/);
    const restore = appjs.match(
      /function (?:restoreFilters|loadFilterState)\([^)]*\)[\s\S]*?\n\}/,
    )?.[0];
    expect(restore).toContain("sessionStorage.getItem");
    expect(restore).toContain("SORT_OPTIONS.includes");
  });
});

describe("renderViewToolbar markup (AC1/AC7)", () => {
  it("is gated on view.sections (pack data), not a view-id literal", () => {
    expect(appjs).toContain("function renderViewToolbar(view)");
    expect(renderViewToolbarFn).toMatch(/view\?\.sections|view\.sections/);
    expect(renderViewToolbarFn).toMatch(/Array\.isArray\(view\?\.sections\)/);
  });

  it("renders all + one chip per pack section into .view-toolbar", () => {
    expect(renderViewToolbarFn).toMatch(/"all",\s*\.\.\.view\.sections/);
    expect(renderViewToolbarFn).toContain('class="view-toolbar"');
    expect(renderViewToolbarFn).toMatch(/class="filter-chip/);
    expect(renderViewToolbarFn).toMatch(/data-cat="\$\{esc\(cat\)\}"/);
  });

  it("marks the active chip with .active", () => {
    expect(renderViewToolbarFn).toMatch(/cat === state\.filters\.category/);
    expect(renderViewToolbarFn).toContain('" active"');
  });

  it("seeds a #streamSort select from state.filters.sort", () => {
    expect(renderViewToolbarFn).toMatch(/id="streamSort"/);
    expect(renderViewToolbarFn).toMatch(/s === state\.filters\.sort/);
    expect(renderViewToolbarFn).toContain('" selected"');
  });

  it("inserts the bar as the view's first child (grid-column 1/-1)", () => {
    expect(renderViewToolbarFn).toContain("afterbegin");
  });
});

describe("category filter (AC2)", () => {
  it("setCategoryFilter updates state, persists and repaints", () => {
    expect(appjs).toContain("function setCategoryFilter(cat)");
    expect(setCategoryFilterFn).toMatch(/state\.filters\.category = cat/);
    expect(setCategoryFilterFn).toMatch(/persistFilter\(FILTER_CATEGORY_KEY/);
    expect(setCategoryFilterFn).toMatch(/classList\.toggle\("active"/);
    expect(setCategoryFilterFn).toContain("applyVisibility()");
    // The order must be recomputed for the newly visible subset: a sort chosen
    // while another category was active only ordered that category, so clearing
    // or changing the chip must re-run the sort over the revealed cards.
    expect(setCategoryFilterFn.indexOf("applyVisibility()")).toBeLessThan(
      setCategoryFilterFn.indexOf("applyCardOrder()"),
    );
  });

  it("applyVisibility keeps only matching source cards, exempting chrome", () => {
    expect(appjs).toContain("function applyVisibility(");
    expect(applyVisibilityFn).toMatch(
      /panel\.dataset\.section === category/,
    );
    expect(applyVisibilityFn).toMatch(
      /!panel\.classList\.contains\("source-card"\)/,
    );
    expect(applyVisibilityFn).toMatch(/category === "all"/);
    expect(applyVisibilityFn).toMatch(/panel\.style\.display = visible \? "" : "none"/);
  });

  it("setView delegates visibility to applyVisibility (single authority)", () => {
    expect(setViewFn).toContain("applyVisibility()");
    expect(setViewFn).toContain("renderViewToolbar(");
    // The old inline membership display loop must be gone from setView.
    expect(setViewFn).not.toMatch(
      /panel\.style\.display = members\.has\(panel\.dataset\.panelId\)/,
    );
  });
});

describe("sort ordering (AC3/AC4)", () => {
  it("setStreamSort validates, persists and reorders", () => {
    expect(appjs).toContain("function setStreamSort(sort)");
    expect(setStreamSortFn).toContain("SORT_OPTIONS.includes(sort)");
    expect(setStreamSortFn).toMatch(/persistFilter\(FILTER_SORT_KEY/);
    expect(setStreamSortFn).toContain("applyCardOrder()");
  });

  it("applyCardOrder delegates to RenderCore.sortSourceCards over visible cards", () => {
    expect(appjs).toContain("function applyCardOrder(");
    expect(applyCardOrderFn).toMatch(
      /window\.RenderCore\.sortSourceCards\(/,
    );
    expect(applyCardOrderFn).toMatch(/state\.filters\.sort/);
    expect(applyCardOrderFn).toMatch(/\.style\.order\s*=/);
    expect(applyCardOrderFn).toContain(".panel.source-card");
  });

  it("re-applies toolbar, visibility and order after a sweep render", () => {
    const applyDataFn = fnBody("applyData");
    expect(applyDataFn).toContain("applyCardOrder()");
  });
});

describe("preview stays filter-independent (AC5)", () => {
  it("renderSourcesPreview reads the raw sweep and never the filter state", () => {
    expect(renderSourcesPreviewFn).toContain("previewSources(sources");
    expect(renderSourcesPreviewFn).not.toContain("filters");
    expect(renderSourcesPreviewFn).not.toContain("applyVisibility");
  });
});

describe("toolbar CSS binds semantic tokens (AC1)", () => {
  it("lays the bar across the whole grid with --strip chrome", () => {
    const bar = rule("\\.view-toolbar");
    expect(bar).toContain("grid-column: 1 / -1");
    expect(bar).toContain("display: flex");
    expect(bar).toContain("background: var(--strip)");
  });

  it("styles chips on --inset and the active chip filled with --ink", () => {
    expect(rule("\\.filter-chip")).toContain("background: var(--inset)");
    expect(rule("\\.filter-chip")).toContain("border-radius: 999px");

    const active = rule("\\.filter-chip\\.active");
    expect(active).toContain("background: var(--ink)");
    expect(active).toContain("color: var(--paper)");
  });

  it("styles the sort control on the right", () => {
    expect(rule("\\.view-toolbar \\.sort")).toContain("margin-left: auto");
    expect(rule("\\.view-toolbar select")).toContain("background: var(--inset)");
  });

  it("gives chips a visible focus state", () => {
    expect(css).toMatch(/\.filter-chip:focus-visible\s*\{[^}]*outline:/);
  });

  it("uses compact wrapping pills below 900px, not a squeezed 44px square", () => {
    // The old square 44x44 touch rule turned the one-word `all` chip into a
    // circle and squeezed `research`/`community` to ellipses in one row.
    const blocks = [
      ...css.matchAll(/@media\s*\(max-width:\s*899px\)\s*\{([\s\S]*?)\n\}/g),
    ].map((m) => m[1]);
    const last = blocks[blocks.length - 1] ?? "";
    expect(last).toMatch(/\.filter-chip\s*\{[^}]*min-width:\s*0/);
    expect(last).toMatch(/\.filter-chip\s*\{[^}]*min-height:\s*34px/);
    expect(last).toMatch(/\.view-toolbar\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});
