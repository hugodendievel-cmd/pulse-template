// tests/source-category-consistency.test.mjs — Pack ↔ source consistency:
// a panel bound by `sources: [...]` must sit in the nav section matching the
// module's category, so filtering behaves as the pack author intends.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import example from "../domains/example.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function readSource(slug) {
  return readFileSync(resolve(root, "apis/sources", `${slug}.mjs`), "utf-8");
}

describe("example pack — source category / panel section consistency", () => {
  it("techcrunch module (used as the generic RSS module) reports category: news", () => {
    expect(readSource("techcrunch")).toMatch(/category:\s*["']news["']/);
  });

  it("the Tech News panel binds by name and matches the module category", () => {
    const panel = example.panels.find((p) => p.id === "technews");
    expect(panel).toBeDefined();
    expect(panel.sources).toEqual(["Tech News"]);
    const sourceCategory = readSource("techcrunch").match(
      /category:\s*["'](\w+)["']/,
    )?.[1];
    expect(panel.section).toBe(sourceCategory);
  });
});
