# AI Pulse

AI news intelligence dashboard — LLM releases, acquisitions, research papers, trending models, and community buzz. Your own AI analyst.

12 sources. One command. Zero cloud.

<img width="2535" height="1203" alt="Capture d’écran 2026-03-19 à 20 49 52" src="https://github.com/user-attachments/assets/6f8d6634-b2c3-4884-b8a7-dc3b3c10ffbe" />

## Quick Start

### npx (recommended)

```bash
npx ai-pulse
```

That's it. Opens at `http://localhost:3200`. On first run, a `.env` file is created in your current directory for configuration.

### From source

```bash
git clone https://github.com/hugodendievel-cmd/ai-pulse.git
cd ai-pulse
npm install
npm start
```

### Configuration

Edit `.env` in your working directory:

```bash
# LLM (optional — enables AI briefing, model radar, signals, weekly digest)
LLM_PROVIDER=openai       # anthropic | openai | gemini | opencode | disabled
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4.1         # optional override

# Server
PORT=3200
REFRESH_INTERVAL_MINUTES=15

# Optional
GITHUB_TOKEN=              # higher GitHub API rate limits
```

Dashboard opens at `http://localhost:3200`. First sweep takes ~5–30s, then auto-refreshes every 15 minutes via SSE.

## What You Get

### Live Dashboard

A Jarvis-style HUD with:

- **Stats bar** — article count, model count, paper count, repo stars, freshness ring
- **AI Briefing** — LLM-powered summary, top stories, trends (optional, needs LLM key)
- **Model Radar** — LLM-detected model releases with status badges
- **Signals** — AI industry signals with confidence indicators
- **🔥 Trending** — engagement-sorted articles from all news sources
- **🆕 Newest** — date-sorted latest articles
- **Trending Models** — Hugging Face models sorted by trending score
- **Latest Papers** — ArXiv cs.AI, cs.CL, cs.LG, cs.CV papers
- **GitHub Trending** — hot AI/ML repositories
- **Reddit** — top posts from r/MachineLearning, r/LocalLLaMA, r/artificial, r/singularity
- **Hacker News** — AI-related stories from the front page
- **Product Hunt** — AI product launches
- **Weekly Digest** — on-demand 7-day synthesis across all sources (see below)
- **Light / dark / terminal mode** — toggle with persistence

### Smart Refresh

- Sweeps only run when someone is viewing the dashboard (saves LLM costs)
- When a viewer arrives with stale data, an immediate sweep is triggered
- All sources queried in parallel (~1–30s)
- Real-time progress pushed via SSE

### Optional LLM Layer

Connect an LLM for enhanced analysis:

- **AI briefing** — summary, top stories, trends, model radar, signals
- **Providers:** Anthropic Claude, OpenAI GPT, Google Gemini, OpenCode Zen
- Graceful fallback when LLM is unavailable

### Weekly Digest

The weekly digest synthesises 7 days of content from all 12 sources into a structured briefing: TL;DR, Key Highlights, Model & Tool Updates, Paper Picks, Community Buzz, and Look Ahead.

**Triggering:**

- Click the **Generate Weekly Digest** button in the dashboard (Digest tab)
- Or call `POST /api/digest/generate` directly

**Once-per-ISO-week guard:** The server allows one digest per ISO 8601 week. If a digest already exists for the current week, the endpoint returns `409` with the existing digest's `generatedAt` and `weekId`. The dashboard displays the existing digest with a note ("already generated this week") instead of an error.

**Force regeneration (operator/admin):** `POST /api/digest/generate?force=1` skips the weekly guard and overwrites the existing digest. This is an operator escape hatch, not a normal user action — the LLM daily budget cap still applies.

**Week boundaries:** Week boundaries follow **Europe/Brussels** time (CET in winter, CEST in summer; DST-transparent). The same timezone is used for the daily LLM budget rollover.

**Storage:** `.ai-pulse/digests/{weekId}.json` and `.ai-pulse/digests/latest.json` in your working directory. `weekId` format: `YYYY-Www` (e.g. `2026-W16`).

**Retrieve:** `GET /api/digest` returns the latest digest, or `404` if none has been generated yet.

## Data Sources (12)

