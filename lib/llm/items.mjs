// lib/llm/items.mjs — Shared freshness-filtered item collection for the
// weekly digest and the daily edition. The window is a parameter so the
// weekly digest (7 days) and the daily edition (24 hours) share one
// implementation instead of drifting apart.
//
// Item shape: { key, text } where text is
// "Title [YYYY-MM-DD] | url | summary excerpt" (excerpt omitted when the
// source carries no description; "[trending]" replaces the date for undated
// items from inherently fresh sources). The excerpt is the difference between
// a headline restated and a fact-dense summary.

const SNIPPET_MAX = 200;

const DATE_FIELDS = [
  "published",
  "pubDate",
  "publishedAt",
  "lastModified",
  "updated",
  "updated_at",
  "updatedAt",
  "created",
  "created_at",
  "createdAt",
  "pushed_at",
  "pushedAt",
  "time",
  "date",
  "isoDate",
];

/** Whitespace-collapsed, length-capped description/summary from a source item. */
export function snippetOf(item) {
  const raw = item.description || item.summary || item.content || "";
  const clean = String(raw).replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > SNIPPET_MAX
    ? `${clean.slice(0, SNIPPET_MAX - 1)}…`
    : clean;
}

export function extractDate(item) {
  for (const field of DATE_FIELDS) {
    const v = item[field];
    if (!v) continue;
    // time as unix seconds (Hacker News)
    if (typeof v === "number") {
      const ms = v < 1e12 ? v * 1000 : v;
      if (!Number.isNaN(ms)) return new Date(ms).toISOString();
    }
    const ts = new Date(v).getTime();
    if (!Number.isNaN(ts)) return new Date(ts).toISOString();
  }
  return "";
}

export function isRecent(dateStr, windowMs) {
  if (!dateStr) return false;
  const ts = new Date(dateStr).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < windowMs;
}

export function formatItem(item, sourceName, freshSources, windowMs) {
  const title = item.title || item.name || item.id || "";
  if (!title) return null;
  const date = extractDate(item);

  if (date) {
    // Has a date — must be within the window
    if (!isRecent(date, windowMs)) return null;
  } else {
    // No date — only allow if the source is inherently fresh
    if (!freshSources.has(sourceName)) return null;
  }

  const url = item.url || item.permalink || item.hnLink || "";
  const snippet = snippetOf(item);
  const datePart = date ? ` [${date.split("T")[0]}]` : " [trending]";
  const text = [url, snippet].filter(Boolean).join(" | ");
  return {
    key: title.toLowerCase(),
    text: text
      ? `${title}${datePart} | ${text}`
      : `${title}${datePart}`,
  };
}

export function collectSourceItems(sweep, seen, sourceMap, freshSources, windowMs) {
  for (const s of sweep.sources || []) {
    if (s.status !== "ok") continue;
    const name = s.source;
    if (!sourceMap[name]) sourceMap[name] = [];

    const items = s.data?.items || [];
    const models = s.data?.models?.items || [];

    for (const item of [...items, ...models]) {
      const entry = formatItem(item, name, freshSources, windowMs);
      if (!entry || seen.has(entry.key)) continue;
      seen.add(entry.key);
      sourceMap[name].push(entry.text);
    }
  }
}
