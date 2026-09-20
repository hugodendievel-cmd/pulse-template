// tests/architecture.test.mjs — Story 1.7: structural invariants that keep the
// engine pack-agnostic. Source-scan + pure imports, no DOM, no server boot.
// Forbidden vocabulary is derived from domains/example.mjs, never copied: the
// test guards against literal drift, so it must not become a second source of
// truth.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDomain, normalizeViews, viewPanels } from "../domains/index.mjs";
import example from "../domains/example.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const CLIENT_FILES = {
  "app.js": readFileSync(
    resolve(root, "dashboard/public/app.js"),
    "utf-8",
  ),
  "render-core.mjs": readFileSync(
    resolve(root, "dashboard/public/render-core.mjs"),
    "utf-8",
  ),
};
// Read now so Story 6.3 flips the splash todos below without touching setup.
const html = readFileSync(
  resolve(root, "dashboard/public/index.html"),
  "utf-8",
);
const styleCss = readFileSync(
  resolve(root, "dashboard/public/style.css"),
  "utf-8",
);
const newsletterRender = readFileSync(
  resolve(root, "lib/newsletter/render.mjs"),
  "utf-8",
);

describe("views uniqueness", () => {
  const sources = [
    ["normalizeViews(example)", normalizeViews(example)],
    ["loadDomain('example').views", loadDomain("example").views],
  ];

  for (const [label, views] of sources) {
    it(`${label}: every view id appears in exactly one entry`, () => {
      for (const id of views.map((v) => v.id)) {
        expect(views.filter((v) => v.id === id)).toHaveLength(1);
      }
    });

    it(`${label}: has no duplicate ids`, () => {
      const ids = views.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  }
});

describe("legacy nav derivation", () => {
  // Minimal legacy pack: no `views`, only `nav` + `panels`.
  const panels = [
    { id: "p", section: "news" },
    { id: "q", section: "code" },
  ];
  const views = normalizeViews({
    nav: [
      { filter: "all", label: "All" },
      { filter: "news", label: "News" },
    ],
    panels,
  });

  it("returns one view per nav entry, ids matching the filters", () => {
    expect(views.map((v) => v.id)).toEqual(["all", "news"]);
  });

  it("derives 'all' with no membership filter, so it contains every panel", () => {
    expect(viewPanels(views, panels, "all")).toEqual(panels);
  });

  it("derives 'news' containing exactly the news panel", () => {
    expect(viewPanels(views, panels, "news")).toEqual([panels[0]]);
  });
});

describe("client literal scan", () => {
  const VIEW_IDS = example.views.map((v) => v.id);
  const SOURCE_NAMES = example.sources.map((s) => s.name);
  // A view id is forbidden as a *quoted string literal* (single, double or
  // backtick) — that is how hardcoding would appear (setView("…"),
  // data-view="…"). A bare substring scan would also flag legitimate
  // non-literal uses added by Story 5.3: `persistence.editions` (the
  // /api/health field name the archive reads) and the user-facing empty-state
  // copy "no past editions yet". The invariant is that the client never
  // hardcodes a view id, not that a word never appears.
  const quoted = (id) => new RegExp(`["'\`]${id}["'\`]`);

  for (const [file, source] of Object.entries(CLIENT_FILES)) {
    for (const id of VIEW_IDS) {
      it(`${file} contains no view id literal "${id}"`, () => {
        expect(source).not.toMatch(quoted(id));
      });
    }
    for (const name of SOURCE_NAMES) {
      it(`${file} contains no source name "${name}"`, () => {
        expect(source).not.toContain(name);
      });
    }
  }
});

describe("session persistence keys stay view-neutral (Story 4.3)", () => {
  const VIEW_IDS = example.views.map((v) => v.id);

  it("app.js sessionStorage keys contain no view id", () => {
    const keys =
      CLIENT_FILES["app.js"]
        .match(/["'`]pulse-[a-z-]+["'`]/g)
        ?.map((k) => k.replace(/["'`]/g, "")) ?? [];
    expect(keys.length).toBeGreaterThanOrEqual(2);
    for (const key of keys) {
      for (const id of VIEW_IDS) expect(key).not.toContain(id);
    }
  });
});

describe("self-hosted fonts (Story 2.2)", () => {
  it("index.html references no Google Fonts origin", () => {
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("fonts.gstatic.com");
  });

  it("lib/newsletter/render.mjs references no Google Fonts origin", () => {
    expect(newsletterRender).not.toContain("fonts.googleapis.com");
    expect(newsletterRender).not.toContain("fonts.gstatic.com");
  });

  it('style.css declares a single variable @font-face for "Inter"', () => {
    expect(styleCss).toContain('font-family: "Inter"');
    expect(styleCss).toContain("fonts/inter.woff2");
    // One variable face covering 400–700, not several single-weight faces that
    // all point at the same file.
    expect(styleCss).toContain("font-weight: 400 700;");
    expect(styleCss).not.toContain("fonts/inter-400.woff2");
  });

  it("self-hosts Inter rather than reaching for Google Fonts", () => {
    // The pre-redesign build linked fonts.googleapis.com; the CSP forbids it.
    expect(styleCss).not.toContain("fonts.googleapis.com");
    expect(styleCss).not.toContain("Instrument Sans");
  });

  it('style.css declares @font-face for "JetBrains Mono"', () => {
    expect(styleCss).toContain('font-family: "JetBrains Mono"');
    expect(styleCss).toContain("fonts/jetbrains-mono-");
  });

  it("every font file referenced by style.css exists", () => {
    const srcs = [...styleCss.matchAll(/url\("(fonts\/[^"]+)"\)/g)].map(
      (m) => m[1],
    );
    expect(srcs.length).toBeGreaterThanOrEqual(4);
    for (const src of srcs) {
      expect(existsSync(resolve(root, "dashboard/public", src)), src).toBe(
        true,
      );
    }
  });
});

describe("CSP + asset hashing (Stories 2.2/2.3)", () => {
  const server = readFileSync(resolve(root, "server.mjs"), "utf-8");
  // Source assertion, deliberately: importing server.mjs would boot Express/SSE.
  const assetVersion =
    server.match(/const ASSET_VERSION = \(\(\) => \{[\s\S]*?\}\)\(\);/)?.[0] ??
    "";

  it("helmet directives contain no Google Fonts origins", () => {
    expect(server).not.toContain("fonts.googleapis.com");
    expect(server).not.toContain("fonts.gstatic.com");
  });

  it("ASSET_VERSION walks the public tree recursively, skipping directories", () => {
    expect(assetVersion).not.toBe("");
    expect(assetVersion).toContain("readdirSync(");
    expect(assetVersion).toMatch(/withFileTypes|recursive:\s*true/);
    expect(assetVersion).toContain("isDirectory(");
  });

  it("script/style CSP keeps 'unsafe-inline' (Railway injects inline scripts)", () => {
    // Bind to the directive arrays, not the whole file: the explanatory
    // comment above them also contains "'unsafe-inline'", so a file-wide
    // toContain would pass even if the directives dropped it.
    const scriptSrc = server.match(/scriptSrc:\s*\[([^\]]*)\]/)?.[1] ?? "";
    const styleSrc = server.match(/styleSrc:\s*\[([^\]]*)\]/)?.[1] ?? "";
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(styleSrc).toContain("'unsafe-inline'");
  });
});

describe("source-health tile contract (Story 4.4)", () => {
  it("app.js dispatches the source-health variant and renders every tile part", () => {
    const app = CLIENT_FILES["app.js"];
    expect(app).toContain('panel.variant === "source-health"');
    expect(app).toContain("health-rows");
    expect(app).toContain("health-cells");
    expect(app).toContain("health-next");
    expect(app).toContain("sourceHealthSummary");
    expect(app).toContain("next sweep");
  });

  it("app.js derives the header live pill from the shared summary", () => {
    const app = CLIENT_FILES["app.js"];
    expect(app).toContain("sourceCountText");
    expect(app).toMatch(/sourceHealthSummary\(/);
  });

  it("app.js bounds the tile to 4 name/status rows and a tested countdown", () => {
    const app = CLIENT_FILES["app.js"];
    // Design 3b: four name/status rows; the helper stays data-driven.
    // The tile lists every source rather than the mock's four: it stretches to
    // its grid row, and a truncated list defeats the "11/12" it exists to explain.
    expect(app).not.toContain("HEALTH_ROW_COUNT");
    // Countdown arithmetic lives in the pure, unit-tested helper.
    expect(app).toContain("nextSweepSeconds");
  });

  it("style.css binds the tile to the 12-cell grid and inset tokens", () => {
    expect(styleCss).toContain('data-panel-id="source-health"');
    expect(styleCss).toContain("grid-template-columns: repeat(12, 1fr)");
    expect(styleCss).toContain(".health-cell { height: 18px");
    expect(styleCss).toContain("gap: 3px");
    expect(styleCss).toContain(".health-cell[data-state=\"running\"]");
  });
});

describe("source-status modal removal (Story 4.4)", () => {
  it("app.js contains no modal render path or cached sources", () => {
    const app = CLIENT_FILES["app.js"];
    expect(app).not.toContain("sourceModal");
    expect(app).not.toContain("initSourceModal");
    expect(app).not.toContain("renderIntegrity");
    expect(app).not.toContain("cachedSources");
  });

  it("index.html contains no source modal markup", () => {
    expect(html).not.toContain("sourceModal");
    expect(html).not.toContain("source-modal");
  });
});

describe("splash removal (Story 6.3)", () => {
  it('index.html contains no loading markup (id="loading")', () => {
    expect(html).not.toMatch(/id="loading"/);
  });

  it('index.html contains no loading markup (class="loading-screen")', () => {
    expect(html).not.toContain("loading-screen");
  });

  it("app.js contains no hideLoading( call", () => {
    expect(CLIENT_FILES["app.js"]).not.toMatch(/hideLoading\s*\(/);
  });

  it("app.js contains no loading-function remnants", () => {
    const app = CLIENT_FILES["app.js"];
    expect(app).not.toMatch(/completeLoading\s*\(/);
    expect(app).not.toContain("postLoadGrace");
    expect(app).not.toMatch(/renderLoadingProgress\s*\(/);
    expect(app).not.toMatch(/renderLoadingSteps\s*\(/);
  });
});
