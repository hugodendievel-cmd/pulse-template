// tests/newsletter-render.test.mjs — lib/newsletter/render.mjs unit tests.
// The renderer produces web documents (the edition JSON is the contract; a
// separate email template comes later), so escaping + link safety are asserted
// strictly.
import { describe, expect, it } from "vitest";

import {
  renderDailyEditionHtml,
  renderEmptyArchiveHtml,
  renderNotFoundHtml,
} from "../lib/newsletter/render.mjs";

const EDITION = {
  editionId: "2026-09-10",
  dateOf: "September 10, 2026",
  generatedAt: "2026-09-10T06:00:00.000Z",
  tldr: "One big release, everything else quiet.",
  topStories: [
    {
      title: "GPT-5.5 lands",
      body: "OpenAI shipped GPT-5.5 with native tool use.",
      category: "model-release",
      impact: "high",
      url: "https://example.com/gpt55",
    },
    {
      title: "No URL story",
      body: "A story without a link.",
      category: "research",
      impact: "low",
      url: "",
    },
  ],
  modelReleases: [
    { name: "Gemini 3 Flash", org: "Google", summary: "Faster flash tier.", url: "" },
  ],
  paperPick: {
    title: "Flash Attention 4",
    authors: "Dao et al.",
    insight: "2x speedup on H100.",
    url: "https://arxiv.example/abs/123",
  },
  communityBuzz: ["Open-weights momentum", '<script>alert(1)</script>loopy'],
};

const BRAND = {
  name: "Pulse",
  credit: { text: "by dendievel.me", url: "https://dendievel.me" },
};

