// tests/weekly-digest-page.test.mjs — the weekly digest as its own document
// page (GET /digest). The dashboard's rail card is a summary; the digest is a
// document, so it gets a page rather than expanding inside a 420px column.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderWeeklyDigestHtml } from "../lib/newsletter/render.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const server = readFileSync(resolve(root, "server.mjs"), "utf-8");
const appjs = readFileSync(resolve(root, "dashboard/public/app.js"), "utf-8");

const DIGEST = {
  weekId: "2026-W13",
  weekOf: "March 17–21, 2026",
  tldr: "A quiet week.",
  highlights: [
    { title: "Agents got real", body: "Tooling shipped.", category: "product", impact: "high", url: "https://example.com/a" },
  ],
  modelUpdates: [{ name: "M1", org: "Lab", summary: "Fast.", url: "https://example.com/m" }],
  paperPicks: [{ title: "P1", authors: "A. Author", insight: "Neat.", url: "https://example.com/p" }],
  communityBuzz: ["chatter"],
  lookAhead: "More agents.",
  generatedAt: "2026-03-22T10:00:00Z",
};

describe("GET /digest route", () => {
  it("serves the digest through the newsletter HTML sender", () => {
    expect(server).toMatch(/app\.get\("\/digest"/);
    expect(server).toMatch(/renderWeeklyDigestHtml\(digest, \{ brand: domain \?\? \{\} \}\)/);
  });

  it("reuses the existing loader — no new store or endpoint", () => {
    const route = server.match(/app\.get\("\/digest"[\s\S]*?\n\}\);/)?.[0] ?? "";
    expect(route).toContain("loadLatestDigest()");
  });

  it("answers 404 when no digest exists, still rendering a page", () => {
    const route = server.match(/app\.get\("\/digest"[\s\S]*?\n\}\);/)?.[0] ?? "";
    expect(route).toMatch(/digest \? 200 : 404/);
  });
});

describe("renderWeeklyDigestHtml", () => {
  const html = renderWeeklyDigestHtml(DIGEST, { brand: { name: "Pulse" } });

  it("mastheads as Weekly, not Daily", () => {
    expect(html).toContain('<span class="zip">Weekly</span>');
    expect(html).not.toContain('<span class="zip">Daily</span>');
    expect(html).toContain("Weekly — March 17–21, 2026");
  });

  it("renders every section the digest carries", () => {
    expect(html).toContain("A quiet week.");
    expect(html).toContain("Key highlights");
    expect(html).toContain("Agents got real");
    expect(html).toContain("Model &amp; tool updates");
    expect(html).toContain("Paper picks");
    expect(html).toContain("Community buzz");
    expect(html).toContain("Look ahead");
  });

  it("escapes dynamic content", () => {
    const nasty = renderWeeklyDigestHtml(
      { ...DIGEST, tldr: '<script>alert(1)</script>' },
      { brand: {} },
    );
    expect(nasty).not.toContain("<script>alert(1)</script>");
    expect(nasty).toContain("&lt;script&gt;");
  });

  it("renders an honest empty state rather than a blank document", () => {
    const empty = renderWeeklyDigestHtml(null, { brand: {} });
    expect(empty).toContain("No digest generated yet");
    expect(empty).toContain('href="/"');
    expect(empty).toContain('<span class="zip">Weekly</span>');
  });
});

