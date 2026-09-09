// server.mjs — Express server with SSE, auto-refresh, LLM analysis
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runDigestSweep,
  runSweep,
  SOURCE_COUNT,
  SOURCE_NAMES,
} from "./apis/briefing.mjs";
import "./apis/utils/env.mjs";
import { loadDomain } from "./domains/index.mjs";
import { computeDelta, getPrevious, pushSweep } from "./lib/delta/index.mjs";
import { loadLatestDigest, saveDigest } from "./lib/digest/store.mjs";
import { weekIdBrussels } from "./lib/digest/week-id.mjs";
import { analyzeWithLLM } from "./lib/llm/analysis.mjs";
import {
  incrementBudget,
  isBudgetExhausted,
  loadBudget,
} from "./lib/llm/budget.mjs";
import { createLLMProvider } from "./lib/llm/index.mjs";
import { generateWeeklyDigest } from "./lib/llm/weekly-digest.mjs";
import log from "./lib/logger.mjs";
import { shouldTriggerSweep } from "./lib/sweep-cooldown.mjs";
import { createSweepProgressTracker } from "./lib/sweep-progress.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Cache-busting version tag derived from package.json
const PKG_VERSION = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf-8"),
).version;

// ── Branding injection (domain pack → index.html tokens) ──
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// "AI Pulse" → AI<span>PULSE</span> (first word plain, rest uppercased in
// the span — reproduces the original logo/loading markup for any pack name).
function pulseNameHtml(name) {
  const words = escapeHtml(name).split(" ");
  const first = words.shift();
  const rest = words.join(" ").toUpperCase();
  return rest ? `${first}<span>${rest}</span>` : first;
}

const PORT = Number.parseInt(process.env.PORT || "3200", 10);
const REFRESH_MS =
  Number.parseInt(process.env.REFRESH_INTERVAL_MINUTES || "15", 10) * 60_000;
const MAX_SSE_CLIENTS = Number.parseInt(
  process.env.MAX_SSE_CLIENTS || "200",
  10,
);
const SSE_HEARTBEAT_MS = 30_000;

const app = express();
const sseClients = new Set();

const MAX_LLM_CALLS_PER_DAY = Number.parseInt(
  process.env.MAX_LLM_CALLS_PER_DAY || "100",
  10,
);

let currentData = null;
let llm = null;
let domain = null; // active domain pack, set in boot()
let sweepCount = 0;
let lastSweepTime = null;
let lastSweepDurationMs = null;
let sourceStats = {}; // per-source success/failure counts
let sweepProgress = null;
let sweepInProgress = false;

// ── Trust proxy (Railway / Cloudflare) ──
app.set("trust proxy", 1);

// ── Security headers ──
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // 'unsafe-inline' required: Railway injects inline scripts whose hash
        // changes per deploy, making hash/nonce approaches impractical.
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false, // allows external images/fonts if needed later
  }),
);

// ── Rate limiting ──
// Scope: /api/* JSON routes only. Static assets and the page shell are cheap,
// and /events is a long-lived SSE connection — counting it (plus the browser's
// auto-reconnect after every server restart) against a 60/min global cap
// locked real users out. Behind a reverse proxy all clients share one IP, so
// the per-IP bucket must be sized for the dashboard's own polling pattern.
app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
  }),
);

app.use(express.json());

