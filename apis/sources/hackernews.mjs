// apis/sources/hackernews.mjs — Hacker News AI stories (no key needed)
// config: { keywords?: string } — RegExp source string; defaults preserve AI behavior
import { safeFetch } from "../utils/fetch.mjs";

const AI_KEYWORDS =
  /\b(ai|llm|gpt|claude|gemini|anthropic|openai|mistral|deepseek|meta ai|llama|transformer|diffusion|machine learning|neural|chatgpt|copilot|midjourney|stable diffusion|hugging\s?face|langchain|rag|fine.?tun|large language|foundation model|generative|deep ?learning|artificial intelligence)\b/i;

export async function briefing(config = {}) {
  const KEYWORDS = new RegExp(config.keywords ?? AI_KEYWORDS.source, "i");
  const ids = await safeFetch(
    "https://hacker-news.firebaseio.com/v0/topstories.json",
  );
  const top100 = ids.slice(0, 100);

  const stories = await Promise.allSettled(
    top100.map((id) =>
      safeFetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
        retries: 1,
        timeout: 8000,
      }),
    ),
  );

  const aiStories = stories
    .filter((r) => r.status === "fulfilled" && r.value?.title)
    .map((r) => r.value)
    .filter((s) => KEYWORDS.test(s.title) || KEYWORDS.test(s.text || ""))
    .map((s) => ({
      title: s.title,
      url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
      score: s.score,
      comments: s.descendants || 0,
      author: s.by,
      time: new Date(s.time * 1000).toISOString(),
      hnLink: `https://news.ycombinator.com/item?id=${s.id}`,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return {
    source: "Hacker News",
    category: "community",
    count: aiStories.length,
    items: aiStories,
  };
}

// Standalone test
if (import.meta.url === `file://${process.argv[1]}`) {
  briefing().then((d) => console.log(JSON.stringify(d, null, 2)));
}
