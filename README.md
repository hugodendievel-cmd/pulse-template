# pulse-template

Template for self-hosted **intelligence dashboards**: aggregate many sources on a schedule, summarize with your own LLM, render a live dashboard. One command, zero cloud.

Fork this template → write one domain pack → ship your own pulse (AI news, Mac apps, privacy news, local music releases…).

## Quick start

```bash
git clone https://github.com/hugodendievel-cmd/pulse-template.git my-pulse
cd my-pulse && npm install
npm start
```

Dashboard opens at `http://localhost:3200`. First sweep takes ~5–30 s, then auto-refreshes every 15 minutes via SSE.

## Build your dashboard (the 5-minute flow)

1. **Write a pack** — copy `domains/example.mjs` to `domains/yours.mjs` and edit it:
   - `sources` — pick modules from `apis/sources/` (Hacker News, GitHub Trending, Reddit, generic RSS, Google News, Product Hunt, NewsAPI, Hugging Face…). Each takes a small `config` (keywords, query, feedUrl, subreddits…).
   - `prompts` — the analyst voice for the briefing, the weekly digest and the daily edition. **Keep the JSON schemas character-identical** — the dashboard renderers depend on those exact field names.
   - `panels`, `stats`, `views`, `colors`, `freshSources`, `name`/`tagline` — the dashboard builds itself from these. `views` declares the destinations (each with a `layout` of `main-rail`, `grid` or `reader`); the legacy `nav` shape is still accepted and normalized into views.
   - `credit` — optional header byline link (`{ text, url }`).
2. **Register it** — one line in `domains/index.mjs` (`REGISTRY`), and/or make it the default: `loadDomain(id = env("PULSE_DOMAIN", "yours"))`.
3. **Brand it** — rename the package in `package.json` (`name`, `bin`), update this README, tweak the semantic tokens at the top of `dashboard/public/style.css` if you want a different accent.
4. **Run it** — `PULSE_DOMAIN=yours npm start` (or set the default as in step 2).
5. **Deploy** — any Node 22+ host works; a `Dockerfile` ships in the box. Point `PULSE_DATA_DIR` at a mounted volume so editions/digests survive redeploys.

## The dashboard

A single-page vanilla-JS HUD driven entirely by `/api/domain` — no build step:

- **Three pack-declared views** (the starter pack ships `today` / `streams` / `editions`), switchable by click, by `1`/`2`/`3`, or from a `⌘K` command palette.
- **Briefing hero** — the LLM summary as a one-sentence deck over a headline list, with model radar and signals in the rail. With `LLM_PROVIDER=disabled` the `today` view degrades to a ranked raw feed plus the pack's `noBriefingNote`; nothing looks broken.
- **Streams grid** — every source as a uniform card with status dot, count, last-fetch age, a source-health tile, category filter chips and in-view sort.
- **Editions view** — the daily-edition reader, the on-demand weekly digest, and the archive of past editions.
- **Metrics strip + ticker**, per-panel delta `N new` badges, skeleton loading on first sweep and SSE connection states in the live pill.
- **Light / dark / terminal themes** with system-follow by default; self-hosted Inter + JetBrains Mono (no external font origin).
- **Static snapshots** — `npm run inject` emits a self-contained `index-static.html` from the latest saved sweep, for sharing or archival.

## What's in the box

```
├── cli.mjs                    # npx entrypoint
├── server.mjs                 # Express: SSE, sweep scheduler, digest + newsletter endpoints/pages, /api/domain
├── diag.mjs                   # Diagnostic script
├── apis/
│   ├── briefing.mjs           # Orchestrator — builds sources from the active pack
│   ├── save-daily-edition.mjs # Operator CLI: generate today's daily edition
│   ├── sources/               # Generic, config-driven source modules
│   └── utils/                 # fetch (timeout/retries), env, sanitize, xml
├── domains/
│   ├── index.mjs              # Pack loader/registry (PULSE_DOMAIN env) + views normalizer
│   └── example.mjs            # Starter pack ← start here
├── lib/
│   ├── data-dir.mjs           # Single source of truth for the .pulse/ runtime root
│   ├── llm/                   # LLM providers (anthropic/openai/gemini/opencode) + budget + daily edition
│   ├── delta/                 # Change tracking between sweeps
│   ├── digest/                # Weekly digest persistence
│   └── newsletter/            # Daily edition: store, pipeline, scheduler, render
├── dashboard/
│   ├── inject.mjs             # Static-export tool → index-static.html (not a build step)
│   └── public/                # Vanilla JS dashboard, rendered from /api/domain
│       ├── index.html
│       ├── app.js
│       ├── render-core.mjs    # Pure data layer (window.RenderCore)
│       ├── style.css          # Semantic tokens, layouts, themes
│       └── fonts/             # Self-hosted Inter + JetBrains Mono (OFL)
└── tests/                     # Vitest
```

