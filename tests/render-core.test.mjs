// tests/render-core.test.mjs — Story 2.4: pure dashboard data layer.
// Imports dashboard/public/render-core.mjs directly — no DOM, no network.
import { describe, expect, it } from "vitest";

import {
  aggregateByCategory,
  aggregateItems,
  collectItems,
  formatNum,
  normalizeItem,
  selectPanelItems,
  sourceColorFor,
  statValue,
} from "../dashboard/public/render-core.mjs";

// Fixture sources resembling an ai-pack sweep
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
    expect(items[0].name).toBe("o/r"); // 1500 stars beats 120+5 likes, 12+4
    expect(items).toHaveLength(4); // repo + community + both models (likes>0)
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

  it("counts items across the ai-style articles split", () => {
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
