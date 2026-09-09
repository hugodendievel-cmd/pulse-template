// tests/domain-endpoint.test.mjs — Story 2.4: /api/domain wiring, branding
// tokens, runtime-only dashboard markup, zero source names in app.js.
// Source-scan tests (no server boot), following health-endpoint.test.mjs.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const server = readFileSync(resolve(root, "server.mjs"), "utf-8");
const html = readFileSync(
  resolve(root, "dashboard/public/index.html"),
  "utf-8",
);
const appjs = readFileSync(
  resolve(root, "dashboard/public/app.js"),
  "utf-8",
);

const SOURCE_NAMES = [
  "Hacker News",
  "ArXiv",
  "Hugging Face",
  "GitHub Trending",
  "TechCrunch",
  "The Verge",
  "VentureBeat",
  "Reddit",
  "Google News",
  "NewsAPI",
  "Product Hunt",
  "Simon Willison",
];

describe("GET /api/domain", () => {
  it("server.mjs registers the route", () => {
    expect(server).toMatch(/app\.get\("\/api\/domain"/);
  });

  it("the handler returns exactly the pack chrome keys (no leakage)", () => {
    const m = server.match(
      /app\.get\("\/api\/domain"[\s\S]*?res\.json\(\s*{([^}]*)}\s*\)/,
    );
    expect(m).not.toBeNull();
    const keys = m[1]
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    expect(keys).toEqual(["name", "tagline", "panels", "stats", "nav", "colors"]);
    expect(m[1]).not.toMatch(/sources|prompts|freshSources/);
  });
});

describe("index.html runtime shells (AC2)", () => {
  it("contains the empty shells", () => {
    expect(html).toContain('<nav class="header-nav" id="headerNav"></nav>');
    expect(html).toContain(
      '<div class="stats-bar" id="statsBar" style="display: none"></div>',
    );
    expect(html).toContain('<div class="dashboard" id="dashboard"></div>');
  });

  it("has no hardcoded panel markup or renderer body ids", () => {
    expect(html).not.toContain("data-section=");
    for (const id of [
      "modelsBody",
      "papersBody",
      "reposBody",
      "trendingBody",
      "newsBody",
      "blogBody",
      "redditBody",
      "hnBody",
      "phBody",
      "analysisBody",
      "radarBody",
      "digestBody",
    ]) {
      expect(html).not.toContain(id);
    }
  });

  it("has no hardcoded nav pills or stat cards", () => {
    expect(html).not.toContain("nav-pill");
    expect(html).not.toContain("stat-card");
    expect(html).not.toContain("statArticles");
  });

  it("branding tokens are in place and no hardcoded pack name remains", () => {
    expect(html).toContain("<title>__PULSE_NAME__ — Intelligence Dashboard</title>");
    expect(html).toContain("__PULSE_NAME__ — __PULSE_TAGLINE__");
    expect(html).toContain("<h1>__PULSE_NAME_HTML__</h1>");
    expect(html.match(/__PULSE_NAME_HTML__/g)).toHaveLength(2); // logo + loading
    expect(html).not.toContain("AI Pulse");
    expect(html).not.toContain("AI<span>PULSE</span>");
  });

  it("keeps the 12 icon sprite symbols and the cache-bustable script tags", () => {
    const symbols = html.match(/<symbol id="ic-[a-z]+"/g) ?? [];
    expect(symbols).toHaveLength(12);
    expect(html).toContain('<script src="app.js"></script>');
    expect(html).toContain('from "./render-core.mjs"');
    expect(html).toContain("window.RenderCore");
  });
});

describe("server branding injection", () => {
  it("replaces the branding tokens in the / handler", () => {
    expect(server).toMatch(/__PULSE_NAME_HTML__/);
    expect(server).toMatch(/__PULSE_NAME__/);
    expect(server).toMatch(/__PULSE_TAGLINE__/);
  });

  it("pulseNameHtml puts the first word plain and the rest in an uppercase span", () => {
    const m = server.match(/function pulseNameHtml[\s\S]*?\n}/);
    expect(m).not.toBeNull();
    expect(m[0]).toContain("<span>");
    expect(m[0]).toContain("toUpperCase()");
  });

  it("cache-bust covers .mjs module imports", () => {
    expect(server).toMatch(/\\\.mjs"/);
  });
});

describe("app.js contains zero source names (AC3)", () => {
  for (const name of SOURCE_NAMES) {
    it(`app.js does not contain "${name}"`, () => {
      expect(appjs).not.toContain(name);
    });
  }

  it("app.js drives the dashboard from /api/domain", () => {
    expect(appjs).toContain('fetch("/api/domain")');
    expect(appjs).toContain("window.RenderCore");
    expect(appjs).toContain("buildDomainUI");
  });
});