describe("renderDailyEditionHtml", () => {
  it("renders TL;DR, numbered stories, models, paper and buzz sections", () => {
    const html = renderDailyEditionHtml(EDITION, {
      brand: BRAND,
      editions: ["2026-09-10", "2026-09-09", "2026-09-08"],
    });

    expect(html).toContain("One big release, everything else quiet.");
    expect(html).toContain("Top stories");
    expect(html).toContain(">1</span>");
    expect(html).toContain(">2</span>");
    expect(html).toContain("GPT-5.5 lands");
    expect(html).toContain("Model releases");
    expect(html).toContain("Gemini 3 Flash");
    expect(html).toContain("Paper pick");
    expect(html).toContain("Flash Attention 4");
    expect(html).toContain("Dao et al.");
    expect(html).toContain("Community buzz");
    expect(html).toContain("Open-weights momentum");
    expect(html).toContain("September 10, 2026");
    expect(html).toContain("edition 2026-09-10");
  });

  it("marks high-impact stories and emits category tags", () => {
    const html = renderDailyEditionHtml(EDITION, { brand: BRAND });
    expect(html).toContain("high impact");
    expect(html).toContain("model-release");
    expect(html).toContain("research");
  });

  it("only makes stories/paper with a URL actual links, with target/rel safety", () => {
    const html = renderDailyEditionHtml(EDITION, { brand: BRAND });
    expect(html).toContain(
      '<a href="https://example.com/gpt55" target="_blank" rel="noopener noreferrer">',
    );
    expect(html).toContain("No URL story</h2>"); // plain escaped title, no anchor
    // story anchor for the one URL; paper links its own arxiv anchor
    expect(html).toContain('<a href="https://example.com/gpt55"');
    expect(html).toContain('<a href="https://arxiv.example/abs/123"');
    // "No URL story" stays plain escaped text, no anchor
    expect(html).toContain("No URL story</h2>");
  });

  it("omits sections when the edition has no data for them", () => {
    const html = renderDailyEditionHtml(
      { editionId: "2026-09-10", tldr: "quiet day", topStories: [] },
      { brand: BRAND },
    );
    expect(html).not.toContain("Top stories");
    expect(html).not.toContain("Model releases");
    expect(html).not.toContain("Paper pick");
    expect(html).not.toContain("Community buzz");
    expect(html).toContain("quiet day");
  });

  it("falls back to editionId when dateOf is empty", () => {
    const html = renderDailyEditionHtml(
      { editionId: "2026-09-10", tldr: "x", topStories: [] },
      { brand: BRAND },
    );
    expect(html).toContain("2026-09-10");
    expect(html).not.toContain("undefined");
  });

  it("escapes hostile content in every dynamic field", () => {
    const hostile = {
      editionId: "2026-09-10",
      tldr: "<script>alert('tldr')</script>",
      topStories: [
        {
          title: '<img src=x onerror=alert(1)>',
          body: "<b>body</b>",
          category: "research",
          impact: "high",
          url: "https://example.com/a>b",
        },
      ],
      paperPick: { title: "<script>x</script>paper" },
      communityBuzz: ['"><script>alert(3)</script>'],
    };
    const html = renderDailyEditionHtml(hostile, { brand: BRAND });

    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert('tldr')&lt;/script&gt;");
    expect(html).toContain("alert(3)");
    // URL is escaped in the attribute (& escaped) — the raw > must not appear in an href
    expect(html).toContain('href="https://example.com/a&gt;b"');
  });

  it("renders quick links as linked one-liners and escapes them", () => {
    const html = renderDailyEditionHtml(
      {
        editionId: "2026-09-10",
        tldr: "x",
        topStories: [],
        quickLinks: [
          { text: "OpenRouter spend shifted to OpenAI", url: "https://example.com/or" },
          { text: '<script>alert(9)</script>no url', url: "" },
        ],
      },
      { brand: BRAND },
    );

    expect(html).toContain("Quick links");
    expect(html).toContain('<ul class="doc-bullets">');
    expect(html).toContain(
      '<a href="https://example.com/or" target="_blank" rel="noopener noreferrer">OpenRouter spend shifted to OpenAI</a>',
    );
    expect(html).not.toContain("<script>alert(9)</script>");
    expect(html).toContain("no url");
  });

  it("keeps rendering legacy communityBuzz editions (pre-quickLinks)", () => {
    const html = renderDailyEditionHtml(
      {
        editionId: "2026-09-01",
        tldr: "old",
        topStories: [],
        communityBuzz: ["Legacy buzz line"],
      },
      { brand: BRAND },
    );

    expect(html).toContain("Community buzz");
    expect(html).toContain("Legacy buzz line");
    expect(html).not.toContain("Quick links");
  });

  it("degrades gracefully when a section field is a malformed non-array", () => {
    // A hand-edited/corrupt stored edition must render the page (sections
    // omitted), not throw a 500 on a public route.
    const html = renderDailyEditionHtml(
      {
        editionId: "2026-09-10",
        tldr: "quiet day",
        topStories: "oops",
        modelReleases: {},
        quickLinks: 7,
        communityBuzz: "no",
      },
      { brand: BRAND },
    );

    expect(html).toContain("quiet day");
    expect(html).not.toContain("Top stories");
    expect(html).not.toContain("Model releases");
    expect(html).not.toContain("Quick links");
    expect(html).not.toContain("Community buzz");
  });

  it("archive chips exclude the current edition and always link safely", () => {
    const html = renderDailyEditionHtml(EDITION, {
      brand: BRAND,
      editions: ["2026-09-10", "2026-09-09", "2026-09-08"],
    });
    expect(html).toContain('href="/newsletter/2026-09-09"');
    expect(html).toContain('href="/newsletter/2026-09-08"');
    expect(html).not.toContain('href="/newsletter/2026-09-10"');
  });
});