describe("weekly digest body (design-reference §9)", () => {
  const html = renderWeeklyDigestHtml(DIGEST, { brand: { name: "Pulse" } });

  it("derives the week-number eyebrow from weekId, not weekOf", () => {
    expect(html).toContain(
      '<div class="doc-eyebrow">week 13 · sun 18:00</div>',
    );
    expect(html).toContain(".doc-eyebrow{");
  });

  it("falls back to the raw weekId when the week number cannot be derived", () => {
    const weird = renderWeeklyDigestHtml(
      { ...DIGEST, weekId: "week-abc", weekOf: "" },
      { brand: {} },
    );
    expect(weird).toContain("week week-abc · sun 18:00");
  });

  it("degrades gracefully when a digest section is a malformed non-array", () => {
    const weird = renderWeeklyDigestHtml(
      {
        ...DIGEST,
        highlights: "oops",
        modelUpdates: {},
        paperPicks: 3,
        communityBuzz: "x",
      },
      { brand: {} },
    );
    expect(weird).toContain("A quiet week.");
    expect(weird).not.toContain("Key highlights");
    expect(weird).not.toContain("Model &amp; tool updates");
    expect(weird).not.toContain("Paper picks");
    expect(weird).not.toContain("Community buzz");
  });

  it("renders the TLDR as the doc-lede (Inter 20/1.46 --ink-2)", () => {
    expect(html).toContain('<p class="doc-lede">A quiet week.</p>');
    expect(html).toContain(
      '.doc-lede{font-family:"Inter",system-ui,sans-serif;font-size:20px;line-height:1.46',
    );
  });

  it("renders highlights as numbered doc-story rows with hairlines and chips", () => {
    expect(html).toContain('<li class="doc-story">');
    expect(html).toContain('<span class="doc-rank">1</span>');
    expect(html).toContain('<h2 class="doc-headline">');
    expect(html).toContain("border-top:1px solid var(--hairline)");
    expect(html).toContain('<span class="doc-chip">product</span>');
    expect(html).toContain('<span class="doc-chip hot">high impact</span>');
    expect(html).toContain("background:var(--green-tint-2)");
    expect(html).toContain(
      ".doc-chip.hot{color:var(--amber-ink);background:var(--amber-tint)}",
    );
  });

  it("renders model & tool updates as doc-model rows (name · org + summary)", () => {
    expect(html).toContain('<div class="doc-model">');
    expect(html).toContain('<strong class="doc-model-name">');
    expect(html).toContain('<span class="doc-model-org">· Lab</span>');
    expect(html).toContain("Fast.");
  });

  it("renders paper picks as borderless --surface-2 doc-paper cards", () => {
    expect(html).toContain('<div class="doc-paper">');
    expect(html).toContain(
      ".doc-paper{background:var(--surface-2);border-radius:10px",
    );
    expect(html).not.toContain('class="paper"');
  });

  it("renders community buzz as em-dash doc-bullets in --green", () => {
    expect(html).toContain('<ul class="doc-bullets">');
    expect(html).toContain(
      '.doc-bullets li::before{content:"—";color:var(--green)',
    );
    expect(html).toContain("chatter");
  });

  it("renders lookAhead as a closing doc-lookahead paragraph in --ink-2", () => {
    expect(html).toContain('<p class="doc-lookahead">More agents.</p>');
    expect(html).toContain(
      '.doc-lookahead{font-family:"Inter",system-ui,sans-serif;font-size:15.5px;line-height:1.6;color:var(--ink-2)}',
    );
  });

  it("escapes links and keeps target/rel safety", () => {
    const linked = renderWeeklyDigestHtml(
      {
        ...DIGEST,
        highlights: [
          {
            title: "<b>x</b>",
            url: "https://example.com/a?b=1&c=2",
          },
        ],
      },
      { brand: {} },
    );
    expect(linked).not.toContain("<b>x</b>");
    expect(linked).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(linked).toContain(
      'href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer"',
    );
  });

  it("drops the legacy bordered card and transitional rules", () => {
    expect(html).not.toContain(".nl-foot{");
    expect(html).not.toContain("border:1px solid #e4dfd5");
    expect(html).not.toContain(".model-row");
    expect(html).not.toContain("ul.buzz");
    expect(html).not.toContain("transitional");
  });
});

describe("the rail card links out instead of expanding", () => {
  it("renders a link to /digest, not an inline expand", () => {
    const fn = appjs.match(/function renderDigest\(digest\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain('href="/digest"');
    expect(fn).not.toContain("digestExpandBtn");
    expect(fn).not.toContain("digest-detail");
  });

  it("keeps the card to a summary: no highlight/model/paper sections", () => {
    const fn = appjs.match(/function renderDigest\(digest\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).not.toContain("renderDigestHighlights");
    expect(fn).not.toContain("renderDigestModels");
    expect(fn).not.toContain("renderDigestPapers");
  });
});