| Source         | What                                                         | Key?                                            |
| -------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| Hacker News    | AI stories from the front page (Firebase JSON API)           | None                                            |
| ArXiv          | AI/ML/NLP/CV papers (Atom)                                   | None                                            |
| Hugging Face   | Trending models & datasets (REST)                            | None                                            |
| GitHub         | Trending AI repositories (Search API)                        | Optional (`GITHUB_TOKEN` for higher rate limit) |
| TechCrunch     | AI news (RSS)                                                | None                                            |
| The Verge      | AI news (Atom)                                               | None                                            |
| VentureBeat    | AI news (RSS)                                                | None                                            |
| Reddit         | r/MachineLearning, r/LocalLLaMA, r/artificial, r/singularity | Optional OAuth (`REDDIT_CLIENT_ID` / `_SECRET`) |
| Google News    | AI search (RSS)                                              | None                                            |
| NewsAPI        | 30 AI headlines (REST)                                       | Required (free tier at newsapi.org)             |
| Product Hunt   | AI product launches (Atom)                                   | None                                            |
| Simon Willison | AI/ML blog (simonwillison.net) (Atom)                        | None                                            |

**All sources work without API keys**, except NewsAPI which silently self-skips when `NEWSAPI_KEY` is absent. GitHub and Reddit keys are optional (for higher rate limits / private OAuth).

## API Keys Setup

All sources work **without API keys** (NewsAPI being the one exception — it silently skips if absent). Optional keys unlock higher rate limits and LLM analysis.

### LLM Provider (optional)

Set `LLM_PROVIDER` in `.env` to one of: `anthropic`, `openai`, `gemini`, `opencode`

| Provider  | Env Var       | Default Model       |
| --------- | ------------- | ------------------- |
| anthropic | `LLM_API_KEY` | `claude-sonnet-4-6` |
| openai    | `LLM_API_KEY` | `gpt-4.1`           |
| gemini    | `LLM_API_KEY` | `gemini-2.5-flash`  |
| opencode  | `LLM_API_KEY` | `gpt-5.6-luna`      |

## Architecture

```
ai-pulse/
├── cli.mjs                    # npx entrypoint (bin)
├── server.mjs                 # Express server (SSE, sweep scheduler, digest endpoints)
├── diag.mjs                   # Diagnostic script
├── .env.example               # Template (copied on first run)
├── package.json               # Runtime deps: express, pino, fast-xml-parser, helmet, express-rate-limit
│
├── apis/
│   ├── briefing.mjs           # Orchestrator — runSweep() + runDigestSweep(); exports SOURCE_COUNT, SOURCE_NAMES
│   ├── save-briefing.mjs      # CLI: save timestamped + latest.json
│   ├── utils/
│   │   ├── fetch.mjs          # safeFetch() / safeFetchText() — timeout, retries, abort
│   │   ├── env.mjs            # .env loader (cwd → package root fallback)
│   │   ├── sanitize.mjs       # XSS prevention, entity decode
│   │   └── xml.mjs            # fast-xml-parser wrapper for RSS/Atom
│   └── sources/               # 12 self-contained source modules
│       ├── hackernews.mjs     # Each exports briefing() → structured data
│       ├── arxiv.mjs          # Standalone: node apis/sources/arxiv.mjs
│       └── ...
│
├── dashboard/
│   ├── inject.mjs             # Static-export tool: inlines CSS+JS for one-off snapshots (not a build step)
│   └── public/
│       ├── index.html         # Shell; references /app.js + /style.css (cache-busted)
│       ├── app.js             # All client JS: SSE, panels, themes, ⌘K, digest UI
│       ├── style.css          # All styles: dark, light, terminal themes
│       └── favicon.svg
│
└── lib/
    ├── logger.mjs             # pino singleton
    ├── sweep-progress.mjs     # Sweep progress state machine
    ├── llm/                   # LLM abstraction (4 providers, raw fetch — no SDKs)
    │   ├── provider.mjs       # Base class
    │   ├── anthropic.mjs      # Claude
    │   ├── openai.mjs         # GPT
    │   ├── gemini.mjs         # Gemini
    │   ├── opencode.mjs       # OpenCode Zen
    │   ├── analysis.mjs       # Per-sweep AI news analysis/synthesis
    │   ├── weekly-digest.mjs  # 7-day digest pipeline
    │   ├── budget.mjs         # Persistent daily budget (Europe/Brussels)
    │   └── index.mjs          # Factory: createLLMProvider()
    ├── delta/                 # Change tracking between sweeps
    │   ├── engine.mjs         # Delta computation
    │   ├── memory.mjs         # Hot memory (3 runs)
    │   └── index.mjs          # Re-exports
    └── digest/                # Weekly digest persistence
        ├── store.mjs          # saveDigest() / loadLatestDigest()
        └── week-id.mjs        # weekIdBrussels() — ISO 8601 week in Europe/Brussels
```

