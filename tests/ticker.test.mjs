// tests/ticker.test.mjs — Story 6.2: the live headline ticker. Source-scan
// only (no browser harness): the in-place update contract and the CSS motion
// contract are asserted against the shipped files, exactly like
// tests/metrics-strip.test.mjs.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const appjs = readFileSync(resolve(root, "dashboard/public/app.js"), "utf-8");
const css = readFileSync(resolve(root, "dashboard/public/style.css"), "utf-8");
const html = readFileSync(resolve(root, "dashboard/public/index.html"), "utf-8");

// Bodies of every `@media (<query>) { … }` block, concatenated. The file may
// declare the same query twice (prefers-reduced-motion is split across the
// base sheet and the component section); media blocks close with a `}` at
// column 0, so the non-greedy `\n\}` boundary is exact.
function mediaBlock(query) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `@media\\s*\\(${escaped}\\)\\s*\\{([\\s\\S]*?)\\n\\}`,
    "g",
  );
  return [...css.matchAll(re)].map((m) => m[1]).join("\n");
}

describe("renderTicker / updateTickerInPlace contract", () => {
  it("defines renderTicker and updateTickerInPlace", () => {
    expect(appjs).toMatch(/function renderTicker\(/);
    expect(appjs).toMatch(/function updateTickerInPlace\(/);
  });

  it("no longer replaces #ticker innerHTML with two duplicated runs wholesale", () => {
    // The old `document.getElementById("ticker").innerHTML = html + html`
    // duplicates the markup on every applyData. The in-place updater keeps the
    // animation (and scroll position) alive, so the wholesale write is gone.
    expect(appjs).not.toMatch(
      /#ticker["']\)\.innerHTML\s*=\s*html\s*\+\s*html/,
    );
    expect(appjs).toMatch(/updateTickerInPlace\(/);
  });

  it("keys the DOM nodes with data-key (escaped url) for a stable diff", () => {
    expect(appjs).toMatch(/data-key/);
    expect(appjs).toMatch(/dataset\.key/);
  });

  // The track holds every item twice and animates continuously, so its size is
  // capped: 5-per-source built a ~52,000px layer and a ~10 minute loop.
  it("builds a capped item list from status:ok sources, skipping failures", () => {
    expect(appjs).toMatch(/status\s*!==\s*["']ok["']/);
    expect(appjs).toMatch(/const TICKER_PER_SOURCE = \d+;/);
    expect(appjs).toMatch(/const TICKER_MAX_ITEMS = \d+;/);
    expect(appjs).toMatch(/slice\(0, TICKER_PER_SOURCE\)/);
    expect(appjs).toMatch(/updateTickerInPlace\(items\.slice\(0, TICKER_MAX_ITEMS\)\)/);
  });

  it("is idempotent: an unchanged key list short-circuits before touching the DOM", () => {
    expect(appjs).toMatch(/tickerKeys/);
    expect(appjs).toMatch(/return false/);
  });

  it("diffs title/source too, refreshing a reused node on a same-url edit", () => {
    // A live feed can edit a headline while keeping the permalink. Diffing on
    // url alone (the DOM identity) would leave the stale title on screen, so
    // the unchanged check must also compare the content signature and reused
    // nodes must get their inner HTML refreshed.
    expect(appjs).toMatch(/tickerSignatures/);
    expect(appjs).toMatch(
      /reused\.innerHTML\s*=\s*tickerItemInner\(item\)/,
    );
  });
});

describe("ticker shell markup", () => {
  it("renders a lowercase ticker lead label and a │ separator before the marquee", () => {
    expect(html).toMatch(/class="ticker-label"[^>]*>ticker</);
    expect(html).toContain("│");
    // The label/separator sit before the marquee track.
    expect(html.indexOf("ticker-label")).toBeLessThan(html.indexOf('id="ticker"'));
  });
});

describe("ticker CSS contract", () => {
  it("binds the shell to --inset, mono 12 and --ink-3", () => {
    expect(css).toMatch(/\.ticker\s*\{[^}]*background:\s*var\(--inset\)/);
    expect(css).toMatch(/\.ticker\s*\{[^}]*font-family:\s*var\(--mono\)/);
    expect(css).toMatch(/\.ticker\s*\{[^}]*font-size:\s*12px/);
    expect(css).toMatch(/\.ticker\s*\{[^}]*color:\s*var\(--ink-3\)/);
  });

  it("styles the label in --ink-4", () => {
    expect(css).toMatch(/\.ticker-label\s*\{[^}]*color:\s*var\(--ink-4\)/);
    expect(css).toMatch(
      /\.ticker-label\s*\{[^}]*text-transform:\s*lowercase/,
    );
  });

  it("scrolls continuously at a constant reading speed", () => {
    // A fixed duration tied the marquee's speed to how much content was in it
    // (the track is every item twice), so a busy sweep scrolled unreadably
    // fast. app.js sets --ticker-duration from the measured track width; the
    // literal here is only the pre-measurement fallback.
    expect(css).toMatch(
      /\.ticker-inner\s*\{[^}]*animation:\s*ticker-scroll\s+var\(--ticker-duration,\s*40s\)\s+linear\s+infinite/,
    );
    expect(css).toMatch(/@keyframes\s+ticker-scroll\s*\{/);
    expect(css).toMatch(
      /@keyframes\s+ticker-scroll\s*\{[\s\S]*?transform:\s*translateX\(0\)/,
    );
    expect(css).toMatch(
      /@keyframes\s+ticker-scroll\s*\{[\s\S]*?translateX\(-50%\)/,
    );
    // The legacy 450s scroll-left animation is retired.
    expect(css).not.toMatch(/scroll-left\s+450s/);
  });

  it("pauses on hover of the whole ticker", () => {
    expect(css).toMatch(
      /\.ticker:hover\s+\.ticker-inner\s*\{[^}]*animation-play-state:\s*paused/,
    );
  });

  it("turns the marquee into a static wrapped list under prefers-reduced-motion", () => {
    const block = mediaBlock("prefers-reduced-motion: reduce");
    expect(block).not.toBe("");
    expect(block).toMatch(/\.ticker-inner\s*\{[^}]*animation:\s*none/);
    expect(block).toMatch(/\.ticker-inner\s*\{[^}]*transform:\s*none/);
    expect(block).toMatch(
      /\.ticker-inner\s*\{[^}]*white-space:\s*normal/,
    );
    expect(block).toMatch(/\.ticker-inner\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(block).toMatch(/\.ticker-inner\s*\{[^}]*gap:\s*8px/);
  });

  it("keeps the ticker items on semantic tokens", () => {
    expect(css).toMatch(/\.ticker-src\s*\{[^}]*color:\s*var\(--ink-4\)/);
    expect(css).toMatch(/\.ticker-item\s*\{[^}]*color:\s*var\(--ink-3\)/);
    expect(css).toMatch(/\.ticker-item a\s*\{[^}]*color:\s*var\(--ink-3\)/);
  });

  it("outweighs the theme anchor rule so marquee links stay ink, not green", () => {
    // html.light a is (0,1,2); a bare .ticker-item a (0,1,1) lost, so every
    // marquee link rendered green in light theme. The .ticker prefix fixes it.
    expect(css).toMatch(
      /\.ticker \.ticker-item a\s*\{[^}]*color:\s*var\(--ink-3\)/,
    );
  });
});

// Speed is derived, not fixed: the track holds two identical runs, so the
// duration must scale with its width or the marquee's reading speed changes
// with the size of the sweep.
describe("ticker speed is derived from the track width", () => {
  const fn = appjs.match(/function syncTickerSpeed\(track\)[\s\S]*?\n\}/)?.[0] ?? "";

  it("declares a px/s reading speed rather than a duration", () => {
    expect(appjs).toMatch(/const TICKER_PX_PER_SEC = \d+;/);
  });

  it("divides one run's width by that speed", () => {
    expect(fn).toContain("track.scrollWidth / 2");
    expect(fn).toMatch(/runWidth \/ TICKER_PX_PER_SEC/);
    expect(fn).toMatch(/setProperty\("--ticker-duration"/);
  });

  it("floors the duration so a near-empty ticker cannot race", () => {
    expect(fn).toMatch(/Math\.max\(\s*20\s*,/);
  });

  it("guards an unmeasured track instead of writing NaN", () => {
    expect(fn).toContain("if (!track) return;");
    expect(fn).toMatch(/!runWidth \|\| !Number\.isFinite\(runWidth\)/);
  });

  it("re-syncs whenever the track is rebuilt", () => {
    expect(appjs).toMatch(/track\.replaceChildren\([\s\S]{0,160}syncTickerSpeed\(track\)/);
  });
});
