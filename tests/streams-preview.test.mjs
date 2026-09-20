// tests/streams-preview.test.mjs — Story 3.5: the today streams preview
// (up to 4 source cards + an "open streams →" action). No DOM/E2E harness
// exists (architecture §7), so this follows the source-scan convention of the
// edition-card/radar-panel tests: it asserts the pack contract, the pure
// helper wiring, the rendered-markup contract and the semantic-token CSS
// bindings without booting a browser. The word "streams" is a pack/view id and
// may appear here (tests/ is outside the client literal scan).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import example from "../domains/example.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const appjs = readFileSync(resolve(root, "dashboard/public/app.js"), "utf-8");
const css = readFileSync(resolve(root, "dashboard/public/style.css"), "utf-8");
const core = readFileSync(
  resolve(root, "dashboard/public/render-core.mjs"),
  "utf-8",
);

const renderFn =
  appjs.match(/function renderSourcesPreview\(panel, sources\)[\s\S]*?\n\}/)?.[0] ??
  "";
const renderPanelFn =
  appjs.match(/function renderPanel\(panel, sources, byCategory\)[\s\S]*?\n\}/)?.[0] ??
  "";

describe("example pack streams-preview panel (AC1/AC2)", () => {
  const panel = example.panels.find((p) => p.variant === "sources-preview");

  it("is a main-column preview targeting the pack's own sources view", () => {
    expect(panel).toMatchObject({
      id: "streams-preview",
      title: "streams",
      icon: "articles",
      section: "briefing",
      variant: "sources-preview",
      limit: 12,
      target: "streams",
      actionLabel: "open streams →",
    });
  });

  it("sits after newest and directly before editions-card", () => {
    // Story 4.2 inserted the newswires/googlenews panels between `newest` and
    // this panel, so only the relative order is contracted (not adjacency).
    const ids = example.panels.map((p) => p.id);
    expect(ids.indexOf("streams-preview")).toBeGreaterThan(ids.indexOf("newest"));
    expect(ids.indexOf("editions-card")).toBe(ids.indexOf("streams-preview") + 1);
  });

  it("is not railed (no column override)", () => {
    expect(panel).not.toHaveProperty("column");
  });
});

