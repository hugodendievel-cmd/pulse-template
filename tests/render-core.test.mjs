// tests/render-core.test.mjs — Story 2.4: pure dashboard data layer.
// Imports dashboard/public/render-core.mjs directly — no DOM, no network.
import { describe, expect, it } from "vitest";

import {
  aggregateByCategory,
  aggregateItems,
  archiveRows,
  collectItems,
  compactAge,
  digestSignalCount,
  editionCardModel,
  editionReaderModel,
  editionSignalCount,
  formatNum,
  healthTally,
  moreHeadlines,
  normalizeItem,
  panelIdForSource,
  panelDeltaCount,
  previewSources,
  selectPanelItems,
  SLOW_FETCH_MS,
  sortSourceCards,
  sourceCardStats,
  sourceColorFor,
  sourceHealthSummary,
  nextSweepSeconds,
  statValue,
  storyMeta,
  viewFor,
  viewPanels,
  weekNumberOf,
} from "../dashboard/public/render-core.mjs";

// Fixture sources resembling an example-pack sweep
const srcNews = {
  source: "Feed",
  status: "ok",
  data: {
    category: "news",
    items: [
      { title: "A", url: "https://a", published: "2026-09-08T10:00:00Z" },
      { title: "B", url: "https://b", published: "2026-09-07T10:00:00Z" },
    ],
  },
};
const srcCommunity = {
  source: "Forum",
  status: "ok",
  data: {
    category: "community",
    items: [
      {
        title: "C",
        permalink: "https://c",
        score: 12,
        comments: 4,
        created: "2026-09-08T12:00:00Z",
      },
    ],
  },
};
const srcCode = {
  source: "Repos",
  status: "ok",
  data: {
    category: "code",
    items: [
      { name: "o/r", url: "https://r", stars: 1500, forks: 60, language: "Go" },
    ],
  },
};
const srcModels = {
  source: "Model Hub",
  status: "ok",
  data: {
    category: "models",
    models: {
      count: 2,
      items: [
        { id: "m1", url: "https://m1", downloads: 5000, likes: 120, pipeline: "text-generation" },
        { id: "m2", url: "https://m2", downloads: 300, likes: 5, pipeline: "text-generation" },
      ],
    },
  },
};
const srcBroken = { source: "Down", status: "error", error: "boom" };

const SOURCES = [srcNews, srcCommunity, srcCode, srcModels, srcBroken];

describe("normalizeItem", () => {
  it("HN-style item: _url prefers hnLink, _score/_comments/_time set", () => {
    const src = { source: "HN Clone", data: { category: "community" } };
    const item = {
      title: "Show HN",
      url: "https://example.com",
      hnLink: "https://news.ycombinator.com/item?id=1",
      score: 42,
      comments: 7,
      time: "2026-09-08T09:00:00Z",
    };
    const n = normalizeItem(item, src);
    expect(n._url).toBe("https://news.ycombinator.com/item?id=1");
    expect(n._score).toBe(42);
    expect(n._comments).toBe(7);
    expect(n._time).toBe("2026-09-08T09:00:00Z");
    expect(n._source).toBe("HN Clone");
    expect(n._category).toBe("community");
    expect(n.title).toBe("Show HN"); // originals passed through
  });

  it("RSS item: _time from published, missing metrics default to 0", () => {
    const src = { source: "Feed", data: { category: "news" } };
    const n = normalizeItem(
      { title: "Post", url: "https://x", published: "2026-09-06T08:00:00Z", creator: "Ann" },
      src,
    );
    expect(n._time).toBe("2026-09-06T08:00:00Z");
    expect(n._url).toBe("https://x");
    expect(n._score).toBe(0);
    expect(n._comments).toBe(0);
    expect(n.creator).toBe("Ann");
  });

  it("category defaults to news when the source data carries none", () => {
    const n = normalizeItem({ title: "x" }, { source: "Bare", data: {} });
    expect(n._category).toBe("news");
  });
});

describe("aggregateByCategory", () => {
  it("buckets by category; models.items land under their source category", () => {
    const byCategory = aggregateByCategory(SOURCES);
    expect(Object.keys(byCategory).sort()).toEqual([
      "code",
      "community",
      "models",
      "news",
    ]);
    expect(byCategory.news).toHaveLength(2);
    expect(byCategory.community).toHaveLength(1);
    expect(byCategory.code).toHaveLength(1);
    expect(byCategory.models).toHaveLength(2);
    expect(byCategory.models[0]._source).toBe("Model Hub");
  });

  it("errored sources are skipped", () => {
    const byCategory = aggregateByCategory([srcBroken]);
    expect(byCategory).toEqual({});
  });
});

describe("aggregateItems", () => {
  const byCategory = aggregateByCategory(SOURCES);

  it("engagement: zero-engagement items excluded, score+comments desc, limit honored", () => {
    const items = aggregateItems(
      { sort: "engagement", limit: 20, excludeCategories: ["code", "models"] },
      byCategory,
    );
    // Only the community item (12+4) has engagement; news items score 0 → dropped
    expect(items.map((i) => i.title)).toEqual(["C"]);
  });

  it("engagement without exclusions includes repo stars as engagement", () => {
    const items = aggregateItems({ sort: "engagement" }, byCategory);
    // Normalized per source: C (16/16), o/r (1500/1500) and m1 (120/120) all
    // rank at the top with norm 1.0 (stable order), m2 (5/120) sinks last.
    expect(items.map((i) => i.title ?? i.name ?? i.id)).toEqual(["C", "o/r", "m1", "m2"]);
    expect(items).toHaveLength(4); // repo + community + both models (likes>0)
  });

  it("engagement normalization lets a quiet source surface its best item", () => {
    const sources = [
      {
        source: "Loud",
        status: "ok",
        data: {
          category: "news",
          items: [
            { title: "loud-top", url: "https://l1", score: 500, created: "2026-09-08T12:00:00Z" },
            { title: "loud-mid", url: "https://l2", score: 300, created: "2026-09-08T12:00:00Z" },
          ],
        },
      },
      {
        source: "Quiet",
        status: "ok",
        data: {
          category: "news",
          items: [
            { title: "quiet-best", url: "https://q1", score: 8, created: "2026-09-08T12:00:00Z" },
          ],
        },
      },
    ];
    const items = aggregateItems({ sort: "engagement" }, aggregateByCategory(sources));
    // quiet-best (8/8 = 1.0) outranks loud-mid (300/500 = 0.6)
    expect(items.map((i) => i.title)).toEqual(["loud-top", "quiet-best", "loud-mid"]);
  });

  it("date: undated excluded, newest first", () => {
    const items = aggregateItems(
      { sort: "date", limit: 20, excludeCategories: ["code", "models"] },
      byCategory,
    );
    expect(items.map((i) => i.title)).toEqual(["C", "A", "B"]);
  });

  it("limit slices after sorting", () => {
    const items = aggregateItems(
      { sort: "date", limit: 1, excludeCategories: ["code", "models"] },
      byCategory,
    );
    expect(items.map((i) => i.title)).toEqual(["C"]);
  });
});

