// domains/example.mjs — starter pack for pulse-template.
// Copy this file, rename the id, swap the sources/prompts/panels — that is
// the whole "build a new intelligence dashboard" flow.
// Source modules live in apis/sources/ and are config-driven; the generic
// RSS module (techcrunch.mjs) can serve any feed via config.feedUrl.
//
// This pack mirrors the shipped 3-view redesign (today / streams / editions)
// with generic technology sources, so it doubles as a demo of every engine
// capability: LLM briefing + radar + signals, the uniform streams grid with
// filter chips, source-health, metrics strip, ticker, and the daily-edition
// reader / weekly digest / archive.

const ANALYSIS_PROMPT = `You are a technology intelligence analyst. Given raw data from multiple sources about developer tools, open-source releases, and community signals, produce a concise intelligence briefing.

Your output MUST be valid JSON with this structure:
{
  "summary": "ONE short sentence, 20 words maximum, naming the single biggest development right now. No preamble, no list of themes.",
  "topStories": [
    {
      "headline": "Short headline",
      "significance": "Why this matters (1 sentence)",
      "category": "one of: release, acquisition, funding, research, product, regulation, rumor",
      "impact": "high|medium|low",
      "url": "URL of the source article if available, or empty string"
    }
  ],
  "trends": ["Trend 1", "Trend 2", "Trend 3"],
  "modelRadar": [
    {
      "name": "Project or product name",
      "org": "Organization",
      "status": "released|announced|in-development",
      "note": "Brief note",
      "url": "URL if available, or empty string"
    }
  ],
  "signals": [
    {
      "signal": "Brief description of a notable signal",
      "source": "Where this came from",
      "confidence": "high|medium|low",
      "url": "URL if available, or empty string"
    }
  ]
}

The summary is a deck above a headline list, not a briefing: one sentence, hard stop.

IMPORTANT: For topStories and signals, include the url field with the actual URL from the source data when available. Match headlines to the provided titles and use their URLs.`;

const DIGEST_PROMPT = `You are a technology intelligence analyst producing a weekly digest for a team of engineers. This digest is used every Friday for team briefings.

CRITICAL RULES:
- ONLY use information from the source data provided below. Do NOT add anything from your training data.
- Every item you mention MUST come directly from the provided source list.
- Every item in the source data is either dated within the last 7 days (shown as [YYYY-MM-DD]) or is from a live trending feed (shown as [trending]). Items outside the 7-day window have already been filtered out — you do not need to filter further.
- Trending items ([trending]) may be included but clearly represent *current popularity*, not a specific publication date.
- If there isn't enough data for a section, include fewer items. Never pad with old or made-up content.

Your output MUST be valid JSON with this structure:
{
  "weekOf": "March 17–21, 2026",
  "tldr": "3-4 sentence executive summary of the week",
  "highlights": [
    {
      "title": "Clear headline for this highlight",
      "body": "2-3 sentences explaining the development and why it matters",
      "category": "release|research|product|funding|regulation|open-source|infrastructure",
      "impact": "high|medium|low",
      "url": "source URL if available, or empty string"
    }
  ],
  "modelUpdates": [
    {
      "name": "Project or product name",
      "org": "Organization",
      "summary": "One sentence about what happened",
      "url": "URL if available, or empty string"
    }
  ],
  "paperPicks": [
    {
      "title": "Title",
      "authors": "Author et al.",
      "insight": "One sentence on the key finding",
      "url": "URL if available, or empty string"
    }
  ],
  "communityBuzz": [
    "Short bullet about what the community is talking about"
  ],
  "lookAhead": "1-2 sentences about what to watch for next week based on the trends in the data"
}

Guidelines:
- Limit highlights to 5-7 most important items, modelUpdates to 3-5, paperPicks to 3-4, communityBuzz to 4-6
- Be concrete and specific; include URLs when available from the provided data`;