describe("renderSourcesPreview markup (AC1/AC2/AC3/AC4/AC5)", () => {
  it("resolves the body and count elements from the panel id", () => {
    expect(renderFn).toMatch(
      /document\.getElementById\("body-" \+ panel\.id\)/,
    );
    expect(renderFn).toMatch(/document\.getElementById\("count-" \+ panel\.id\)/);
  });

  it("derives rows from the pure helper, passing panel.limit through", () => {
    expect(renderFn).toMatch(
      /window\.RenderCore\.previewSources\(sources, panel\.limit \|\| 4\)/,
    );
    // The preview never consults the category aggregate (AC3).
    expect(renderFn).not.toContain("byCategory");
    expect(renderFn).not.toContain("state.filters");
  });

  it("shows an explicit empty state instead of a blank card (AC4)", () => {
    expect(renderFn).toContain('class="panel-empty"');
    expect(renderFn).toContain("no source activity yet");
    expect(renderFn).toMatch(/if \(rows\.length === 0\)/);
  });

  it("emits the preview grid as a source directory: name and count (AC1)", () => {
    expect(renderFn).toMatch(/class="preview-grid"/);
    expect(renderFn).toMatch(/class="preview-card"/);
    expect(renderFn).toMatch(/class="preview-source"/);
    expect(renderFn).toMatch(/class="preview-count"/);
    expect(renderFn).not.toMatch(/class="preview-headline"/);
  });

  // Each tile is a button into the destination view, not an outbound link to
  // one article: the reader wants the source, and the grid it lands on carries
  // the articles.
  it("makes each tile a button that jumps to that source (AC5)", () => {
    expect(renderFn).toMatch(
      /<button class="preview-card" type="button" data-source="\$\{esc\(r\.source\)\}"/,
    );
    expect(renderFn).toMatch(/jumpToSource\(panel\.target, card\.dataset\.source\)/);
    expect(renderFn).not.toContain("target=\"_blank\"");
  });

  it("never caps the directory with an internal scroll", () => {
    expect(renderFn).toMatch(/classList\.remove\("panel-body--scroll"\)/);
    expect(renderFn).not.toMatch(/classList\.toggle\("panel-body--scroll"/);
  });

  // Design 3a puts the action on the right of the label row, not below the
  // cards: the header's count slot carries it and becomes the link.
  it("renders the pack action label in the header, styled as a view link", () => {
    expect(renderFn).toMatch(/countEl\.textContent = panel\.actionLabel/);
    expect(renderFn).toMatch(/countEl\.classList\.add\("view-link"\)/);
  });

  it("labels the row `{title} · {n} sources` from live data (AC1)", () => {
    expect(renderFn).toMatch(/\$\{panel\.title\} \S+ \$\{total\} sources/);
  });

  it("routes the action to the pack target via setView, never a literal (AC2)", () => {
    expect(renderFn).toMatch(/setView\(panel\.target\)/);
    expect(renderFn).not.toContain('setView("streams")');
  });

  it("binds the header link once, never on every re-render", () => {
    expect(renderFn).toMatch(/!countEl\.dataset\.bound/);
    expect(renderFn).toMatch(/countEl\.dataset\.bound = "1"/);
  });
});

describe("renderPanel dispatch (AC1)", () => {
  it("returns to renderSourcesPreview before the aggregate/select logic", () => {
    expect(renderPanelFn).toMatch(
      /if \(panel\.variant === "sources-preview"\) \{\s*renderSourcesPreview\(panel, sources\);\s*return;\s*\}/,
    );
    const dispatchAt = renderPanelFn.indexOf('"sources-preview"');
    const selectAt = renderPanelFn.indexOf("selectPanelItems");
    expect(dispatchAt).toBeGreaterThan(-1);
    expect(dispatchAt).toBeLessThan(selectAt);
  });
});

describe("client literal safety (AC2)", () => {
  it("keeps the view-id vocabulary out of app.js and render-core.mjs", () => {
    expect(appjs).not.toContain("streams");
    expect(core).not.toContain("streams");
  });
});

describe("preview CSS binds semantic tokens (AC1)", () => {
  const rule = (sel) => css.match(new RegExp(`(?:^|\\n)\\.${sel}\\s*\\{[^}]*\\}`, "s"))?.[0] ?? "";

  it("lays the cards out in a 4-column grid (design 3a)", () => {
    const grid = rule("preview-grid");
    expect(grid).toContain("display: grid");
    expect(grid).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(grid).toContain("gap: 10px");
  });

  it("gives each tile the --surface treatment", () => {
    const card = rule("preview-card");
    expect(card).toContain("background: var(--surface)");
    expect(card).toContain("border-radius: 10px");
    expect(card).toContain("padding: 13px 14px");
    expect(card).toContain("display: flex");
    // Name and count share one baseline row, not a stacked card.
    expect(card).toContain("justify-content: space-between");
    expect(card).toContain("font-family: var(--mono)");
  });

  it("styles the source and count with mono/ink tokens", () => {
    expect(rule("preview-card")).toContain("color: var(--ink-2)");
    expect(rule("preview-count")).toContain("color: var(--green-ink)");
    // The name ellipsises rather than wrapping the tile taller.
    expect(rule("preview-source")).toContain("text-overflow: ellipsis");
  });

  it("gives the tile a hover state, since it is a control", () => {
    expect(css).toMatch(/\.preview-card:hover\s*\{[^}]*background: var\(--inset\)/s);
  });

  it("carries no headline rule now the tiles are a directory", () => {
    expect(css).not.toContain(".preview-headline");
  });

  it("styles the empty state with the mono ink token", () => {
    const empty = rule("panel-empty");
    expect(empty).toContain("font-family: var(--mono)");
    expect(empty).toContain("font-size: 12px");
    expect(empty).toContain("color: var(--ink-4)");
    expect(empty).toContain("padding: 14px 2px");
  });

  it("reuses the shared .view-link rule instead of redefining it", () => {
    const links = css.match(/(?:^|\n)\.view-link\s*\{/g) ?? [];
    expect(links).toHaveLength(1);
  });
});
