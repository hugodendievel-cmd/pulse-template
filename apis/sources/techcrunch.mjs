// apis/sources/techcrunch.mjs — TechCrunch AI RSS (no key needed)
// config: { feedUrl?: string, keywords?: string } — keywords is a RegExp source
// string; defaults preserve AI behavior
import { safeFetchText } from "../utils/fetch.mjs";
import { parseRss } from "../utils/xml.mjs";

const FEED_URL =
  "https://techcrunch.com/category/artificial-intelligence/feed/";

const AI_KEYWORDS =
  /\b(ai|llm|gpt|claude|anthropic|openai|google|meta|microsoft|nvidia|startup|acquisition|funding|launch|model|chatbot|copilot|agent|generative)\b/i;

export async function briefing(config = {}) {
  const keywords = new RegExp(config.keywords ?? AI_KEYWORDS.source, "i");
  const xml = await safeFetchText(config.feedUrl ?? FEED_URL, {
    timeout: 15000,
  });
  const items = parseRss(xml).filter(
    (i) => keywords.test(i.title) || keywords.test(i.description),
  );

  return {
    source: "TechCrunch",
    category: "news",
    count: items.length,
    items: items.slice(0, 15),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  briefing().then((d) => console.log(JSON.stringify(d, null, 2)));
}
