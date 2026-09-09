// dashboard/public/render-core.mjs — Pure dashboard data layer (no DOM, no
// network): item normalization, category aggregation, panel item selection,
// aggregate sorting and stat computation. Loaded as an ES module by
// index.html's inline bootstrap (exposed as window.RenderCore for app.js)
// and imported directly by tests/render-core.test.mjs.

/**
 * Normalize a source item: pass through every original field and add the
 * engine-canonical `_`-prefixed fields renderers bind to.
 */
export function normalizeItem(item, src) {
  return {
    ...item,
    _source: src.source,
    _category: src.data?.category ?? "news",
    _url: item.hnLink || item.permalink || item.url || "",
    _score: item.score ?? item.stars ?? item.likes ?? 0,
    _comments: item.comments ?? item.descendants ?? 0,
    _time:
      item.published || item.created || item.time || item.lastModified || "",
  };
}

/**
 * Flatten a sweep's ok sources into normalized items — `data.items` and
 * `data.models.items` both flow through (models carry their source's
 * category, e.g. "models").
 */
export function collectItems(sources) {
  const out = [];
  for (const src of sources || []) {
    if (src.status !== "ok") continue;
    for (const item of src.data?.items ?? []) out.push(normalizeItem(item, src));
    for (const item of src.data?.models?.items ?? []) {
      out.push(normalizeItem(item, src));
    }
  }
  return out;
}

/** Group the normalized items of a sweep by category. */
export function aggregateByCategory(sources) {
  const byCategory = {};
  for (const item of collectItems(sources)) {
    (byCategory[item._category] ??= []).push(item);
  }
  return byCategory;
}

/**
 * Items for one panel: bound by source display names (pack sweep order
 * preserved) or by category, sliced to panel.limit.
 */
export function selectPanelItems(panel, sources, byCategory) {
  let items;
  if (panel.sources) {
    const wanted = new Set(panel.sources);
    const bySource = new Map();
    for (const src of sources || []) {
      if (src.status !== "ok" || !wanted.has(src.source)) continue;
      bySource.set(src.source, collectItems([src]));
    }
    items = panel.sources.flatMap((name) => bySource.get(name) ?? []);
  } else if (panel.category) {
    items = [...(byCategory[panel.category] ?? [])];
  } else {
    items = [];
  }
  return panel.limit ? items.slice(0, panel.limit) : items;
}

/**
 * Aggregate panel items: union of every category minus excludeCategories,
 * then engagement sort (score+comments desc, zero-engagement dropped) or
 * date sort (newest first, undated dropped), sliced to panel.limit.
 */
export function aggregateItems(panel, byCategory) {
  const excluded = new Set(panel.excludeCategories ?? []);
  const items = [];
  for (const [category, list] of Object.entries(byCategory)) {
    if (excluded.has(category)) continue;
    items.push(...list);
  }
  let sorted;
  if (panel.sort === "engagement") {
    // Per-source normalized ranking: each item competes against the best
    // engagement within its own source, so quiet sources don't drown below
    // one loud feed. Raw engagement ties normalize to 1.0 across sources.
    const engaged = items.filter(
      (i) => (i._score ?? 0) > 0 || (i._comments ?? 0) > 0,
    );
    const srcMax = new Map();
    for (const i of engaged) {
      const e = (i._score ?? 0) + (i._comments ?? 0);
      srcMax.set(i._source, Math.max(srcMax.get(i._source) ?? 0, e));
    }
    sorted = engaged
      .map((i) => ({
        item: i,
        norm:
          ((i._score ?? 0) + (i._comments ?? 0)) /
          (srcMax.get(i._source) || 1),
      }))
      .sort((a, b) => b.norm - a.norm)
      .map((x) => x.item);
  } else {
    // "date"
    sorted = items
      .filter((i) => i._time)
      .sort((a, b) => new Date(b._time) - new Date(a._time));
  }
  return panel.limit ? sorted.slice(0, panel.limit) : sorted;
}

export function formatNum(n) {
  if (!n) return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toString();
}

/**
 * Stat card value: count items across stat.categories, plus the optional
 * sub-line — "topValue" (mode of item[field]; array fields flattened with
 * the first 2 entries per item, reproducing the category histogram) or
 * "sum" (Σ item[field], compact-formatted). Empty stat → "—".
 */
export function statValue(stat, byCategory) {
  const items = (stat.categories ?? []).flatMap(
    (category) => byCategory[category] ?? [],
  );
  let sub = "—";
  if (stat.sub?.type === "topValue") {
    const counts = {};
    for (const item of items) {
      const value = item[stat.sub.field];
      const values = Array.isArray(value) ? value.slice(0, 2) : [value];
      for (const v of values) {
        const key = v ?? "other";
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top) sub = `${stat.sub.prefix ?? ""}${top[0]}${stat.sub.suffix ?? ""}`;
  } else if (stat.sub?.type === "sum") {
    const total = items.reduce(
      (acc, item) => acc + (Number(item[stat.sub.field]) || 0),
      0,
    );
    sub = `${stat.sub.prefix ?? ""}${formatNum(total)}${stat.sub.suffix ?? ""}`;
  }
  return { value: items.length, sub };
}

/** Source color from the pack palette; neutral slate fallback. */
export function sourceColorFor(colors, name) {
  return colors?.[name] ?? "#94a3b8";
}
