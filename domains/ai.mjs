// domains/ai.mjs — "AI Pulse" domain pack: reproduces the original app exactly
// Prompt strings live in lib/llm/ (canonical defaults) and are re-exported
// here — single source of truth, zero duplication.
import { SYSTEM_PROMPT } from "../lib/llm/analysis.mjs";
import { WEEKLY_SYSTEM_PROMPT } from "../lib/llm/weekly-digest.mjs";

export default {
  id: "ai",
  name: "AI Pulse",
  tagline:
    "real-time intelligence dashboard tracking LLM releases, papers, models, and community signals across 12 sources.",

  // The 12 sources in orchestrator sweep order. config:{} — defaults live in
  // the source modules themselves (single source of truth).
  sources: [
    { name: "Hacker News", module: "hackernews", config: {} },
    { name: "ArXiv", module: "arxiv", config: {} },
    { name: "Hugging Face", module: "huggingface", config: {} },
    { name: "GitHub Trending", module: "github-trending", config: {} },
    { name: "TechCrunch", module: "techcrunch", config: {} },
    { name: "The Verge", module: "theverge", config: {} },
    { name: "VentureBeat", module: "venturebeat", config: {} },
    { name: "Reddit", module: "reddit", config: {} },
    { name: "Google News", module: "google-news", config: {} },
    { name: "NewsAPI", module: "newsapi", config: {} },
    { name: "Product Hunt", module: "producthunt", config: {} },
    { name: "Simon Willison", module: "simonwillison", config: {} },
  ],

  prompts: {
    analysis: SYSTEM_PROMPT,
    digest: WEEKLY_SYSTEM_PROMPT,
  },

  // Sources whose items carry no per-item date but are inherently fresh
  // (verbatim from INHERENTLY_FRESH_SOURCES in lib/llm/weekly-digest.mjs).
  freshSources: [
    "Hacker News",
    "Reddit",
    "Product Hunt",
    "GitHub Trending",
    "Hugging Face",
  ],

  // Panels in DOM order. icon = #ic-<icon> sprite suffix; section = nav group.
  panels: [
    { id: "analysis", title: "AI Briefing", icon: "brain", section: "briefing", span: 8, variant: "briefing" },
    { id: "radar", title: "Radar", icon: "radar", section: "briefing", span: 4, variant: "radar" },
    // Aggregates: today's renderNews included every data.items source except
    // GitHub Trending; HF has no data.items. Excluding code+models is the
    // exact generic equivalent.
    { id: "trending", title: "Trending", icon: "flame", section: "news", span: 6, variant: "aggregate", sort: "engagement", limit: 20, excludeCategories: ["code", "models"] },
    { id: "newest", title: "Newest", icon: "sparkles", section: "news", span: 6, variant: "aggregate", sort: "date", limit: 20, excludeCategories: ["code", "models"] },
    { id: "models", title: "Trending Models", icon: "cube", section: "research", span: 6, variant: "cards", category: "models", limit: 15 },
    { id: "papers", title: "Latest Papers", icon: "paper", section: "research", span: 6, variant: "cards", category: "research", limit: 15 },
    { id: "repos", title: "GitHub Trending", icon: "code", section: "code", span: 6, variant: "cards", category: "code", limit: 12 },
    { id: "blog", title: "Simon Willison", icon: "pen", section: "community", span: 6, variant: "news", sources: ["Simon Willison"], limit: 15 },
    { id: "reddit", title: "Reddit", icon: "chat", section: "community", span: 4, variant: "news", sources: ["Reddit"], limit: 15 },
    { id: "hackernews", title: "Hacker News", icon: "hexagon", section: "community", span: 4, variant: "news", sources: ["Hacker News"], limit: 15 },
    // section "community" is deliberate — matches the original data-section.
    { id: "producthunt", title: "Product Hunt AI", icon: "rocket", section: "community", span: 4, variant: "news", category: "products", limit: 10 },
    { id: "digest", title: "Weekly AI Digest", icon: "list", section: "digest", span: 12, variant: "digest" },
  ],

  // Stat cards (the freshness ring is built-in engine chrome, not pack data).
  stats: [
    { key: "articles", label: "Articles", icon: "articles", categories: ["news", "community", "products"], chart: true },
    { key: "models", label: "Models", icon: "models", categories: ["models"], sub: { type: "topValue", field: "pipeline", prefix: "Top: " } },
    { key: "papers", label: "Papers", icon: "papers", categories: ["research"], sub: { type: "topValue", field: "categories", prefix: "Top: " } },
    { key: "repos", label: "Repos", icon: "repos", categories: ["code"], sub: { type: "sum", field: "stars", prefix: "★ ", suffix: " total" } },
  ],

  nav: [
    { filter: "all", label: "All" },
    { filter: "briefing", label: "Briefing" },
    { filter: "news", label: "News" },
    { filter: "research", label: "Research" },
    { filter: "code", label: "Code" },
    { filter: "community", label: "Community" },
    { filter: "digest", label: "Digest" },
  ],

  // Verbatim from the original sourceColor() map in app.js.
  colors: {
    TechCrunch: "#34d399",
    "The Verge": "#f472b6",
    VentureBeat: "#60a5fa",
    "Google News": "#fbbf24",
    "Hacker News": "#fb923c",
    Reddit: "#f87171",
    ArXiv: "#a78bfa",
    "Hugging Face": "#fbbf24",
    "GitHub Trending": "#60a5fa",
    "Product Hunt": "#fb923c",
    "Simon Willison": "#38bdf8",
  },
};