describe("daily edition body (design-reference §9)", () => {
  const html = renderDailyEditionHtml(EDITION, {
    brand: BRAND,
    editions: ["2026-09-10", "2026-09-09"],
  });

  it("renders the TLDR as the doc-lede (Inter 20/1.46 --ink-2)", () => {
    expect(html).toContain(
      '<p class="doc-lede">One big release, everything else quiet.</p>',
    );
    expect(html).toContain(
      '.doc-lede{font-family:"Inter",system-ui,sans-serif;font-size:20px;line-height:1.46',
    );
    expect(html).toContain("color:var(--ink-2)");
  });

  it("renders top stories as numbered doc-story rows with hairline dividers", () => {
    expect(html).toContain(".doc-stories{list-style:none}");
    expect(html).toContain(".doc-story{display:grid;grid-template-columns:22px 1fr");
    expect(html).toContain("border-top:1px solid var(--hairline)");
    expect(html).toContain(
      '.doc-rank{font-family:"JetBrains Mono",monospace;font-size:18px;font-weight:700;color:var(--green)}',
    );
    expect(html).toContain('<span class="doc-rank">1</span>');
    expect(html).toContain('<span class="doc-rank">2</span>');
    expect(html).toContain('<h2 class="doc-headline">');
    expect(html).toContain(
      '.doc-summary{font-family:"Inter",system-ui,sans-serif;font-size:14.5px',
    );
  });

  it("renders category and high-impact chips with the right tokens, never links", () => {
    expect(html).toContain('<span class="doc-chip">model-release</span>');
    expect(html).toContain('<span class="doc-chip hot">high impact</span>');
    expect(html).toContain('background:var(--green-tint-2)');
    expect(html).toContain("color:var(--green-ink)");
    expect(html).toContain(
      ".doc-chip.hot{color:var(--amber-ink);background:var(--amber-tint)}",
    );
    expect(html).not.toContain('<a class="doc-chip"');
  });

  it("renders model releases as doc-model rows with name · org and summary", () => {
    expect(html).toContain(
      '<strong class="doc-model-name">Gemini 3 Flash</strong>',
    );
    expect(html).toContain('<span class="doc-model-org">· Google</span>');
    expect(html).toContain("Faster flash tier.");
    expect(html).toContain(
      ".doc-model{padding:12px 0;border-top:1px solid var(--hairline)",
    );
  });

  it("renders the paper pick as a borderless --surface-2 doc-paper card", () => {
    expect(html).toContain('<div class="doc-paper">');
    expect(html).toContain(
      ".doc-paper{background:var(--surface-2);border-radius:10px",
    );
    // legacy bordered paper card is gone (markup and CSS)
    expect(html).not.toContain('class="paper"');
    expect(html).not.toContain(".paper{");
  });

  it("renders community buzz as em-dash doc-bullets in --green", () => {
    expect(html).toContain('<ul class="doc-bullets">');
    expect(html).toContain(
      '.doc-bullets li::before{content:"—";color:var(--green);margin-right:9px;font-weight:600}',
    );
    expect(html).toContain("Open-weights momentum");
  });
});

describe("newsletter typography (self-hosted fonts)", () => {
  it("references self-hosted families and no Google Fonts origin", () => {
    const html = renderDailyEditionHtml(EDITION, {
      brand: BRAND,
      editions: ["2026-09-10", "2026-09-09"],
    });

    expect(html).not.toContain("fonts.googleapis");
    expect(html).not.toContain("fonts.gstatic");
    expect(html).toContain("/fonts/");
    expect(html).toContain("Inter");
    expect(html).toContain('font-family:"Inter",system-ui');
  });
});

