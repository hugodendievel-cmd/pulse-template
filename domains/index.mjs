// domains/index.mjs — Domain pack loader: PULSE_DOMAIN env selects the active pack
// Synchronous over a static registry so apis/briefing.mjs can keep exporting
// SOURCE_COUNT / SOURCE_NAMES as plain constants at import time.
// Adding a pack = one new file in domains/ + one registry line.
import { env } from "../apis/utils/env.mjs";
import example from "./example.mjs";

const REGISTRY = { example };

const cache = new Map();

export const DEFAULT_LAYOUT = "grid";
export const LAYOUTS = ["main-rail", "grid", "reader"];

/** `Invalid domain pack: missing or empty "<key>"`. */
const missing = (key) =>
  new Error(`Invalid domain pack: missing or empty "${key}"`);

/** Throw `Invalid domain pack: missing or empty "<key>"` on the first gap. */
export function validateDomain(pack) {
  const fail = (key) => {
    throw missing(key);
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
  if (!Array.isArray(pack.views) && !Array.isArray(pack.nav)) fail("views|nav");
  return pack;
}

/**
 * Return a new views array for `pack`. Packs with `views` only get `layout`
 * defaulted; legacy `nav`-only packs derive one view per nav filter.
 * Pure — the input pack is not mutated.
 */
export function normalizeViews(pack) {
  if (Array.isArray(pack?.views)) {
    return pack.views.map((view) => {
      const next = { ...view, layout: view.layout ?? DEFAULT_LAYOUT };
      // Copy the membership arrays so normalized views never share state with
      // the caller's pack (guidance: copy sections/panels arrays when present).
      if (Array.isArray(view.sections)) next.sections = [...view.sections];
      if (Array.isArray(view.panels)) next.panels = [...view.panels];
      if (Array.isArray(view.fallbackPanels))
        next.fallbackPanels = [...view.fallbackPanels];
      return next;
    });
  }
  if (Array.isArray(pack?.nav)) {
    const fallbackPanels = Array.isArray(pack.panels)
      ? pack.panels.map((p) => p.id)
      : [];
    return pack.nav.map((nav, i) => {
      const view = {
        id: nav.filter,
        label: nav.label,
        layout: DEFAULT_LAYOUT,
        fallbackPanels: [...fallbackPanels],
      };
      if (nav.filter !== "all") view.sections = [nav.filter];
      if (i === 0) view.default = true;
      return view;
    });
  }
  throw missing("views|nav");
}

/**
 * Panels belonging to `viewId`, in `panels[]` order. A view selects by
 * `sections` membership or explicit `panels` ids; a view with neither contains
 * every panel. Unknown view id returns [].
 */
export function viewPanels(views, panels, viewId) {
  const view = (views ?? []).find((v) => v.id === viewId);
  if (!view) return [];
  const byPanels = Array.isArray(view.panels);
  const bySections = Array.isArray(view.sections);
  if (!byPanels && !bySections) return panels;
  // §2.1 membership is a union: a panel belongs when its section is listed OR
  // its id is listed. Both lists may be present on the same view.
  return panels.filter(
    (p) =>
      (byPanels && view.panels.includes(p.id)) ||
      (bySections && view.sections.includes(p.section)),
  );
}

/**
 * Return the pack for `id` (default: PULSE_DOMAIN env, fallback "example").
 * Validated once, then cached by id — the same object is returned thereafter.
 */
export function loadDomain(id = env("PULSE_DOMAIN", "example")) {
  if (cache.has(id)) return cache.get(id);
  const pack = REGISTRY[id];
  if (!pack) throw new Error(`Unknown domain pack: ${id}`);
  validateDomain(pack);
  if (!Array.isArray(pack.views)) pack.views = normalizeViews(pack);
  cache.set(id, pack);
  return pack;
}

export function listDomains() {
  return Object.keys(REGISTRY);
}
