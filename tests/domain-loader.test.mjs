// tests/domain-loader.test.mjs — domains/index.mjs pack loading + example pack
// shape. No network, no DOM.
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_LAYOUT,
  LAYOUTS,
  listDomains,
  loadDomain,
  normalizeViews,
  validateDomain,
  viewPanels,
} from "../domains/index.mjs";
import example from "../domains/example.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const EXAMPLE_SOURCE_ORDER = [
  "GitHub Trending",
  "Hacker News",
  "Tech News",
  "Google News",
];

afterEach(() => {
  delete process.env.PULSE_DOMAIN;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("domains/index.mjs loader", () => {
  it("loadDomain() returns the example pack by default", () => {
    expect(loadDomain().id).toBe("example");
  });

  it("loadDomain('example') returns the same object (cache)", () => {
    expect(loadDomain("example")).toBe(loadDomain());
  });

  it("listDomains() includes example", () => {
    expect(listDomains()).toContain("example");
  });

  it("loadDomain('nope') throws Unknown domain pack", () => {
    expect(() => loadDomain("nope")).toThrow("Unknown domain pack: nope");
  });

  it("validateDomain({}) throws mentioning the first missing key", () => {
    expect(() => validateDomain({})).toThrow(/Invalid domain pack.*"id"/);
  });

  it("PULSE_DOMAIN env selects the pack", async () => {
    process.env.PULSE_DOMAIN = "example";
    vi.resetModules();
    const mod = await import("../domains/index.mjs");
    expect(mod.loadDomain().id).toBe("example");
  });
});

describe("domains/example.mjs pack shape", () => {
  it("declares the 4 sources in orchestrator order", () => {
    expect(example.sources).toHaveLength(4);
    expect(example.sources.map((s) => s.name)).toEqual(EXAMPLE_SOURCE_ORDER);
  });

  it("every source module resolves to an existing file", () => {
    for (const s of example.sources) {
      expect(
        existsSync(resolve(root, "apis/sources", `${s.module}.mjs`)),
        `apis/sources/${s.module}.mjs`,
      ).toBe(true);
    }
  });

  it("prompts are the pack's analyst voice, schema-compatible", () => {
    expect(example.prompts.analysis).toContain("technology intelligence analyst");
    expect(example.prompts.digest).toContain("weekly digest");
    expect(example.prompts.daily).toContain("daily briefing");
  });

  it("panels/stats/views reproduce the redesigned dashboard chrome", () => {
    expect(example.panels.map((p) => p.id)).toEqual([
      "analysis",
      "radar",
      "signals",
      "trending",
      "newest",
      "technews",
      "googlenews",
      "repos",
      "hackernews",
      "streams-preview",
      "editions-card",
      "editions-reader",
      "digest",
      "archive",
      "source-health",
    ]);
    expect(example.stats.map((s) => s.key)).toEqual(["articles", "repos"]);
    expect(example.views.map((v) => v.id)).toEqual([
      "today",
      "streams",
      "editions",
    ]);
    expect(example.nav).toBeUndefined();
  });

  it("keeps freshSources unchanged", () => {
    expect(example.freshSources).toEqual(["Hacker News", "GitHub Trending"]);
  });
});

describe("domains/example.mjs views shape", () => {
  it("declares today as the default main-rail view with fallback panels", () => {
    const today = example.views.find((v) => v.id === "today");
    expect(today).toMatchObject({
      id: "today",
      label: "today",
      default: true,
      layout: "main-rail",
      // Design 3a's today is the briefing screen: the trending/newest raw
      // aggregates belong to the no-LLM fallback band only.
      panels: [
        "analysis",
        "radar",
        "signals",
        "streams-preview",
        "editions-card",
      ],
      fallbackPanels: ["trending", "newest", "streams-preview", "editions-card"],
    });
    expect(today.noBriefingNote).toBe(
      "briefing disabled — no LLM configured. set LLM_PROVIDER and LLM_API_KEY in .env for daily analyst briefings.",
    );
  });

  it("declares streams as a grid over the pack's sections", () => {
    const streams = example.views.find((v) => v.id === "streams");
    expect(streams).toMatchObject({
      id: "streams",
      label: "streams",
      layout: "grid",
      sections: ["news", "code", "community"],
    });
  });

  it("streams includes the source-health chrome panel alongside its sections", () => {
    const streams = example.views.find((v) => v.id === "streams");
    // The tile is chrome, not a category card: registered by explicit id,
    // while the view still selects its sections.
    expect(streams.panels).toEqual(["source-health"]);
    expect(streams.sections).toEqual(["news", "code", "community"]);
  });

  it("declares the source-health chrome panel without a section", () => {
    const panel = example.panels.find((p) => p.id === "source-health");
    expect(panel).toMatchObject({
      id: "source-health",
      title: "source health",
      icon: "radar",
      variant: "source-health",
    });
    expect(panel).not.toHaveProperty("section");
    // Last in panels[] so it renders after the cards.
    expect(example.panels.at(-1).id).toBe("source-health");
  });

  it("declares editions as a reader view over reader/digest/archive", () => {
    const editions = example.views.find((v) => v.id === "editions");
    expect(editions).toMatchObject({
      id: "editions",
      label: "editions",
      layout: "reader",
      panels: ["editions-reader", "digest", "archive"],
    });
  });

  it("declares the editions-reader main panel before the digest", () => {
    const reader = example.panels.find((p) => p.id === "editions-reader");
    expect(reader).toMatchObject({
      id: "editions-reader",
      title: "daily edition",
      icon: "list",
      column: "main",
      variant: "edition",
    });
    const ids = example.panels.map((p) => p.id);
    expect(ids.indexOf("editions-reader")).toBeLessThan(ids.indexOf("digest"));
    // The reader stays a member of the editions view's explicit panel list.
    const editions = example.views.find((v) => v.id === "editions");
    expect(editions.panels).toContain("editions-reader");
  });

  it("sets column rail on radar, editions-card and digest while keeping their section", () => {
    const radar = example.panels.find((p) => p.id === "radar");
    const editions = example.panels.find((p) => p.id === "editions-card");
    const digest = example.panels.find((p) => p.id === "digest");
    expect(radar).toMatchObject({ column: "rail", section: "briefing" });
    expect(editions).toMatchObject({
      column: "rail",
      section: "briefing",
      variant: "edition-card",
      target: "editions",
      weeklyRun: "sun 18:00",
      actionLabel: "read",
    });
    expect(digest).toMatchObject({ column: "rail", section: "digest" });
  });

  it("sets main/rail column only where explicitly required", () => {
    const rail = new Set(["radar", "signals", "editions-card", "digest", "archive"]);
    // Story 5.1 gives the daily reader an explicit main column; design 3c
    // stacks the archive under the weekly digest in the rail instead.
    const main = new Set(["editions-reader"]);
    for (const panel of example.panels) {
      if (rail.has(panel.id) || main.has(panel.id)) continue;
      expect(panel, panel.id).not.toHaveProperty("column");
    }
    expect(example.panels.find((p) => p.id === "editions-reader")).toMatchObject({
      column: "main",
    });
    expect(example.panels.find((p) => p.id === "archive")).toMatchObject({
      column: "rail",
    });
  });
});

describe("domains/example.mjs feed coverage", () => {
  // Union of every explicit source binding in the pack.
  const boundSources = example.panels.flatMap((p) => p.sources ?? []);

  // Category panels (repos) reach their sources via the sweep's `data.category`.
  // Read that literal from each source module so the coverage derives from code,
  // not a restated mapping.
  const categoryPanels = new Set(
    example.panels.filter((p) => p.category).map((p) => p.category),
  );
  const covered = new Set(boundSources);
  for (const source of example.sources) {
    const moduleSrc = readFileSync(
      resolve(root, "apis/sources", `${source.module}.mjs`),
      "utf-8",
    );
    const category = moduleSrc.match(/category:\s*"([^"]+)"/)?.[1];
    if (categoryPanels.has(category)) covered.add(source.name);
  }

  it("binds technews to the Tech News feed", () => {
    expect(example.panels.find((p) => p.id === "technews")).toMatchObject({
      section: "news",
      variant: "news",
      sources: ["Tech News"],
      limit: 15,
    });
  });

  it("binds googlenews to Google News", () => {
    expect(example.panels.find((p) => p.id === "googlenews")).toMatchObject({
      section: "news",
      variant: "news",
      sources: ["Google News"],
      limit: 15,
    });
  });

  it("gives each aggregate-only feed an explicit source-bound home", () => {
    for (const name of ["Tech News", "Google News", "Hacker News"]) {
      expect(boundSources, name).toContain(name);
    }
  });

  it("resolves all 4 pack sources across bound + category panels", () => {
    const names = example.sources.map((s) => s.name);
    expect(names).toEqual(EXAMPLE_SOURCE_ORDER);
    // Derive the expectation from the pack itself (not the restated order) so a
    // 5th source added upstream without a home/decision fails here on intent.
    expect([...covered].sort()).toEqual([...names].sort());
  });

  it("keeps the streams view selecting the news section", () => {
    const streams = example.views.find((v) => v.id === "streams");
    expect(streams.sections).toEqual(["news", "code", "community"]);
    expect(streams.sections).toContain("news");
  });

  it("points every panel icon at a sprite symbol in index.html", () => {
    // `renderPanel` renders `<use href="#ic-${panel.icon}">`, so a panel whose
    // icon has no sprite symbol silently loses its header glyph.
    const html = readFileSync(
      resolve(root, "dashboard/public/index.html"),
      "utf-8",
    );
    const symbols = new Set(
      [...html.matchAll(/<symbol id="(ic-[a-z-]+)"/g)].map((m) => m[1]),
    );
    for (const panel of example.panels) {
      expect(
        symbols.has(`ic-${panel.icon}`),
        `${panel.id} → ic-${panel.icon}`,
      ).toBe(true);
    }
  });
});

describe("normalizeViews", () => {
  it("exposes DEFAULT_LAYOUT and LAYOUTS", () => {
    expect(DEFAULT_LAYOUT).toBe("grid");
    expect(LAYOUTS).toEqual(["main-rail", "grid", "reader"]);
  });

  it("returns a pack's views as a new array with layout defaulted", () => {
    const pack = {
      views: [
        { id: "today", label: "Today", default: true, layout: "main-rail" },
        { id: "streams", label: "Streams" },
      ],
    };
    const views = normalizeViews(pack);
    expect(views).not.toBe(pack.views);
    expect(views).toEqual([
      { id: "today", label: "Today", default: true, layout: "main-rail" },
      { id: "streams", label: "Streams", layout: "grid" },
    ]);
  });

  it("does not mutate the input pack", () => {
    const view = { id: "streams", label: "Streams" };
    const pack = { views: [view] };
    normalizeViews(pack);
    expect(pack.views[0]).toBe(view);
    expect(view.layout).toBeUndefined();
  });

  it("copies membership arrays instead of sharing them with the pack", () => {
    const view = {
      id: "streams",
      sections: ["news"],
      panels: ["a"],
      fallbackPanels: ["a"],
    };
    const pack = { views: [view] };
    const [normalized] = normalizeViews(pack);
    expect(normalized.sections).toEqual(["news"]);
    expect(normalized.sections).not.toBe(view.sections);
    expect(normalized.panels).not.toBe(view.panels);
    expect(normalized.fallbackPanels).not.toBe(view.fallbackPanels);
    // mutating the normalized copy must not touch the caller's pack
    normalized.sections.push("code");
    expect(view.sections).toEqual(["news"]);
  });

  it("derives one view per nav entry from a legacy pack", () => {
    const pack = {
      panels: [
        { id: "p-all", section: "briefing" },
        { id: "p-news", section: "news" },
        { id: "p-research", section: "research" },
      ],
      nav: [
        { filter: "all", label: "All" },
        { filter: "news", label: "News" },
        { filter: "research", label: "Research" },
      ],
    };
    const views = normalizeViews(pack);
    expect(views).toEqual([
      {
        id: "all",
        label: "All",
        layout: "grid",
        fallbackPanels: ["p-all", "p-news", "p-research"],
        default: true,
      },
      {
        id: "news",
        label: "News",
        layout: "grid",
        fallbackPanels: ["p-all", "p-news", "p-research"],
        sections: ["news"],
      },
      {
        id: "research",
        label: "Research",
        layout: "grid",
        fallbackPanels: ["p-all", "p-news", "p-research"],
        sections: ["research"],
      },
    ]);
  });

  it("omits sections/panels on the legacy all view and never exposes nav", () => {
    const pack = {
      panels: [{ id: "p-news", section: "news" }],
      nav: [
        { filter: "all", label: "All" },
        { filter: "news", label: "News" },
      ],
    };
    const [all, news] = normalizeViews(pack);
    expect(all).not.toHaveProperty("sections");
    expect(all).not.toHaveProperty("panels");
    expect(all).not.toHaveProperty("nav");
    expect(news.sections).toEqual(["news"]);
  });

  it("marks only the first derived view as default", () => {
    const pack = {
      panels: [{ id: "p", section: "news" }],
      nav: [
        { filter: "all", label: "All" },
        { filter: "news", label: "News" },
      ],
    };
    const views = normalizeViews(pack);
    expect(views.map((v) => v.default === true)).toEqual([true, false]);
  });

  it("throws the missing views|nav error when neither is present", () => {
    expect(() => normalizeViews({ panels: [] })).toThrow(
      /Invalid domain pack.*"views\|nav"/,
    );
  });
});

describe("viewPanels", () => {
  const panels = [
    { id: "a", section: "news" },
    { id: "b", section: "research" },
    { id: "c", section: "news" },
    { id: "d", section: "code" },
  ];

  it("selects by section membership in panels[] order", () => {
    const views = [{ id: "news", sections: ["news"] }];
    expect(viewPanels(views, panels, "news").map((p) => p.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("selects by explicit panel id membership in panels[] order", () => {
    const views = [{ id: "pick", panels: ["c", "a"] }];
    expect(viewPanels(views, panels, "pick").map((p) => p.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("returns the union when a view declares both sections and panels", () => {
    const views = [{ id: "mixed", sections: ["news"], panels: ["b"] }];
    expect(viewPanels(views, panels, "mixed").map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns every panel when the view has neither sections nor panels", () => {
    const views = [{ id: "all" }];
    expect(viewPanels(views, panels, "all")).toBe(panels);
  });

  it("returns [] for an unknown view id without throwing", () => {
    expect(() => viewPanels([], panels, "nope")).not.toThrow();
    expect(viewPanels([{ id: "all" }], panels, "nope")).toEqual([]);
  });

  it("returns [] when the matched view has no panels regardless of id", () => {
    const views = [{ id: "code", sections: ["code"] }];
    expect(viewPanels(views, panels, "code").map((p) => p.id)).toEqual(["d"]);
  });
});

// App-equivalent legacy fixture: a representative sections + nav filter set
// from before packs migrated to views. Synthetic, so it stays pack-agnostic.
const LEGACY_NAV_PANELS = [
  { id: "analysis", section: "briefing" },
  { id: "radar", section: "briefing" },
  { id: "trending", section: "news" },
  { id: "newest", section: "news" },
  { id: "repos", section: "code" },
  { id: "hackernews", section: "community" },
  { id: "digest", section: "digest" },
];
const LEGACY_NAV = [
  { filter: "all", label: "All" },
  { filter: "briefing", label: "Briefing" },
  { filter: "news", label: "News" },
  { filter: "code", label: "Code" },
  { filter: "community", label: "Community" },
  { filter: "digest", label: "Digest" },
];
const LEGACY_PANEL_IDS = LEGACY_NAV_PANELS.map((p) => p.id);

describe("normalizeViews — legacy nav equivalence", () => {
  it("derives one grid view per legacy nav filter", () => {
    const views = normalizeViews({ panels: LEGACY_NAV_PANELS, nav: LEGACY_NAV });
    expect(views.map((v) => v.id)).toEqual(LEGACY_NAV.map((n) => n.filter));
    expect(views.every((v) => v.layout === "grid")).toBe(true);
  });

  it("gives all neither panels nor sections but keeps the panel fallback", () => {
    const [all] = normalizeViews({ panels: LEGACY_NAV_PANELS, nav: LEGACY_NAV });
    expect(all).toEqual({
      id: "all",
      label: "All",
      layout: "grid",
      fallbackPanels: LEGACY_PANEL_IDS,
      default: true,
    });
  });

  it("maps every non-all filter to sections:[filter] with the panel fallback", () => {
    const views = normalizeViews({ panels: LEGACY_NAV_PANELS, nav: LEGACY_NAV });
    views.slice(1).forEach((view, i) => {
      // Assert against the fixture (not the view's own fields) so a dropped or
      // swapped id/label is caught — the client renders pill text from label.
      const nav = LEGACY_NAV[i + 1];
      expect(view).toEqual({
        id: nav.filter,
        label: nav.label,
        layout: "grid",
        fallbackPanels: LEGACY_PANEL_IDS,
        sections: [nav.filter],
      });
    });
  });

  it("marks only the first derived view as default", () => {
    const views = normalizeViews({ panels: LEGACY_NAV_PANELS, nav: LEGACY_NAV });
    expect(views.filter((v) => v.default === true).map((v) => v.id)).toEqual([
      "all",
    ]);
  });
});

describe("viewPanels — app-equivalent membership", () => {
  const views = normalizeViews({ panels: LEGACY_NAV_PANELS, nav: LEGACY_NAV });

  it("returns every panel for the all view", () => {
    expect(viewPanels(views, LEGACY_NAV_PANELS, "all")).toBe(
      LEGACY_NAV_PANELS,
    );
  });

  it("returns exactly the panels whose section matches each filter", () => {
    for (const filter of ["briefing", "news", "code", "community", "digest"]) {
      const expected = LEGACY_NAV_PANELS.filter(
        (p) => p.section === filter,
      ).map((p) => p.id);
      expect(viewPanels(views, LEGACY_NAV_PANELS, filter).map((p) => p.id)).toEqual(
        expected,
      );
    }
  });
});

describe("validateDomain views|nav", () => {
  const base = () => ({
    id: "x",
    name: "X",
    sources: [{ name: "S" }],
    prompts: { analysis: "a", digest: "d" },
    panels: [{ id: "p", section: "news" }],
    stats: [{ key: "k" }],
  });

  it("accepts a views-only pack", () => {
    const pack = { ...base(), views: [{ id: "v", label: "V" }] };
    expect(validateDomain(pack)).toBe(pack);
  });

  it("accepts a nav-only pack", () => {
    const pack = { ...base(), nav: [{ filter: "all", label: "All" }] };
    expect(validateDomain(pack)).toBe(pack);
  });

  it("throws when neither views nor nav is present", () => {
    expect(() => validateDomain(base())).toThrow(
      /Invalid domain pack.*"views\|nav"/,
    );
  });
});

describe("loadDomain view normalization", () => {
  it("exposes the pack's declared views unchanged", () => {
    const pack = loadDomain("example");
    expect(Array.isArray(pack.views)).toBe(true);
    expect(pack.views.map((v) => v.id)).toEqual(["today", "streams", "editions"]);
    expect(pack.nav).toBeUndefined();
    expect(pack.views[0]).toMatchObject({
      id: "today",
      layout: "main-rail",
      default: true,
    });
    expect(pack.views[1]).toMatchObject({
      id: "streams",
      layout: "grid",
      sections: ["news", "code", "community"],
    });
  });

  it("normalizes once and reuses the same cached views array", () => {
    expect(loadDomain("example").views).toBe(loadDomain("example").views);
  });
});