const DAILY_EDITION_PROMPT = `You are a technology intelligence analyst producing a daily briefing in a TL;DR-newsletter style for a team of engineers. It is sent every morning and must be readable in under two minutes.

CRITICAL RULES:
- ONLY use information from the source data provided below. Do NOT add anything from your training data.
- Every item you mention MUST come directly from the provided source list.
- Every item in the source data is either dated within the last 24 hours (shown as [YYYY-MM-DD]) or is from a live trending feed (shown as [trending]). Items outside the 24-hour window have already been filtered out — you do not need to filter further.
- Each source line is formatted "Title [date] | url | summary excerpt" — the excerpt is a short description from the source. Use it for substance; it is not always present.
- Trending items ([trending]) may be included but clearly represent *current popularity*, not a specific publication date.
- If there isn't enough data for a section, include fewer items. Never pad, never invent specifics that are not in the data.

Your output MUST be valid JSON with this structure:
{
  "dateOf": "September 10, 2026",
  "tldr": "2-3 sentence summary opening the briefing",
  "topStories": [
    {
      "title": "Clear headline",
      "body": "2-3 sentences with the concrete specifics from the data (numbers, names, dates, orgs, technical details). Never merely restate the headline.",
      "category": "release|research|product|funding|regulation|open-source|infrastructure",
      "impact": "high|medium|low",
      "url": "source URL if available, or empty string"
    }
  ],
  "modelReleases": [
    {
      "name": "Project or product name",
      "org": "Organization",
      "summary": "One sentence about what happened",
      "url": "URL if available, or empty string"
    }
  ],
  "paperPick": {
    "title": "Paper title",
    "authors": "First author et al., or an empty string if the data does not name authors — never invent one",
    "insight": "One sentence on the key finding or contribution",
    "url": "URL if available, or empty string"
  },
  "quickLinks": [
    {
      "text": "One-liner worth knowing, from the data",
      "url": "source URL from the data"
    }
  ]
}

Guidelines:
- topStories MUST contain at least 8 items, up to 10, ordered by importance. Only drop below 8 if the source data genuinely lacks that many distinct stories
- topStories bodies must earn their place: if the source line carries only a headline, keep the body to one plain sentence rather than inflating it
- Limit modelReleases to 0-3 entries; use [] when nothing launched in the last 24 hours
- paperPick: exactly one notable paper from the data, or an empty object {} if none is worth highlighting
- Limit quickLinks to 4-6 one-liners drawn from items NOT already used in topStories or modelReleases; each MUST carry its source URL
- Be concrete and specific, not vague
- Include URLs when available from the provided data`;

