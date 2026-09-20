// tests/editions-reader.test.mjs — Story 5.1: the editions main-column daily
// reader. No DOM/E2E harness exists (architecture §7), so this follows the
// source-scan convention of edition-card/radar-panel tests: it asserts the
// rendered-markup contract, the dispatch, the deferred-scope absences and the
// semantic-token CSS bindings without booting a browser.
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
  appjs.match(/function renderDailyEdition\(panel\)[\s\S]*?\n\}/)?.[0] ?? "";
const panelFn =
  appjs.match(/function dailyEditionPanel\(\)[\s\S]*?\n\}/)?.[0] ?? "";

describe("example pack daily-reader panel (AC1/AC3/AC6)", () => {
  const panel = example.panels.find((p) => p.variant === "edition");

  it("is an explicit main-column reader panel", () => {
    expect(panel).toMatchObject({
      id: "editions-reader",
      title: "daily edition",
      icon: "list",
      column: "main",
      variant: "edition",
    });
  });

  it("sits directly before the digest panel so the reader precedes the archive", () => {
    const ids = example.panels.map((p) => p.id);
    expect(ids.indexOf("editions-reader")).toBe(ids.indexOf("digest") - 1);
  });

  it("is listed in the editions view's panels", () => {
    const view = example.views.find((v) => v.id === "editions");
    expect(view.panels).toEqual(["editions-reader", "digest", "archive"]);
  });
});

describe("dailyEditionPanel resolution (AC7)", () => {
  it("finds the panel by the singular variant, never by a client panel-id literal", () => {
    expect(panelFn).toContain('p.variant === "edition"');
    expect(panelFn).not.toContain("editions-reader");
  });
});

describe("renderDailyEdition reader markup (AC1/AC2/AC3)", () => {
  it("resolves the body by panel id and reads the pure reader model", () => {
    expect(renderFn).toMatch(/document\.getElementById\("body-" \+ p\.id\)/);
    expect(renderFn).toMatch(
      /window\.RenderCore\.editionReaderModel\(lastEdition\)/,
    );
  });

  it("renders the masthead, sub-line, hairline, lede and top stories", () => {
    expect(renderFn).toContain("edition-masthead");
    expect(renderFn).toContain("edition-wordmark");
    expect(renderFn).toContain("edition-wordmark-green");
    expect(renderFn).toContain("edition-sub");
    expect(renderFn).toContain("07:00 cest");
    expect(renderFn).toContain('class="hairline"');
    expect(renderFn).toContain("edition-lede");
    expect(renderFn).toContain("edition-section-label");
    expect(renderFn).toContain("edition-stories");
    expect(renderFn).toContain("edition-story");
    expect(renderFn).toContain("edition-rank");
  });

  it("numbers rows with the 1-based index", () => {
    expect(renderFn).toMatch(/index|i\) =>|\.map\(\(s, i\)/);
    expect(renderFn).toMatch(/edition-rank">\$\{i \+ 1\}/);
  });

  it("renders the footer links and the signal count", () => {
    expect(renderFn).toContain("read in browser");
    expect(renderFn).toContain("signals condensed");
    expect(renderFn).toMatch(/href="\/newsletter\/\$\{esc\(m\.id\)\}"/);
    expect(renderFn).toContain('class="edition-share"');
  });

  it("offers an open archive link instead of in-app date navigation (AC3)", () => {
    expect(renderFn).toContain("open archive →");
    expect(renderFn).toMatch(/class="view-link" href="\/newsletter"/);
  });

  it("shows an honest empty state with a generation hint and no link (AC4)", () => {
    expect(renderFn).toMatch(/if \(!m\.present\)/);
    expect(renderFn).toContain(
      "no edition yet · generated automatically each morning (07:00 cest)",
    );
    // The archive link must live only in the present branch.
    const emptyBranch = renderFn.slice(
      renderFn.indexOf("if (!m.present)"),
      renderFn.indexOf("const stories"),
    );
    expect(emptyBranch).not.toContain("open archive");
    expect(emptyBranch).not.toContain("/newsletter");
  });

  it("routes every dynamic string through esc()", () => {
    expect(renderFn).toMatch(/esc\(m\.id\)/);
    expect(renderFn).toMatch(/esc\(m\.lede\)/);
    expect(renderFn).toMatch(/esc\(s\.title\)/);
    expect(renderFn).toMatch(/esc\(s\.body\)/);
    expect(renderFn).toMatch(/esc\(s\.url\)/);
    expect(renderFn).toMatch(/esc\(s\.category\)/);
    expect(renderFn).toMatch(/esc\(s\.impact\)/);
  });

  it("keeps the reader a document, never an internal scroll list", () => {
    expect(renderFn).toMatch(
      /body\.classList\.remove\("panel-body--scroll"\)/,
    );
  });

  it("shares via navigator.share, falls back to clipboard, never throws", () => {
    expect(renderFn).toContain("navigator.share");
    expect(renderFn).toContain("navigator.clipboard");
    expect(renderFn).toContain("location.origin");
  });
});

describe("renderPanel dispatch (AC1)", () => {
  const renderPanelFn =
    appjs.match(
      /function renderPanel\(panel, sources, byCategory\)[\s\S]*?\n\}/,
    )?.[0] ?? "";

  it("dispatches the singular edition variant before aggregate/select logic", () => {
    expect(renderPanelFn).toMatch(
      /if \(panel\.variant === "edition"\) \{\s*renderDailyEdition\(panel\);\s*return;\s*\}/,
    );
    const dispatchAt = renderPanelFn.indexOf('"edition"');
    const selectAt = renderPanelFn.indexOf("selectPanelItems");
    expect(dispatchAt).toBeGreaterThan(-1);
    expect(dispatchAt).toBeLessThan(selectAt);
  });
});