// ── Serve index.html with cache-busted asset URLs + pack branding ──
app.get("/", (_req, res) => {
  const htmlPath = resolve(__dirname, "dashboard", "public", "index.html");
  let html = readFileSync(htmlPath, "utf-8");
  html = html.replace(/\.css"/g, `.css?v=${PKG_VERSION}"`);
  html = html.replace(/\.js"/g, `.js?v=${PKG_VERSION}"`);
  html = html.replace(/\.mjs"/g, `.mjs?v=${PKG_VERSION}"`);
  if (domain) {
    html = html
      .replaceAll("__PULSE_NAME_HTML__", pulseNameHtml(domain.name))
      .replaceAll("__PULSE_NAME__", escapeHtml(domain.name))
      .replaceAll("__PULSE_TAGLINE__", escapeHtml(domain.tagline ?? ""));
  }
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

// ── Static files with cache control ──
const isDev = process.env.NODE_ENV !== "production";
app.use(
  express.static(resolve(__dirname, "dashboard", "public"), {
    maxAge: isDev ? 0 : "1h",
    etag: true,
  }),
);

// ── API ──
app.get("/api/data", (_req, res) => {
  if (!currentData)
    return res.status(503).json({ error: "First sweep in progress" });
  res.json(currentData);
});

// Active domain pack chrome: panels/stats/nav/colors/branding for the
// dashboard to build itself from. No sources/prompts/freshSources leakage.
app.get("/api/domain", (_req, res) => {
  if (!domain)
    return res.status(503).json({ error: "Domain pack not loaded yet" });
  const { name, tagline, panels, stats, nav, colors } = domain;
  res.json({ name, tagline, panels, stats, nav, colors });
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    sweepCount,
    lastSweep: lastSweepTime,
    lastSweepDurationMs,
    llm: llm ? `${llm.name}/${llm.model}` : "disabled",
    sourceCount: SOURCE_COUNT,
    sources: currentData?.sweep?.sourcesTotal || 0,
    sseClients: sseClients.size,
    llmBudget: (() => {
      const b = isBudgetExhausted({ cap: MAX_LLM_CALLS_PER_DAY });
      return {
        callsToday: b.count,
        dailyLimit: b.cap,
        remaining: Math.max(0, b.cap - b.count),
        ...(b.exhausted ? { skipReason: b.skipReason } : {}),
      };
    })(),
    sourceStats,
  });
});

// ── Weekly Digest API ──
let digestGenerating = false;

app.get("/api/digest", (_req, res) => {
  const digest = loadLatestDigest();
  if (!digest)
    return res.status(404).json({ error: "No digest available yet" });
  res.json(digest);
});

app.post("/api/digest/generate", async (req, res) => {
  if (!llm) return res.status(503).json({ error: "LLM not configured" });
  if (digestGenerating)
    return res
      .status(409)
      .json({ error: "Digest generation already in progress" });

  // Once-per-ISO-week guard (Europe/Brussels). Skippable with ?force=1.
  const force = req.query.force === "1";
  if (!force) {
    const latest = loadLatestDigest();
    const currentWeekId = weekIdBrussels();
    if (latest?.weekId === currentWeekId) {
      return res.status(409).json({
        error: `Digest already generated for ${currentWeekId}`,
        existing: {
          generatedAt: latest.generatedAt,
          weekId: latest.weekId,
          weekOf: latest.weekOf ?? null,
        },
      });
    }
  }

  digestGenerating = true;
  try {
    // Budget check (persisted, Brussels day boundary)
    const budget = isBudgetExhausted({ cap: MAX_LLM_CALLS_PER_DAY });
    if (budget.exhausted) {
      return res.status(429).json({ error: budget.skipReason });
    }

    // Run a dedicated 7-day sweep across all sources
    const sweepData = await runDigestSweep();
    incrementBudget();
    const digest = await generateWeeklyDigest(llm, sweepData, {
      prompt: domain.prompts.digest,
      freshSources: domain.freshSources,
    });
    if (!digest)
      return res.status(500).json({ error: "Digest generation failed" });

    const saved = saveDigest(digest);
    log.info({ weekId: saved.weekId }, "Weekly digest generated");
    broadcast({ type: "digest", data: saved });
    res.json(saved);
  } catch (err) {
    log.error({ err: err.message }, "Digest generation failed");
    res.status(500).json({ error: "Digest generation failed" });
  } finally {
    digestGenerating = false;
  }
});

// ── SSE ──
app.get("/events", (req, res) => {
  // Cap SSE connections to prevent resource exhaustion
  if (sseClients.size >= MAX_SSE_CLIENTS) {
    log.warn(
      { clients: sseClients.size },
      "SSE connection rejected — limit reached",
    );
    return res.status(503).json({ error: "Too many connections" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("data: connected\n\n");

  const now = Date.now();
  const trigger = shouldTriggerSweep({
    lastSweepTime,
    now,
    cooldownMs: REFRESH_MS,
    sweepInProgress,
  });

  if (sweepInProgress && sweepProgress) {
    // Sweep is live — send current progress snapshot for late joiners
    res.write(
      `data: ${JSON.stringify({ type: "progress", ...sweepProgress })}\n\n`,
    );
  } else if (currentData && !trigger) {
    // Inside the cooldown window — replay cached data so the dashboard's
    // catch-up animation renders briefly and then shows the briefing.
    res.write(
      `data: ${JSON.stringify({ type: "update", data: currentData })}\n\n`,
    );
  }
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));

  // If cooldown has elapsed (or there's no data yet), trigger a fresh sweep
  // so the client waits on the loading screen.
  if (trigger) {
    const sinceMs = lastSweepTime
      ? now - new Date(lastSweepTime).getTime()
      : null;
    log.info(
      { sinceMs },
      "Viewer arrived — cooldown elapsed, triggering sweep",
    );
    sweep();
  } else if (lastSweepTime && !sweepInProgress) {
    const sinceMs = now - new Date(lastSweepTime).getTime();
    const remainingMs = Math.max(0, REFRESH_MS - sinceMs);
    log.debug(
      { reason: "cooldown", sinceMs, remainingMs },
      "Viewer arrived inside cooldown — skipping sweep trigger",
    );
  }
});

// ── SSE heartbeat to detect dead connections ──
setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(":heartbeat\n\n");
    } catch {
      sseClients.delete(client);
    }
  }
}, SSE_HEARTBEAT_MS);

function broadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function publishSweepProgress(progress) {
  sweepProgress = progress;
  broadcast({ type: "progress", ...progress });
}

// ── Sweep cycle ──
function trackSourceStats(sources) {
  for (const s of sources) {
    if (!sourceStats[s.source]) sourceStats[s.source] = { ok: 0, error: 0 };
    sourceStats[s.source][s.status === "ok" ? "ok" : "error"]++;
  }
}

async function runLLMAnalysis(sweepData) {
  if (!llm) {
    return {
      analysis: null,
      state: "disabled",
      detail: "LLM disabled",
    };
  }

  // Budget check (persisted, Brussels day boundary — rolls over on read)
  const budget = isBudgetExhausted({ cap: MAX_LLM_CALLS_PER_DAY });
  if (budget.exhausted) {
    log.warn(
      { count: budget.count, cap: budget.cap },
      "Daily LLM call budget exhausted — skipping analysis",
    );
    return {
      analysis: null,
      state: "skipped",
      detail: budget.skipReason,
    };
  }

  try {
    incrementBudget();
    const analysis = await analyzeWithLLM(llm, sweepData, {
      prompt: domain.prompts.analysis,
    });
    if (analysis) {
      const { count } = loadBudget();
      log.info({ llmCallsToday: count }, "LLM analysis complete");
      return {
        analysis,
        state: "ok",
        detail: "Briefing ready",
      };
    }

    log.warn("LLM analysis returned no structured briefing");
    return {
      analysis: null,
      state: "error",
      detail: "Briefing unavailable",
    };
  } catch (err) {
    log.error({ err: err.message }, "LLM analysis failed");
    return {
      analysis: null,
      state: "error",
      detail: "Briefing failed",
    };
  }
}

async function sweep() {
  if (sweepInProgress) return;
  sweepInProgress = true;
  const sweepStart = Date.now();
  try {
    const progressTracker = createSweepProgressTracker({
      sourceNames: SOURCE_NAMES,
      llmEnabled: Boolean(llm),
    });

    publishSweepProgress(progressTracker.snapshot());
    const sweepData = await runSweep((progress) => {
      publishSweepProgress(
        progressTracker.markSource(progress.source, progress.status),
      );
    });

    trackSourceStats(sweepData.sources);

    const previous = getPrevious();
    const delta = computeDelta(sweepData, previous);
    pushSweep(sweepData);

    let llmResult = {
      analysis: null,
      state: "disabled",
      detail: "LLM disabled",
    };

    if (llm) {
      publishSweepProgress(progressTracker.startLlm());
      llmResult = await runLLMAnalysis(sweepData);
      publishSweepProgress(progressTracker.finishLlm(llmResult));
    }

    currentData = {
      sweep: sweepData,
      delta,
      analysis: llmResult.analysis,
      generatedAt: new Date().toISOString(),
    };

    sweepCount++;
    lastSweepTime = new Date().toISOString();
    lastSweepDurationMs = Date.now() - sweepStart;
    log.info(
      {
        sweepCount,
        durationMs: lastSweepDurationMs,
        ok: sweepData.sourcesOk,
        total: sweepData.sourcesTotal,
      },
      "Sweep complete",
    );
    broadcast({ type: "update", data: currentData });
  } catch (err) {
    log.error({ err: err.message }, "Sweep failed");
  } finally {
    sweepProgress = null;
    sweepInProgress = false;
  }
}

// ── Boot ──
let server;
async function boot() {
  // Active domain pack (PULSE_DOMAIN, default "ai") — throws on unknown ids
  domain = loadDomain();
  log.info({ domain: domain.id, name: domain.name }, "Domain pack loaded");

  try {
    llm = await createLLMProvider();
    if (llm)
      log.info({ provider: llm.name, model: llm.model }, "LLM initialized");
    else log.info("LLM disabled");
  } catch (err) {
    log.warn({ err: err.message }, "LLM init failed");
  }

  const { count: budgetCount, day: budgetDay } = loadBudget();
  log.info({ count: budgetCount, day: budgetDay }, "LLM budget loaded");

  server = app.listen(PORT, () => {
    console.log(`\n  ┌─────────────────────────────────────────┐`);
    console.log(`  │       AI PULSE — Intelligence HUD       │`);
    console.log(`  │                                         │`);
    console.log(`  │   Dashboard:  http://localhost:${PORT}     │`);
    console.log(
      `  │   Sources:    ${SOURCE_COUNT}${" ".repeat(24 - String(SOURCE_COUNT).length)}│`,
    );
    console.log(
      `  │   Refresh:    every ${REFRESH_MS / 60000} min              │`,
    );
    const llmLabel = llm ? llm.name : "disabled";
    console.log(`  │   LLM:        ${llmLabel.padEnd(24)}  │`);
    console.log(`  └─────────────────────────────────────────┘\n`);
  });

  // First sweep after a short delay so SSE clients can connect
  setTimeout(sweep, 2000);
  // Then every REFRESH_MS — but only if someone is watching and the cooldown
  // has elapsed. Skip iterations that land before the first sweep completes.
  setInterval(() => {
    if (!lastSweepTime) return; // first sweep hasn't finished yet
    if (sseClients.size === 0) {
      log.info("No active viewers — skipping sweep");
      return;
    }
    const now = Date.now();
    if (
      !shouldTriggerSweep({
        lastSweepTime,
        now,
        cooldownMs: REFRESH_MS,
        sweepInProgress,
      })
    ) {
      const sinceMs = now - new Date(lastSweepTime).getTime();
      const remainingMs = Math.max(0, REFRESH_MS - sinceMs);
      log.debug(
        { reason: "cooldown", sinceMs, remainingMs },
        "Interval tick skipped — cooldown not elapsed",
      );
      return;
    }
    sweep();
  }, REFRESH_MS);
}

// ── Graceful shutdown ──
function shutdown(signal) {
  log.info({ signal }, "Shutting down gracefully…");
  // Close SSE connections
  for (const client of sseClients) {
    try {
      client.end();
    } catch {
      /* ignore */
    }
  }
  sseClients.clear();

  if (server) {
    server.close(() => {
      log.info("Server closed");
      process.exit(0);
    });
    // Force exit after 10s if connections linger
    setTimeout(() => process.exit(1), 10_000);
  } else {
    process.exit(0);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

await boot();
