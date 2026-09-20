import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SOURCE_NAMES } from "../apis/briefing.mjs";
import { loadDomain } from "../domains/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

describe("diag.mjs source mapping", () => {
  it("resolves every SOURCE_NAME to an existing module under apis/sources/", () => {
    const pack = loadDomain();
    for (const name of SOURCE_NAMES) {
      const source = pack.sources.find((s) => s.name === name);
      expect(source, `no pack source for "${name}"`).toBeTruthy();
      expect(
        existsSync(resolve(root, "apis/sources", `${source.module}.mjs`)),
        `apis/sources/${source.module}.mjs`,
      ).toBe(true);
    }
  });

  it("derives slugs from the active pack rather than a restated static map", () => {
    // diag.mjs is a top-level-await script that boots modules with side effects,
    // so we assert on its source instead of importing it.
    const src = readFileSync(resolve(root, "diag.mjs"), "utf-8");
    expect(src).toContain("loadDomain");
    expect(src).toContain("slugOf");
  });
});
