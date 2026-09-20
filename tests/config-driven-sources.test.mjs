// tests/config-driven-sources.test.mjs — Story 2.2: sources read their domain
// filter from `config`, zero-arg calls preserve AI behavior (FR6).
// No network: apis/utils/fetch.mjs is stubbed via vi.doMock + vi.resetModules
// (pattern from tests/reddit-source.test.mjs).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function stubFetchModule({ safeFetch, safeFetchText } = {}) {
  vi.doMock("../apis/utils/fetch.mjs", () => ({
    safeFetch: safeFetch ?? vi.fn(),
    safeFetchText: safeFetchText ?? vi.fn(),
  }));
}

beforeEach(() => {
  vi.resetModules();
  // Force the reddit public path (no OAuth)
  delete process.env.REDDIT_CLIENT_ID;
  delete process.env.REDDIT_CLIENT_SECRET;
});

afterEach(() => {
  vi.doUnmock("../apis/utils/fetch.mjs");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("hackernews — config.keywords", () => {
  const safeFetchImpl = async (url) => {
    if (url.includes("topstories")) return [1, 2];
    if (url.includes("/item/1"))
      return { id: 1, title: "New macOS app released", score: 5, time: 1700000000 };
    if (url.includes("/item/2"))
      return { id: 2, title: "New GPT model released", score: 5, time: 1700000000 };
    return null;
  };

  it("keyword override keeps only matching stories", async () => {
    stubFetchModule({ safeFetch: vi.fn(safeFetchImpl) });
    const { briefing } = await import("../apis/sources/hackernews.mjs");
    const result = await briefing({ keywords: "\\b(macos|mac app)\\b" });
    expect(result.source).toBe("Hacker News");
    expect(result.category).toBe("community");
    expect(result.items.map((i) => i.title)).toEqual([
      "New macOS app released",
    ]);
  });

  it("zero-arg briefing() keeps the default AI filter", async () => {
    stubFetchModule({ safeFetch: vi.fn(safeFetchImpl) });
    const { briefing } = await import("../apis/sources/hackernews.mjs");
    const result = await briefing();
    expect(result.items.map((i) => i.title)).toEqual([
      "New GPT model released",
    ]);
  });
});

describe("reddit — config.subreddits", () => {
  it("override hits only the configured subreddits", async () => {
    const safeFetch = vi.fn().mockResolvedValue({ data: { children: [] } });
    stubFetchModule({ safeFetch });
    const { briefing } = await import("../apis/sources/reddit.mjs");
    const result = await briefing({ subreddits: ["macapps"] });
    expect(result.source).toBe("Reddit");
    expect(result.category).toBe("community");
    expect(safeFetch).toHaveBeenCalled();
    for (const call of safeFetch.mock.calls) {
      expect(call[0]).toContain("/r/macapps");
    }
  });

  it("zero-arg briefing() hits the default AI subreddits", async () => {
    const safeFetch = vi.fn().mockResolvedValue({ data: { children: [] } });
    stubFetchModule({ safeFetch });
    const { briefing } = await import("../apis/sources/reddit.mjs");
    await briefing();
    const urls = safeFetch.mock.calls.map((c) => c[0]);
    expect(urls.some((u) => u.includes("/r/MachineLearning"))).toBe(true);
  });
});

describe("github-trending — config.query + config.dateField", () => {
  it("zero-arg briefing() keeps the default AI query and pushed: window", async () => {
    const safeFetch = vi.fn().mockResolvedValue({ items: [] });
    stubFetchModule({ safeFetch });
    const { briefing } = await import("../apis/sources/github-trending.mjs");
    const result = await briefing();
    expect(result.source).toBe("GitHub Trending");
    expect(result.category).toBe("code");
    const url = safeFetch.mock.calls[0][0];
    expect(url).toContain("pushed%3A");
    expect(url).toContain("llm");
  });

  it("override swaps query and dateField", async () => {
    const safeFetch = vi.fn().mockResolvedValue({ items: [] });
    stubFetchModule({ safeFetch });
    const { briefing } = await import("../apis/sources/github-trending.mjs");
    await briefing({ query: "topic:macos", dateField: "created" });
    const url = safeFetch.mock.calls[0][0];
    expect(url).toContain("created%3A");
    expect(url).toContain("topic%3Amacos");
    expect(url).not.toContain("pushed%3A");
  });
});

describe("arxiv — config.categories", () => {
  const ATOM = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`;

  it("override changes the category query", async () => {
    const safeFetchText = vi.fn().mockResolvedValue(ATOM);
    stubFetchModule({ safeFetchText });
    const { briefing } = await import("../apis/sources/arxiv.mjs");
    const result = await briefing({ categories: ["stat.ML"] });
    expect(result.source).toBe("ArXiv");
    expect(result.category).toBe("research");
    expect(safeFetchText.mock.calls[0][0]).toContain("cat:stat.ML");
  });

  it("zero-arg briefing() keeps the default AI categories", async () => {
    const safeFetchText = vi.fn().mockResolvedValue(ATOM);
    stubFetchModule({ safeFetchText });
    const { briefing } = await import("../apis/sources/arxiv.mjs");
    await briefing();
    expect(safeFetchText.mock.calls[0][0]).toContain("cat:cs.AI");
  });
});

describe("techcrunch — config.feedUrl", () => {
  it("override fetches exactly the configured feed", async () => {
    const safeFetchText = vi
      .fn()
      .mockResolvedValue(`<?xml version="1.0"?><rss><channel></channel></rss>`);
    stubFetchModule({ safeFetchText });
    const { briefing } = await import("../apis/sources/techcrunch.mjs");
    const result = await briefing({ feedUrl: "https://example.test/feed/" });
    expect(result.source).toBe("TechCrunch");
    expect(result.category).toBe("news");
    expect(safeFetchText).toHaveBeenCalledTimes(1);
    expect(safeFetchText.mock.calls[0][0]).toBe("https://example.test/feed/");
  });
});

describe("google-news — config.queries + opts.days", () => {
  const RSS = `<?xml version="1.0"?><rss><channel></channel></rss>`;

  it("override queries and days flow into the request URL", async () => {
    const safeFetchText = vi.fn().mockResolvedValue(RSS);
    stubFetchModule({ safeFetchText });
    const { briefing } = await import("../apis/sources/google-news.mjs");
    const result = await briefing({ queries: ["macos+app"] }, { days: 7 });
    expect(result.source).toBe("Google News");
    expect(result.category).toBe("news");
    expect(safeFetchText).toHaveBeenCalledTimes(1);
    const url = safeFetchText.mock.calls[0][0];
    expect(url).toContain("macos+app");
    expect(url).toContain("when:7d");
  });

  it("zero-arg briefing() defaults to the AI queries and when:3d", async () => {
    const safeFetchText = vi.fn().mockResolvedValue(RSS);
    stubFetchModule({ safeFetchText });
    const { briefing } = await import("../apis/sources/google-news.mjs");
    await briefing();
    const urls = safeFetchText.mock.calls.map((c) => c[0]);
    expect(urls).toHaveLength(4);
    expect(urls[0]).toContain("artificial+intelligence");
    expect(urls[0]).toContain("when:3d");
  });
});

describe("uniform signature — remaining modules accept (config, opts)", () => {
  it("huggingface / theverge / venturebeat / simonwillison / producthunt / newsapi accept both args", async () => {
    const safeFetchText = vi
      .fn()
      .mockResolvedValue(`<?xml version="1.0"?><feed></feed>`);
    const safeFetch = vi.fn().mockResolvedValue([]);
    stubFetchModule({ safeFetch, safeFetchText });
    const hf = await import("../apis/sources/huggingface.mjs");
    const tv = await import("../apis/sources/theverge.mjs");
    const vb = await import("../apis/sources/venturebeat.mjs");
    const sw = await import("../apis/sources/simonwillison.mjs");
    const ph = await import("../apis/sources/producthunt.mjs");
    const na = await import("../apis/sources/newsapi.mjs");
    // None of these may throw on (config, opts)
    await hf.briefing({}, {});
    await tv.briefing({}, {});
    await vb.briefing({}, {});
    await sw.briefing({}, {});
    await ph.briefing({}, {});
    const newsapiResult = await na.briefing({}, { days: 7 });
    // NewsAPI without a key keeps its early-return shape
    expect(newsapiResult.source).toBe("NewsAPI");
    expect(newsapiResult.items).toEqual([]);
  });
});
