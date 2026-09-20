// tests/source-card.test.mjs — Story 4.1: the uniform source grid card.
// No DOM/E2E harness exists (architecture §7), so this follows the source-scan
// convention of the streams-preview/edition-card tests: it asserts the pack
// contract, the pure-helper wiring, the rendered-markup contract and the
// semantic-token CSS bindings without booting a browser. View/source names may
// appear here — tests/ is outside the client literal scan.
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

const renderPanelFn =
  appjs.match(/function renderPanel\(panel, sources, byCategory\)[\s\S]*?\n\}/)?.[0] ??
  "";
const renderSourceCardFn =
  appjs.match(
    /function renderSourceCard\(panel, sources, byCategory\)[\s\S]*?\n\}/,
  )?.[0] ?? "";

describe("example pack source-bound panels (AC1)", () => {
  const sourceBound = example.panels.filter(
    (p) => p.variant === "news" || p.variant === "cards",
  );

  it("declares cards/news panels to render as uniform cards", () => {
    const variants = sourceBound.map((p) => p.variant);
    expect(variants).toContain("news");
    expect(variants).toContain("cards");
    for (const p of sourceBound) {
      expect(["news", "cards"]).toContain(p.variant);
    }
  });
});

describe("buildDomainUI tags card frames (AC1)", () => {
  it("adds the source-card class only for news/cards variants", () => {
    expect(appjs).toMatch(
      /if \(p\.variant === "news" \|\| p\.variant === "cards"\) \{\s*extraClass \+= " source-card";\s*\}/,
    );
  });
});