describe("selectPanelItems", () => {
  const byCategory = aggregateByCategory(SOURCES);

  it("binds by display name when panel.sources is set", () => {
    const items = selectPanelItems(
      { sources: ["Forum"] },
      SOURCES,
      byCategory,
    );
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("C");
  });

  it("preserves pack source order regardless of sweep order", () => {
    const items = selectPanelItems(
      { sources: ["Forum", "Feed"] },
      SOURCES,
      byCategory,
    );
    expect(items.map((i) => i.title)).toEqual(["C", "A", "B"]);
  });

  it("binds by category when panel.category is set", () => {
    const items = selectPanelItems({ category: "code" }, SOURCES, byCategory);
    expect(items.map((i) => i.name)).toEqual(["o/r"]);
  });

  it("limit slices", () => {
    const items = selectPanelItems(
      { sources: ["Feed"], limit: 1 },
      SOURCES,
      byCategory,
    );
    expect(items).toHaveLength(1);
  });
});

describe("previewSources", () => {
  it("returns the first 4 ok sources with items in sweep order", () => {
    const rows = previewSources(SOURCES);
    expect(rows.map((r) => r.source)).toEqual([
      "Feed",
      "Forum",
      "Repos",
      "Model Hub",
    ]);
    expect(rows.map((r) => r.category)).toEqual([
      "news",
      "community",
      "code",
      "models",
    ]);
    expect(rows.map((r) => r.count)).toEqual([2, 1, 1, 2]);
  });

  it("carries the first item's title, url and time", () => {
    const [feed, forum] = previewSources(SOURCES);
    expect(feed.title).toBe("A");
    expect(feed.url).toBe("https://a");
    expect(feed.time).toBe("2026-09-08T10:00:00Z");
    // permalink is preferred over url by normalizeItem
    expect(forum.title).toBe("C");
    expect(forum.url).toBe("https://c");
  });

  it("skips errored sources and sources with zero items", () => {
    const sources = [
      srcBroken,
      { source: "Empty", status: "ok", data: { category: "news", items: [] } },
      srcNews,
    ];
    const rows = previewSources(sources);
    expect(rows.map((r) => r.source)).toEqual(["Feed"]);
  });

  it("respects the limit and defaults to 4", () => {
    expect(previewSources(SOURCES, 2).map((r) => r.source)).toEqual([
      "Feed",
      "Forum",
    ]);
    const many = Array.from({ length: 6 }, (_, i) => ({
      source: `S${i}`,
      status: "ok",
      data: { category: "news", items: [{ title: `t${i}`, url: `https://${i}` }] },
    }));
    expect(previewSources(many)).toHaveLength(4);
  });

  it("returns [] for an empty or absent sweep", () => {
    expect(previewSources([])).toEqual([]);
    expect(previewSources(undefined)).toEqual([]);
  });
});

describe("sourceCardStats", () => {
  const recent = (minsAgo) =>
    new Date(Date.now() - minsAgo * 60 * 1000).toISOString();

  const okSource = (name, items, category = "news") => ({
    source: name,
    status: "ok",
    data: { category, items },
  });

  it("exposes the slow threshold as a single 30-minute constant", () => {
    expect(SLOW_FETCH_MS).toBe(30 * 60 * 1000);
  });

  it("source-bound panel: total count ignores panel.limit, stats are ok", () => {
    const src = okSource("Feed", [
      { title: "A", url: "https://a", published: recent(5) },
      { title: "B", url: "https://b", published: recent(60) },
    ]);
    const stats = sourceCardStats({ sources: ["Feed"], limit: 1 }, [src]);
    expect(stats.names).toEqual(["Feed"]);
    expect(stats.count).toBe(2); // not sliced to limit
    expect(stats.itemCounts).toEqual({ Feed: 2 });
    expect(stats.lastFetch).toBe(src.data.items[0].published); // max _time
    expect(stats.ok).toBe(1);
    expect(stats.total).toBe(1);
    expect(stats.status).toBe("ok");
  });

  it("category-bound panel aggregates every source in that category", () => {
    const a = okSource("A", [{ title: "a", published: recent(5) }], "code");
    const b = okSource("B", [{ title: "b", published: recent(5) }], "code");
    const stats = sourceCardStats({ category: "code" }, [a, b]);
    expect(stats.names).toEqual(["A", "B"]);
    expect(stats.count).toBe(2);
    expect(stats.itemCounts).toEqual({ A: 1, B: 1 });
    expect(stats.status).toBe("ok");
  });

  it("defaults a missing category to news for category binding", () => {
    const src = okSource("Bare", [{ title: "x", published: recent(5) }], undefined);
    delete src.data.category;
    const stats = sourceCardStats({ category: "news" }, [src]);
    expect(stats.count).toBe(1);
    expect(stats.names).toEqual(["Bare"]);
  });

  it("an errored bound source wins: status error, zero count, ok < total", () => {
    const stats = sourceCardStats({ sources: ["Down"] }, [srcBroken]);
    expect(stats.status).toBe("error");
    expect(stats.count).toBe(0);
    expect(stats.names).toEqual(["Down"]);
    expect(stats.ok).toBe(0);
    expect(stats.total).toBe(1);
  });

  it("zero items → idle", () => {
    const src = okSource("Empty", []);
    const stats = sourceCardStats({ sources: ["Empty"] }, [src]);
    expect(stats.count).toBe(0);
    expect(stats.status).toBe("idle");
  });

  it("a lastFetch older than the threshold → slow", () => {
    const src = okSource("Old", [
      { title: "old", published: new Date(Date.now() - SLOW_FETCH_MS - 60000).toISOString() },
    ]);
    expect(sourceCardStats({ sources: ["Old"] }, [src]).status).toBe("slow");
  });

  it("a recent lastFetch → ok", () => {
    const src = okSource("Fresh", [{ title: "fresh", published: recent(1) }]);
    expect(sourceCardStats({ sources: ["Fresh"] }, [src]).status).toBe("ok");
  });

  it("empty/absent sweep → idle zero stats, never throws", () => {
    const stats = sourceCardStats({ sources: ["X"] }, []);
    expect(stats).toMatchObject({
      names: [],
      count: 0,
      itemCounts: {},
      lastFetch: null,
      status: "idle",
      ok: 0,
      total: 0,
    });
    expect(sourceCardStats({}, undefined).count).toBe(0);
    expect(() => sourceCardStats(undefined, undefined)).not.toThrow();
    expect(sourceCardStats(undefined, undefined).status).toBe("idle");
  });

  it("preserves sweep order across multiple bound sources", () => {
    const first = okSource("First", [{ title: "1", published: recent(5) }]);
    const second = okSource("Second", [{ title: "2", published: recent(5) }]);
    const stats = sourceCardStats({ sources: ["Second", "First"] }, [first, second]);
    expect(stats.names).toEqual(["First", "Second"]);
  });
});