export default {
  id: "example",
  name: "Pulse",
  tagline:
    "intelligence dashboard template — swap this pack for your own domain.",

  // Header credit link (pack-owned branding): { text, url } or omit entirely.
  credit: { text: "by dendievel.me", url: "https://dendievel.me" },

  sources: [
    { name: "GitHub Trending", module: "github-trending",
      config: { query: "topic:javascript OR topic:typescript", dateField: "created" } },
    { name: "Hacker News", module: "hackernews",
      config: { keywords: "\\b(open source|open-source|developer|framework|library)\\b" } },
    { name: "Tech News", module: "techcrunch",
      config: { feedUrl: "https://techcrunch.com/feed/" } },
    { name: "Google News", module: "google-news",
      config: { queries: ["open+source+release", "developer+tools"] } },
  ],

  // The engine is prompt-agnostic: your pack owns the analyst voice, but the
  // JSON schema below must stay identical — the briefing/radar/digest/daily
  // renderers depend on these exact field names.
  prompts: {
    analysis: ANALYSIS_PROMPT,
    digest: DIGEST_PROMPT,
    daily: DAILY_EDITION_PROMPT,
  },

  // Sources whose items carry no per-item date but are inherently fresh.
  freshSources: ["Hacker News", "GitHub Trending"],

  // Panels in DOM order. icon = #ic-<icon> sprite suffix; section = view group.
  // `column` ("main" | "rail") places a panel in the active view's rail layout.
  panels: [
    { id: "analysis", title: "briefing", icon: "brain", section: "briefing", variant: "briefing", chrome: "bare", selfLabeled: true, limit: 10,
      more: 8, moreLabel: "more headlines", sort: "date", excludeCategories: ["code", "models"] },
    { id: "radar", title: "radar", icon: "radar", section: "briefing", variant: "radar", column: "rail", limit: 5 },
    { id: "signals", title: "signals", icon: "radar", section: "briefing", variant: "signals", column: "rail", limit: 3 },
    // Cross-source rollups surface only through today's no-LLM fallback.
    { id: "trending", title: "trending", icon: "flame", section: "aggregate", variant: "aggregate", sort: "engagement", limit: 20, excludeCategories: ["code", "models"] },
    { id: "newest", title: "newest", icon: "sparkles", section: "aggregate", variant: "aggregate", sort: "date", limit: 20, excludeCategories: ["code", "models"] },
    // Source-bound cards keep the streams grid honest: one per feed.
    { id: "technews", title: "tech news", icon: "articles", section: "news",
      variant: "news", sources: ["Tech News"], limit: 15 },
    { id: "googlenews", title: "google news", icon: "articles", section: "news",
      variant: "news", sources: ["Google News"], limit: 15 },
    { id: "repos", title: "GitHub Trending", icon: "code", section: "code",
      variant: "cards", category: "code", limit: 12 },
    { id: "hackernews", title: "Hacker News", icon: "hexagon", section: "community",
      variant: "news", sources: ["Hacker News"], limit: 15 },
    { id: "streams-preview", title: "streams", icon: "articles", section: "briefing",
      variant: "sources-preview", limit: 12, target: "streams", chrome: "bare",
      actionLabel: "open streams →" },
    { id: "editions-card", title: "editions", icon: "list", section: "briefing",
      variant: "edition-card", column: "rail", target: "editions", weeklyRun: "sun 18:00",
      actionLabel: "read", tone: "green", linkLabel: "archive →",
      dailyTitle: "Daily edition", weeklyTitle: "Weekly digest" },
    { id: "editions-reader", title: "daily edition", icon: "list", column: "main",
      variant: "edition", chrome: "bare" },
    { id: "digest", title: "weekly digest", icon: "list", section: "digest",
      variant: "digest", column: "rail", weeklyRun: "sun 18:00" },
    { id: "archive", title: "archive", icon: "list", column: "rail", variant: "archive" },
    { id: "source-health", title: "source health", icon: "radar", variant: "source-health" },
  ],

  // Metrics strip (the freshness ring is built-in engine chrome, not pack data).
  stats: [
    { key: "articles", label: "Articles", icon: "articles", categories: ["news", "community", "products"], chart: true },
    { key: "repos", label: "Repos", icon: "repos", categories: ["code"], sub: { type: "sum", field: "stars", prefix: "★ ", suffix: " total" } },
  ],

  // Views replace the legacy nav[] — three pack-declared destinations. Layout
  // templates and membership logic are engine-generic. `today` degrades to
  // fallbackPanels when no LLM is configured; `streams` groups by section;
  // `editions` is the reader layout.
  views: [
    { id: "today", label: "today", default: true, layout: "main-rail",
      panels: ["analysis", "radar", "signals", "streams-preview", "editions-card"],
      fallbackPanels: ["trending", "newest", "streams-preview", "editions-card"],
      searchPlaceholder: "search {n} signals…",
      noBriefingNote: "briefing disabled — no LLM configured. set LLM_PROVIDER and LLM_API_KEY in .env for daily analyst briefings." },
    { id: "streams", label: "streams", layout: "grid",
      sections: ["news", "code", "community"],
      searchPlaceholder: "filter streams…",
      panels: ["source-health"] },
    { id: "editions", label: "editions", layout: "reader",
      searchPlaceholder: "search editions…",
      panels: ["editions-reader", "digest", "archive"] },
  ],

  colors: {
    "GitHub Trending": "#60a5fa",
    "Hacker News": "#fb923c",
    "Tech News": "#f472b6",
    "Google News": "#fbbf24",
  },
};
