// apis/briefing.mjs — Master orchestrator: runs the active domain pack's sources in parallel
import { loadDomain } from "../domains/index.mjs";
import log from "../lib/logger.mjs";
import { sanitizeItem } from "./utils/sanitize.mjs";

// Pinned: resolved synchronously at import time from the env-selected pack
// (PULSE_DOMAIN, default "ai") so diag.mjs, server.mjs (/api/health) and the
// existing tests keep importing plain constants.
const DEFAULT_PACK = loadDomain();
export const SOURCE_COUNT = DEFAULT_PACK.sources.length;
export const SOURCE_NAMES = DEFAULT_PACK.sources.map((s) => s.name);

// Resolved source lists cached per pack id
const resolvedCache = new Map();

/**
 * Resolve a pack's source list to [{ name, fn }] via dynamic import.
 * fn = (opts) => mod.briefing(config ?? {}, opts) — config flows from the
 * pack, opts from the caller (runDigestSweep passes { days: 7 }).
 * A module that fails to import degrades to one errored source at sweep time
 * (existing per-source error envelope), never a boot crash.
 */
async function resolveSources(pack) {
  if (resolvedCache.has(pack.id)) return resolvedCache.get(pack.id);
  const sources = await Promise.all(
    pack.sources.map(async ({ name, module, config }) => {
      try {
        const mod = await import(`./sources/${module}.mjs`);
        return { name, fn: (opts) => mod.briefing(config ?? {}, opts) };
      } catch (err) {
        log.warn(
          { source: name, module, err: err.message },
          "Source module failed to import",
        );
        return {
          name,
          fn: async () => {
            throw err;
          },
        };
      }
    }),
  );
  resolvedCache.set(pack.id, sources);
  return sources;
}

/** Sanitize all items returned by a source */
function sanitizeSourceData(data) {
  if (!data) return data;
  if (data.items) {
    data.items = data.items.map(sanitizeItem);
  }
  if (data.models?.items) {
    data.models.items = data.models.items.map(sanitizeItem);
  }
  if (data.datasets?.items) {
    data.datasets.items = data.datasets.items.map(sanitizeItem);
  }
  return data;
}

export async function runSweep(onProgress, { pack = DEFAULT_PACK } = {}) {
  const start = Date.now();
  const sources = await resolveSources(pack);
  log.info(
    { sources: sources.length },
    "Sweep started — querying sources in parallel",
  );

  let done = 0;
  const results = await Promise.allSettled(
    sources.map(async (s) => {
      const t0 = Date.now();
      try {
        const data = await s.fn();
        const sanitizedData = sanitizeSourceData(data);
        const ms = Date.now() - t0;
        log.info({ source: s.name, ms }, "Source OK");
        done++;
        onProgress?.({
          done,
          total: sources.length,
          source: s.name,
          status: "ok",
        });
        return { source: s.name, status: "ok", data: sanitizedData };
      } catch (err) {
        const ms = Date.now() - t0;
        log.warn({ source: s.name, ms, err: err.message }, "Source failed");
        done++;
        onProgress?.({
          done,
          total: sources.length,
          source: s.name,
          status: "error",
        });
        return { source: s.name, status: "error", error: err.message };
      }
    }),
  );

  const sweepSources = results.map((r) =>
    r.status === "fulfilled" ? r.value : r.reason,
  );
  const okCount = sweepSources.filter((s) => s.status === "ok").length;
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  log.info({ ok: okCount, total: sources.length, elapsed }, "Sweep complete");

  return {
    timestamp: new Date().toISOString(),
    sweepDurationMs: Date.now() - start,
    sourcesOk: okCount,
    sourcesTotal: sources.length,
    sources: sweepSources,
  };
}

/**
 * Digest-specific sweep: fetches from all sources with a 7-day window
 * where supported (Google News, NewsAPI). Other sources return their
 * current hot/trending content which is inherently recent.
 */
export async function runDigestSweep({ pack = DEFAULT_PACK } = {}) {
  const DIGEST_DAYS = 7;
  const start = Date.now();
  const sources = await resolveSources(pack);
  log.info("Digest sweep started — fetching 7-day content from all sources");

  const results = await Promise.allSettled(
    sources.map(async (s) => {
      const t0 = Date.now();
      try {
        const data = await s.fn({ days: DIGEST_DAYS });
        const sanitizedData = sanitizeSourceData(data);
        const ms = Date.now() - t0;
        log.info({ source: s.name, ms }, "Digest source OK");
        return { source: s.name, status: "ok", data: sanitizedData };
      } catch (err) {
        const ms = Date.now() - t0;
        log.warn(
          { source: s.name, ms, err: err.message },
          "Digest source failed",
        );
        return { source: s.name, status: "error", error: err.message };
      }
    }),
  );

  const digestSources = results.map((r) =>
    r.status === "fulfilled" ? r.value : r.reason,
  );
  const okCount = digestSources.filter((s) => s.status === "ok").length;

  log.info(
    { ok: okCount, total: sources.length, ms: Date.now() - start },
    "Digest sweep complete",
  );

  return {
    timestamp: new Date().toISOString(),
    sweepDurationMs: Date.now() - start,
    sourcesOk: okCount,
    sourcesTotal: sources.length,
    sources: digestSources,
  };
}

// CLI mode
if (import.meta.url === `file://${process.argv[1]}`) {
  await import("./utils/env.mjs");
  const d = await runSweep();
  console.log(JSON.stringify(d, null, 2));
}
