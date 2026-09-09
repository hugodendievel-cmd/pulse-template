// apis/sources/arxiv.mjs — ArXiv AI/ML papers (no key needed)
// config: { categories?: string[], maxResults?: number } — defaults preserve AI behavior
import { safeFetchText } from "../utils/fetch.mjs";
import { parseArxiv } from "../utils/xml.mjs";

const CATEGORIES = ["cs.AI", "cs.CL", "cs.LG", "cs.CV"];
const MAX_RESULTS = 25;

export async function briefing(config = {}) {
  const categories = config.categories ?? CATEGORIES;
  const max = config.maxResults ?? MAX_RESULTS;
  const query = categories.map((c) => `cat:${c}`).join("+OR+");
  const url = `https://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=${max}`;

  const xml = await safeFetchText(url, { timeout: 20000 });
  const papers = parseArxiv(xml);

  return {
    source: "ArXiv",
    category: "research",
    count: papers.length,
    items: papers,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  briefing().then((d) => console.log(JSON.stringify(d, null, 2)));
}
