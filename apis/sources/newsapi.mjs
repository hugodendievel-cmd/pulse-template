// apis/sources/newsapi.mjs — NewsAPI.org AI headlines (requires NEWSAPI_KEY)
// config: { query?: string } — defaults preserve AI behavior
// opts: { days?: number } — sets the `from` param when provided
import { env } from "../utils/env.mjs";
import { safeFetch } from "../utils/fetch.mjs";

const BASE = "https://newsapi.org/v2/everything";
const QUERY =
  "artificial intelligence OR LLM OR large language model OR OpenAI OR generative AI";
const PAGE_SIZE = 30;

export async function briefing(config = {}, { days } = {}) {
  const apiKey = env("NEWSAPI_KEY");
  if (!apiKey) {
    return {
      source: "NewsAPI",
      category: "news",
      count: 0,
      items: [],
      skipped: "NEWSAPI_KEY not configured",
    };
  }

  const url = new URL(BASE);
  url.searchParams.set("q", config.query ?? QUERY);
  url.searchParams.set("sortBy", "publishedAt");
  url.searchParams.set("pageSize", String(PAGE_SIZE));
  url.searchParams.set("language", "en");
  if (days) {
    const from = new Date(Date.now() - days * 86400000)
      .toISOString()
      .split("T")[0];
    url.searchParams.set("from", from);
  }

  const data = await safeFetch(url.toString(), {
    timeout: 15000,
    headers: { "X-Api-Key": apiKey },
  });

  const items = (data.articles || []).map((a) => ({
    title: a.title,
    url: a.url,
    source: a.source?.name || "",
    published: a.publishedAt,
    description: a.description || "",
    author: a.author || null,
  }));

  return {
    source: "NewsAPI",
    category: "news",
    count: items.length,
    items,
  };
}

// Standalone test
if (import.meta.url === `file://${process.argv[1]}`) {
  const d = await briefing();
  console.log(JSON.stringify(d, null, 2));
}
