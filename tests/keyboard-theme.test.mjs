// tests/keyboard-theme.test.mjs — Story 6.6: theme parity, keyboard shortcuts
// and the icon sprite. Source-scan only: app.js is a browser script (not
// importable under vitest), so the shortcut wiring is asserted structurally.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDomain } from "../domains/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const app = readFileSync(resolve(root, "dashboard/public/app.js"), "utf-8");
const html = readFileSync(resolve(root, "dashboard/public/index.html"), "utf-8");
const css = readFileSync(resolve(root, "dashboard/public/style.css"), "utf-8");

// ── Keyboard numbering shortcuts (FR-C1) ─────────────────────────────────
describe("number shortcuts derive from the active pack (Story 6.6)", () => {
  it("reads the digits from the keydown event", () => {
    expect(app).toContain("const digit = Number(e.key)");
  });

  it("maps the digit positionally into DOMAIN.views", () => {
    expect(app).toMatch(/DOMAIN\?\.views\s*\?\?\s*\[\]/);
    expect(app).toMatch(/views\[digit\s*-\s*1\]/);
  });

  it("guards the digit range to 1..9 and skips modifier/typing keys", () => {
    expect(app).toMatch(/digit\s*>=\s*1\s*&&\s*digit\s*<=\s*9/);
    expect(app).toMatch(/!inInput\s*&&\s*!e\.metaKey\s*&&\s*!e\.ctrlKey/);
  });

  it("switches to the resolved view via setView and no-ops when absent", () => {
    expect(app).toMatch(/target\?\.id/);
    expect(app).toMatch(/setView\(target\.id\)/);
  });

  it("introduces no quoted view-id literal", () => {
    const viewIds = loadDomain("example").views.map((v) => v.id);
    for (const id of viewIds) {
      expect(app, `app.js must not hardcode "${id}"`).not.toMatch(
        new RegExp(`["'\`]${id}["'\`]`),
      );
    }
  });
});

// The mapping is positional: for any pack, digit d activates views[d - 1]. The
// example pack happens to be today/streams/editions; the test asserts the rule, not
// those ids, so a future pack with a different order still passes.
//
// The index expression is *extracted from app.js* and evaluated here, so this
// exercises the shipped expression rather than a re-implementation: an off-by-
// one regression (views[digit]) or a dropped mapping fails these tests.
describe("digit → view mapping is generic across packs", () => {
  const indexExpr = app.match(/const target = views\[([^\]]+)\]/)?.[1];
  // Fail loudly if the mapping expression disappears entirely.
  if (!indexExpr) throw new Error("no positional mapping found in app.js");
  const mapDigit = (views, digit) =>
    views[new Function("digit", `return ${indexExpr}`)(digit)]?.id;

  it("maps 1/2/3 to the pack's first three views in order", () => {
    const views = loadDomain("example").views;
    expect(mapDigit(views, 1)).toBe(views[0].id);
    expect(mapDigit(views, 2)).toBe(views[1].id);
    expect(mapDigit(views, 3)).toBe(views[2].id);
  });

  it("is a no-op for a missing view index", () => {
    const views = loadDomain("example").views;
    expect(mapDigit(views, views.length + 1)).toBeUndefined();
  });

  it("stays correct for an arbitrary pack order", () => {
    const views = [{ id: "alpha" }, { id: "beta" }, { id: "gamma" }];
    expect(mapDigit(views, 2)).toBe("beta");
  });
});

