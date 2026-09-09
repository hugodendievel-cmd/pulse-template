import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SOURCE_NAMES } from "../apis/briefing.mjs";
import example from "../domains/example.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

/**
 * Parse the NAME_TO_SLUG object literal from diag.mjs.
 *
 * diag.mjs is a top-level-await script that boots modules with side effects,
 * so we can't safely `import` it from a test. Parsing the literal is robust
 * enough for this guardrail. Slugs resolve pack-first (diag builds `slugOf`
 * from the active pack's `module` fields); NAME_TO_SLUG is legacy fallback.
 */
function loadNameToSlug() {
  const src = readFileSync(resolve(root, "diag.mjs"), "utf-8");
  const match = src.match(/const NAME_TO_SLUG\s*=\s*{([\s\S]*?)};/);
  if (!match) throw new Error("NAME_TO_SLUG literal not found in diag.mjs");
  const body = match[1];
  const entries = {};
  // Match: `"Key": "value",` OR `Key: "value",` (bare identifier keys like ArXiv)
  const entryRe = /(?:"([^"]+)"|([A-Za-z0-9_]+))\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = entryRe.exec(body)) !== null) {
    const key = m[1] ?? m[2];
    entries[key] = m[3];
  }
  return entries;
}

describe("diag.mjs source-slug resolution", () => {
  it("is pack-aware (builds slugOf from loadDomain().sources)", () => {
    const src = readFileSync(resolve(root, "diag.mjs"), "utf-8");
    expect(src).toContain("loadDomain()");
    expect(src).toContain("slugOf.get(name)");
  });

  it("every active SOURCE_NAME resolves via the pack's module fields", () => {
    const packModules = new Map(example.sources.map((s) => [s.name, s.module]));
    const missing = SOURCE_NAMES.filter(
      (name) => !packModules.has(name),
    );
    expect(missing).toEqual([]);
    for (const [name, slug] of packModules) {
      if (!SOURCE_NAMES.includes(name)) continue;
      expect(
        existsSync(resolve(root, "apis/sources", `${slug}.mjs`)),
        `apis/sources/${slug}.mjs`,
      ).toBe(true);
    }
  });

  it("legacy NAME_TO_SLUG fallback only maps modules that exist", () => {
    const mapping = loadNameToSlug();
    const broken = Object.entries(mapping).filter(
      ([, slug]) => !existsSync(resolve(root, "apis/sources", `${slug}.mjs`)),
    );
    expect(broken).toEqual([]);
  });
});
