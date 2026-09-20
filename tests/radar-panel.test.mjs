// tests/radar-panel.test.mjs — Story 3.2: the today right-rail model radar
// (8px dot | 1fr | tag rows) and its four statuses. No DOM/E2E harness exists
// (architecture §7), so this follows the source-scan convention of
// briefing-panel.test.mjs: it asserts the rendered markup contract and the
// semantic-token CSS bindings without booting a browser.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const appjs = readFileSync(resolve(root, "dashboard/public/app.js"), "utf-8");
const css = readFileSync(resolve(root, "dashboard/public/style.css"), "utf-8");

describe("RADAR_STATUS_META (AC2)", () => {
  const meta =
    appjs.match(/const RADAR_STATUS_META = \{[\s\S]*?\n\};/)?.[0] ?? "";

  it("is a four-entry map carrying dot, bg, fg and label", () => {
    for (const key of ["released", "announced", "rumored", '"in-development"']) {
      expect(meta).toContain(`${key}:`);
    }
    expect(meta.match(/label:/g) ?? []).toHaveLength(4);
    expect(meta.match(/dot:/g) ?? []).toHaveLength(4);
    expect(meta.match(/bg:/g) ?? []).toHaveLength(4);
    expect(meta.match(/fg:/g) ?? []).toHaveLength(4);
  });

  it("binds every colour to a semantic token", () => {
    expect(meta).toMatch(/released: \{[\s\S]*?dot: "var\(--green\)"[\s\S]*?bg: "var\(--green-tint\)"[\s\S]*?fg: "var\(--green-ink\)"[\s\S]*?label: "RELEASED"/);
    expect(meta).toMatch(/announced: \{[\s\S]*?dot: "var\(--amber-dot\)"[\s\S]*?bg: "var\(--amber-tint\)"[\s\S]*?fg: "var\(--amber-ink\)"[\s\S]*?label: "ANNOUNCED"/);
    expect(meta).toMatch(/rumored: \{[\s\S]*?dot: "var\(--amber-dot\)"[\s\S]*?bg: "var\(--inset\)"[\s\S]*?fg: "var\(--ink-4\)"[\s\S]*?label: "RUMORED"/);
    expect(meta).toMatch(/"in-development": \{[\s\S]*?dot: "var\(--green-soft\)"[\s\S]*?bg: "var\(--green-tint-2\)"[\s\S]*?fg: "var\(--green-ink\)"[\s\S]*?label: "IN DEV"/);
  });

  it("does not inline the old legacy palette colours", () => {
    expect(meta).not.toContain("var(--pink)");
    expect(meta).not.toContain("var(--blue)");
    expect(meta).not.toContain("rgba(");
  });
});

describe("buildRadarHtml markup (AC1/AC2/AC4)", () => {
  const build = appjs.match(/function buildRadarHtml[\s\S]*?\n\}/)?.[0] ?? "";

  it("emits a .radar-row per model carrying data-status", () => {
    expect(build).toContain('class="radar-row"');
    expect(build).toMatch(/data-status="\$\{esc\(status\)\}"/);
  });

  it("replaces the old .radar-card/.radar-status/.radar-status-label markup", () => {
    expect(build).not.toContain("radar-card");
    expect(build).not.toContain("radar-status-label");
    expect(build).not.toContain("radar-status");
    // Status colours come from [data-status] CSS, never inline style.
    expect(build).not.toMatch(/class="radar-(dot|tag)"\s+style=/);
    expect(build).not.toContain("background:${meta");
    expect(build).not.toContain("box-shadow");
  });

  it("emits dot, info (name + org + optional note) and tag", () => {
    expect(build).toContain('class="radar-dot"');
    expect(build).toContain('class="radar-info"');
    expect(build).toContain('class="radar-name"');
    expect(build).toContain('class="radar-org"');
    expect(build).toContain('class="radar-note"');
    expect(build).toContain('class="radar-tag"');
    expect(build).toMatch(/m\.note \?/);
  });

  it("falls back to in-development so a model can never render an empty tag", () => {
    // The fallback must test own keys: a prototype key ("toString", …) is
    // truthy against a plain map literal but has no `label`.
    expect(build).toMatch(
      /hasOwnProperty\.call\(\s*RADAR_STATUS_META,\s*m\.status,?\s*\)[\s\S]{0,40}"in-development"/,
    );
    expect(build).toContain("meta.label");
  });

  it("links the model name externally when it has a url (AC4)", () => {
    expect(build).toMatch(/target="_blank" rel="noopener"/);
    expect(build).toMatch(/esc\(m\.url\)/);
    expect(build).toMatch(/esc\(m\.name\)/);
  });

  it("routes every dynamic string through esc()", () => {
    expect(build).toMatch(/esc\(m\.org\)/);
    expect(build).toMatch(/esc\(m\.note\)/);
    expect(build).toMatch(/esc\(status\)/);
  });

  // Design 3a labels the card's right meta `7 tracked` — radar entries only;
  // signals are their own card now.
  it("populates #radarCount with the tracked-model count", () => {
    expect(build).toContain('"radarCount"');
    expect(build).toMatch(/const tracked = analysis\.modelRadar\?\.length \|\| 0;/);
    expect(build).toMatch(/tracked \? `\$\{tracked\} tracked` : ""/);
  });
});

describe("renderBriefing radar visibility (AC3)", () => {
  const fn = appjs.match(/function renderBriefing\(analysis, d\)[\s\S]*?\n\}/)?.[0] ?? "";

  it("hides the radar panel when there are no tracked entries", () => {
    expect(fn).toMatch(
      /radarPanel\.classList\.toggle\("panel-absent", !analysis\?\.modelRadar\?\.length\)/,
    );
  });

  it("never forces radar display (visibility stays with setView)", () => {
    expect(appjs).not.toMatch(/radarPanel\.style\.display/);
  });

  it("uses a reversible class toggle, never an add/remove pair", () => {
    expect(fn).toMatch(/radarPanel\.classList\.toggle\(/);
    expect(fn).not.toMatch(/radarPanel\.classList\.add\(/);
    expect(fn).not.toMatch(/radarPanel\.classList\.remove\(/);
  });
});

describe("radar CSS binds semantic tokens (AC2/AC5)", () => {
  it("lays out the row as 8px dot | 1fr | tag with hairline dividers", () => {
    const row = css.match(/\.radar-row\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(row).toContain("display: grid");
    expect(row).toContain("grid-template-columns: 8px 1fr auto");
    expect(row).toContain("gap: 12px");
    expect(row).toContain("align-items: start");
    expect(row).toContain("padding: 12px 0");
    expect(row).toContain("border-bottom: 1px solid var(--hairline)");
    expect(css).toMatch(/\.radar-row:last-child\s*\{[^}]*border-bottom: none/s);
  });

  it("styles the 8px dot and its status variants", () => {
    const dot = css.match(/\.radar-dot\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(dot).toContain("width: 8px");
    expect(dot).toContain("height: 8px");
    expect(dot).toContain("border-radius: 50%");
    expect(dot).toContain("margin-top: 5px");
    expect(dot).toContain("background: var(--amber-dot)");
    expect(css).toMatch(/\[data-status="released"\] \.radar-dot\s*\{[^}]*background: var\(--green\)/s);
    expect(css).toMatch(/\[data-status="in-development"\] \.radar-dot\s*\{[^}]*background: var\(--green-soft\)/s);
  });

  it("styles name, org and note", () => {
    const name = css.match(/\.radar-name\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(name).toContain("font-family: var(--font)");
    expect(name).toContain("font-size: 15px");
    expect(name).toContain("font-weight: 600");
    expect(name).toContain("color: var(--ink)");
    const org = css.match(/\.radar-org\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(org).toContain("font-family: var(--mono)");
    expect(org).toContain("font-size: 11.5px");
    expect(org).toContain("color: var(--ink-4)");
    const note = css.match(/\.radar-note\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(note).toContain("font-size: 13.5px");
    expect(note).toContain("color: var(--ink-3)");
  });

  it("styles the tag and keeps all four statuses distinct", () => {
    const tag = css.match(/\.radar-tag\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(tag).toContain("font-family: var(--mono)");
    expect(tag).toContain("font-size: 10.5px");
    expect(tag).toContain("text-transform: uppercase");
    expect(tag).toContain("letter-spacing: 0.06em");
    expect(tag).toContain("padding: 2px 7px");
    expect(tag).toContain("border-radius: 4px");
    expect(css).toMatch(/\[data-status="released"\] \.radar-tag\s*\{[^}]*background: var\(--green-tint\)[^}]*color: var\(--green-ink\)/s);
    expect(css).toMatch(/\[data-status="announced"\] \.radar-tag\s*\{[^}]*background: var\(--amber-tint\)[^}]*color: var\(--amber-ink\)/s);
    expect(css).toMatch(/\[data-status="rumored"\] \.radar-tag\s*\{[^}]*background: var\(--inset\)[^}]*color: var\(--ink-4\)/s);
    expect(css).toMatch(/\[data-status="in-development"\] \.radar-tag\s*\{[^}]*background: var\(--green-tint-2\)[^}]*color: var\(--green-ink\)/s);
  });

  it("removes the superseded .radar-card/.radar-status selectors", () => {
    expect(css).not.toMatch(/\.radar-card\s*\{/);
    expect(css).not.toMatch(/\.radar-status\s*\{/);
    expect(css).not.toMatch(/\.radar-status-label\s*\{/);
  });

  it("gives the rail panel the surface card (radius 12, no own 1px border)", () => {
    const rail = css.match(/(?:^|\n)\.panel\[data-column="rail"\]\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rail).toContain("background: var(--surface)");
    expect(rail).toContain("border-radius: 12px");
    expect(rail).toMatch(/border: none/);
  });

  it("suppresses absent panels via the shared .panel-absent rule", () => {
    expect(css).toMatch(/\.panel\.panel-absent\s*\{[^}]*display: none/s);
  });
});
