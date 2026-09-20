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
// Every client file that ships runtime logic; the source-name scan covers each.
const CLIENT_FILES = {
  "app.js": appjs,
  "render-core.mjs": readFileSync(
    resolve(root, "dashboard/public/render-core.mjs"),
    "utf-8",
  ),
};
const css = readFileSync(
  resolve(root, "dashboard/public/style.css"),
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
    expect(keys).toEqual([
      "name",
      "tagline",
      "credit",
      "panels",
      "stats",
      "views",
      "colors",
    ]);
    expect(m[1]).not.toMatch(/sources|prompts|freshSources/);
  });
});

describe("index.html runtime shells (AC2)", () => {
  it("contains the empty shells plus the .view and bottom-nav mount points", () => {
    expect(html).toContain('<nav class="header-nav" id="headerNav"></nav>');
    // The metrics strip was removed: its four counts restated the live pill
    // and the search placeholder, and it pushed the briefing below the fold.
    expect(html).not.toContain('id="statsBar"');
    expect(html).toContain('<div class="dashboard" id="dashboard">');
    expect(html).toContain(
      '<div class="view" id="viewRoot" data-view data-layout="grid"></div>',
    );
    expect(html).toContain('<nav class="bottom-nav" id="bottomNav"></nav>');
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
    expect(html).not.toContain("AI Pulse");
    expect(html).not.toContain("AI<span>PULSE</span>");
  });

  it("keeps the icon sprite symbols and the cache-bustable script tags", () => {
    // 13 since Story 4.2's news panels need `ic-articles`; the sprite may grow
    // (architecture §3.6) but the core frames must keep their symbols.
    const symbols = html.match(/<symbol id="ic-[a-z]+"/g) ?? [];
    expect(symbols).toHaveLength(13);
    expect(html).toContain('<script defer src="app.js"></script>');
    expect(html).toContain('from "./render-core.mjs"');
    expect(html).toContain("window.RenderCore");
  });

  // Regression: app.js must not be a parser-blocking classic script. The
  // render-core bootstrap is a module (always deferred), so a non-deferred
  // app.js boots first, opens the EventSource and throws on the first SSE
  // frame at `window.RenderCore.<fn>` — leaving an empty shell. `defer` puts
  // both in document order: bootstrap, then app.js.
  it("loads app.js after the render-core module bootstrap", () => {
    const bootstrap = html.indexOf('import * as RC from "./render-core.mjs"');
    const appTag = html.indexOf('src="app.js"');
    expect(bootstrap).toBeGreaterThan(-1);
    expect(appTag).toBeGreaterThan(bootstrap);
    const tag = html.slice(html.lastIndexOf("<script", appTag), appTag);
    expect(tag).toMatch(/\bdefer\b/);
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

describe("client files contain zero source names (AC3)", () => {
  for (const [file, source] of Object.entries(CLIENT_FILES)) {
    for (const name of SOURCE_NAMES) {
      it(`${file} does not contain "${name}"`, () => {
        expect(source).not.toContain(name);
      });
    }
  }

  it("app.js drives the dashboard from /api/domain", () => {
    expect(appjs).toContain('fetch("/api/domain")');
    expect(appjs).toContain("window.RenderCore");
    expect(appjs).toContain("buildDomainUI");
  });

  // Regression guard for Story 1.2: the endpoint stopped serving `nav`, so a
  // client that still dereferences `domain.nav` would throw in buildDomainUI
  // and render no chrome at all.
  it("builds domain chrome from views, never domain.nav", () => {
    expect(appjs).not.toMatch(/domain\.nav\b/);
    expect(appjs).toMatch(/domain\.views/);
  });
});

describe("app.js consumes pack views generically (Story 1.5)", () => {
  it("builds nav pills from views with data-view, not data-filter", () => {
    expect(appjs).toMatch(/data-view="\$\{esc\(v\.id\)\}"/);
    expect(appjs).not.toContain("data-filter=");
  });

  it("seeds the active view from views[].default via RenderCore.viewFor", () => {
    expect(appjs).toMatch(/viewFor\(domain\.views\s*\)/);
    expect(appjs).toMatch(/state\.view/);
  });

  it("renders a single .view container carrying data-view and data-layout", () => {
    expect(appjs).toMatch(/class="view"/);
    // The runtime view must reuse the static index.html #viewRoot shell (the
    // fallback path only builds a fresh container when it is absent).
    expect(appjs).toMatch(/getElementById\("viewRoot"\)/);
    expect(appjs).toMatch(/dataset\.view\b/);
    expect(appjs).toMatch(/dataset\.layout\b/);
  });

  it("tags panel frames with data-panel-id and data-column for generic toggling", () => {
    expect(appjs).toMatch(/data-panel-id=/);
    expect(appjs).toMatch(/data-column=/);
  });

  it("implements setView/initViewNav and deletes applyNavFilter/activeFilter", () => {
    expect(appjs).toMatch(/function setView\(/);
    expect(appjs).toMatch(/function initViewNav\(/);
    expect(appjs).not.toContain("applyNavFilter");
    expect(appjs).not.toMatch(/function activeFilter\(/);
  });

  it("derives view membership from RenderCore.viewPanels", () => {
    expect(appjs).toMatch(/viewPanels\(/);
  });

  it("drives the layout grid from .view[data-layout] (legacy col system removed)", () => {
    expect(appjs).toMatch(/class="view"/);
    expect(css).toMatch(/\.view\[data-layout=["']main-rail["']\]/);
    expect(css).not.toMatch(/--col-span/);
    expect(css).not.toContain("data-filter=");
  });

  it("leaves panel visibility to setView (renderAnalysis must not force display)", () => {
    expect(appjs).not.toMatch(/briefPanel\.style\.display/);
    expect(appjs).not.toMatch(/radarPanel\.style\.display/);
  });

  it("contains no view id literal (AC: no view id or source name literal)", () => {
    for (const id of ["today", "streams", "editions"]) {
      expect(appjs).not.toMatch(new RegExp(`["'\`]${id}["'\`]`));
    }
  });
});

// ── Environment tag (deployment-scoped) ──────────────────────────────────
describe("environment tag", () => {
  it("carries the token beside the wordmark", () => {
    expect(html).toContain("__PULSE_ENV_TAG__");
    expect(html).toMatch(/class="logo-row"[\s\S]*__PULSE_ENV_TAG__/);
  });

  it("renders from PULSE_ENV_LABEL and nothing when it is unset", () => {
    expect(server).toContain("__PULSE_ENV_TAG__");
    expect(server).toMatch(/process\.env\.PULSE_ENV_LABEL/);
    // The empty guard is what keeps production (unset) clean.
    expect(server).toMatch(
      /function envTagHtml\(\)[\s\S]*?return label \?[^:]*: ""/,
    );
  });

  it("styles the tag on amber tokens", () => {
    expect(css).toMatch(
      /\.env-tag\s*\{[^}]*background: var\(--amber-tint\)[^}]*color: var\(--amber-ink\)/s,
    );
  });
});
