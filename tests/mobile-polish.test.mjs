// tests/mobile-polish.test.mjs — the phone pass (2026-09-20).
//
// The desktop chrome/type was rendering unchanged at <=899px: three filled
// 44px circles crowded the header (wrapping the live pill), the bottom nav
// drew a solid full-height pill, and the edition/briefing documents carried
// the 1280px measure. These assertions pin the mobile overrides; the 44px hit
// targets are asserted in tests/mobile-responsive.test.mjs and tests/a11y.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(
  resolve(__dirname, "../dashboard/public/style.css"),
  "utf-8",
);

// The mobile polish block is the last @media (max-width: 899px) block; inner
// rules close indented, so `\n}` finds the media block's own close.
const blocks = [
  ...css.matchAll(/@media\s*\(max-width:\s*899px\)\s*\{([\s\S]*?)\n\}/g),
].map((m) => m[1]);
const mobile = blocks[blocks.length - 1] ?? "";

describe("mobile polish — header chrome", () => {
  it("drops the redundant archive pill", () => {
    expect(mobile).toMatch(/\.header-link\s*\{[^}]*display:\s*none/);
  });

  it("turns the search trigger into a ghost icon control", () => {
    const rule = mobile.match(/\.search-trigger\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/width:\s*44px/);
    expect(rule).toMatch(/background:\s*transparent/);
    expect(rule).toMatch(/border-color:\s*transparent/);
    expect(mobile).toMatch(/\.search-trigger span\s*\{[^}]*display:\s*none/);
  });

  it("overrides the theme fills on their own specificity (no !important)", () => {
    // `html.light .search-trigger`/`html.light .theme-toggle` outrank a bare
    // class, so a plain `.search-trigger { background: transparent }` silently
    // lost and the filled circles stayed. The selectors must carry extra weight.
    expect(mobile).toMatch(/\.header \.header-right \.search-trigger\s*\{/);
    expect(mobile).toMatch(/\.header \.header-right \.theme-toggle\s*\{/);
    // No escalation to an important declaration (the comment may mention one).
    expect(mobile).not.toMatch(/\{[^}]*!important/);
  });

  it("keeps the live pill on one line so it cannot wrap in the header", () => {
    expect(mobile).toMatch(/\.status-badge\s*\{[^}]*white-space:\s*nowrap/);
    expect(mobile).toMatch(/\.status-badge\s*\{[^}]*flex:\s*none/);
  });
});

describe("mobile polish — bottom nav", () => {
  it("uses a tinted segmented control for the active view", () => {
    const rule = mobile.match(/\.bottom-nav \.nav-pill\.active\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/background:\s*var\(--green-tint\)/);
    expect(rule).toMatch(/color:\s*var\(--green-ink\)/);
    expect(rule).toMatch(/box-shadow:\s*none/);
    // Must outrank `html.light .nav-pill.active` (which paints the solid fill).
    expect(mobile).toMatch(/:root \.bottom-nav \.nav-pill\.active\s*\{/);
  });

  it("flattens the hover state (no desktop lift/glow on touch chrome)", () => {
    const rule = mobile.match(/\.bottom-nav \.nav-pill:hover\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/transform:\s*none/);
    expect(rule).toMatch(/box-shadow:\s*none/);
  });

  it("is a compact centred segmented control, not three full-width blocks", () => {
    expect(mobile).toMatch(/\.bottom-nav\s*\{[^}]*justify-content:\s*center/);
    const rule =
      mobile.match(/:root \.bottom-nav \.nav-pill\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/flex:\s*0 1 auto/);
    expect(rule).toMatch(/min-width:\s*84px/);
  });
});

describe("mobile polish — document type", () => {
  it("steps the edition lede and headline down from the desktop measure", () => {
    expect(mobile).toMatch(/\.edition-lede\s*\{[^}]*font-size:\s*15\.5px/);
    expect(mobile).toMatch(/\.edition-headline\s*\{[^}]*font-size:\s*15\.5px/);
    expect(mobile).toMatch(/\.edition-reader\s*\{[^}]*padding:\s*18px 16px/);
  });

  it("stacks the story-row meta under the headline on a phone", () => {
    expect(mobile).toMatch(
      /\.story-row\s*\{[^}]*grid-template-columns:\s*20px minmax\(0, 1fr\)/,
    );
    expect(mobile).toMatch(/\.story-meta\s*\{[^}]*grid-column:\s*2/);
    expect(mobile).toMatch(/\.analysis-summary\s*\{[^}]*font-size:\s*20px/);
  });
});

describe("empty panel count renders nothing", () => {
  it("removes the stray — placeholder", () => {
    expect(css).not.toMatch(/\.panel-count:empty::before/);
    expect(css).toMatch(/\.panel-count:empty\s*\{[^}]*display:\s*none/);
  });

  it("no longer seeds the count span with a literal —", () => {
    const appjs = readFileSync(
      resolve(__dirname, "../dashboard/public/app.js"),
      "utf-8",
    );
    // The placeholder used to be `>—</span>`, so :empty never matched.
    expect(appjs).not.toMatch(/panel-count[^>]*>—</);
    expect(appjs).toMatch(/panel-count[^>]*><\/span>/);
  });
});

describe("mobile polish — ticker", () => {
  it("pins the marquee size on the band and its items", () => {
    // Pinned on the item/link too: long arXiv titles were reading oversized
    // where a glyph fell back, and a bare size on the band did not hold them.
    expect(mobile).toMatch(/\.ticker,[\s\S]*?font-size:\s*10px/);
    expect(mobile).toMatch(/\.ticker \.ticker-item a[\s\S]*?font-size:\s*10px/);
    expect(mobile).toMatch(/\.ticker-item\s*\{[^}]*margin-right:\s*20px/);
  });
});

describe("mobile polish — streams filter bar", () => {
  it("wraps the chips and drops the square rule that circled 'all'", () => {
    expect(mobile).toMatch(/\.view-toolbar\s*\{[^}]*flex-wrap:\s*wrap/);
    const chip = mobile.match(/\.filter-chip\s*\{[^}]*\}/)?.[0] ?? "";
    expect(chip).toMatch(/min-width:\s*0/);
    expect(chip).toMatch(/min-height:\s*34px/);
    expect(chip).toMatch(/white-space:\s*nowrap/);
    expect(mobile).toMatch(/\.view-toolbar \.sort\s*\{[^}]*margin-left:\s*0/);
  });
});

describe("mobile polish — iOS text autosizing", () => {
  it("pins text-size-adjust so Safari cannot inflate the marquee", () => {
    // Without this, iOS Safari enlarged the long nowrap ticker track to a size
    // of its own and ignored the declared px, so some items read huge.
    expect(css).toMatch(/-webkit-text-size-adjust:\s*100%/);
    expect(css).toMatch(/[^-]text-size-adjust:\s*100%/);
  });

  it("stacks the briefing label and byline instead of wrapping mid-phrase", () => {
    expect(mobile).toMatch(/\.briefing-head\s*\{[^}]*flex-direction:\s*column/);
    expect(mobile).toMatch(/\.briefing-by\s*\{[^}]*text-overflow:\s*ellipsis/);
  });
});

describe("mobile polish — bottom bar", () => {
  it("is shorter than the 44px default", () => {
    const pill =
      mobile.match(/:root \.bottom-nav \.nav-pill\s*\{[^}]*\}/)?.[0] ?? "";
    expect(pill).toMatch(/min-height:\s*38px/);
    const bar = mobile.match(/\.bottom-nav\s*\{[^}]*\}/)?.[0] ?? "";
    expect(bar).toMatch(/padding:\s*4px 10px/);
  });

  it("is opaque, not translucent (the blurred bar read worse than solid chrome)", () => {
    const bar = mobile.match(/\.bottom-nav\s*\{[^}]*\}/)?.[0] ?? "";
    expect(bar).toMatch(/background:\s*var\(--surface\)/);
    expect(bar).not.toMatch(/backdrop-filter/);
    expect(bar).not.toMatch(/color-mix/);
  });
});
