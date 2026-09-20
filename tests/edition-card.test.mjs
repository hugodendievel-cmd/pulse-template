// tests/edition-card.test.mjs — Story 3.4: the today right-rail editions card
// (--green-tint surface with two --surface rows). No DOM/E2E harness exists
// (architecture §7), so this follows the source-scan convention of
// radar-panel/signals-panel tests: it asserts the rendered-markup contract,
// the fetch resilience and the semantic-token CSS bindings without booting a
// browser.
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
  appjs.match(/function renderEditionCard\(panel\)[\s\S]*?\n\}/)?.[0] ?? "";
const fetchFn =
  appjs.match(/async function fetchEdition\(\)[\s\S]*?\n\}/)?.[0] ?? "";
const panelFn =
  appjs.match(/function editionPanel\(\)[\s\S]*?\n\}/)?.[0] ?? "";
const renderPanelFn =
  appjs.match(/function renderPanel\(panel, sources, byCategory\)[\s\S]*?\n\}/)?.[0] ??
  "";

describe("example pack edition-card panel (AC1/AC2/AC5)", () => {
  const panel = example.panels.find((p) => p.variant === "edition-card");

  it("is a rail card targeting the pack's own view", () => {
    expect(panel).toMatchObject({
      id: "editions-card",
      title: "editions",
      icon: "list",
      section: "briefing",
      variant: "edition-card",
      column: "rail",
      target: "editions",
      weeklyRun: "sun 18:00",
      actionLabel: "read",
    });
  });

  it("sits after the newest and streams-preview panels", () => {
    // Story 4.2 inserted the newswires/googlenews panels before streams-preview,
    // so only the relative order is contracted (not adjacency to `newest`).
    const ids = example.panels.map((p) => p.id);
    expect(ids.indexOf("edition-card")).toBe(-1); // id is plural in the pack
    expect(ids.indexOf("editions-card")).toBeGreaterThan(ids.indexOf("newest"));
    expect(ids.indexOf("editions-card")).toBe(ids.indexOf("streams-preview") + 1);
  });
});

describe("editionPanel resolution (AC1/AC5)", () => {
  it("finds the panel by variant, never by a client panel-id literal", () => {
    expect(panelFn).toContain('p.variant === "edition-card"');
    expect(panelFn).not.toContain("editions-card");
  });
});

