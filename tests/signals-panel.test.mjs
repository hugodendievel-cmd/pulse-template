// tests/signals-panel.test.mjs — Story 3.3: the signals card inside the
// today right rail (statement Sans 14 + `source · high confidence` with the
// confidence emphasised). No DOM/E2E harness exists (architecture §7), so this
// follows the source-scan convention of radar-panel.test.mjs: it asserts the
// rendered markup contract and the semantic-token CSS bindings without booting
// a browser.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const appjs = readFileSync(resolve(root, "dashboard/public/app.js"), "utf-8");
const css = readFileSync(resolve(root, "dashboard/public/style.css"), "utf-8");

describe("signal confidence whitelist (AC3)", () => {
  it("declares a fixed high/medium/low whitelist", () => {
    expect(appjs).toMatch(
      /const SIGNAL_CONFIDENCE_LEVELS = \["high", "medium", "low"\];/,
    );
  });
});

// Design 3a puts signals in their own rail card beside the radar, so the
// markup lives in buildSignalsHtml and the card's label is its panel header.
describe("buildSignalsHtml markup (AC1/AC3/AC4)", () => {
  const build = appjs.match(/function buildSignalsHtml[\s\S]*?\n\}/)?.[0] ?? "";

  it("emits signal markup only when signals exist", () => {
    expect(build).toMatch(/if \(signalEntries\.length\)/);
  });

  // Density is pack-declared: the design's rail carries a short signals list,
  // and an unbounded one made the rail outrun the main column.
  it("caps the list at the pack panel's limit", () => {
    expect(build).toMatch(
      /analysis\.signals \|\| \[\]\)\.slice\([\s\S]{0,60}panelLimitFor\("signals", Infinity\)/,
    );
  });

  it("emits a .signal-item per signal with statement and meta", () => {
    expect(build).toContain('<div class="signal-item">');
    expect(build).toContain('<div class="signal-statement">');
    expect(build).toContain('<div class="signal-meta">');
    expect(build).toContain('<span class="signal-source">');
    expect(build).toMatch(/<span class="signal-confidence \$\{conf\}">/);
    // design 3a: `source · confidence`
    expect(build).toContain("·");
  });

  it("falls back to low for an unknown confidence (never a raw class)", () => {
    expect(build).toMatch(
      /SIGNAL_CONFIDENCE_LEVELS\.includes\(s\.confidence\)[\s\S]{0,40}"low"/,
    );
    // The class/text come from the whitelisted value, never the item content.
    expect(build).toMatch(/esc\(conf\)/);
    expect(build).not.toMatch(/esc\(s\.confidence\)/);
  });

  it("links the statement externally when a url is present (AC4)", () => {
    expect(build).toMatch(/target="_blank" rel="noopener"/);
    expect(build).toMatch(/esc\(s\.url\)/);
    expect(build).toMatch(/esc\(s\.signal\)/);
    expect(build).toMatch(/s\.url\s*\?/);
  });

  it("routes every dynamic string through esc() (AC4)", () => {
    expect(build).toMatch(/esc\(s\.signal\)/);
    expect(build).toMatch(/esc\(s\.source\)/);
    expect(build).toMatch(/esc\(s\.url\)/);
    expect(build).toMatch(/esc\(conf\)/);
  });

  it("drops the legacy .signal-conf/.conf-*/.signal-text markup", () => {
    expect(build).not.toMatch(/signal-conf\b/);
    expect(build).not.toContain("conf-");
    expect(build).not.toContain("signal-text");
  });

  it("guards non-object entries so a malformed payload cannot abort the render", () => {
    expect(build).toMatch(
      /for \(const s of signalEntries\) \{\s*\n\s*if \(!s \|\| typeof s !== "object"\) continue;/,
    );
  });

  it("no longer folds signals into #radarCount", () => {
    expect(build).not.toContain('"radarCount"');
    const radar = appjs.match(/function buildRadarHtml[\s\S]*?\n\}/)?.[0] ?? "";
    expect(radar).not.toContain("analysis.signals");
  });
});

describe("renderBriefing signals visibility (AC2/AC5)", () => {
  const fn =
    appjs.match(/function renderBriefing\(analysis, d\)[\s\S]*?\n\}/)?.[0] ?? "";

  it("gives the signals card its own content-driven absence", () => {
    expect(fn).toMatch(
      /signalsPanel\?\.classList\.toggle\("panel-absent", !analysis\?\.signals\?\.length\)/,
    );
  });

  it("shows a signals-only analysis without the radar card", () => {
    expect(fn).toMatch(
      /radarPanel\.classList\.toggle\("panel-absent", !analysis\?\.modelRadar\?\.length\)/,
    );
    expect(fn).not.toMatch(/signalsPanel\.style\.display/);
  });

  it("renders the signals body from buildSignalsHtml", () => {
    expect(fn).toContain("signalsBody.innerHTML = buildSignalsHtml(analysis)");
  });
});

describe("signals CSS binds semantic tokens (AC1/AC3)", () => {
  it("lays out the item with a hairline divider, last item none", () => {
    const item = css.match(/\.signal-item\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(item).toContain("padding: 12px 0");
    expect(item).toContain("border-bottom: 1px solid var(--hairline)");
    expect(css).toMatch(/\.signal-item:last-child\s*\{[^}]*border-bottom: none/s);
  });

  it("styles the statement as Sans 14/1.5 in ink-2", () => {
    const statement =
      css.match(/\.signal-statement\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(statement).toContain("font-family: var(--font)");
    expect(statement).toContain("font-size: 14px");
    expect(statement).toContain("line-height: 1.5");
    expect(statement).toContain("color: var(--ink-2)");
  });

  it("styles the mono meta line and quiet source", () => {
    const meta = css.match(/\.signal-meta\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(meta).toContain("display: flex");
    expect(meta).toContain("gap: 8px");
    expect(meta).toContain("align-items: baseline");
    expect(meta).toContain("margin-top: 4px");
    expect(meta).toContain("font-family: var(--mono)");
    expect(meta).toContain("font-size: 11.5px");
    const source = css.match(/\.signal-source\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(source).toContain("color: var(--ink-4)");
  });

  it("keeps all three confidence levels distinct (AC3)", () => {
    const conf = css.match(/\.signal-confidence\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(conf).toContain("text-transform: uppercase");
    expect(conf).toContain("letter-spacing: 0.06em");
    expect(css).toMatch(
      /\.signal-confidence\.high\s*\{[^}]*color: var\(--amber-ink\)/s,
    );
    expect(css).toMatch(
      /\.signal-confidence\.medium\s*\{[^}]*color: var\(--ink-3\)/s,
    );
    expect(css).toMatch(
      /\.signal-confidence\.low\s*\{[^}]*color: var\(--ink-4\)/s,
    );
  });

  it("retires the legacy .signal-conf/.conf-*/.signal-text rules", () => {
    expect(css).not.toMatch(/\.signal-conf\s*\{/);
    expect(css).not.toMatch(/\.conf-high\s*\{/);
    expect(css).not.toMatch(/\.conf-medium\s*\{/);
    expect(css).not.toMatch(/\.conf-low\s*\{/);
    expect(css).not.toMatch(/\.signal-text\s*\{/);
  });

  it("reuses the shared .panel-absent rule instead of duplicating it", () => {
    expect(css.match(/\.panel\.panel-absent\s*\{/g) ?? []).toHaveLength(1);
  });
});