describe("reader data refresh (AC2/AC4)", () => {
  const fetchFn =
    appjs.match(/async function fetchEdition\(\)[\s\S]*?\n\}/)?.[0] ?? "";

  it("reuses the existing newsletter fetch and repaints the reader", () => {
    expect(fetchFn).toContain('fetch("/api/newsletter")');
    expect(fetchFn).toContain("Promise.allSettled");
    expect(fetchFn).toMatch(/renderDailyEdition\(\)/);
    expect(appjs).not.toContain("/api/editions");
  });

  it("repaints the reader on the newsletter SSE event", () => {
    expect(appjs).toMatch(
      /msg\.type === "newsletter"[\s\S]{0,120}lastEdition = msg\.data;[\s\S]{0,80}renderDailyEdition\(\)/,
    );
  });
});

describe("deferred scope stays deferred (AC6)", () => {
  it("renders no subscribe control, draft UI or weekday/date nav", () => {
    for (const forbidden of [
      "subscribe",
      "daysCollected",
      "weekday",
      "date-nav",
      "dateNav",
      "prevEdition",
      "nextEdition",
      "edition-nav",
    ]) {
      expect(appjs, forbidden).not.toContain(forbidden);
    }
  });
});

describe("reader CSS binds semantic tokens (AC5)", () => {
  it("gives the reader the --surface card", () => {
    const rule = css.match(/\.edition-reader\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toContain("background: var(--surface)");
    expect(rule).toContain("border-radius: 12px");
    expect(rule).toContain("padding: 30px 32px 34px");
  });

  it("binds the masthead, lede and hairlines to semantic tokens", () => {
    expect(css).toMatch(
      /\.edition-wordmark\s*\{[^}]*font-family: var\(--mono\)[^}]*color: var\(--ink\)/s,
    );
    expect(css).toMatch(
      /\.edition-wordmark-green\s*\{[^}]*color: var\(--green\)/s,
    );
    expect(css).toMatch(
      /\.edition-lede\s*\{[^}]*font-size: 20px[^}]*line-height: 1\.46[^}]*color: var\(--ink-2\)/s,
    );
    expect(css).toMatch(
      /\.edition-reader \.hairline\s*\{[^}]*border-top: 1px solid var\(--hairline\)/s,
    );
  });

  it("lays the numbered rows out 22px | 1fr with hairline separation", () => {
    expect(css).toMatch(
      /\.edition-story\s*\{[^}]*grid-template-columns: 22px 1fr[^}]*border-top: 1px solid var\(--hairline\)/s,
    );
    expect(css).toMatch(/\.edition-rank\s*\{[^}]*color: var\(--green\)/s);
  });

  it("never introduces a 1px reader card border", () => {
    const rule = css.match(/\.edition-reader\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).not.toContain("border:");
  });
});

describe("literal safety (architecture scan)", () => {
  it("keeps the plural view id out of both client files", () => {
    // Forbidden as a quoted literal; the archive's `persistence.editions`
    // field read and "no past editions yet" copy are not view-id hardcoding.
    const quoted = /["'`]editions["'`]/;
    expect(appjs).not.toMatch(quoted);
    expect(core).not.toMatch(quoted);
  });

  it("exports the reader helpers from the pure data layer", () => {
    expect(core).toContain("export function editionReaderModel(");
    expect(core).toContain("export function editionSignalCount(");
  });
});