Sources are `briefing(config, opts)` — pure functions of their config. Adding a source module = one file, fully optional. Runtime data (editions, digests, budget, hot memory) lands under `<PULSE_DATA_DIR|cwd>/.pulse/`.

## LLM layer (optional)

Set `LLM_PROVIDER` in `.env` to one of `anthropic`, `openai`, `gemini`, `opencode`, or leave `disabled` — everything else still works.

| Provider  | Env Var       | Notes                    |
| --------- | ------------- | ------------------------ |
| anthropic | `LLM_API_KEY` | Claude models             |
| openai    | `LLM_API_KEY` | GPT models                |
| gemini    | `LLM_API_KEY` | Google AI Studio          |
| opencode  | `LLM_API_KEY` | OpenCode Zen gateway (`LLM_BASE_URL` overrides base) |

Daily budget cap via `MAX_LLM_CALLS_PER_DAY` (persisted, Europe/Brussels day boundary).

### Daily edition

With an LLM configured, the server runs an internal scheduler that generates a TL;DR-style daily edition once a day (`NEWSLETTER_RUN_AT`, default `07:30` Europe/Brussels, with automatic catch-up after a restart that missed the slot). There is deliberately no public trigger endpoint; operators can run `npm run edition:save` (add `--force` to regenerate). The result is served at `/api/newsletter` (JSON) and rendered at `/newsletter` (archive pages, `render.mjs` — the same presentation layer intended for email delivery).

## Configuration

| Variable                                     | Default      | Description                                                           |
| -------------------------------------------- | ------------ | ---------------------------------------------------------------------- |
| `PORT`                                       | `3200`       | Server port                                                            |
| `REFRESH_INTERVAL_MINUTES`                   | `15`         | Auto-refresh interval                                                  |
| `PULSE_DOMAIN`                               | `example`    | Active domain config pack (`domains/<id>.mjs`)                         |
| `LLM_PROVIDER`                               | `disabled`   | `anthropic`, `openai`, `gemini`, `opencode`, or `disabled`             |
| `LLM_API_KEY`                                | —            | API key for LLM provider                                               |
| `LLM_MODEL`                                  | per-provider | Override model selection                                               |
| `LLM_BASE_URL`                               | —            | LLM gateway base override (opencode provider: `opencode.ai/zen/v1`)    |
| `GITHUB_TOKEN`                               | —            | Higher GitHub API rate limits                                          |
| `NEWSAPI_KEY`                                | —            | Enables the NewsAPI source                                             |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`  | —            | Reddit OAuth (optional; falls back to public JSON)                     |
| `MAX_SSE_CLIENTS`                            | `200`        | Max concurrent SSE connections                                         |
| `MAX_LLM_CALLS_PER_DAY`                      | `100`        | Daily LLM budget (Europe/Brussels rollover)                            |
| `NEWSLETTER_RUN_AT`                          | `07:30`      | Daily-edition generation time (HH:MM, Europe/Brussels; internal scheduler) |
| `PULSE_ENV_LABEL`                            | —            | Optional tag beside the wordmark (e.g. `acc`); unset in production      |
| `PULSE_DATA_DIR`                             | working dir  | Base for the `.pulse/` runtime data — point at a persistent volume      |
| `LOG_LEVEL`                                  | `info`       | pino log level                                                         |
| `NODE_ENV`                                   | —            | `production`/`development` (asset cache TTL, pino transport)           |

## Lineage

- **Descendants** (e.g. [ai-pulse](https://ai-pulse.be) — self-hosted AI news — and future packs) fork this template and keep full git history — pull engine fixes with:
  ```bash
  git remote add upstream git@github.com:hugodendievel-cmd/pulse-template.git
  git fetch upstream && git merge upstream/main
  ```
- **Engine fixes** land here first, then flow down via that merge.

## License

MIT