describe("sortSourceCards", () => {
  // Bound panels over the shared SOURCES fixture: Feed (newest 09-08T10),
  // Forum (newest 09-08T12), Repos (undated), Model Hub (undated).
  const panels = [
    { id: "p-feed", title: "Feed", sources: ["Feed"] },
    { id: "p-forum", title: "Forum", sources: ["Forum"] },
    { id: "p-repos", title: "Repos", sources: ["Repos"] },
    { id: "p-models", title: "Model Hub", category: "models" },
  ];
  const ids = (list) => list.map((p) => p.id);

  it("orders by the newest bound item's _time, undated last (stable)", () => {
    expect(ids(sortSourceCards(panels, SOURCES, "freshest"))).toEqual([
      "p-forum",
      "p-feed",
      "p-repos",
      "p-models",
    ]);
  });

  it("orders by summed _score + _comments (desc)", () => {
    // Repos 1500 stars, Model Hub 120+5 likes, Forum 12+4, Feed 0+0.
    expect(ids(sortSourceCards(panels, SOURCES, "engagement"))).toEqual([
      "p-repos",
      "p-models",
      "p-forum",
      "p-feed",
    ]);
  });

  it("orders alphabetically by panel.title (localeCompare)", () => {
    expect(ids(sortSourceCards(panels, SOURCES, "name"))).toEqual([
      "p-feed",
      "p-forum",
      "p-models",
      "p-repos",
    ]);
  });

  it("orders by sourceCardStats status rank ok → slow → idle → error", () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const old = new Date(Date.now() - SLOW_FETCH_MS - 60_000).toISOString();
    const sources = [
      { source: "OkFeed", status: "ok", data: { category: "news", items: [{ title: "ok", published: recent }] } },
      { source: "SlowFeed", status: "ok", data: { category: "news", items: [{ title: "old", published: old }] } },
      { source: "EmptyFeed", status: "ok", data: { category: "news", items: [] } },
      { source: "DownFeed", status: "error", error: "boom" },
    ];
    const ranked = [
      { id: "e", title: "E", sources: ["DownFeed"] },
      { id: "i", title: "I", sources: ["EmptyFeed"] },
      { id: "o", title: "O", sources: ["OkFeed"] },
      { id: "s", title: "S", sources: ["SlowFeed"] },
    ];
    expect(ids(sortSourceCards(ranked, sources, "status"))).toEqual([
      "o",
      "s",
      "i",
      "e",
    ]);
  });

  it("falls back to freshest for an unknown sort", () => {
    expect(ids(sortSourceCards(panels, SOURCES, "bogus"))).toEqual(
      ids(sortSourceCards(panels, SOURCES, "freshest")),
    );
    expect(ids(sortSourceCards(panels, SOURCES))).toEqual(
      ids(sortSourceCards(panels, SOURCES, "freshest")),
    );
  });

  it("returns a new array and never mutates the input order", () => {
    const input = panels.slice();
    const out = sortSourceCards(input, SOURCES, "name");
    expect(out).not.toBe(input);
    expect(ids(input)).toEqual(panels.map((p) => p.id));
  });

  it("returns [] for empty panels or absent sources, never throws", () => {
    expect(sortSourceCards([], SOURCES, "name")).toEqual([]);
    expect(sortSourceCards(panels, undefined, "name")).toEqual([]);
    expect(sortSourceCards(undefined, undefined, "name")).toEqual([]);
    expect(() => sortSourceCards(undefined, undefined, "name")).not.toThrow();
  });
});

describe("statValue", () => {
  it("topValue returns the mode of a scalar field with prefix", () => {
    const stat = {
      categories: ["models"],
      sub: { type: "topValue", field: "pipeline", prefix: "Top: " },
    };
    expect(statValue(stat, aggregateByCategory(SOURCES))).toEqual({
      value: 2,
      sub: "Top: text-generation",
    });
  });

  it("topValue flattens array fields (first 2 per item)", () => {
    const src = {
      source: "Papers",
      status: "ok",
      data: {
        category: "research",
        items: [
          { title: "p1", categories: ["cs.AI", "cs.LG", "cs.CV"] },
          { title: "p2", categories: ["cs.AI"] },
        ],
      },
    };
    const stat = {
      categories: ["research"],
      sub: { type: "topValue", field: "categories", prefix: "Top: " },
    };
    // cs.CV (3rd entry of p1) must NOT be counted
    expect(statValue(stat, aggregateByCategory([src]))).toEqual({
      value: 2,
      sub: "Top: cs.AI",
    });
  });

  it("sum totals the field with compact formatting", () => {
    const stat = {
      categories: ["code"],
      sub: { type: "sum", field: "stars", prefix: "★ ", suffix: " total" },
    };
    expect(statValue(stat, aggregateByCategory(SOURCES))).toEqual({
      value: 1,
      sub: "★ 1.5K total",
    });
  });

  it("counts items across the example-style articles split", () => {
    const stat = { categories: ["news", "community", "products"] };
    expect(statValue(stat, aggregateByCategory(SOURCES)).value).toBe(3);
  });

  it("empty categories → 0 and —", () => {
    const stat = {
      categories: ["products"],
      sub: { type: "topValue", field: "pipeline", prefix: "Top: " },
    };
    expect(statValue(stat, aggregateByCategory(SOURCES))).toEqual({
      value: 0,
      sub: "—",
    });
  });
});

