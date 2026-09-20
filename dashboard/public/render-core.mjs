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
 * One card per ok source that has items, in sweep order: source name, item
 * count and the first normalized item's headline/url/time. Filter-independent
 * — callers pass the raw sweep list. Never throws.
 */
export function previewSources(sources, limit = 4) {
  const out = [];
  for (const src of sources || []) {
    if (src.status !== "ok") continue;
    const items = collectItems([src]);
    if (items.length === 0) continue;
    const first = items[0];
    out.push({
      source: src.source,
      category: src.data?.category ?? "news",
      count: items.length,
      title: first.title || first.name || first.id || "",
      url: first._url,
      time: first._time,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export const SLOW_FETCH_MS = 30 * 60 * 1000; // "slow" threshold for a card age

/**
 * Health/count stats for one source-bound card. Binds the panel to its sweep
 * sources — by `panel.sources` display names, else by `panel.category`
 * (missing category defaults to "news") — and reports the panel's true total
 * (never `panel.limit`), so the header can show `count · last-fetch age` while
 * the body caps its rows. Status is "error" if any bound source errored, else
 * "idle" when nothing is bound or the total is 0, else "slow" when the newest
 * item predates SLOW_FETCH_MS, else "ok". Never throws.
 */
export function sourceCardStats(panel, sources) {
  const list = sources || [];
  let bound;
  if (panel?.sources) {
    const wanted = new Set(panel.sources);
    bound = list.filter((src) => wanted.has(src.source));
  } else if (panel?.category) {
    bound = list.filter(
      (src) => (src.data?.category ?? "news") === panel.category,
    );
  } else {
    bound = [];
  }

  const itemCounts = {};
  let count = 0;
  let ok = 0;
  let lastFetch = null;
  let lastFetchMs = -Infinity;
  for (const src of bound) {
    const items = collectItems([src]);
    itemCounts[src.source] = items.length;
    count += items.length;
    if (src.status === "ok") ok += 1;
    for (const item of items) {
      const ms = item._time ? new Date(item._time).getTime() : NaN;
      if (!Number.isNaN(ms) && ms > lastFetchMs) {
        lastFetchMs = ms;
        lastFetch = item._time;
      }
    }
  }

  let status = "ok";
  if (bound.some((src) => src.status === "error")) status = "error";
  else if (count === 0 || bound.length === 0) status = "idle";
  else if (lastFetch && Date.now() - lastFetchMs >= SLOW_FETCH_MS) {
    status = "slow";
  }

  return {
    names: bound.map((src) => src.source),
    count,
    itemCounts,
    lastFetch,
    status,
    ok,
    total: bound.length,
  };
}

// Generic sort keys for the source-family grid. The status order is the visual
// health ranking the card dot uses (ok < slow < idle < error).
const SOURCE_CARD_SORTS = new Set(["freshest", "engagement", "name", "status"]);
const SORT_STATUS_RANK = { ok: 0, slow: 1, idle: 2, error: 3 };

/**
 * Bound normalized items for one panel, resolved the same way as
 * `sourceCardStats` (by `panel.sources` display names, else `panel.category`).
 * Used only for the engagement key; never throws.
 */
function boundItemsFor(panel, sources) {
  const names = new Set(sourceCardStats(panel, sources).names);
  return (sources || [])
    .filter((src) => names.has(src.source))
    .flatMap((src) => collectItems([src]));
}

/**
 * Sort the given source-family panels by a generic key, returning a NEW array
 * (the input order is never mutated). Binds each panel to its sweep sources via
 * `sourceCardStats` (by `panel.sources` display names, else `panel.category`).
 * Keys:
 *   freshest   -> newest bound item `_time` (desc; undated panels last)
 *   engagement -> Σ(`_score` + `_comments`) over bound items (desc)
 *   name       -> panel.title (localeCompare)
 *   status     -> sourceCardStats status rank ok < slow < idle < error
 * Unknown `sort` falls back to "freshest"; empty panels or absent sources
 * return []. Never throws.
 */
export function sortSourceCards(panels, sources, sort) {
  const list = Array.isArray(panels) ? panels.slice() : [];
  if (list.length === 0 || !Array.isArray(sources)) return [];
  const mode = SOURCE_CARD_SORTS.has(sort) ? sort : "freshest";

  if (mode === "name") {
    return list.sort((a, b) =>
      String(a?.title ?? "").localeCompare(String(b?.title ?? "")),
    );
  }

  if (mode === "status") {
    const rank = new Map(
      list.map((panel) => [
        panel,
        SORT_STATUS_RANK[sourceCardStats(panel, sources).status] ?? 3,
      ]),
    );
    return list.sort((a, b) => rank.get(a) - rank.get(b));
  }

  if (mode === "engagement") {
    const score = new Map(
      list.map((panel) => [
        panel,
        boundItemsFor(panel, sources).reduce(
          (sum, item) =>
            sum + (Number(item._score) || 0) + (Number(item._comments) || 0),
          0,
        ),
      ]),
    );
    return list.sort((a, b) => score.get(b) - score.get(a));
  }

  // freshest (default): newest bound item `_time` desc, undated last.
  const time = new Map(
    list.map((panel) => {
      const iso = sourceCardStats(panel, sources).lastFetch;
      const ms = iso ? new Date(iso).getTime() : NaN;
      return [panel, Number.isNaN(ms) ? -Infinity : ms];
    }),
  );
  return list.sort((a, b) => time.get(b) - time.get(a));
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
 * Compact age for the metrics strip's freshness item: `16m` / `1h` / `2d`,
 * flooring partial units. A missing, negative or non-finite age yields "—" so
 * the strip never renders a fabricated number. Pure, never throws.
 */
export function compactAge(ms) {
  if (ms == null) return "—";
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "—";
  const mins = Math.floor(n / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
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

/**
 * Per-source item counts for a stat's categories — the data behind a stat's
 * optional sparkline. Ok sources only, busiest first (name as tie-break so the
 * order is stable), capped at `limit`.
 * @returns {{source: string, count: number}[]}
 */
export function sourceCountsFor(stat, sources, limit = 6) {
  const cats = new Set(stat?.categories ?? []);
  const out = [];
  for (const s of sources ?? []) {
    if (s.status !== "ok") continue;
    const cat = s.data?.category ?? "news";
    if (!cats.has(cat)) continue;
    const n = (s.data?.items ?? []).length;
    if (n > 0) out.push({ source: s.source, count: n });
  }
  return out
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))
    .slice(0, limit);
}

/**
 * Freshness of a sweep: the age of its newest dated item. `text` is the compact
 * age (`16m` / `3h`), `label` the design's three-state word. No dated items →
 * an unknown reading rather than a misleading "very fresh".
 * @returns {{minutes: number|null, text: string, label: string}}
 */
export function freshness(sources, now = Date.now()) {
  let newest = 0;
  for (const item of collectItems(sources)) {
    const t = new Date(item._time || 0).getTime();
    if (t > newest) newest = t;
  }
  if (!newest) return { minutes: null, text: "—", label: "unknown" };
  const minutes = Math.max(0, Math.round((now - newest) / 60000));
  const label =
    minutes < 60 ? "very fresh" : minutes < 360 ? "recent" : "aging";
  const text = minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
  return { minutes, text, label };
}

/** Source color from the pack palette; neutral slate fallback. */
export function sourceColorFor(colors, name) {
  return colors?.[name] ?? "#94a3b8";
}

/**
 * Resolve a view by id: the matching view, else the view marked `default`,
 * else the first view, else null. Pure — inputs are never mutated.
 */
export function viewFor(views, id) {
  const list = views ?? [];
  return (
    list.find((view) => view.id === id) ??
    list.find((view) => view.default === true) ??
    list[0] ??
    null
  );
}

/**
 * Panels belonging to `viewId`, always in `panels[]` order with unknown ids
 * ignored. The client copy adds `{fallback}` for the no-LLM path: when truthy
 * it selects `view.fallbackPanels` ids; otherwise a view selects by explicit
 * `panels` ids or `sections` membership, and a view with neither contains
 * every panel. Unknown/unresolvable view returns []; never throws.
 */
export function viewPanels(views, panels, viewId, options = {}) {
  const view = viewFor(views, viewId);
  if (!view) return [];
  const list = panels ?? [];
  if (options.fallback) {
    const ids = view.fallbackPanels;
    if (!Array.isArray(ids)) return [];
    return list.filter((panel) => ids.includes(panel.id));
  }
  const byPanels = Array.isArray(view.panels);
  const bySections = Array.isArray(view.sections);
  if (!byPanels && !bySections) return list;
  return list.filter(
    (panel) =>
      (byPanels && view.panels.includes(panel.id)) ||
      (bySections && view.sections.includes(panel.section)),
  );
}

/**
 * Rail card model for the daily edition summary plus the weekly digest's
 * presence. Returns `{daily, weekly}` with each side `null` when its source
 * payload is absent, so the card can always render an honest empty state.
 * Never throws.
 */
export function editionCardModel(digest, edition) {
  const daily =
    edition && edition.editionId
      ? {
          id: edition.editionId,
          generatedAt: edition.generatedAt ?? "",
          href: `/newsletter/${edition.editionId}`,
        }
      : null;
  const weekly =
    digest && digest.weekId
      ? { weekId: digest.weekId, generatedAt: digest.generatedAt ?? "" }
      : null;
  return { daily, weekly };
}

/**
 * Daily-reader model for one edition payload (`GET /api/newsletter`). Returns
 * `{present,id,date,lede,stories,signals}`; a missing edition yields the empty
 * model (`present:false`) so the reader can show an honest empty state. Every
 * top story is normalized to `{title,body,category,impact,url}` strings. Never
 * throws.
 */
export function editionReaderModel(edition) {
  if (!edition || !edition.editionId) {
    return {
      present: false,
      id: "",
      date: "",
      lede: "",
      stories: [],
      signals: 0,
    };
  }
  const stories = Array.isArray(edition.topStories) ? edition.topStories : [];
  return {
    present: true,
    id: edition.editionId,
    date: edition.dateOf ?? edition.editionId,
    lede: edition.tldr ?? "",
    stories: stories.map((s) => ({
      title: s?.title ?? "",
      body: s?.body ?? "",
      category: s?.category ?? "",
      impact: s?.impact ?? "",
      url: s?.url ?? "",
    })),
    signals: editionSignalCount(edition),
  };
}

/**
 * Reference count of the condensed items in an edition: top stories + model
 * releases + the single paper pick + community buzz + quick links. A structural
 * count, not a date or engagement metric. Never throws.
 */
export function editionSignalCount(edition) {
  if (!edition || typeof edition !== "object") return 0;
  // The prompt emits `paperPick: {}` (later sanitized to empty strings) when no
  // paper is worth highlighting — that is *not* a condensed item. Count only a
  // pick that actually names a paper or carries an insight.
  const pp = edition.paperPick;
  const paperPick =
    pp && typeof pp === "object" && (pp.title || pp.insight) ? 1 : 0;
  return (
    (edition.topStories?.length ?? 0) +
    (edition.modelReleases?.length ?? 0) +
    paperPick +
    (edition.communityBuzz?.length ?? 0) +
    (edition.quickLinks?.length ?? 0)
  );
}

/**
 * Reference count of the condensed items in a weekly digest: highlights +
 * model updates + paper picks + community buzz. A structural count, not a date
 * or engagement metric. Never throws.
 */
export function digestSignalCount(digest) {
  if (!digest || typeof digest !== "object") return 0;
  return (
    (digest.highlights?.length ?? 0) +
    (digest.modelUpdates?.length ?? 0) +
    (digest.paperPicks?.length ?? 0) +
    (digest.communityBuzz?.length ?? 0)
  );
}

/**
 * Live source-health model for the health tile and the header pill. `sources`
 * is the sweep payload (`[{source,status,…}]`, pack order); `progress` is the
 * SSE snapshot (`{phase,steps[],totals}`). Returns:
 *   rows  [{name,status}] one per source, pack order
 *   cells [{status}]      one per source, "running" while a sweep is in flight
 *   ok    progress.totals.sourcesOk, else the sweep's ok count
 *   total sources.length, else progress.totals.sourcesTotal, else 0
 * During a `sources`-phase sweep a cell reflects its matching progress step
 * (`kind:"source"`, `label === name`), staying "running" until that step is
 * terminal; otherwise it reflects the sweep source status. No literal count.
 * Never throws on undefined.
 */
export function sourceHealthSummary(sources, progress) {
  const list = Array.isArray(sources) ? sources : [];
  const steps = Array.isArray(progress?.steps) ? progress.steps : [];
  const sourceSteps = steps.filter((step) => step && step.kind === "source");
  const stepByLabel = new Map(sourceSteps.map((step) => [step.label, step]));

  const sweeping = Boolean(progress && progress.phase === "sources");

  // Names in sweep order. Before the first sweep payload arrives the in-flight
  // progress steps are the only source list available.
  const names = list.length
    ? list.map((src) => src?.source ?? "")
    : sourceSteps.map((step) => step.label ?? "");

  const statusFor = (name, sweepSource) => {
    if (sweeping) {
      const step = stepByLabel.get(name);
      const terminal = step && (step.state === "ok" || step.state === "error");
      return terminal ? step.state : "running";
    }
    if (sweepSource?.status === "error") return "error";
    if (sweepSource?.status === "ok") return "ok";
    return "idle";
  };

  const rows = names.map((name, i) => ({
    name,
    status: statusFor(name, list[i]),
  }));
  const cells = names.map((name, i) => ({ status: statusFor(name, list[i]) }));

  const sweepOk = list.filter((src) => src?.status === "ok").length;
  const ok = progress?.totals?.sourcesOk ?? sweepOk;
  const total = sources?.length ?? progress?.totals?.sourcesTotal ?? 0;

  return { ok, total, rows, cells, sweeping };
}

/**
 * Seconds until the next sweep, for the tile's `next sweep {n}s` countdown.
 * Pure and deterministic: `now` is injected so the arithmetic is unit-testable.
 * Returns a non-negative integer, and 0 when the sweep anchor or cooldown is
 * unknown — an unknown countdown must not invent a number. Never throws.
 */
export function nextSweepSeconds(lastSweepAt, cooldownMs, now = Date.now()) {
  const anchor = lastSweepAt ? new Date(lastSweepAt).getTime() : NaN;
  const cooldown = Number(cooldownMs);
  if (!Number.isFinite(anchor) || !Number.isFinite(cooldown) || cooldown <= 0) {
    return 0;
  }
  return Math.max(0, Math.round((anchor + cooldown - now) / 1000));
}

/**
 * Count raw arrivals for a panel's delta badge: by `sources` binding, else by
 * `category`, else aggregate (everything except `excludeCategories`). Not
 * clamped to `panel.limit` — the body re-renders on click. Never throws.
 *
 * `delta.newItems` is built by the delta engine as `{ source, category, ... }`
 * (lib/delta/engine.mjs), NOT the `_source`/`_category` shape that
 * `normalizeItem` gives sweep items. Accept both so the badge binds correctly to
 * the payload actually broadcast over SSE.
 */
export function panelDeltaCount(panel, newItems) {
  const items = newItems ?? [];
  const sourceOf = (item) => item._source ?? item.source;
  const categoryOf = (item) => item._category ?? item.category;
  if (panel.sources) {
    const wanted = new Set(panel.sources);
    return items.filter((item) => wanted.has(sourceOf(item))).length;
  }
  if (panel.category) {
    return items.filter((item) => categoryOf(item) === panel.category).length;
  }
  const excluded = new Set(panel.excludeCategories ?? []);
  return items.filter((item) => !excluded.has(categoryOf(item))).length;
}

/**
 * ISO week number from a `YYYY-Www` weekId string: "2026-W16" → 16. Numeric
 * only — item text is never interpolated. Malformed, missing or non-string
 * input yields 0. Never throws.
 */
export function weekNumberOf(weekId) {
  if (typeof weekId !== "string") return 0;
  const match = /^\d{4}-W(\d{1,2})$/.exec(weekId);
  if (!match) return 0;
  const n = Number(match[1]);
  return Number.isInteger(n) ? n : 0;
}

/**
 * Archive-card rows built from already-public metadata, never a new data path.
 * `editionIds` is the stored-day id list (newest-first, order preserved); the
 * `digest` supplies the latest weekly weekId; `latestEdition` is the only daily
 * payload fetched, so only its signal count is known.
 *
 * A weekly row leads when `digest?.weekId` is set: `{kind:"weekly", id,
 * weekNumber, signals, href:null}`. Each daily id then yields `{kind:"daily",
 * id, date:id, signals, href:"/newsletter/:id"}`, where `signals` is that
 * count for the latest id and `null` for older ones — an unknown count is never
 * fabricated. Absent inputs yield []; malformed ids pass through as data.
 * Never throws.
 */
export function archiveRows(editionIds, digest, latestEdition) {
  const rows = [];
  if (digest?.weekId) {
    rows.push({
      kind: "weekly",
      id: digest.weekId,
      weekNumber: weekNumberOf(digest.weekId),
      signals: digestSignalCount(digest),
      href: null,
    });
  }
  const ids = Array.isArray(editionIds) ? editionIds : [];
  const latestId = latestEdition?.editionId;
  for (const id of ids) {
    rows.push({
      kind: "daily",
      id,
      date: id,
      signals: id === latestId ? editionSignalCount(latestEdition) : null,
      href: `/newsletter/${id}`,
    });
  }
  return rows;
}

/**
 * Right-hand metadata for a design-3a top-story row: `{source, age, score}`.
 * The LLM returns no provenance, so it is recovered by matching the story's
 * `url` against the sweep's normalized items — the only trustworthy join,
 * since headlines are rewritten by the model.
 *
 * `age` is a compact string (`18h`) relative to `now`; `score` is the item's
 * engagement number, or 0 when it carries none. An unmatched or url-less story
 * yields `null` so the caller renders nothing rather than a fabricated source.
 * Pure, never throws.
 */
export function storyMeta(story, items, now = Date.now()) {
  const url = story?.url;
  if (!url || typeof url !== "string") return null;
  // `_url` prefers a discussion permalink where a source supplies one, but the
  // model cites the article it read, so the original `url` is the second key.
  const list = Array.isArray(items) ? items : [];
  const match =
    list.find((i) => i?._url === url) ?? list.find((i) => i?.url === url);
  if (!match) return null;
  const ts = match._time ? Date.parse(match._time) : NaN;
  return {
    source: match._source || "",
    age: Number.isFinite(ts) ? compactAge(now - ts) : "",
    score: Number(match._score) || 0,
  };
}

/**
 * `{healthy, slow, idle}` across a sweep's sources, for design 3b's filter-bar
 * summary. A sweep source reports only `status`, with no fetch timing, so the
 * classification mirrors the health tile's own dot mapping rather than
 * inventing latency: a failed source is `slow` (the tile's amber state), a
 * source that returned nothing is `idle`, and everything else is `healthy`.
 * Item age is deliberately NOT used — a feed whose newest post is hours old is
 * not a slow source. Pure, never throws.
 */
export function healthTally(sources) {
  const tally = { healthy: 0, slow: 0, idle: 0 };
  for (const src of Array.isArray(sources) ? sources : []) {
    if (!src || src.status === "error") {
      tally.slow += 1;
    } else if (src.status !== "ok" || collectItems([src]).length === 0) {
      tally.idle += 1;
    } else {
      tally.healthy += 1;
    }
  }
  return tally;
}

/**
 * The id of the panel that shows a given source, for the today preview's
 * jump-to-source click. Resolved through the same binding the source cards
 * use — `panel.sources` display names, else `panel.category` — so the mapping
 * can never drift from what the source grid actually renders.
 *
 * `views`/`viewId` scope the search to the destination view, so a source that
 * two panels could claim resolves to the one the reader will land on. Returns
 * null when nothing binds it, and the caller then just switches view. Pure,
 * never throws.
 */
export function panelIdForSource(views, panels, viewId, sources, sourceName) {
  if (!sourceName) return null;
  const candidates = viewPanels(views, panels, viewId);
  const list = Array.isArray(sources) ? sources : [];
  for (const panel of candidates) {
    if (!panel) continue;
    const { names } = sourceCardStats(panel, list);
    if (names.includes(sourceName)) return panel.id;
  }
  return null;
}

/**
 * Ranked headlines to continue the briefing's story list, so the column is
 * full of news on a day the model returns few picks. Reuses the aggregate
 * ranking (`panel.sort`, `panel.excludeCategories`), then takes one item per
 * source in turn so no single busy feed fills the list. Drops anything the
 * stories already show, matching on both the canonical `_url` and the item's
 * original `url` — the same pair storyMeta joins on.
 *
 * Returns at most `limit` items and never the ones already on screen, so the
 * reader is never shown the same headline twice. Pure, never throws.
 */
export function moreHeadlines(panel, byCategory, usedUrls, limit = 0) {
  if (!limit || limit < 1) return [];
  const used = new Set(
    (Array.isArray(usedUrls) ? usedUrls : []).filter(Boolean),
  );

  // Rank first, then take one per source in turn. Straight ranking let a
  // single busy feed supply most of the list; round-robin keeps the spread
  // honest to "12 sources" while each source still offers its best item first.
  // The panel's own `limit` caps the story list, not the pool this draws from:
  // passing it through would hand the round-robin ten items to spread.
  const { limit: _ignored, sort, excludeCategories } = panel ?? {};
  const pool = aggregateItems(
    { sort, excludeCategories },
    byCategory ?? {},
  );

  const bySource = new Map();
  for (const item of pool) {
    if (used.has(item?._url) || used.has(item?.url)) continue;
    const key = item?._source ?? "";
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(item);
  }

  const queues = [...bySource.values()];
  const out = [];
  let drained = false;
  while (out.length < limit && !drained) {
    drained = true;
    for (const queue of queues) {
      if (!queue.length) continue;
      out.push(queue.shift());
      drained = false;
      if (out.length >= limit) break;
    }
  }
  return out;
}
