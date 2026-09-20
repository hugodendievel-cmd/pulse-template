// tests/delta-badge.test.mjs — Story 6.5: the `N new` delta badge contract.
// Source-scan only: app.js is a browser script (not importable under vitest),
// so the guard against re-rendering a visible list is asserted structurally.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const app = readFileSync(resolve(root, "dashboard/public/app.js"), "utf-8");
const styleCss = readFileSync(
  resolve(root, "dashboard/public/style.css"),
  "utf-8",
);

describe("delta badge contract (Story 6.5)", () => {
  it("keeps pendingDelta keyed by panel id", () => {
    expect(app).toContain("const pendingDelta = new Map()");
  });

  it("counts arrivals with the pure panelDeltaCount helper", () => {
    expect(app).toContain("panelDeltaCount(");
  });

  it("renders the badge via renderDeltaBadge", () => {
    expect(app).toContain("function renderDeltaBadge(");
  });

  it("gates the full render on the first delta", () => {
    expect(app).toContain("delta.isFirst === true");
  });

  it("guards a late-joining replay before the client's first paint", () => {
    // A replayed non-first delta before the first applyData paint must still
    // render fully (bodies would otherwise stay skeletons with a bogus badge).
    expect(app).toContain("!hasRendered");
    expect(app).toMatch(/!hasRendered\s*\|\|\s*!delta\s*\|\|\s*delta\.isFirst === true/);
  });

  it("re-attaches a pending badge after a view-switch render", () => {
    expect(app).toMatch(/pendingDelta\.has\(panel\.id\)/);
    expect(app).toMatch(/pendingDelta\.get\(panel\.id\)/);
  });
});

describe("delta badge guard (never re-sort a visible list)", () => {
  // The applyData panel loop: from the delta read to the briefing refresh.
  const start = app.indexOf("const delta = nextData.delta");
  const end = app.indexOf("renderBriefing(", start);
  const loop = app.slice(start, end);
  const elseBranch = loop.slice(loop.indexOf("} else {"));

  it("finds the delta-gated panel loop", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(loop).toContain("delta.isFirst === true");
  });

  it("sets pendingDelta, renders the badge, then continues", () => {
    const set = elseBranch.indexOf("pendingDelta.set(");
    const badge = elseBranch.indexOf("renderDeltaBadge(");
    const cont = elseBranch.indexOf("continue;");
    expect(set).toBeGreaterThan(-1);
    expect(badge).toBeGreaterThan(set);
    expect(cont).toBeGreaterThan(badge);
  });

  it("skips renderPanel in the non-first branch", () => {
    expect(elseBranch).not.toContain("renderPanel(");
  });
});

describe("delta badge style (header pill, no layout shift)", () => {
  it("binds the pill to the green tokens in the header", () => {
    expect(styleCss).toContain(".delta-badge");
    expect(styleCss).toMatch(/\.delta-badge\s*\{[^}]*--green-tint/);
    expect(styleCss).toMatch(/\.delta-badge\s*\{[^}]*--green-ink/);
  });
});