describe("compactAge", () => {
  it("renders minutes under an hour, then hours, then days", () => {
    expect(compactAge(16 * 60000)).toBe("16m");
    expect(compactAge(59 * 60000)).toBe("59m");
    expect(compactAge(60 * 60000)).toBe("1h");
    expect(compactAge(5 * 3600000)).toBe("5h");
    expect(compactAge(2 * 86400000)).toBe("2d");
  });

  it("floors partial units", () => {
    expect(compactAge(90 * 1000)).toBe("1m");
    expect(compactAge(119 * 60000)).toBe("1h");
  });

  it("returns — for a missing, negative or non-finite age, never throws", () => {
    expect(compactAge(undefined)).toBe("—");
    expect(compactAge(null)).toBe("—");
    expect(compactAge(-1)).toBe("—");
    expect(compactAge(NaN)).toBe("—");
    expect(compactAge(Infinity)).toBe("—");
  });
});

describe("sourceColorFor", () => {
  it("returns the pack color and the fallback", () => {
    expect(sourceColorFor({ Feed: "#123456" }, "Feed")).toBe("#123456");
    expect(sourceColorFor({}, "Nope")).toBe("#94a3b8");
    expect(sourceColorFor(undefined, "Nope")).toBe("#94a3b8");
  });
});

describe("formatNum", () => {
  it("compacts thousands and millions", () => {
    expect(formatNum(0)).toBe("0");
    expect(formatNum(999)).toBe("999");
    expect(formatNum(1500)).toBe("1.5K");
    expect(formatNum(2_500_000)).toBe("2.5M");
  });
});

const VIEWS = [
  { id: "streams", label: "streams" },
  { id: "today", label: "today", default: true },
  { id: "editions", label: "editions" },
];

describe("viewFor", () => {
  it("returns the view whose id matches", () => {
    expect(viewFor(VIEWS, "streams")).toBe(VIEWS[0]);
  });

  it("falls back to the default view for an unknown id", () => {
    expect(viewFor(VIEWS, "nope")).toBe(VIEWS[1]);
  });

  it("falls back to the first entry when no default is marked", () => {
    const views = [{ id: "a" }, { id: "b" }];
    expect(viewFor(views, "missing")).toBe(views[0]);
  });

  it("returns null for an empty or absent list", () => {
    expect(viewFor([], "today")).toBeNull();
    expect(viewFor(undefined, "today")).toBeNull();
  });
});

const V_PANELS = [
  { id: "p-news", section: "news" },
  { id: "p-code", section: "code" },
  { id: "p-community", section: "community" },
  { id: "p-trending", section: "aggregates" },
];

const VIEW_PANEL_FIXTURES = [
  {
    id: "today",
    default: true,
    sections: ["aggregates"],
    fallbackPanels: ["p-trending", "p-news"],
  },
  { id: "streams", panels: ["p-news", "p-code"] },
  { id: "all" },
];

describe("viewPanels", () => {
  it("selects by sections membership", () => {
    expect(
      viewPanels(VIEW_PANEL_FIXTURES, V_PANELS, "today").map((p) => p.id),
    ).toEqual(["p-trending"]);
  });

  it("selects by explicit panels ids", () => {
    expect(
      viewPanels(VIEW_PANEL_FIXTURES, V_PANELS, "streams").map((p) => p.id),
    ).toEqual(["p-news", "p-code"]);
  });

  it("returns every panel when the view has neither panels nor sections", () => {
    expect(viewPanels(VIEW_PANEL_FIXTURES, V_PANELS, "all")).toEqual(V_PANELS);
  });

  it("{fallback:true} selects fallbackPanels in panels[] order", () => {
    expect(
      viewPanels(VIEW_PANEL_FIXTURES, V_PANELS, "today", {
        fallback: true,
      }).map((p) => p.id),
    ).toEqual(["p-news", "p-trending"]);
  });

  it("returns [] when no view resolves (no throw)", () => {
    expect(() => viewPanels([], V_PANELS, "nope")).not.toThrow();
    expect(viewPanels([], V_PANELS, "nope")).toEqual([]);
    expect(viewPanels(undefined, V_PANELS, "nope")).toEqual([]);
  });

  it("resolves an unknown id to the default view, not [] (client resilience)", () => {
    // Task 14/15 + Dev Notes: viewPanels delegates to viewFor, so an unknown
    // id against a resolvable list lands on the default view rather than [].
    expect(
      viewPanels(VIEW_PANEL_FIXTURES, V_PANELS, "nope").map((p) => p.id),
    ).toEqual(["p-trending"]);
  });

  it("{fallback:true} returns [] when the view declares no fallbackPanels (no throw)", () => {
    expect(
      viewPanels(VIEW_PANEL_FIXTURES, V_PANELS, "streams", { fallback: true }),
    ).toEqual([]);
  });

  it("ignores unknown panel ids but preserves panels[] order", () => {
    const panels = [
      { id: "p-news", section: "news" },
      { id: "p-code", section: "code" },
    ];
    const views = [{ id: "v", panels: ["p-ghost", "p-news", "p-code"] }];
    expect(viewPanels(views, panels, "v").map((p) => p.id)).toEqual([
      "p-news",
      "p-code",
    ]);
  });
});

