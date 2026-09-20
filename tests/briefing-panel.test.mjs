// tests/briefing-panel.test.mjs — Story 3.1: the landing view's briefing band
// (label row, lede, emerging trends, top-story rows). No DOM/E2E harness exists
// (architecture §7), so this follows the source-scan convention of
// domain-endpoint.test.mjs: it asserts the rendered markup contract and the
// semantic-token CSS bindings without booting a browser.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const appjs = readFileSync(resolve(root, "dashboard/public/app.js"), "utf-8");
const css = readFileSync(resolve(root, "dashboard/public/style.css"), "utf-8");

describe("renderBriefing wiring (AC1/AC3)", () => {
  it("renames renderAnalysis to renderBriefing(analysis, d)", () => {
    expect(appjs).toMatch(/function renderBriefing\(analysis, d\)/);
    expect(appjs).not.toMatch(/function renderAnalysis\(/);
  });

  it("applyData passes the analysis and the sweep envelope", () => {
    expect(appjs).toMatch(/renderBriefing\(d\.analysis, d\)/);
    expect(appjs).toMatch(/function applyData\(nextData\)/);
  });

  it("early-returns when analysis is absent", () => {
    expect(appjs).toMatch(/function renderBriefing\(analysis, d\)\s*\{[\s\S]*?if \(!analysis\)/);
  });

  it("does not write the quiet no-LLM note here (Story 3.6 owns it)", () => {
    const fn = appjs.match(/function renderBriefing[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).not.toContain("panel-hint");
    expect(fn).not.toContain("briefing disabled");
  });

  it("sets #analysisProvider to the model or an empty string", () => {
    expect(appjs).toMatch(/analysisProvider/);
    expect(appjs).toMatch(/analysis\.model \|\| analysis\.provider \|\| ""/);
  });

  it("never forces panel display (visibility stays with setView)", () => {
    expect(appjs).not.toMatch(/analysisPanel\.style\.display/);
    expect(appjs).not.toMatch(/radarPanel\.style\.display/);
  });

  it("takes the briefing/radar frames away when there is nothing to show (AC3)", () => {
    // Clearing the body is not enough: the empty card frame would still show.
    expect(appjs).toMatch(
      /briefPanel\.classList\.toggle\("panel-absent", !analysis\)/,
    );
    // Signals moved to their own rail card (design 3a), so each frame is
    // driven by its own content.
    expect(appjs).toMatch(
      /radarPanel\.classList\.toggle\("panel-absent", !analysis\?\.modelRadar\?\.length\)/,
    );
    expect(appjs).toMatch(
      /signalsPanel\?\.classList\.toggle\("panel-absent", !analysis\?\.signals\?\.length\)/,
    );
    expect(css).toMatch(/\.panel\.panel-absent\s*\{[^}]*display: none/s);
  });
});

describe("esc() escaping (AC4)", () => {
  const fn = appjs.match(/function esc\(s\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

  it("escapes &, <, > and double quotes (attribute context)", () => {
    expect(fn).toContain('replace(/&/g, "&amp;")');
    expect(fn).toContain('replace(/</g, "&lt;")');
    expect(fn).toContain('replace(/>/g, "&gt;")');
    // DOM text serialization leaves quotes alone, so esc() must add them.
    expect(fn).toContain('replace(/"/g, "&quot;")');
  });
});

describe("buildBriefingHtml markup (AC1/AC2/AC4/AC5)", () => {
  const build = appjs.match(/function buildBriefingHtml[\s\S]*?\n\}/)?.[0] ?? "";

  it("emits the label row with date and by-line", () => {
    expect(build).toContain("briefing-head");
    expect(build).toContain("briefing-label");
    expect(build).toContain("briefing · ");
    expect(build).toContain("briefing-by");
    expect(build).toContain("summarized by ");
  });

  it("derives the date from generatedAt, falling back to the sweep timestamp", () => {
    expect(build).toMatch(/generatedAt[\s\S]{0,40}sweep\?\.timestamp/);
    expect(build).toMatch(
      /toLocaleDateString\(undefined,\s*\{\s*day: "numeric",\s*month: "short",?\s*\}\)/s,
    );
  });

  it("falls back from model to provider for the by-line (AC5)", () => {
    expect(build).toMatch(/analysis\.model \|\| analysis\.provider/);
  });

  // today is a headline screen, so the lede is a one-sentence deck, not the
  // multi-sentence briefing it used to be: the pack prompt caps it and the CSS
  // clamps it so a long generation cannot push the headlines down the page.
  it("emits the lede as a deck above the headline list", () => {
    expect(build).toContain("analysis-summary");
    expect(build).toMatch(/esc\(analysis\.summary\)/);
    const idx = build.indexOf("analysis-summary");
    expect(idx).toBeLessThan(build.indexOf("emerging trends"));
  });

  it("emits up to three trend rows with dots", () => {
    expect(build).toMatch(/analysis\.trends\?\.slice\(0, 3\) \?\? \[\]/);
    expect(build).toContain("trend-item");
    expect(build).toContain("trend-dot");
    expect(build).toContain("emerging trends");
    expect(build).toContain("top stories");
  });

  it("emits ranked story rows with a dimmed 4th+ numeral (AC2)", () => {
    expect(build).toContain("story-row");
    expect(build).toContain("story-rank");
    expect(build).toContain("story-rank--dim");
    expect(build).toMatch(/index >= 3/);
  });

  it("emits headline, significance and the conditional chips (AC2)", () => {
    expect(build).toContain("story-headline");
    expect(build).toContain("story-why");
    expect(build).toContain("chip chip-category");
    expect(build).toContain("chip chip-impact");
    expect(build).toContain("high impact");
    expect(build).toMatch(/impact === "high"/);
    expect(build).toContain("chip chip-rumor");
    expect(build).toContain("rumor");
    expect(build).toMatch(/category === "rumor"/);
  });

  it("links the headline externally and escapes every dynamic string (AC4)", () => {
    expect(build).toMatch(/target="_blank" rel="noopener"/);
    expect(build).toMatch(/esc\(s\.url\)/);
    expect(build).toMatch(/esc\(s\.headline\)/);
    expect(build).toMatch(/esc\(s\.significance\)/);
  });
});

describe("briefing CSS binds semantic tokens (Story 3.1)", () => {
  it("styles the label row from mono and ink tokens", () => {
    expect(css).toMatch(/\.briefing-head\s*\{[^}]*font-family: var\(--mono\)[^}]*font-size: 11\.5px/s);
    expect(css).toMatch(/\.briefing-label\s*\{[^}]*color: var\(--green-ink\)/s);
    expect(css).toMatch(/\.briefing-by\s*\{[^}]*color: var\(--ink-4\)/s);
  });

  it("styles the lede as the day's hero title", () => {
    const lede = css.match(/\.analysis-summary\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(lede).toContain("font-size: 30px");
    expect(lede).toContain("font-weight: 500");
    expect(lede).toContain("color: var(--ink)");
    // It dominates the screen but is still capped, whatever the model returns.
    expect(lede).toContain("-webkit-line-clamp: 3");
  });

  it("styles trends and the dot", () => {
    const trend = css.match(/\.trend-item\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(trend).toContain("display: flex");
    // baseline, so a clamped one-line trend still sits on the dot's line
    expect(trend).toContain("align-items: baseline");
    expect(trend).toContain("gap: 9px");
    expect(trend).toContain("font-size: 14px");
    expect(trend).toContain("color: var(--ink-2)");
    const dot = css.match(/\.trend-dot\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(dot).toContain("background: var(--green)");
  });

  it("styles the story row grid and hairline divider", () => {
    const row = css.match(/\.story-row\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(row).toContain("display: grid");
    // Design 3a: rank | body | source-age/score, right-aligned.
    expect(row).toContain("grid-template-columns: 30px minmax(0, 1fr) 96px");
    expect(row).toContain("gap: 16px");
    expect(row).toContain("padding: 12px 8px");
    expect(row).toContain("border-bottom: 1px solid var(--hairline)");
    expect(css).toMatch(/\.story-row:last-child\s*\{[^}]*border-bottom: none/s);
  });

  it("styles the rank numerals", () => {
    const rank = css.match(/\.story-rank\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rank).toContain("font-family: var(--mono)");
    expect(rank).toContain("font-size: 18px");
    expect(rank).toContain("font-weight: 700");
    expect(rank).toContain("color: var(--green)");
    expect(css).toMatch(/\.story-rank--dim\s*\{[^}]*color: var\(--green-soft\)/s);
  });

  it("styles headline, why and chips", () => {
    const headline = css.match(/\.story-headline\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(headline).toContain("font-size: 17.5px");
    expect(headline).toContain("font-weight: 600");
    expect(css).toMatch(/\.story-why\s*\{[^}]*color: var\(--ink-3\)/s);
    expect(css).toMatch(/\.chip\s*\{[^}]*font-family: var\(--mono\)[^}]*text-transform: uppercase/s);
    expect(css).toMatch(/\.chip-category\s*\{[^}]*background: var\(--green-tint-2\)[^}]*color: var\(--green-ink\)/s);
    expect(css).toMatch(/\.chip-impact\s*\{[^}]*background: var\(--amber-tint\)[^}]*color: var\(--amber-ink\)/s);
    expect(css).toMatch(/\.chip-rumor\s*\{[^}]*background: var\(--inset\)[^}]*color: var\(--ink-4\)/s);
  });

  it("keeps the quiet panel-hint rule available for Story 3.6", () => {
    expect(css).toMatch(/\.panel-hint\s*\{/);
  });
});
