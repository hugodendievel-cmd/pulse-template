// tests/mobile-responsive.test.mjs — Story 2.4: the `[data-layout]` view grid
// replaces the legacy `.col-*` / `--col-span` / `[data-filter]` responsive
// system. Source-scan only (no browser harness); layout is verified here plus a
// manual check at 1280 / 900 / 390.
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

// Body of the first `@media (<query>) { … }` block. Media blocks in this file
// close with a `}` at column 0, so the non-greedy `\n\}` boundary is exact.
function mediaBlock(query) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`@media\\s*\\(${escaped}\\)\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
}

describe("view layout templates", () => {
  it('declares .view[data-layout="main-rail"] as 1fr + 372px rail', () => {
    expect(css).toMatch(
      /\.view\[data-layout=["']main-rail["']\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*372px/,
    );
  });

  it('declares .view[data-layout="grid"] as a 3-column grid', () => {
    expect(css).toMatch(
      /\.view\[data-layout=["']grid["']\]\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
  });

  it('declares .view[data-layout="reader"] as 1fr + 420px reader', () => {
    expect(css).toMatch(
      /\.view\[data-layout=["']reader["']\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*420px/,
    );
  });

  it('pins .panel[data-column="rail"] to grid-column 2', () => {
    expect(css).toMatch(
      /\.panel\[data-column=["']rail["']\]\s*\{[^}]*grid-column:\s*2/,
    );
  });

  it("keeps data-column=main panels pinned to column 1 inside rail layouts", () => {
    expect(css).toMatch(
      /\.view\[data-layout=["']main-rail["']\]\s+\.panel\[data-column=["']main["']\][\s\S]*?grid-column:\s*1/,
    );
  });
});

describe(">=1200px base templates", () => {
  // The specced desktop layout is the base rule, not a media override; the
  // 900–1199px rule below is what collapses it. Asserting the base rule here
  // guards the >=1200px contract explicitly (Story 6.7 AC1).
  it('renders streams as a 3-column grid at >=1200px', () => {
    expect(css).toMatch(
      /\.view\[data-layout=["']grid["']\]\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
  });

  it("keeps the main-rail 372px rail at >=1200px", () => {
    expect(css).toMatch(
      /\.view\[data-layout=["']main-rail["']\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*372px/,
    );
  });

  it("keeps the reader 420px rail at >=1200px", () => {
    expect(css).toMatch(
      /\.view\[data-layout=["']reader["']\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*420px/,
    );
  });

  it("does not need a min-width media override (base rules are unambiguous at 1200)", () => {
    expect(css).not.toMatch(/@media\s*\(min-width:\s*1200px\)/);
  });
});

describe("responsive contract", () => {
  it("reduces the streams grid to 2 columns at <=1199px", () => {
    const block = mediaBlock("max-width: 1199px");
    expect(block).toMatch(
      /\.view\[data-layout=["']grid["']\]\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
  });

  it("drops the rail below the main column at <=1199px", () => {
    const block = mediaBlock("max-width: 1199px");
    expect(block).toMatch(
      /\.view\[data-layout=["']main-rail["'][\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    // Main and rail are independent column stacks (design 3a/3c), so dropping
    // the rail means collapsing both wrappers onto column 1 — the wrappers
    // already sit main-then-rail in DOM order.
    expect(block).toMatch(
      /\.view\[data-layout=["']main-rail["']\]\s+\.view-col[\s\S]{0,120}grid-column:\s*1/,
    );
  });

  it("stacks every layout to a single column at <=899px", () => {
    const block = mediaBlock("max-width: 899px");
    expect(block).toMatch(
      /\.view\[data-layout=["'](main-rail|grid|reader)["'][\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
  });

  it("shows the bottom-anchored segmented nav at <=899px", () => {
    const block = mediaBlock("max-width: 899px");
    expect(block).toMatch(/\.bottom-nav\s*\{[^}]*display:\s*flex/);
    expect(block).toMatch(/\.header-nav\s*\{[^}]*display:\s*none/);
  });



  it("keeps the ticker on a single line at <=899px", () => {
    const block = mediaBlock("max-width: 899px");
    expect(block).toMatch(/\.ticker-inner\s*\{[^}]*white-space:\s*nowrap/);
  });

  it("enforces 44×44 touch targets for every mobile control at <=899px", () => {
    const block = mediaBlock("max-width: 899px");
    // Each control must be covered by a rule that actually declares the 44×44
    // minimum — presence of the selector somewhere in the block is not enough.
    const controls = [
      ".panel-toggle",
      ".nav-pill",
      ".search-trigger",
      ".theme-toggle",
      ".collapse-all-btn",
      ".header-link",
    ];
    for (const sel of controls) {
      const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(block).toMatch(
        new RegExp(`${escaped}[^{}]*\\{[^}]*min-height:\\s*44px`),
      );
    }
  });

  it("hides the bottom nav again at >=900px", () => {
    const block = mediaBlock("min-width: 900px");
    expect(block).toMatch(/\.bottom-nav\s*\{[^}]*display:\s*none/);
  });

  it("bottom-anchors the bottom nav to the viewport", () => {
    // The fix is in the base `.bottom-nav` rule (outside the media query): it is
    // fixed and pinned to the bottom edges, so the mobile media query only has
    // to reveal it with `display: flex`.
    expect(css).toMatch(/\.bottom-nav\s*\{[^}]*position:\s*fixed/);
    expect(css).toMatch(/\.bottom-nav\s*\{[^}]*inset:\s*auto\s+0\s+0\s+0/);
  });

  it("reserves safe-area padding for the bottom nav", () => {
    expect(css).toMatch(
      /\.bottom-nav\s*\{[^}]*padding:[^;]*env\(safe-area-inset-bottom/,
    );
  });

  it("shapes the bottom nav as equal segments", () => {
    expect(css).toMatch(/\.bottom-nav\s+\.nav-pill\s*\{[^}]*flex:\s*1/);
  });

  it("paints the active nav segment --green on --paper", () => {
    expect(css).toMatch(
      /\.nav-pill\.active\s*\{[^}]*background:\s*var\(--green\)/,
    );
    expect(css).toMatch(
      /\.nav-pill\.active\s*\{[^}]*color:\s*var\(--paper\)/,
    );
  });

  it("paints the active segment the same way in the default light theme", () => {
    // `html.light` is the default theme; its override must not fall back to a
    // hardcoded colour. Design reference §4 (3a): --green fill / --paper text.
    expect(css).toMatch(
      /html\.light\s+\.nav-pill\.active\s*\{[^}]*background:\s*var\(--green\)/,
    );
    expect(css).toMatch(
      /html\.light\s+\.nav-pill\.active\s*\{[^}]*color:\s*var\(--paper\)/,
    );
  });

  it("keeps the fixed bottom nav clear of the footer at <=899px", () => {
    const block = mediaBlock("max-width: 899px");
    expect(block).toMatch(/\.footer\s*\{[^}]*padding-bottom:\s*calc\(/);
  });
});

describe("bottom nav is the only mobile nav path (Story 6.7)", () => {
  it("deletes the dead initHamburger code and its call", () => {
    expect(appjs).not.toContain("initHamburger");
    expect(appjs).not.toContain("hamburgerBtn");
  });

  it("delegates clicks on both nav containers to setView", () => {
    expect(appjs).toMatch(/function initViewNav\(/);
    expect(appjs).toContain("headerNav");
    expect(appjs).toContain("bottomNav");
  });

  it("builds the bottom nav from the pack's views, never a hardcoded count", () => {
    // The item count is `views.length`; the client never asserts 3.
    expect(appjs).toMatch(/bottomNav[\s\S]*?\.map\(/);
    expect(appjs).not.toMatch(/bottomNav[\s\S]{0,200}===\s*3/);
  });

  it("toggles the active state across both nav containers", () => {
    expect(appjs).toMatch(
      /querySelectorAll\(["']\.nav-pill["']\)\.forEach/,
    );
  });
});

describe("legacy grid system is gone", () => {
  it("has no --col-span custom property", () => {
    expect(css).not.toMatch(/--col-span/);
  });

  it("has no .col-N span selectors", () => {
    expect(css).not.toMatch(/\.col-\d/);
  });

  it("has no [data-filter] layout overrides", () => {
    expect(css).not.toContain("data-filter=");
  });
});

describe("panel toggle", () => {
  it("pushes the count flush right at ALL viewports, chevron trailing it", () => {
    expect(css).toMatch(/\.panel-count\s*\{[^}]*margin-left:\s*auto/);
    expect(css).toMatch(/\.panel-toggle\s*\{[^}]*margin-left:\s*8px/);
  });
});