describe("panelDeltaCount", () => {
  const arrivals = [
    { _source: "Feed", _category: "news" },
    { _source: "Feed", _category: "news" },
    { _source: "Forum", _category: "community" },
    { _source: "Repos", _category: "code" },
    { _source: "Model Hub", _category: "models" },
  ];

  it("sources binding counts only matching _source", () => {
    expect(panelDeltaCount({ sources: ["Feed"] }, arrivals)).toBe(2);
    expect(panelDeltaCount({ sources: ["Forum", "Repos"] }, arrivals)).toBe(2);
    expect(panelDeltaCount({ sources: ["Absent"] }, arrivals)).toBe(0);
  });

  it("category binding counts only matching _category", () => {
    expect(panelDeltaCount({ category: "community" }, arrivals)).toBe(1);
    expect(panelDeltaCount({ category: "missing" }, arrivals)).toBe(0);
  });

  it("aggregate counts everything except excludeCategories", () => {
    expect(panelDeltaCount({}, arrivals)).toBe(5);
    expect(
      panelDeltaCount({ excludeCategories: ["code", "models"] }, arrivals),
    ).toBe(3);
  });

  it("a panel with neither sources nor category still counts the aggregate", () => {
    // No binding at all: every arrival counts, minus any excluded category.
    expect(panelDeltaCount({ excludeCategories: [] }, arrivals)).toBe(5);
    expect(panelDeltaCount({ excludeCategories: ["news"] }, arrivals)).toBe(3);
  });

  it("tolerates undefined/null arrivals", () => {
    expect(panelDeltaCount({ category: "news" }, undefined)).toBe(0);
    expect(panelDeltaCount({ category: "news" }, null)).toBe(0);
  });

  it("binds to the delta engine's `source`/`category` shape (SSE payload)", () => {
    // lib/delta/engine.mjs emits { source, category }, not `_source`/`_category`.
    // The badge must count the payload actually broadcast, or source/category
    // panels would silently show nothing while aggregates over-count.
    const engineArrivals = [
      { source: "Feed", category: "news" },
      { source: "Feed", category: "news" },
      { source: "Forum", category: "community" },
    ];
    expect(panelDeltaCount({ sources: ["Feed"] }, engineArrivals)).toBe(2);
    expect(panelDeltaCount({ category: "community" }, engineArrivals)).toBe(1);
    expect(panelDeltaCount({}, engineArrivals)).toBe(3);
    expect(
      panelDeltaCount({ excludeCategories: ["news"] }, engineArrivals),
    ).toBe(1);
  });
});

describe("editionCardModel", () => {
  const digest = { weekId: "2026-W38", weekOf: "September 14–18, 2026", generatedAt: "2026-09-16T05:00:00Z" };
  const edition = { editionId: "2026-09-16", generatedAt: "2026-09-16T05:00:00Z" };

  it("returns the daily summary with a /newsletter/ href when the edition has an id", () => {
    expect(editionCardModel(digest, edition)).toEqual({
      daily: {
        id: "2026-09-16",
        generatedAt: "2026-09-16T05:00:00Z",
        href: "/newsletter/2026-09-16",
      },
      weekly: {
        weekId: "2026-W38",
        generatedAt: "2026-09-16T05:00:00Z",
      },
    });
  });

  it("returns daily null when no edition is available", () => {
    expect(editionCardModel(digest, null).daily).toBeNull();
    expect(editionCardModel(digest, {}).daily).toBeNull();
  });

  it("returns weekly null when no digest is available", () => {
    expect(editionCardModel(null, edition).weekly).toBeNull();
    expect(editionCardModel({}, edition).weekly).toBeNull();
  });

  it("returns both null when neither is available", () => {
    expect(editionCardModel(null, null)).toEqual({ daily: null, weekly: null });
    expect(editionCardModel(undefined, undefined)).toEqual({
      daily: null,
      weekly: null,
    });
  });

  it("defaults a missing generatedAt to an empty string", () => {
    const model = editionCardModel(
      { weekId: "2026-W38" },
      { editionId: "2026-09-16" },
    );
    expect(model.daily.generatedAt).toBe("");
    expect(model.weekly.generatedAt).toBe("");
  });

  it("never throws on undefined", () => {
    expect(() => editionCardModel()).not.toThrow();
    expect(editionCardModel()).toEqual({ daily: null, weekly: null });
  });
});

describe("editionReaderModel", () => {
  const edition = {
    editionId: "2026-09-16",
    dateOf: "September 16, 2026",
    tldr: "Three things happened today.",
    topStories: [
      {
        title: "T1",
        body: "B1",
        category: "research",
        impact: "high",
        url: "https://t1",
      },
      {
        title: "T2",
        body: "B2",
        category: "product",
        impact: "low",
        url: "https://t2",
      },
    ],
    modelReleases: [{ name: "M" }, { name: "N" }],
    paperPick: { title: "P" },
    communityBuzz: ["x", "y", "z"],
    quickLinks: [{ text: "q" }],
  };

  it("maps a present edition into the reader model", () => {
    expect(editionReaderModel(edition)).toEqual({
      present: true,
      id: "2026-09-16",
      date: "September 16, 2026",
      lede: "Three things happened today.",
      stories: [
        {
          title: "T1",
          body: "B1",
          category: "research",
          impact: "high",
          url: "https://t1",
        },
        {
          title: "T2",
          body: "B2",
          category: "product",
          impact: "low",
          url: "https://t2",
        },
      ],
      signals: 9,
    });
  });

  it("falls back to the edition id when dateOf is absent", () => {
    expect(editionReaderModel({ editionId: "2026-09-16" })).toEqual({
      present: true,
      id: "2026-09-16",
      date: "2026-09-16",
      lede: "",
      stories: [],
      signals: 0,
    });
  });

  for (const absent of [undefined, null, {}, { editionId: "" }]) {
    it(`returns the empty model for ${JSON.stringify(absent)}`, () => {
      expect(editionReaderModel(absent)).toEqual({
        present: false,
        id: "",
        date: "",
        lede: "",
        stories: [],
        signals: 0,
      });
    });
  }

  it("never throws on absent input", () => {
    expect(() => editionReaderModel()).not.toThrow();
  });
});