describe("renderSourceCard markup (AC2/AC3/AC4/AC6)", () => {
  it("declares the 3-row display cap as a named constant", () => {
    // The cap is the panel's own pack `limit`, with CARD_ITEM_ROWS only as the
    // floor for a panel that declares none; the body scrolls internally past
    // six rather than growing the page (design 3b).
    expect(appjs).toMatch(/const CARD_ITEM_ROWS = \d+;/);
    expect(renderSourceCardFn).toContain("slice(0, panel.limit || CARD_ITEM_ROWS)");
  });

  it("derives stats from the pure helper, never a hardcoded count (AC6/NFR-6)", () => {
    expect(renderSourceCardFn).toMatch(
      /window\.RenderCore\.sourceCardStats\(panel, sources\)/,
    );
    expect(renderSourceCardFn).toMatch(
      /window\.RenderCore\.selectPanelItems\(panel, sources, byCategory\)/,
    );
  });

  it("reports the true total plus the last-fetch age (AC2/AC6)", () => {
    expect(renderSourceCardFn).toMatch(/countEl\.textContent = `\$\{stats\.count\} · \$\{age\}`/);
    expect(renderSourceCardFn).toMatch(
      /timeAgo\(stats\.lastFetch \|\| data\?\.sweep\?\.timestamp\)/,
    );
  });

  it("flags a slow fetch on the count (AC2)", () => {
    expect(renderSourceCardFn).toMatch(
      /countEl\.classList\.toggle\("slow", stats\.status === "slow"\)/,
    );
  });

  it("toggles the status on the frame and injects the dot once (AC2)", () => {
    expect(renderSourceCardFn).toMatch(/dataset\.status = stats\.status/);
    expect(renderSourceCardFn).toMatch(/class="src-dot"/);
    expect(renderSourceCardFn).toMatch(/querySelector\("\.src-dot"\)/);
    expect(renderSourceCardFn).toMatch(/insertAdjacentHTML\(\s*"afterbegin"/);
  });

  it("renders the 24h empty state, never a bare card (AC4)", () => {
    expect(renderSourceCardFn).toMatch(/if \(stats\.count === 0\)/);
    expect(renderSourceCardFn).toContain("no items in the last 24h · last ok");
    expect(renderSourceCardFn).toMatch(/class="panel-empty"/);
  });

  it("renders cards via cardHtmlFor and feeds via newsItemHtml (AC3)", () => {
    expect(renderSourceCardFn).toMatch(
      /panel\.variant === "cards" \? cardHtmlFor\(i\) : newsItemHtml\(i\)/,
    );
  });
});

describe("renderPanel dispatch (AC1)", () => {
  it("routes news/cards to renderSourceCard before the aggregate/select logic", () => {
    expect(renderPanelFn).toMatch(
      /if \(panel\.variant === "news" \|\| panel\.variant === "cards"\) \{\s*renderSourceCard\(panel, sources, byCategory\);\s*return;\s*\}/,
    );
    const dispatchAt = renderPanelFn.indexOf('"cards"');
    const selectAt = renderPanelFn.indexOf("selectPanelItems");
    expect(dispatchAt).toBeGreaterThan(-1);
    expect(dispatchAt).toBeLessThan(selectAt);
  });
});

describe("client literal safety (AC7)", () => {
  it("keeps the view/source vocabulary out of app.js and render-core.mjs", () => {
    // Forbidden as a quoted string literal (how hardcoding appears). The
    // archive's `persistence.editions` field read and "no past editions yet"
    // copy are not view-id hardcoding (Story 5.3).
    for (const id of ["today", "streams", "editions"]) {
      const quoted = new RegExp(`["'\`]${id}["'\`]`);
      expect(appjs).not.toMatch(quoted);
      expect(core).not.toMatch(quoted);
    }
  });
});

describe("source-card CSS binds semantic tokens (AC1/AC2/AC3)", () => {
  // Matches a selector at the start of its line, tolerating further
  // comma-separated selectors before the `{` (the snippet groups some rules).
  const rule = (sel) =>
    css.match(new RegExp(`(?:^|\\n)${sel}\\s*(?:,[^{]*)?\\{[^}]*\\}`, "s"))?.[0] ??
    "";

  it("gives the grid card the --surface chrome (r12, pad 18, gap 12)", () => {
    const card = rule('\\.view\\[data-layout="grid"\\] \\.panel\\.source-card');
    expect(card).toContain("background: var(--surface)");
    expect(card).toContain("border: none");
    expect(card).toContain("border-radius: 12px");
    expect(card).toContain("overflow: hidden");

    const header = rule(
      '\\.view\\[data-layout="grid"\\] \\.panel\\.source-card \\.panel-header',
    );
    expect(header).toContain("padding: 18px 18px 12px");
    expect(header).toContain("gap: 12px");
    expect(header).toContain("border-bottom: 1px solid var(--hairline)");

    const body = rule(
      '\\.view\\[data-layout="grid"\\] \\.panel\\.source-card \\.panel-body',
    );
    expect(body).toContain("padding: 0 18px 18px");
  });

  it("renders a 6px status dot that the panel status colours", () => {
    const dot = rule("\\.src-dot");
    expect(dot).toContain("width: 6px");
    expect(dot).toContain("height: 6px");
    expect(dot).toContain("border-radius: 50%");
    expect(dot).toContain("background: var(--idle)");

    expect(rule('\\.panel\\[data-status="ok"\\] \\.src-dot')).toContain(
      "background: var(--green)",
    );
    expect(rule('\\.panel\\[data-status="slow"\\] \\.src-dot')).toContain(
      "background: var(--amber-dot)",
    );
    expect(rule('\\.panel\\[data-status="error"\\] \\.src-dot')).toContain(
      "background: var(--amber-dot)",
    );
    expect(rule('\\.panel\\[data-status="idle"\\] \\.src-dot')).toContain(
      "background: var(--idle)",
    );
  });

  it("styles the mono name and count, amber when slow (AC2)", () => {
    const title = rule(
      '\\.view\\[data-layout="grid"\\] \\.panel\\.source-card \\.panel-title',
    );
    expect(title).toContain("font-family: var(--mono)");
    expect(title).toContain("font-size: 12.5px");
    expect(title).toContain("color: var(--ink-2)");
    // AC2: `count · last-fetch age` is right-aligned — the title flexes to push
    // the count to the right edge (the count also stops shrinking).
    expect(title).toContain("flex: 1");

    const count = rule(
      '\\.view\\[data-layout="grid"\\] \\.panel\\.source-card \\.panel-count',
    );
    expect(count).toContain("font-family: var(--mono)");
    expect(count).toContain("font-size: 11px");
    expect(count).toContain("color: var(--ink-4)");
    expect(count).toContain("margin-left: auto");
    expect(count).toContain("flex-shrink: 0");

    const slow = rule(
      '\\.view\\[data-layout="grid"\\] \\.panel\\.source-card \\.panel-count\\.slow',
    );
    expect(slow).toContain("color: var(--amber-ink)");
  });

  it("styles item titles and meta, and green-ink repo/model names (AC3)", () => {
    const title = rule(
      '\\.view\\[data-layout="grid"\\] \\.panel\\.source-card \\.news-title',
    );
    expect(title).toContain("font-family: var(--font)");
    expect(title).toContain("font-size: 14px");
    expect(title).toContain("line-height: 1.4");

    const meta = rule(
      '\\.view\\[data-layout="grid"\\] \\.panel\\.source-card \\.news-meta',
    );
    expect(meta).toContain("font-family: var(--mono)");
    expect(meta).toContain("font-size: 11px");
    expect(meta).toContain("color: var(--ink-4)");

    const repo = rule(
      '\\.view\\[data-layout="grid"\\] \\.panel\\.source-card \\.repo-name a',
    );
    expect(repo).toContain("font-family: var(--mono)");
    expect(repo).toContain("font-size: 12.5px");
    expect(repo).toContain("color: var(--green-ink)");

    const model = rule(
      '\\.view\\[data-layout="grid"\\] \\.panel\\.source-card \\.model-name a',
    );
    expect(model).toContain("color: var(--green-ink)");
  });

  // The base .panel now carries the design's flat-surface treatment: the
  // handoff is explicit that panels have no 1px border and that separation
  // comes from surface tint plus hairline row dividers.
  it("gives every panel the flat surface, not a bordered card", () => {
    expect(css).toMatch(/(?:^|\n)\.panel\s*\{[^}]*background: var\(--surface\)/s);
    expect(css).toMatch(/(?:^|\n)\.panel\s*\{[^}]*border: none/s);
    expect(css).toMatch(/(?:^|\n)\.panel\s*\{[^}]*border-radius: 12px/s);
    expect(css).not.toMatch(
      /(?:^|\n)\.panel-header\s*\{[^}]*border-bottom: 1px solid/s,
    );
    // Story 4.5 keeps collapse; do not remove it here.
    expect(css).toMatch(/\.panel\.collapsed \.panel-body\s*\{/);
  });
});