describe("document shell (design-reference §9)", () => {
  const html = renderDailyEditionHtml(EDITION, {
    brand: BRAND,
    editions: ["2026-09-10", "2026-09-09"],
  });

  it("declares the §3 tokens on :root with the exact values", () => {
    for (const decl of [
      "--paper:#f5f1e9",
      "--surface:#faf8f3",
      "--surface-2:#f1ede4",
      "--inset:#ece8de",
      "--strip:#efeade",
      "--ink:#1d1b19",
      "--ink-2:#3b3732",
      "--ink-3:#55504a",
      "--ink-4:#6b665e",
      "--hairline:rgba(29,27,25,.08)",
      "--green:#12a150",
      "--green-ink:#0c7a3d",
      "--green-tint:#e0efe3",
      "--green-tint-2:#e4f0e4",
      "--green-soft:#7cc294",
      "--amber-ink:#96500c",
      "--amber-tint:#fbe8d4",
    ]) {
      expect(html).toContain(decl);
    }
  });

  it("uses the full-bleed paper page with a 720px column and 20/32 gutters", () => {
    expect(html).toContain("body{background:var(--paper)");
    expect(html).toContain("max-width:720px;margin:0 auto");
    expect(html).toContain("padding:18px 20px");
    expect(html).toContain("padding-left:32px;padding-right:32px");
  });

  it("renders the doc-* shell vocabulary", () => {
    expect(html).toContain(".doc-head{");
    expect(html).toContain(".doc-head-inner{");
    expect(html).toContain(".doc-wordmark{");
    expect(html).toContain(".doc-credit{");
    expect(html).toContain(".doc-eyebrow{");
    expect(html).toContain(".sec-label{");
    expect(html).toContain(".doc-foot{");
    expect(html).toContain(".doc-pill{");
    expect(html).toContain('<header class="doc-head">');
    expect(html).toContain('<main class="doc-main">');
    expect(html).toContain('<footer class="doc-foot">');
  });

  it("styles the wordmark (mono 17/700) with the cadence in --green-ink", () => {
    expect(html).toContain('font-size:17px;font-weight:700');
    expect(html).toContain(".zip{color:var(--green-ink)}");
  });

  it("keeps the mobile override after the base lede/headline rules", () => {
    // Media queries add no specificity: the max-width block must come after the
    // base rules, or the base rules win and the mobile downscale is dead CSS.
    const media = html.indexOf("@media(max-width:520px)");
    expect(media).toBeGreaterThan(-1);
    expect(media).toBeGreaterThan(html.indexOf(".doc-lede{font-family"));
    expect(media).toBeGreaterThan(html.indexOf(".doc-headline{font-family"));
  });

  it("drops the legacy 640px bordered card and every legacy hex", () => {
    expect(html).not.toContain(".ew{");
    expect(html).not.toContain("border:1px solid #d1cdc6");
    for (const hex of [
      "#efe9de",
      "#fcf8f2",
      "#d1cdc6",
      "#e4dfd5",
      "#15a04a",
      "#f0eae0",
      "#776c64",
      "#675b54",
      "#2a1e1a",
      "#4a3d36",
      "#b45309",
      "#fdf0dd",
      "#eee8dc",
    ]) {
      expect(html).not.toContain(hex);
    }
  });
});

describe("newsletter footer source count (derived, never hardcoded)", () => {
  const NO_DATE = { editionId: "2026-09-10", tldr: "quiet day", topStories: [] };

  it("interpolates the injected sourceCount when there is no generatedAt", () => {
    const html = renderDailyEditionHtml(NO_DATE, { brand: BRAND, sourceCount: 12 });
    expect(html).toContain(">generated from 12 sources</span>");
  });

  it("degrades to a count-free string when sourceCount is absent", () => {
    const html = renderDailyEditionHtml(NO_DATE, { brand: BRAND });
    expect(html).toContain(">generated</span>");
    expect(html).not.toContain("12 sources");
  });

  it("prefers generatedAt over the source count when present", () => {
    const html = renderDailyEditionHtml(EDITION, { brand: BRAND, sourceCount: 12 });
    expect(html).toContain("Generated 2026-09-10T06:00:00.000Z");
    expect(html).not.toContain("generated from 12 sources");
  });
});

describe("renderEmptyArchiveHtml / renderNotFoundHtml", () => {
  it("empty page explains how to generate the first edition", () => {
    const html = renderEmptyArchiveHtml({ brand: BRAND });
    expect(html).toContain("No editions generated yet");
    expect(html).toContain("npm run edition:save");
    // Honest copy only: the generate endpoint never existed, so it must not be
    // advertised. The automatic/local generation path is the real one.
    expect(html).not.toContain("POST /api/newsletter/generate");
    // Masthead carries the cadence word in its own span (the wordmark is now
    // `Pulse <span class="zip">Daily</span>`, lowercased visually by CSS).
    expect(html).toContain('<span class="zip">Daily</span>');
  });

  it("not-found page escapes the malformed editionId", () => {
    const html = renderNotFoundHtml({
      editionId: "<script>alert(4)</script>",
      brand: BRAND,
    });
    expect(html).not.toContain("<script>alert(4)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Edition not found");
  });
});