describe("editionSignalCount", () => {
  it("counts topStories + modelReleases + paperPick + communityBuzz + quickLinks", () => {
    expect(
      editionSignalCount({
        topStories: [1, 2, 3],
        modelReleases: [1],
        paperPick: { title: "P" },
        communityBuzz: [1, 2, 3, 4],
        quickLinks: [1, 2],
      }),
    ).toBe(11);
  });

  it("treats missing sections and an absent paper pick as zero", () => {
    expect(editionSignalCount({ topStories: [1] })).toBe(1);
    expect(editionSignalCount({ paperPick: null })).toBe(0);
    expect(editionSignalCount({})).toBe(0);
  });

  it("does not count an empty paperPick (the prompt's no-paper sentinel)", () => {
    // `paperPick: {}` is documented in the pack prompt as "no paper worth
    // highlighting"; sanitizeDailyEdition turns it into empty strings. It is
    // not a condensed item and must not inflate the reference count.
    expect(editionSignalCount({ paperPick: {} })).toBe(0);
    expect(
      editionSignalCount({ paperPick: { title: "", insight: "", url: "" } }),
    ).toBe(0);
    expect(
      editionSignalCount({ topStories: [1], paperPick: {} }),
    ).toBe(1);
  });

  it("never throws on absent input", () => {
    expect(() => editionSignalCount()).not.toThrow();
    expect(editionSignalCount(undefined)).toBe(0);
    expect(editionSignalCount(null)).toBe(0);
  });
});

describe("sourceHealthSummary", () => {
  const sources = Array.from({ length: 12 }, (_, i) => ({
    source: `S${i}`,
    status: "ok",
    data: { category: "news", items: [] },
  }));

  it("returns one row and one cell per sweep source, in pack order", () => {
    const s = sourceHealthSummary(sources);
    expect(s.rows).toHaveLength(12);
    expect(s.cells).toHaveLength(12);
    expect(s.rows.map((r) => r.name)).toEqual(sources.map((x) => x.source));
    expect(s.total).toBe(12);
    expect(s.ok).toBe(12);
    expect(s.sweeping).toBe(false);
  });

  it("derives ok/total from the sweep data, never a literal", () => {
    const three = [
      { source: "A", status: "ok", data: { category: "news", items: [] } },
      { source: "B", status: "error", error: "x" },
      { source: "C", status: "ok", data: { category: "news", items: [] } },
    ];
    const s = sourceHealthSummary(three);
    expect(s.total).toBe(3);
    expect(s.ok).toBe(2);
    expect(s.rows.map((r) => r.status)).toEqual(["ok", "error", "ok"]);
    expect(s.cells.map((c) => c.status)).toEqual(["ok", "error", "ok"]);
  });

  it("falls back to progress totals when the sweep payload is absent", () => {
    const progress = {
      phase: "sources",
      totals: { sourcesOk: 4, sourcesTotal: 12 },
      steps: [],
    };
    const s = sourceHealthSummary(undefined, progress);
    expect(s.total).toBe(12);
    expect(s.ok).toBe(4);
  });

  it("during a sources sweep a cell is running until its step is terminal", () => {
    const steps = sources.map((src, i) => ({
      kind: "source",
      label: src.source,
      state: i === 0 ? "ok" : i === 1 ? "error" : "running",
    }));
    const progress = {
      phase: "sources",
      totals: { sourcesOk: 1, sourcesTotal: 12 },
      steps,
    };
    const s = sourceHealthSummary(sources, progress);
    expect(s.sweeping).toBe(true);
    expect(s.cells).toHaveLength(12);
    expect(s.cells[0].status).toBe("ok");
    expect(s.cells[1].status).toBe("error");
    expect(s.cells[2].status).toBe("running");
    expect(s.cells[11].status).toBe("running");
    expect(s.ok).toBe(1);
    expect(s.total).toBe(12);
  });

  it("after the sources phase, cells fall back to the sweep status", () => {
    const s = sourceHealthSummary(sources, { phase: "ready", steps: [] });
    expect(s.sweeping).toBe(false);
    expect(s.cells.every((c) => c.status === "ok")).toBe(true);
  });

  it("maps a source with no status to idle and a failed source to error", () => {
    const list = [
      { source: "Pending" },
      { source: "Broken", status: "error", error: "boom" },
    ];
    const s = sourceHealthSummary(list);
    expect(s.rows.map((r) => r.status)).toEqual(["idle", "error"]);
  });

  it("never throws on undefined inputs", () => {
    expect(sourceHealthSummary()).toEqual({
      ok: 0,
      total: 0,
      rows: [],
      cells: [],
      sweeping: false,
    });
    expect(sourceHealthSummary(undefined, undefined)).toEqual({
      ok: 0,
      total: 0,
      rows: [],
      cells: [],
      sweeping: false,
    });
  });
});

describe("nextSweepSeconds", () => {
  const t = "2026-09-16T12:00:00.000Z";
  const anchor = new Date(t).getTime();
  const cooldown = 900000; // 15 min, mirrors REFRESH_MS

  it("counts down as now advances", () => {
    expect(nextSweepSeconds(t, cooldown, anchor)).toBe(900);
    expect(nextSweepSeconds(t, cooldown, anchor + 100000)).toBe(800);
    expect(nextSweepSeconds(t, cooldown, anchor + 899500)).toBe(1);
  });

  it("clamps at zero once the cooldown has elapsed", () => {
    expect(nextSweepSeconds(t, cooldown, anchor + cooldown)).toBe(0);
    expect(nextSweepSeconds(t, cooldown, anchor + cooldown + 60000)).toBe(0);
  });

  it("returns zero when the anchor or cooldown is unknown", () => {
    // No anchor yet, no cooldown, unparseable date and zero/negative cooldown
    // must not invent a number.
    expect(nextSweepSeconds(null, cooldown, anchor)).toBe(0);
    expect(nextSweepSeconds(t, 0, anchor)).toBe(0);
    expect(nextSweepSeconds(t, undefined, anchor)).toBe(0);
    expect(nextSweepSeconds("not-a-date", cooldown, anchor)).toBe(0);
  });

  it("never throws on undefined inputs", () => {
    expect(nextSweepSeconds()).toBe(0);
  });
});

describe("weekNumberOf", () => {
  it("extracts the ISO week number from a weekId", () => {
    expect(weekNumberOf("2026-W16")).toBe(16);
    expect(weekNumberOf("2026-W01")).toBe(1);
    expect(weekNumberOf("2026-W52")).toBe(52);
  });

  it("returns 0 for malformed, missing or non-string ids", () => {
    expect(weekNumberOf("")).toBe(0);
    expect(weekNumberOf("2026-W")).toBe(0);
    expect(weekNumberOf("not-a-week")).toBe(0);
    expect(weekNumberOf("2026-Wabc")).toBe(0);
    expect(weekNumberOf(undefined)).toBe(0);
    expect(weekNumberOf(null)).toBe(0);
    expect(weekNumberOf(2026)).toBe(0);
  });

  it("never throws", () => {
    expect(() => weekNumberOf({})).not.toThrow();
    expect(weekNumberOf({})).toBe(0);
  });
});

