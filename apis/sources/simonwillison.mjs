// apis/sources/simonwillison.mjs — Simon Willison's blog (Atom feed, no key needed)
// config: { feedUrl?: string } — defaults preserve AI behavior
import { safeFetchText } from "../utils/fetch.mjs";
import { parseAtom } from "../utils/xml.mjs";

const FEED_URL = "https://simonwillison.net/atom/everything/";

export async function briefing(config = {}) {
  const xml = await safeFetchText(config.feedUrl ?? FEED_URL, {
    timeout: 15000,
  });
  const items = parseAtom(xml);

  return {
    source: "Simon Willison",
    category: "community",
    count: items.length,
    items: items.slice(0, 15),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const d = await briefing();
  console.log(JSON.stringify(d, null, 2));
}
