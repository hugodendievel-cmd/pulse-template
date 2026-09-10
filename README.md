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
   - `prompts` — the analyst voice for the briefing and the weekly digest. **Keep the JSON schemas character-identical** — the dashboard renderers depend on those exact field names.
   - `panels`, `stats`, `nav`, `colors`, `freshSources`, `name`/`tagline` — the dashboard builds itself from these.
2. **Register it** — one line in `domains/index.mjs` (`REGISTRY`), and/or make it the default: `loadDomain(id = env("PULSE_DOMAIN", "yours"))`.
3. **Brand it** — rename the package in `package.json` (`name`, `bin`), update this README, tweak `dashboard/public/style.css` tokens if you want a different accent.
4. **Run it** — `PULSE_DOMAIN=yours npm start` (or set the default as in step 2).
5. **Deploy** — any Node 22+ host works; a `Dockerfile` ships in the box.

## What's in the box

```
├── cli.mjs                    # npx entrypoint
├── server.mjs                 # Express: SSE, sweep scheduler, digest endpoints, /api/domain
├── apis/
│   ├── briefing.mjs           # Orchestrator — builds sources from the active pack
│   ├── sources/               # Generic, config-driven source modules
│   └── utils/                 # fetch (timeout/retries), env, sanitize, xml
├── domains/
│   ├── index.mjs              # Pack loader/registry (PULSE_DOMAIN env)
│   └── example.mjs            # Minimal starter pack ← start here
├── lib/
│   ├── llm/                   # LLM providers (anthropic/openai/gemini/opencode) + budget
│   ├── delta/                 # Change tracking between sweeps
│   └── digest/                # Weekly digest persistence
├── dashboard/public/          # Vanilla JS dashboard, rendered from /api/domain
└── tests/                     # Vitest
```

Sources are `briefing(config, opts)` — pure functions of their config. Adding a source module = one file, fully optional.

## LLM layer (optional)

Set `LLM_PROVIDER` in `.env` to one of `anthropic`, `openai`, `gemini`, `opencode`, or leave `disabled` — everything else still works.

| Provider  | Env Var       | Notes                    |
| --------- | ------------- | ------------------------ |
| anthropic | `LLM_API_KEY` | Claude models             |
| openai    | `LLM_API_KEY` | GPT models                |
| gemini    | `LLM_API_KEY` | Google AI Studio          |
| opencode  | `LLM_API_KEY` | OpenCode Zen gateway (`LLM_BASE_URL` overrides base) |

Daily budget cap via `MAX_LLM_CALLS_PER_DAY` (persisted, Europe/Brussels day boundary).

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