describe("digestSignalCount", () => {
  it("counts highlights + modelUpdates + paperPicks + communityBuzz", () => {
    expect(
      digestSignalCount({
        highlights: [1, 2, 3],
        modelUpdates: [1],
        paperPicks: [1, 2],
        communityBuzz: [1, 2, 3, 4],
      }),
    ).toBe(10);
  });

  it("treats missing sections as zero and never throws", () => {
    expect(digestSignalCount({ highlights: [1] })).toBe(1);
    expect(digestSignalCount({})).toBe(0);
    expect(digestSignalCount(undefined)).toBe(0);
    expect(digestSignalCount(null)).toBe(0);
    expect(() => digestSignalCount()).not.toThrow();
  });
});

describe("archiveRows", () => {
  const digest = {
    weekId: "2026-W38",
    highlights: [1, 2],
    modelUpdates: [1],
    paperPicks: [1],
    communityBuzz: [1, 2],
  };
  const latestEdition = {
    editionId: "2026-09-16",
    topStories: [1, 2, 3],
    modelReleases: [1],
    paperPick: { title: "P" },
    communityBuzz: [1],
    quickLinks: [1, 2],
  };

  it("emits the weekly row first with week number and digest signal count", () => {
    expect(archiveRows(["2026-09-16"], digest, latestEdition)[0]).toEqual({
      kind: "weekly",
      id: "2026-W38",
      weekNumber: 38,
      signals: 6,
      href: null,
    });
  });

  it("preserves the caller's daily order and links each to /newsletter/:id", () => {
    const rows = archiveRows(
      ["2026-09-16", "2026-09-15", "2026-09-14"],
      digest,
      latestEdition,
    );
    expect(rows.slice(1).map((r) => r.id)).toEqual([
      "2026-09-16",
      "2026-09-15",
      "2026-09-14",
    ]);
    expect(rows[1]).toMatchObject({
      kind: "daily",
      date: "2026-09-16",
      href: "/newsletter/2026-09-16",
    });
    expect(rows[2].href).toBe("/newsletter/2026-09-15");
    expect(rows[3].href).toBe("/newsletter/2026-09-14");
  });

  it("carries signals only for the latest daily; older rows stay null", () => {
    const rows = archiveRows(
      ["2026-09-16", "2026-09-15"],
      digest,
      latestEdition,
    );
    // 3 stories + 1 release + 1 paper + 1 buzz + 2 links
    expect(rows[1].signals).toBe(8);
    expect(rows[2].signals).toBeNull();
  });

  it("omits the weekly row when the digest has no weekId", () => {
    const rows = archiveRows(["2026-09-16"], { weekId: "" }, latestEdition);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("daily");
    expect(rows[0].signals).toBe(8);
  });

  it("returns [] for absent or empty inputs and never throws", () => {
    expect(archiveRows()).toEqual([]);
    expect(archiveRows(undefined, undefined, undefined)).toEqual([]);
    expect(archiveRows([], undefined, undefined)).toEqual([]);
    expect(archiveRows(undefined, {}, undefined)).toEqual([]);
    expect(() => archiveRows()).not.toThrow();
  });

  it("preserves malformed ids as data and never throws", () => {
    const rows = archiveRows(["not-a-date", 42], digest, null);
    expect(rows.slice(1).map((r) => r.id)).toEqual(["not-a-date", 42]);
    expect(rows[1].href).toBe("/newsletter/not-a-date");
    expect(rows[1].signals).toBeNull();
  });
});

describe("storyMeta", () => {
  const HOUR = 3600000;
  const now = Date.parse("2026-09-17T12:00:00Z");
  const sources = [
    {
      source: "Wire",
      status: "ok",
      data: {
        category: "news",
        items: [
          {
            title: "A",
            url: "https://example.com/a",
            published: "2026-09-17T06:00:00Z",
            score: 431,
          },
          // A source that supplies a discussion permalink: `_url` becomes the
          // permalink while `url` stays the article the model actually cites.
          {
            title: "B",
            url: "https://example.com/b",
            hnLink: "https://discuss.example/1",
            published: "2026-09-16T12:00:00Z",
            score: 629,
          },
        ],
      },
    },
  ];
  const items = collectItems(sources);

  it("resolves source, compact age and score from the matching item", () => {
    expect(storyMeta({ url: "https://example.com/a" }, items, now)).toEqual({
      source: "Wire",
      age: "6h",
      score: 431,
    });
  });

  it("falls back to the original url when _url is a discussion permalink", () => {
    expect(storyMeta({ url: "https://example.com/b" }, items, now)).toEqual({
      source: "Wire",
      age: "1d",
      score: 629,
    });
  });

  it("prefers an exact _url match over the article url", () => {
    expect(
      storyMeta({ url: "https://discuss.example/1" }, items, now),
    ).toMatchObject({ source: "Wire" });
  });

  it("returns null rather than inventing provenance", () => {
    expect(storyMeta({ url: "https://example.com/missing" }, items, now)).toBeNull();
    expect(storyMeta({ url: "" }, items, now)).toBeNull();
    expect(storyMeta({}, items, now)).toBeNull();
    expect(storyMeta(undefined, items, now)).toBeNull();
    expect(storyMeta({ url: "https://example.com/a" }, undefined, now)).toBeNull();
  });

  it("yields an empty age for an item carrying no timestamp", () => {
    const noTime = collectItems([
      {
        source: "Hub",
        status: "ok",
        data: { category: "models", models: { items: [{ id: "m", url: "u" }] } },
      },
    ]);
    expect(storyMeta({ url: "u" }, noTime, now)).toEqual({
      source: "Hub",
      age: "",
      score: 0,
    });
  });

  it("never throws", () => {
    expect(() => storyMeta(null, null)).not.toThrow();
    expect(storyMeta({ url: 42 }, items, now)).toBeNull();
  });
});

