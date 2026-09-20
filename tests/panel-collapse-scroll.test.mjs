// tests/panel-collapse-scroll.test.mjs — Story 4.5: collapsible panels with
// internal scroll (design-reference 3b). No DOM/E2E harness exists
// (architecture §7), so this is a pure readFileSync source scan: the CSS
// opt-in scroll rule and the client collapse/scroll contract are asserted
// without booting a browser. View/source names must not appear here — the
// tests/architecture.test.mjs literal scan owns that invariant.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(
  resolve(__dirname, "../dashboard/public/style.css"),
  "utf-8",
);
const appjs = readFileSync(
  resolve(__dirname, "../dashboard/public/app.js"),
  "utf-8",
);

// Body of a `function name(args) { … }` declaration; the non-greedy `\n\}`
// boundary is exact because nested blocks close with indentation.
function fn(name, args = "") {
  return (
    appjs.match(
      new RegExp(`function ${name}\\(${args}\\)[\\s\\S]*?\\n\\}`),
    )?.[0] ?? ""
  );
}

// A single top-level CSS rule body.
function cssRule(selector) {
  return (
    css.match(new RegExp(`(?:^|\\n)${selector}\\s*\\{[^}]*\\}`, "s"))?.[0] ?? ""
  );
}

describe("internal scroll is opt-in at >=6 rendered rows (AC1)", () => {
  it("declares .panel-body--scroll with a capped, scrollable body", () => {
    const rule = cssRule("\\.panel-body--scroll");
    expect(rule).toContain("max-height: 320px");
    expect(rule).toContain("overflow-y: auto");
  });

  it("drops the permanent max-height from the base .panel-body", () => {
    const base = cssRule("\\.panel-body");
    expect(base).toContain("padding: 8px 18px 16px");
    expect(base).toContain("flex: 1");
    expect(base).toContain("min-height: 0");
    expect(base).not.toContain("max-height: 460px");
    expect(base).not.toContain("overflow-y: auto");
    // No other blanket `.panel-body { max-height }` re-imposes the cap.
    expect(css).not.toMatch(/\.panel-body\s*\{[^}]*max-height/);
  });

  it("keeps the scrollbar rules on .panel-body", () => {
    expect(css).toContain(".panel-body::-webkit-scrollbar");
    expect(css).toContain(".panel-body::-webkit-scrollbar-track");
    expect(css).toContain(".panel-body::-webkit-scrollbar-thumb");
  });

  it("no other same-specificity rule frees a panel body from the cap", () => {
    // `.digest-body` used to set `max-height: none` to escape the old blanket
    // cap; with equal specificity it would win over `.panel-body--scroll` and
    // defeat internal scroll on the digest. Guard against its return.
    expect(css).not.toMatch(/\.digest-body\s*\{[^}]*max-height/);
  });

  it("keeps the tall-screen override opt-in", () => {
    const block =
      css.match(/@media\s*\(min-width:\s*1600px\)\s*\{([\s\S]*?)\n\}/)?.[1] ??
      "";
    expect(block).toMatch(/\.panel-body--scroll\s*\{[^}]*max-height:\s*640px/);
  });

  it("toggles the scroll class on the rendered row count, threshold 6", () => {
    expect(appjs).toContain(
      'classList.toggle("panel-body--scroll", renderedCount >= 6)',
    );
  });

  it("applies the rule in every body-writing branch (uniform)", () => {
    for (const [name, args] of [
      ["renderPanel", "panel, sources, byCategory"],
      ["renderSourceCard", "panel, sources, byCategory"],
      ["renderSourcesPreview", "panel, sources"],
      ["renderEditionCard", "panel"],
      ["renderDigest", "digest"],
    ]) {
      expect(fn(name, args), `${name} must manage the scroll class`).toContain(
        "panel-body--scroll",
      );
    }
  });

  it("does not cap the source cards (Story 4.1 caps them at 3 rows)", () => {
    // The card branch derives its count from the sliced, displayed rows.
    expect(fn("renderSourceCard", "panel, sources, byCategory")).toContain(
      ".slice(0, panel.limit || CARD_ITEM_ROWS)",
    );
  });
});

describe("collapse persistence contract (AC2/AC3/AC4)", () => {
  it("keeps initPanelCollapse with the localStorage key and helpers", () => {
    expect(appjs).toContain("function initPanelCollapse()");
    expect(appjs).toContain("pulse-collapsed");
    expect(appjs).toMatch(/function getCollapsed\(\)/);
    expect(appjs).toMatch(/function saveCollapsed\(ids\)/);
  });

  it("keeps the injected chevron and injects it idempotently on re-init", () => {
    expect(appjs).toContain("panel-toggle");
    expect(appjs).toContain('if (!header.querySelector(".panel-toggle"))');
  });

  it("keeps the header click toggling the persisted set", () => {
    expect(appjs).toMatch(
      /panel\.classList\.toggle\("collapsed"\)/,
    );
    expect(appjs).toContain("saveCollapsed(collapsed)");
  });

  // Design 3a's header carries no collapse-all control, so `C` owns the
  // behaviour directly instead of clicking a button that no longer exists.
  it("keeps collapse-all as a keyboard-only affordance", () => {
    expect(appjs).toContain("let toggleAllPanels = ()");
    expect(appjs).toContain("toggleAllPanels = () =>");
    expect(appjs).not.toContain("collapseAllBtn");
  });

  it("binds the C shortcut straight to collapse-all", () => {
    expect(appjs).toMatch(
      /e\.key === "c"[\s\S]{0,80}toggleAllPanels\(\)/,
    );
  });

  it("still toggles every visible panel together", () => {
    const fn = appjs.match(/toggleAllPanels = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
    expect(fn).toContain('p.style.display !== "none"');
    expect(fn).toContain('classList.contains("collapsed")');
    expect(fn).toContain("saveCollapsed(collapsed)");
  });

  it("keeps collapsed panels hidden (class-driven, composes with view visibility)", () => {
    expect(cssRule("\\.panel\\.collapsed \\.panel-body")).toContain(
      "display: none",
    );
    // No assertion on a header divider: design cards carry none to begin with.
  });

  it("keeps the grid source-card body padding override (orthogonal)", () => {
    expect(
      cssRule('\\.view\\[data-layout="grid"\\] \\.panel\\.source-card \\.panel-body'),
    ).toContain("padding: 0 18px 18px");
  });
});

describe("filters and sorting never reset collapse (AC4)", () => {
  it("applyVisibility only toggles display/order", () => {
    const body = fn("applyVisibility");
    expect(body).not.toContain("collapsed");
  });

  it("applyCardOrder only toggles display/order", () => {
    const body = fn("applyCardOrder");
    expect(body).not.toContain("collapsed");
  });

  it("setCategoryFilter never touches the collapsed class", () => {
    const body = fn("setCategoryFilter", "cat");
    expect(body).not.toContain("collapsed");
  });
});