Runtime data is stored in your working directory under `.ai-pulse/` (hot memory ring + digests + persisted LLM budget).

### Design Principles

- **Pure ESM** — every file is `.mjs` with explicit imports
- **Minimal dependencies** — Express is the only runtime dependency (plus pino for logging and fast-xml-parser for RSS/Atom)
- **Parallel execution** — `Promise.allSettled()` fires all sources simultaneously
- **Graceful degradation** — missing keys produce empty arrays, not crashes
- **npx-ready** — resolves package assets via `import.meta.url`, user data via `process.cwd()`
- **Separate dashboard assets** — `index.html`, `app.js`, `style.css` served individually with 1-hour cache headers in production

## npm Scripts

| Script               | Command                            | Description                       |
| -------------------- | ---------------------------------- | --------------------------------- |
| `npm start`          | `node cli.mjs`                     | Start via CLI (same as `npx`)     |
| `npm run dev`        | `node --trace-warnings server.mjs` | Start with trace warnings (dev)   |
| `npm run sweep`      | `node apis/briefing.mjs`           | Run a single sweep, output JSON   |
| `npm run brief:save` | `node apis/save-briefing.mjs`      | Run sweep + save timestamped JSON |
| `npm run diag`       | `node diag.mjs`                    | Run diagnostics                   |

## API Endpoints

| Endpoint                    | Method | Description                                                                              |
| --------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| `/`                         | GET    | Dashboard shell (cache-busted asset URLs)                                                |
| `/api/data`                 | GET    | Current intelligence data (JSON); `503` before first sweep                               |
| `/api/health`               | GET    | Uptime, sweep stats, LLM budget, source stats, SSE client count                          |
| `/api/digest`               | GET    | Latest weekly digest from `.ai-pulse/digests/latest.json`; `404` if none yet             |
| `/api/digest/generate`      | POST   | Triggers digest sweep + LLM generation; once-per-ISO-week guard; `?force=1` override     |
| `/events`                   | GET    | SSE stream: `progress` / `update` / `digest` events; capped at `MAX_SSE_CLIENTS`         |

## Configuration

| Variable                                     | Default      | Description                                                                                                          |
| -------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                       | `3200`       | Server port                                                                                                          |
| `REFRESH_INTERVAL_MINUTES`                   | `15`         | Auto-refresh interval                                                                                                |
| `LLM_PROVIDER`                               | `disabled`   | `anthropic`, `openai`, `gemini`, `opencode`, or `disabled`                                                           |
| `LLM_API_KEY`                                | —            | API key for LLM provider                                                                                             |
| `LLM_MODEL`                                  | per-provider | Override model selection (e.g. `gpt-4.1`)                                                                            |
| `GITHUB_TOKEN`                               | —            | GitHub PAT (optional, higher rate limits)                                                                            |
| `NEWSAPI_KEY`                                | —            | Enables NewsAPI source (silently skipped if absent)                                                                  |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`  | —            | Reddit OAuth (optional; falls back to public JSON)                                                                   |
| `MAX_SSE_CLIENTS`                            | `200`        | Maximum concurrent SSE connections                                                                                   |
| `MAX_LLM_CALLS_PER_DAY`                      | `100`        | Daily LLM budget — persisted to `.ai-pulse/memory/llm-budget.json`; resets at midnight Europe/Brussels (DST-aware)   |
| `LOG_LEVEL`                                  | `info`       | pino log level: `trace` / `debug` / `info` / `warn` / `error`                                                        |
| `NODE_ENV`                                   | —            | `production` or `development` — affects static-asset cache TTL (1 h in production) and pino transport                |

## License

MIT