describe("renderEditionCard markup (AC1/AC2/AC3/AC4)", () => {
  it("resolves panel and body at call time (render-time and post-fetch)", () => {
    expect(renderFn).toMatch(/const p = panel \|\| editionPanel\(\)/);
    expect(renderFn).toMatch(/document\.getElementById\("body-" \+ p\.id\)/);
  });

  it("reads its data from the pure editionCardModel helper", () => {
    expect(appjs).toMatch(
      /let lastEdition = null;/,
    );
    expect(renderFn).toMatch(
      /window\.RenderCore\.editionCardModel\(\s*lastDigest,\s*lastEdition,?\s*\)/,
    );
  });

  it("emits the daily row with sent 07:00 · edition {id} and a read control", () => {
    expect(renderFn).toMatch(/class="edition-row"/);
    expect(renderFn).toContain("sent 07:00 · edition");
    expect(renderFn).toMatch(/esc\(daily\.id\)/);
    // Design 3a makes `read` a filled green pill, not a text link.
    expect(renderFn).toMatch(/<button class="edition-btn" type="button">/);
    expect(renderFn).toMatch(/esc\(p\.actionLabel \|\| "read"\)/);
    expect(renderFn).toMatch(/esc\(p\.dailyTitle \|\| ""\)/);
  });

  it("shows an honest empty state instead of a dead link when no edition exists (AC3)", () => {
    expect(renderFn).toContain('class="edition-row edition-row--empty"');
    expect(renderFn).toMatch(/esc\(p\.emptyLabel \|\| "no edition yet"\)/);
    // The read control exists only inside the daily-present branch.
    expect(renderFn).toMatch(/if \(daily\) \{[\s\S]*?edition-btn[\s\S]*?\} else \{/);
  });

  it("shows the weekly next-run time plus state only — no progress bar (AC4)", () => {
    expect(renderFn).toContain('class="edition-row edition-row--weekly"');
    expect(renderFn).toMatch(/esc\(p\.weeklyRun \|\| ""\)/);
    expect(renderFn).toContain('class="edition-state"');
    expect(renderFn).toMatch(/weekly \? "generated" : "next run"/);
    expect(renderFn).not.toMatch(/<progress|progress-bar|progress-bar/i);
  });

  it("routes the read control to the pack target via setView (AC2)", () => {
    expect(renderFn).toMatch(/setView\(p\.target\)/);
    expect(renderFn).not.toContain("setView(" + '"' + "editions" + '"' + ")");
  });

  it("routes every dynamic string through esc()", () => {
    expect(renderFn).toMatch(/esc\(daily\.id\)/);
    expect(renderFn).toMatch(/esc\(p\.actionLabel/);
    expect(renderFn).toMatch(/esc\(p\.emptyLabel/);
    expect(renderFn).toMatch(/esc\(p\.weeklyRun/);
  });

  it("keeps the panel-id and view-id vocabulary out of the client", () => {
    // The pack owns id/target; the client only reads them. "edition" singular
    // class/variable names are the safe form. A quoted "editions" literal is
    // still forbidden, but the archive's `persistence.editions` field read and
    // "no past editions yet" copy are not view-id hardcoding (Story 5.3).
    expect(appjs).not.toMatch(/["'`]editions["'`]/);
    expect(core).not.toMatch(/["'`]editions["'`]/);
  });
});

describe("renderPanel dispatch (AC1)", () => {
  it("returns to renderEditionCard before the aggregate/select logic", () => {
    expect(renderPanelFn).toMatch(
      /if \(panel\.variant === "edition-card"\) \{\s*renderEditionCard\(panel\);\s*return;\s*\}/,
    );
    const dispatchAt = renderPanelFn.indexOf('"edition-card"');
    const selectAt = renderPanelFn.indexOf("selectPanelItems");
    expect(dispatchAt).toBeGreaterThan(-1);
    expect(dispatchAt).toBeLessThan(selectAt);
  });
});

describe("fetchEdition resilience (AC1/AC6)", () => {
  it("consumes only the existing digest, newsletter and health endpoints", () => {
    expect(fetchFn).toContain('fetch("/api/digest")');
    expect(fetchFn).toContain('fetch("/api/newsletter")');
    expect(fetchFn).toContain('fetch("/api/health")');
    expect(fetchFn).not.toContain("/api/editions");
  });

  it("uses allSettled and r.ok guards so a 404 leaves the empty state", () => {
    expect(fetchFn).toContain("Promise.allSettled");
    expect(fetchFn.match(/r\.ok \? r\.json\(\) : null/g) ?? []).toHaveLength(3);
    expect(fetchFn).not.toMatch(/\bthrow\b/);
    expect(fetchFn).toMatch(/renderEditionCard\(\)/);
  });

  it("is fetched at boot next to fetchDigest", () => {
    expect(appjs).toMatch(/fetchEdition\(\)\.catch/);
    expect(appjs).toMatch(/fetchDigest\(\)\.catch/);
  });

  it("refreshes the card on the digest and newsletter SSE events", () => {
    expect(appjs).toMatch(/msg\.type === "digest"[\s\S]{0,80}renderEditionCard\(\)/);
    expect(appjs).toMatch(
      /msg\.type === "newsletter"[\s\S]{0,80}lastEdition = msg\.data;[\s\S]{0,40}renderEditionCard\(\)/,
    );
  });
});

describe("edition-card CSS binds semantic tokens (AC5)", () => {
  // Design 3a tints the panel itself; the card element is only the stack, so
  // the rows sit directly on the green ground instead of a card-in-a-card.
  it("gives the panel the --green-tint surface", () => {
    const tone = css.match(/\.panel--green,\s*\n\.panel--green:hover\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(tone).toContain("background: var(--green-tint)");
    const card = css.match(/\.edition-card\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(card).not.toContain("background:");
    expect(card).toContain("display: flex");
    expect(card).toContain("flex-direction: column");
    expect(card).toContain("gap: 10px");
  });

  it("declares the tone on the pack, not by panel id", () => {
    expect(
      example.panels.find((p) => p.variant === "edition-card").tone,
    ).toBe("green");
  });

  it("gives the rows the --surface surface (two rows)", () => {
    const row = css.match(/\.edition-row\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(row).toContain("background: var(--surface)");
    expect(row).toContain("border-radius: 9px");
    expect(row).toContain("padding: 13px 14px");
    expect(row).toContain("display: flex");
    expect(row).toContain("align-items: center");
    expect(row).toContain("justify-content: space-between");
    expect(row).toContain("gap: 12px");
  });

  it("styles the mono when/state copy with quiet ink tokens", () => {
    const when = css.match(/\.edition-when\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(when).toContain("font-family: var(--mono)");
    expect(when).toContain("font-size: 11.5px");
    expect(when).toContain("color: var(--ink-3)");

    const state = css.match(/\.edition-state\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(state).toContain("font-family: var(--mono)");
    expect(state).toContain("font-size: 11.5px");
    expect(state).toContain("color: var(--ink-4)");
    expect(state).toContain("text-transform: uppercase");
    expect(state).toContain("letter-spacing: 0.06em");

    expect(css).toMatch(
      /\.edition-row--empty \.edition-when\s*\{[^}]*color: var\(--ink-4\)/s,
    );
  });

  it("adds the shared .view-link contract (reused by Story 3.5)", () => {
    const link = css.match(/(?:^|\n)\.view-link\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(link).toContain("font-family: var(--mono)");
    expect(link).toContain("font-size: 11.5px");
    expect(link).toContain("color: var(--green-ink)");
    expect(link).toContain("background: none");
    expect(link).toContain("border: none");
    expect(link).toContain("cursor: pointer");
    expect(css).toMatch(
      /\.view-link:hover\s*\{[^}]*color: var\(--green\)[^}]*text-decoration: underline/s,
    );
  });
});