// ── Theme persistence (Story 6.6, AC3) ───────────────────────────────────
describe("theme persistence (Story 6.6)", () => {
  it("applyTheme is the single writer of pulse-theme", () => {
    const writers =
      app.match(/localStorage\.setItem\(\s*["']pulse-theme["']/g) ?? [];
    expect(writers).toHaveLength(1);
    expect(app).toMatch(
      /localStorage\.setItem\(\s*["']pulse-theme["'],\s*mode\s*\)/,
    );
  });

  it("follows the OS colour scheme unless a choice is saved", () => {
    expect(app).toMatch(/localStorage\.getItem\(\s*["']pulse-theme["']\s*\)/);
    expect(app).toMatch(
      /function systemTheme\(\)[\s\S]*?prefers-color-scheme:\s*dark/,
    );
    expect(app).toMatch(/applyTheme\(saved \|\| ["']auto["']/);
    // Live-follows the OS while the mode is automatic.
    expect(app).toMatch(/\(\s*["']change["'],\s*\(\)\s*=>/);
    expect(app).toMatch(/if \(themeMode\(\) === ["']auto["']\)/);
  });

  it("stores nothing in auto, so system-follow stays live", () => {
    const fn = app.match(/function applyTheme\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toMatch(/if \(mode === ["']auto["']\) localStorage\.removeItem/);
    expect(fn).toMatch(/else localStorage\.setItem\(\s*["']pulse-theme["']/);
  });

  it("cycles light -> dark -> auto, with terminal outside the cycle", () => {
    expect(app).toMatch(/const THEME_CYCLE = \["light", "dark", "auto"\]/);
    const cycle = app.match(/function cycleTheme\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(cycle).toContain("THEME_CYCLE[(i + 1) % THEME_CYCLE.length]");
    // T cycles; Shift+T toggles terminal.
    expect(app).toMatch(/e\.key === "t"[\s\S]{0,80}cycleTheme\(\)/);
    expect(app).toMatch(/applyTheme\(themeMode\(\) === ["']terminal["']/);
  });

  it("applyTheme keeps the terminal class override", () => {
    expect(app).toMatch(/root\.classList\.add\(\s*["']terminal["']\s*\)/);
    expect(app).toMatch(/root\.classList\.remove\(\s*["']light["']\s*,\s*["']terminal["']\s*\)/);
  });

  it("shows a distinct auto glyph, not a dot or the sun/moon", () => {
    expect(html).toContain('class="icon-auto"');
    // Only one of the three glyphs shows at a time.
    expect(css).toMatch(/\.theme-toggle \.icon-auto\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(
      /html\[data-theme-mode="auto"\] \.theme-toggle \.icon-sun,[\s\S]*?\.icon-moon\s*\{[^}]*display:\s*none/,
    );
    // The auto rules must sit after the sun/moon swap to win the cascade.
    const swap = css.indexOf("html.light .theme-toggle .icon-moon");
    const auto = css.indexOf(
      'html[data-theme-mode="auto"] .theme-toggle .icon-auto',
    );
    expect(swap).toBeGreaterThan(-1);
    expect(auto).toBeGreaterThan(swap);
  });
});

// ── Shortcuts overlay (index.html) ───────────────────────────────────────
describe("keyboard shortcuts overlay (Story 6.6)", () => {
  it("lists the current set including the 1/2/3 view row", () => {
    expect(html).toMatch(/Switch view 1 \/ 2 \/ 3/);
    expect(html).toMatch(/<kbd>1<\/kbd><kbd>2<\/kbd><kbd>3<\/kbd>/);
  });

  it("keeps the ⌘K search row and the other shortcuts", () => {
    expect(html).toMatch(/<kbd>⌘<\/kbd><kbd>K<\/kbd>/);
    expect(html).toContain("Cycle theme: light / dark / auto");
    expect(html).toContain("Toggle terminal theme");
    expect(html).toContain("Collapse / expand all panels");
    expect(html).toContain("Show this help");
  });

  it("keeps the dialog semantics", () => {
    expect(html).toMatch(/id="kbdOverlay"[^>]*role="dialog"/);
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="kbdTitle"');
  });

  it("never hardcodes a view label — the digits are positional", () => {
    const overlay =
      html.match(/id="kbdOverlay"[\s\S]*?<!--\s*Pure render core/)?.[0] ?? "";
    expect(overlay).not.toBe("");
    for (const id of loadDomain("example").views.map((v) => v.id)) {
      expect(overlay, `overlay must not name "${id}"`).not.toContain(id);
    }
  });
});

// ── Icon sprite un-hide (FR-C7/FR-C8) ────────────────────────────────────
describe("icon sprite is visible again (Story 6.6)", () => {
  // The design handoff is explicit — "No icons are used. Status is expressed
  // with colored dots, bars and mono glyphs … don't introduce an icon set." So
  // the panel header carries a label, never a glyph: there is no .panel-icon
  // markup and no dead display:none rule for it either.
  it("renders no icon in the panel header", () => {
    expect(app).not.toContain("panel-icon");
    expect(css).not.toContain(".panel-icon");
  });

  it("leaves no .stat-icon display:none dead rule", () => {
    expect(css).not.toMatch(/\.stat-icon\s*\{[^}]*display:\s*none/);
  });

  it("keeps the sprite available for the chrome that still uses it", () => {
    // The sprite itself stays (header archive link, newsletter pages); only the
    // per-panel glyph is gone.
    expect(html).toContain('<symbol id="ic-list"');
  });

  // The handoff's wordmark is `aipulse` plus the plain 9x16 green block —
  // "not an SVG logo" — so there is no mark graphic and no rule for one.
  it("renders no logo mark graphic", () => {
    expect(html).not.toContain("logo-mark");
    expect(css).not.toContain(".logo-mark");
  });
});

// Un-hiding `.panel-icon` is necessary but not sufficient: the panel frame
// emits `<use href="#ic-${p.icon}">`, so every pack icon must resolve to a
// sprite symbol or the slot renders blank.
describe("the sprite resolves every panel icon (Story 6.6)", () => {
  const symbolIds = new Set(
    [...html.matchAll(/<symbol id="(ic-[a-z-]+)"/g)].map((m) => m[1]),
  );

  it("ships at least one sprite symbol", () => {
    expect(symbolIds.size).toBeGreaterThan(0);
  });

  it("has a matching #ic- symbol for every DOMAIN panel icon", () => {
    for (const panel of loadDomain("example").panels) {
      if (!panel.icon) continue;
      expect(
        symbolIds.has(`ic-${panel.icon}`),
        `no <symbol id="ic-${panel.icon}"> for panel "${panel.id}"`,
      ).toBe(true);
    }
  });
});
