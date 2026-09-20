// tests/a11y.test.mjs — Story 6.8: accessibility pass over the redesign.
// Source-scan only (architecture §7): app.js is a browser script and there is no
// DOM harness, so focus rings, hit targets, live regions and motion
// suppressions are asserted against the authored CSS/HTML/JS. The few things a
// source scan cannot prove (real tab order, actual contrast rendering) are
// documented in Dev Notes and checked manually at 1280/390.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const css = readFileSync(resolve(root, "dashboard/public/style.css"), "utf-8");
const html = readFileSync(resolve(root, "dashboard/public/index.html"), "utf-8");
const appjs = readFileSync(resolve(root, "dashboard/public/app.js"), "utf-8");

// Body of the first `@media (<query>) { … }` block. Media blocks in this file
// close with a `}` at column 0, so the non-greedy `\n\}` boundary is exact.
function mediaBlock(query) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    css.match(
      new RegExp(`@media\\s*\\(${escaped}\\)\\s*\\{([\\s\\S]*?)\\n\\}`),
    )?.[1] ?? ""
  );
}

// Every `@media (prefers-reduced-motion: reduce)` block, concatenated.
function reducedMotionBlocks() {
  return [
    ...css.matchAll(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g,
    ),
  ]
    .map((m) => m[1])
    .join("\n");
}

// ── Relative luminance / contrast ratio (WCAG 2.x) ───────────────────────
function luminance(hex) {
  const c = hex.replace("#", "");
  const channel = (i) => parseInt(c.slice(i, i + 2), 16) / 255;
  const linear = (v) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return (
    0.2126 * linear(channel(0)) +
    0.7152 * linear(channel(2)) +
    0.0722 * linear(channel(4))
  );
}
function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Declared value of `name` inside the first block matching `selector`, e.g.
// `html.light` or `:root`.
function tokenIn(selector, name) {
  const block =
    css.match(new RegExp(`${selector}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
  return block.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{3,6})`))?.[1];
}

// Function body of a top-level `function name(...) { … }` in app.js.
function fnBody(name) {
  return (
    appjs.match(new RegExp(`function ${name}\\([^)]*\\)[\\s\\S]*?\\n\\}`))?.[0] ??
    ""
  );
}

// ── AC1: contrast — decorative greys are never text ──────────────────────
describe("decorative greys are never used as text (Story 6.8)", () => {
  const DECORATIVE = ["#8a847a", "#b9b2a3", "#cfc9bc"];

  for (const hex of DECORATIVE) {
    it(`no \`color: ${hex}\` declaration`, () => {
      expect(css, `${hex} must only be backgrounds/dots`).not.toMatch(
        new RegExp(`color\\s*:\\s*${hex}`, "i"),
      );
    });
  }

  it("binds metadata text to --ink-4 (never a raw decorative hex)", () => {
    // The semantic token itself is the only place a grey may be declared.
    expect(css).toMatch(/\.ticker-src\s*\{[^}]*color:\s*var\(--ink-4\)/);
    expect(css).toMatch(/\.ticker-sep\s*\{[^}]*color:\s*var\(--ink-4\)/);
  });
});

// ── AC1: --ink-4 clears 4.9:1 on --surface in light and dark ─────────────
describe("--ink-4 clears the 4.9:1 text bar on --surface (Story 6.8)", () => {
  it("light theme: #6b665e on #faf8f3", () => {
    const ink = tokenIn("html\\.light", "--ink-4");
    const surface = tokenIn("html\\.light", "--surface");
    expect(ink).toBeTruthy();
    expect(surface).toBeTruthy();
    expect(contrast(ink, surface)).toBeGreaterThanOrEqual(4.9);
  });

  it("dark theme (:root): #9a948a on #232120", () => {
    const ink = tokenIn(":root", "--ink-4");
    const surface = tokenIn(":root", "--surface");
    expect(ink).toBeTruthy();
    expect(surface).toBeTruthy();
    expect(contrast(ink, surface)).toBeGreaterThanOrEqual(4.9);
  });
});

// ── AC2: visible focus ring bound to --green ─────────────────────────────
describe("focus-visible ring (Story 6.8)", () => {
  it("uses --green as a single ring source", () => {
    expect(css).toMatch(
      /:where\([^)]*(a|button)[^)]*\):focus-visible\s*\{[^}]*outline:\s*2px solid var\(--green\)/,
    );
  });

  it("covers every interactive control class added since 2.1", () => {
    // The controls live in one comma-separated rule; bind the assertion to that
    // rule so a stray `:focus-visible` elsewhere cannot satisfy it.
    const rule =
      css.match(/\.nav-pill:focus-visible,[\s\S]*?\n\}/)?.[0] ?? "";
    expect(rule).not.toBe("");
    expect(rule).toContain("outline: 2px solid var(--green)");
    const controls = [
      ".nav-pill",
      ".search-trigger",
      ".panel-toggle",
      ".filter-chip",
      ".delta-badge",
      ".archive-link",
      ".view-link",
      // .command-input is covered by its row's :focus-within, asserted below.
      ".digest-link",
    ];
    for (const sel of controls) {
      expect(rule, `${sel} needs a focus ring`).toContain(
        `${sel}:focus-visible`,
      );
    }
  });

  // The input sits inside a bordered row; ringing the bare input drew a green
  // box floating inside the field. The row carries the focus state instead, so
  // the affordance is still visible without the stray outline.
  it("gives the command input a visible focus affordance on its row", () => {
    expect(css).toMatch(/\.command-input\s*\{[^}]*outline:\s*none/);
    expect(css).toMatch(
      /\.command-input-wrap:focus-within\s*\{[^}]*border-bottom-color:\s*var\(--green\)/,
    );
  });
});

