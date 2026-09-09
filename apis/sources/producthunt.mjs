// apis/sources/producthunt.mjs — Product Hunt AI products (no key needed — uses Atom feed)
// config: { feedUrl?: string, keywords?: string } — keywords is a RegExp source
// string; defaults preserve AI behavior
import { safeFetchText } from "../utils/fetch.mjs";
import { parseAtom } from "../utils/xml.mjs";

const AI_KEYWORDS =
  /\b(ai|llm|gpt|chatbot|copilot|agent|machine learning|generative|automation|assistant|neural|language model|deep learning)\b/i;

export async function briefing(config = {}) {
  const keywords = new RegExp(config.keywords ?? AI_KEYWORDS.source, "i");
  let items = [];
  try {
    const xml = await safeFetchText(
      config.feedUrl ?? "https://www.producthunt.com/feed",
      {
        timeout: 15000,
      },
    );
    items = parseAtom(xml).filter(
      (i) => keywords.test(i.title) || keywords.test(i.description),
    );
  } catch (err) {
    return {
      source: "Product Hunt",
      category: "products",
      error: err.message,
      items: [],
    };
  }

  return {
    source: "Product Hunt",
    category: "products",
    count: items.length,
    items: items.slice(0, 15),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  briefing().then((d) => console.log(JSON.stringify(d, null, 2)));
}