describe("healthTally", () => {
  const item = { title: "t", url: "u", published: "2026-09-17T11:40:00Z" };
  const old = { title: "t", url: "u2", published: "2020-01-01T00:00:00Z" };

  it("counts an ok source carrying items as healthy", () => {
    expect(
      healthTally([
        { source: "A", status: "ok", data: { category: "news", items: [item] } },
      ]),
    ).toEqual({ healthy: 1, slow: 0, idle: 0 });
  });

  it("counts a failed source as slow", () => {
    expect(healthTally([{ source: "A", status: "error" }])).toEqual({
      healthy: 0,
      slow: 1,
      idle: 0,
    });
  });

  it("counts an ok-but-empty source as idle", () => {
    expect(
      healthTally([
        { source: "A", status: "ok", data: { category: "news", items: [] } },
      ]),
    ).toEqual({ healthy: 0, slow: 0, idle: 1 });
  });

  // Regression: item age is not fetch latency. A feed whose newest post is
  // years old is still a healthy source if the fetch succeeded.
  it("does not treat stale items as a slow source", () => {
    expect(
      healthTally([
        { source: "A", status: "ok", data: { category: "news", items: [old] } },
      ]),
    ).toEqual({ healthy: 1, slow: 0, idle: 0 });
  });

  it("tallies a mixed sweep", () => {
    expect(
      healthTally([
        { source: "A", status: "ok", data: { category: "news", items: [item] } },
        { source: "B", status: "ok", data: { category: "news", items: [old] } },
        { source: "C", status: "error" },
        { source: "D", status: "ok", data: { category: "news", items: [] } },
      ]),
    ).toEqual({ healthy: 2, slow: 1, idle: 1 });
  });

  it("returns a zeroed tally for absent input and never throws", () => {
    expect(healthTally()).toEqual({ healthy: 0, slow: 0, idle: 0 });
    expect(healthTally(null)).toEqual({ healthy: 0, slow: 0, idle: 0 });
    expect(() => healthTally([null, undefined])).not.toThrow();
  });
});

describe("panelIdForSource", () => {
  const panels = [
    { id: "wires", section: "news", sources: ["Wire A", "Wire B"] },
    { id: "hub", section: "research", category: "models" },
    { id: "health", variant: "source-health" },
  ];
  const views = [
    { id: "grid", sections: ["news", "research"], panels: ["health"] },
    { id: "other", sections: ["community"] },
  ];
  const sources = [
    { source: "Wire A", status: "ok", data: { category: "news", items: [{ title: "a", url: "u" }] } },
    { source: "Wire B", status: "ok", data: { category: "news", items: [{ title: "b", url: "v" }] } },
    { source: "Hub", status: "ok", data: { category: "models", models: { items: [{ id: "m" }] } } },
  ];

  it("resolves a source bound by name", () => {
    expect(panelIdForSource(views, panels, "grid", sources, "Wire B")).toBe("wires");
  });

  it("resolves a source bound by category", () => {
    expect(panelIdForSource(views, panels, "grid", sources, "Hub")).toBe("hub");
  });

  it("only searches the destination view", () => {
    expect(panelIdForSource(views, panels, "other", sources, "Wire A")).toBeNull();
  });

  it("returns null for an unbound or missing source", () => {
    expect(panelIdForSource(views, panels, "grid", sources, "Nowhere")).toBeNull();
    expect(panelIdForSource(views, panels, "grid", sources, "")).toBeNull();
    expect(panelIdForSource(views, panels, "grid", sources, undefined)).toBeNull();
  });

  it("never throws on absent input", () => {
    expect(() => panelIdForSource(undefined, undefined, "grid", undefined, "x")).not.toThrow();
    expect(panelIdForSource([], [], "grid", [], "x")).toBeNull();
  });
});

describe("moreHeadlines", () => {
  const mk = (source, url, score) => ({
    _source: source,
    _url: url,
    url,
    _category: "news",
    _score: score,
    _comments: 0,
    title: url,
  });
  const byCategory = {
    news: [
      mk("A", "a1", 100),
      mk("A", "a2", 90),
      mk("A", "a3", 80),
      mk("B", "b1", 70),
      mk("B", "b2", 60),
      mk("C", "c1", 50),
    ],
    code: [mk("D", "d1", 40)],
  };
  const panel = { sort: "engagement", excludeCategories: ["code"] };

  it("spreads across sources instead of letting one feed fill the list", () => {
    const rows = moreHeadlines(panel, byCategory, [], 5);
    expect(rows.map((r) => r._source)).toEqual(["A", "B", "C", "A", "B"]);
  });

  it("offers each source's best item first", () => {
    const rows = moreHeadlines(panel, byCategory, [], 3);
    expect(rows.map((r) => r._url)).toEqual(["a1", "b1", "c1"]);
  });

  it("never repeats a headline the stories already show", () => {
    const rows = moreHeadlines(panel, byCategory, ["a1", "b1"], 4);
    expect(rows.map((r) => r._url)).not.toContain("a1");
    expect(rows.map((r) => r._url)).not.toContain("b1");
  });

  it("matches a used url on either the canonical or original field", () => {
    const item = { ...mk("A", "perma", 100), url: "article" };
    const rows = moreHeadlines(panel, { news: [item] }, ["article"], 2);
    expect(rows).toEqual([]);
  });

  it("honours excludeCategories from the panel", () => {
    const rows = moreHeadlines(panel, byCategory, [], 10);
    expect(rows.map((r) => r._source)).not.toContain("D");
  });

  // Regression: aggregateItems slices by panel.limit, which is the story-list
  // cap. Passing it through left the round-robin only that many items to
  // spread, so one busy source still filled the list.
  it("draws from the whole pool, not the panel's story-list limit", () => {
    const capped = { ...panel, limit: 2 };
    const rows = moreHeadlines(capped, byCategory, [], 5);
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r._source)).size).toBeGreaterThan(1);
  });

  it("returns [] for a zero or missing limit, and never throws", () => {
    expect(moreHeadlines(panel, byCategory, [], 0)).toEqual([]);
    expect(moreHeadlines(panel, byCategory, [])).toEqual([]);
    expect(() => moreHeadlines(undefined, undefined, undefined, 3)).not.toThrow();
    expect(moreHeadlines(undefined, undefined, undefined, 3)).toEqual([]);
  });

  it("stops at the limit even when more are available", () => {
    expect(moreHeadlines(panel, byCategory, [], 2)).toHaveLength(2);
  });
});
