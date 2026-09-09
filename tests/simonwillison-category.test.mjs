// tests/simonwillison-category.test.mjs — Pack ↔ source consistency for the
// blog panel (rewritten in 2.4: panels are pack data now, not HTML markup).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import ai from "../domains/ai.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const source = readFileSync(
  resolve(root, "apis/sources/simonwillison.mjs"),
  "utf-8",
);

describe("Simon Willison category/panel consistency", () => {
  it("source file exports category: community", () => {
    expect(source).toMatch(/category:\s*["']community["']/);
  });

  it("ai pack has a community blog panel bound to the source by name", () => {
    const panel = ai.panels.find((p) => p.id === "blog");
    expect(panel).toBeDefined();
    expect(panel.section).toBe("community");
    expect(panel.sources).toEqual(["Simon Willison"]);
  });

  it("pack panel section and source category both equal community", () => {
    const sourceCategory = source.match(/category:\s*["'](\w+)["']/)?.[1];
    const panelSection = ai.panels.find((p) => p.id === "blog")?.section;
    expect(sourceCategory).toBe(panelSection);
  });
});
