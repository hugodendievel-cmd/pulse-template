// domains/example.mjs — minimal starter pack for pulse-template.
// Copy this file, rename the id, swap the sources/prompts/panels — that is
// the whole "build a new intelligence dashboard" flow.
// Source modules live in apis/sources/ and are config-driven; the generic
// RSS module (techcrunch.mjs) can serve any feed via config.feedUrl.

export default {
  id: "example",
  name: "Pulse",
  tagline: "intelligence dashboard template — swap this pack for your own domain.",

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
  // JSON schema below must stay identical — the briefing/radar/digest
  // renderers depend on these exact field names.
  prompts: {
    analysis: `You are a technology intelligence analyst. Given raw data from multiple sources about developer tools, open-source releases, and community signals, produce a concise intelligence briefing.

Your output MUST be valid JSON with this structure:
{
  "summary": "2-3 sentence overview of the most important developments right now",
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

IMPORTANT: For topStories and signals, include the url field with the actual URL from the source data when available. Match headlines to the provided titles and use their URLs.`,
    digest: `You are a technology intelligence analyst producing a weekly digest for a team of engineers. This digest is used every Friday for team briefings.

CRITICAL RULES:
- ONLY use information from the source data provided below. Do NOT add anything from your training data.
- Every item you mention MUST come directly from the provided source list.
- Every item in the source data is either dated within the last 7 days (shown as [YYYY-MM-DD]) or is from a live trending feed (shown as [trending]).
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
  "lookAhead": "1-2 sentences about what to watch for next week"
}

Guidelines:
- Limit highlights to 5-7 most important items, modelUpdates to 3-5, paperPicks to 3-4, communityBuzz to 4-6
- Be concrete and specific; include URLs when available`,
  },

  freshSources: ["Hacker News", "GitHub Trending"],

  panels: [
    { id: "analysis", title: "Briefing", icon: "brain", section: "briefing", span: 8, variant: "briefing" },
    { id: "radar", title: "Radar", icon: "radar", section: "briefing", span: 4, variant: "radar" },
    { id: "trending", title: "Trending", icon: "flame", section: "news", span: 6, variant: "aggregate", sort: "engagement", limit: 20, excludeCategories: ["code", "models"] },
    { id: "newest", title: "Newest", icon: "sparkles", section: "news", span: 6, variant: "aggregate", sort: "date", limit: 20, excludeCategories: ["code", "models"] },
    { id: "repos", title: "GitHub Trending", icon: "code", section: "code", span: 6, variant: "cards", category: "code", limit: 12 },
    { id: "technews", title: "Tech News", icon: "pen", section: "news", span: 6, variant: "news", sources: ["Tech News"], limit: 15 },
    { id: "hackernews", title: "Hacker News", icon: "hexagon", section: "community", span: 4, variant: "news", sources: ["Hacker News"], limit: 15 },
    { id: "digest", title: "Weekly Digest", icon: "list", section: "digest", span: 12, variant: "digest" },
  ],

  stats: [
    { key: "articles", label: "Articles", icon: "articles", categories: ["news", "community", "products"], chart: true },
    { key: "repos", label: "Repos", icon: "repos", categories: ["code"], sub: { type: "sum", field: "stars", prefix: "★ ", suffix: " total" } },
  ],

  nav: [
    { filter: "all", label: "All" },
    { filter: "briefing", label: "Briefing" },
    { filter: "news", label: "News" },
    { filter: "code", label: "Code" },
    { filter: "community", label: "Community" },
    { filter: "digest", label: "Digest" },
  ],

  colors: {
    "GitHub Trending": "#60a5fa",
    "Hacker News": "#fb923c",
    "Tech News": "#f472b6",
    "Google News": "#fbbf24",
  },
};