// ── AC2: 44×44 touch targets at <900px ───────────────────────────────────
describe("44×44 touch targets at <900px (Story 6.8)", () => {
  it("declares min-height/min-width for every listed control", () => {
    const block = mediaBlock("max-width: 899px");
    const controls = [
      ".nav-pill",
      ".search-trigger",
      ".theme-toggle",
      ".panel-toggle",
      ".filter-chip",
      ".delta-badge",
    ];
    for (const sel of controls) {
      const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(block, `${sel} must be 44×44 below 900px`).toMatch(
        new RegExp(`${escaped}[^{}]*\\{[^}]*min-height:\\s*44px`),
      );
      expect(block, `${sel} must be 44×44 below 900px`).toMatch(
        new RegExp(`${escaped}[^{}]*\\{[^}]*min-width:\\s*44px`),
      );
    }
  });

  it("documents the bottom-nav segmented pills as the deliberate sub-44 exception", () => {
    // The fixed bottom bar is shorter than 44px so it reads as an iOS
    // segmented control; it is a documented exception, not an oversight.
    expect(css).toMatch(
      /:root \.bottom-nav \.nav-pill\s*\{[^}]*min-height:\s*38px/,
    );
  });
});

// ── AC3: prefers-reduced-motion suppresses the animated components ───────
describe("reduced motion suppresses pulse + marquee (Story 6.8)", () => {
  const blocks = reducedMotionBlocks();

  it("has a reduced-motion block", () => {
    expect(blocks).not.toBe("");
  });

  const suppressed = [
    ["\\.panel\\.is-loading \\.panel-body::after", "skeleton-pulse"],
    [
      "\\.panel:not\\(\\.is-loading\\) \\.panel-body > \\*",
      "fade-rise",
    ],
    ['\\.status-dot\\[data-state="connected"\\]', "pulse"],
    ["\\.ticker-inner", "ticker-scroll"],
  ];
  for (const [sel, name] of suppressed) {
    it(`disables ${name} on ${sel.replace(/\\/g, "")}`, () => {
      // `[^{}]*` so a selector in a comma-separated list still matches.
      expect(blocks).toMatch(
        new RegExp(`${sel}[^{}]*\\{[^}]*animation:\\s*none`),
      );
    });
  }

  it("keeps the live pill's text label when the dot is static", () => {
    expect(html).toMatch(/id="sourceCount"[^>]*role="status"/);
    expect(appjs).toContain('"live"');
    expect(appjs).toContain('"reconnecting…"');
    expect(appjs).toContain('"offline · showing cached"');
  });
});

// ── AC4: live regions without stealing focus ─────────────────────────────
describe("live regions (Story 6.8)", () => {
  it("live pill keeps role=status, aria-live=polite and coarse announcements", () => {
    expect(html).toMatch(
      /id="sourceCount"[^>]*role="status"[^>]*aria-live="polite"/,
    );
    expect(html).toMatch(/id="sourceCount"[^>]*aria-atomic="false"/);
  });


  // The pill no longer carries a per-second age at all, so there is nothing
  // for the polite region to re-announce every second.
  it("carries no ticking age in the live region", () => {
    expect(html).not.toContain('id="sweepTime"');
    expect(appjs).not.toContain("sweepTime");
  });

  it("delta badge inserts an accessible name and stays a focusable button", () => {
    const fn = fnBody("renderDeltaBadge");
    expect(fn).not.toBe("");
    expect(fn).toContain('badge.type = "button"');
    expect(fn).toMatch(/aria-label/);
    expect(fn).toMatch(/new items/);
  });

  it("announces delta badge arrivals through a polite live region", () => {
    // The badge is inserted into a body that is never re-rendered, so it needs
    // a live region of its own; aria-label alone only helps once focused.
    expect(html).toMatch(
      /id="liveAnnouncer"[^>]*role="status"[^>]*aria-live="polite"/,
    );
    const fn = fnBody("renderDeltaBadge");
    expect(fn).toContain("liveAnnouncer");
  });

  it("never focuses a dynamically updated region", () => {
    for (const name of ["applyData", "renderLivePill"]) {
      const fn = fnBody(name);
      expect(fn, `${name} must not move focus`).not.toBe("");
      expect(fn, `${name} must not call focus()`).not.toMatch(/\.focus\(/);
    }
  });

  it("only the user-initiated command palette open moves focus", () => {
    const opens = appjs.match(/\.focus\(/g) ?? [];
    expect(opens).toHaveLength(1);
  });
});

// ── AC2: keyboard reachability for click-only controls ───────────────────
describe("interactive elements are keyboard-reachable (Story 6.8)", () => {
  it("makes the per-panel chevron a real button with a disclosure name", () => {
    // The old chevron was an aria-hidden <span>; only the whole header was
    // clickable, so a single panel could not be collapsed from the keyboard.
    expect(appjs).toMatch(/toggle\.type\s*=\s*"button"/);
    expect(appjs).toMatch(/toggle\.setAttribute\("aria-expanded"/);
    expect(appjs).toMatch(/setAttribute\(\s*"aria-label"/);
    expect(appjs).toContain('"Expand panel"');
    expect(appjs).toContain('"Collapse panel"');
  });
});

// ── AC2/AC4: dialog + input labelling ────────────────────────────────────
describe("dialog and input labelling (Story 6.8)", () => {
  it("shortcuts overlay keeps its dialog semantics", () => {
    expect(html).toMatch(
      /id="kbdOverlay"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="kbdTitle"/,
    );
  });

  it("command overlay input has an accessible label", () => {
    expect(html).toMatch(/id="commandInput"[^>]*aria-label="[^"]+"/);
  });
});
