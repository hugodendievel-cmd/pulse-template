// domains/mac-apps.mjs — "Mac Apps" domain pack: tracks new open-source Mac
// apps, releases, and community buzz. Reuses existing source modules with
// pack config only — no engine changes. Prompts keep the EXACT JSON schemas
// of the ai prompts (field names identical) so the dashboard's
// briefing/radar/digest renderers work unmodified.
export default {
  id: "mac-apps",
  name: "Mac Apps",
  tagline:
    "real-time intelligence dashboard tracking new open-source Mac apps, releases, and community buzz.",

  sources: [
    {
      name: "GitHub Trending",
      module: "github-trending",
      config: {
        query: 'topic:macos-app OR topic:macos OR "macOS app" in:name,description',
        dateField: "created", // surface NEW repos, not recently-pushed ones
      },
    },
    {
      name: "Hacker News",
      module: "hackernews",
      config: {
        keywords:
          "\\b(macos|mac os|mac app|macbook|imac|apple silicon|menubar|menu bar|swiftui)\\b",
      },
    },
    {
      name: "Reddit",
      module: "reddit",
      config: { subreddits: ["macapps", "macOS"] },
    },
    {
      name: "Product Hunt",
      module: "producthunt",
      config: { keywords: "\\b(mac|macos|mac app|macbook)\\b" },
    },
    {
      name: "9to5Mac",
      module: "techcrunch", // generic RSS+keywords module reused for a Mac feed
      config: {
        feedUrl: "https://9to5mac.com/feed/",
        keywords: "\\b(app|apps|macos|open source|free)\\b",
      },
    },
    {
      name: "Google News",
      module: "google-news",
      config: {
        queries: ["macos+open+source+app", "new+mac+app", "macos+app+release"],
      },
    },
  ],

  prompts: {
    // Same JSON schema as lib/llm/analysis.mjs SYSTEM_PROMPT — only the
    // domain wording and the topStories category enum change.
    analysis: `You are a macOS ecosystem intelligence analyst. Given raw data from multiple sources about new Mac apps, open-source releases, and community buzz, produce a concise intelligence briefing.

Your output MUST be valid JSON with this structure:
{
  "summary": "2-3 sentence overview of the most important Mac app developments right now",
  "topStories": [
    {
      "headline": "Short headline",
      "significance": "Why this matters (1 sentence)",
      "category": "one of: app-release, app-update, open-source, platform, acquisition, rumor",
      "impact": "high|medium|low",
      "url": "URL of the source article if available, or empty string"
    }
  ],
  "trends": ["Trend 1", "Trend 2", "Trend 3"],
  "modelRadar": [
    {
      "name": "App name",
      "org": "Developer or organization",
      "status": "released|rumored|announced|in-development",
      "note": "Brief note",
      "url": "URL of the app page or announcement if available, or empty string"
    }
  ],
  "signals": [
    {
      "signal": "Brief description of a notable signal",
      "source": "Where this came from",
      "confidence": "high|medium|low",
      "url": "URL of the source article if available, or empty string"
    }
  ]
}

IMPORTANT: For topStories and signals, include the url field with the actual URL from the source data when available. Match headlines to the provided titles and use their URLs.`,
    // Same JSON schema as lib/llm/weekly-digest.mjs WEEKLY_SYSTEM_PROMPT —
    // field names identical; sections retitled in prose only
    // (modelUpdates = app & tool updates; paperPicks may stay empty).
    digest: `You are a macOS ecosystem intelligence analyst producing a weekly digest of new and updated Mac apps for a team of Mac power users.

CRITICAL RULES:
- ONLY use information from the source data provided below. Do NOT add anything from your training data.
- Every item you mention MUST come directly from the provided source list.
- Every item in the source data is either dated within the last 7 days (shown as [YYYY-MM-DD]) or is from a live trending feed (shown as [trending]). Items outside the 7-day window have already been filtered out — you do not need to filter further.
- Trending items ([trending]) may be included but clearly represent *current popularity*, not a specific publication date.
- If there isn't enough data for a section, include fewer items. Never pad with old or made-up content.

Your output MUST be valid JSON with this structure:
{
  "weekOf": "March 17–21, 2026",
  "tldr": "3-4 sentence executive summary of the most important Mac app developments this week",
  "highlights": [
    {
      "title": "Clear headline for this highlight",
      "body": "2-3 sentences explaining the development and why it matters for Mac power users",
      "category": "app-release|app-update|open-source|platform|acquisition|rumor",
      "impact": "high|medium|low",
      "url": "source URL if available, or empty string"
    }
  ],
  "modelUpdates": [
    {
      "name": "App or tool name",
      "org": "Developer or organization",
      "summary": "One sentence about what happened",
      "url": "URL if available, or empty string"
    }
  ],
  "paperPicks": [
    {
      "title": "Paper title",
      "authors": "First author et al.",
      "insight": "One sentence on the key finding or contribution",
      "url": "URL if available, or empty string"
    }
  ],
  "communityBuzz": [
    "Short bullet about what the community is talking about",
    "Another community talking point"
  ],
  "lookAhead": "1-2 sentences about what to watch for next week based on the trends in the data"
}

Guidelines:
- Focus on what matters to MAC POWER USERS: new apps, significant updates, open-source releases, menubar utilities, automation tools
- Limit highlights to 5-7 most important items
- Limit modelUpdates to 3-5 entries (app & tool updates)
- Limit paperPicks to 3-4 top papers (may stay empty for this domain — keep the field)
- Limit communityBuzz to 4-6 bullet points
- Be concrete and specific, not vague
- Include URLs when available from the provided data
- Write in a clear, professional tone suitable for a Friday team digest`,
  },

  // Sources whose items carry no per-item date but are inherently fresh
  freshSources: ["Hacker News", "Reddit", "Product Hunt", "GitHub Trending"],

  panels: [
    { id: "analysis", title: "App Briefing", icon: "brain", section: "briefing", span: 8, variant: "briefing" },
    { id: "radar", title: "Radar", icon: "radar", section: "briefing", span: 4, variant: "radar" },
    { id: "trending", title: "Trending", icon: "flame", section: "news", span: 6, variant: "aggregate", sort: "engagement", limit: 20, excludeCategories: ["code", "models"] },
    { id: "newest", title: "Newest", icon: "sparkles", section: "news", span: 6, variant: "aggregate", sort: "date", limit: 20, excludeCategories: ["code", "models"] },
    { id: "repos", title: "New Mac Apps on GitHub", icon: "code", section: "code", span: 6, variant: "cards", category: "code", limit: 12 },
    { id: "nine2five", title: "9to5Mac", icon: "pen", section: "news", span: 6, variant: "news", sources: ["9to5Mac"], limit: 15 },
    { id: "reddit", title: "Reddit", icon: "chat", section: "community", span: 4, variant: "news", sources: ["Reddit"], limit: 15 },
    { id: "hackernews", title: "Hacker News", icon: "hexagon", section: "community", span: 4, variant: "news", sources: ["Hacker News"], limit: 15 },
    { id: "producthunt", title: "Product Hunt", icon: "rocket", section: "community", span: 4, variant: "news", category: "products", limit: 10 },
    { id: "digest", title: "Weekly Mac Apps Digest", icon: "list", section: "digest", span: 12, variant: "digest" },
  ],

  stats: [
    { key: "articles", label: "Articles", icon: "articles", categories: ["news", "community", "products"], chart: true },
    { key: "repos", label: "New Repos", icon: "repos", categories: ["code"], sub: { type: "sum", field: "stars", prefix: "★ ", suffix: " total" } },
    { key: "products", label: "Products", icon: "models", categories: ["products"] },
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
    Reddit: "#f87171",
    "Product Hunt": "#fb923c",
    "9to5Mac": "#34d399",
    "Google News": "#fbbf24",
  },
};
