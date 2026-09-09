// domains/index.mjs — Domain pack loader: PULSE_DOMAIN env selects the active pack
// Synchronous over a static registry so apis/briefing.mjs can keep exporting
// SOURCE_COUNT / SOURCE_NAMES as plain constants at import time.
// Adding a pack = one new file in domains/ + one registry line.
import { env } from "../apis/utils/env.mjs";
import ai from "./ai.mjs";
import macApps from "./mac-apps.mjs";

const REGISTRY = { ai, "mac-apps": macApps };

const cache = new Map();

/** Throw `Invalid domain pack: missing or empty "<key>"` on the first gap. */
export function validateDomain(pack) {
  const fail = (key) => {
    throw new Error(`Invalid domain pack: missing or empty "${key}"`);
  };
  if (!pack || typeof pack !== "object") fail("id");
  if (!pack.id) fail("id");
  if (!pack.name) fail("name");
  if (!Array.isArray(pack.sources) || pack.sources.length === 0)
    fail("sources");
  if (!pack.prompts?.analysis) fail("prompts.analysis");
  if (!pack.prompts?.digest) fail("prompts.digest");
  if (!Array.isArray(pack.panels) || pack.panels.length === 0) fail("panels");
  if (!Array.isArray(pack.stats) || pack.stats.length === 0) fail("stats");
  if (!Array.isArray(pack.nav) || pack.nav.length === 0) fail("nav");
  return pack;
}

/**
 * Return the pack for `id` (default: PULSE_DOMAIN env, fallback "ai").
 * Validated once, then cached by id — the same object is returned thereafter.
 */
export function loadDomain(id = env("PULSE_DOMAIN", "ai")) {
  if (cache.has(id)) return cache.get(id);
  const pack = REGISTRY[id];
  if (!pack) throw new Error(`Unknown domain pack: ${id}`);
  validateDomain(pack);
  cache.set(id, pack);
  return pack;
}

export function listDomains() {
  return Object.keys(REGISTRY);
}
