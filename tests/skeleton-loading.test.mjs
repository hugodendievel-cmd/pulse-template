// tests/skeleton-loading.test.mjs — Story 6.3: the skeleton contract that
// replaces the full-screen splash. Source-scan only, no DOM/browser harness
// exists (architecture §7), following domain-endpoint.test.mjs.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const appjs = readFileSync(resolve(root, "dashboard/public/app.js"), "utf-8");
const html = readFileSync(resolve(root, "dashboard/public/index.html"), "utf-8");
const css = readFileSync(resolve(root, "dashboard/public/style.css"), "utf-8");

describe("applyData is the single data-entry path (Story 6.3)", () => {
  it("defines applyData(nextData)", () => {
    expect(appjs).toMatch(/function applyData\(nextData\)/);
  });

  it("is called from init(), the SSE update branch and the fallback fetch", () => {
    // Pin each entry path, not a bare occurrence count: a count passes even if
    // one path stops calling applyData while an unrelated call is added.
    expect(appjs).toMatch(
      /state\.sweepProgress = null;[\s\S]*?applyData\(msg\.data\)/,
    );
    expect(appjs).toMatch(/const d = await res\.json\(\);[\s\S]*?applyData\(d\)/);
    expect(appjs).toMatch(/if \(data\?\.sweep\) applyData\(data\)/);
  });

  it("references no loading function and no #loading", () => {
    const fn = appjs.match(/function applyData\(nextData\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).not.toBe("");
    expect(fn).not.toContain("#loading");
    expect(fn).not.toMatch(/hideLoading|completeLoading|renderLoading/);
  });
});

describe("per-source skeleton resolution (Story 6.3)", () => {
  it("calls resolvePanelSkeletons from the SSE progress branch", () => {
    expect(appjs).toContain("resolvePanelSkeletons(msg.steps)");
    expect(appjs).toMatch(/function resolvePanelSkeletons\(steps\)/);
  });

  it("resolves only panels with an explicit panel.sources binding, no literals", () => {
    const fn =
      appjs.match(/function resolvePanelSkeletons\(steps\)[\s\S]*?\n\}/)?.[0] ??
      "";
    expect(fn).not.toBe("");
    expect(fn).toContain("s.kind === \"source\"");
    expect(fn).toContain("panel?.sources");
    expect(fn).toContain('frame.dataset.resolved = "true"');
    expect(fn).not.toMatch(/["'`](today|streams|editions)["'`]/);
  });

  it("emits aria-busy and is-loading in buildDomainUI", () => {
    expect(appjs).toMatch(/aria-busy="true"/);
    expect(appjs).toContain("is-loading");
  });
});

describe("index.html has no splash (Story 6.3)", () => {
  it("contains no #loading or .loading-screen", () => {
    expect(html).not.toMatch(/id="loading"/);
    expect(html).not.toContain("loading-screen");
  });
});

describe("skeleton CSS contract (Story 6.3)", () => {
  it("binds the skeleton block to --inset with a pulse", () => {
    expect(css).toContain(".panel.is-loading");
    expect(css).toContain("skeleton-pulse");
    expect(css).toMatch(
      /\.panel\.is-loading \.panel-body::after\s*\{[^}]*background:\s*var\(--inset\)/s,
    );
  });

  it("adds the 150ms fade + 4px rise arrival motion", () => {
    expect(css).toContain("fade-rise");
    expect(css).toMatch(/@keyframes fade-rise\s*\{[^}]*translateY\(4px\)/s);
    expect(css).toMatch(/animation:\s*fade-rise 150ms/);
  });

  it("no longer declares any splash rule", () => {
    expect(css).not.toContain(".loading-screen");
    expect(css).not.toContain(".loading-step");
  });
});
