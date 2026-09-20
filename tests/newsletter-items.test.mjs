// tests/newsletter-items.test.mjs — lib/llm/items.mjs: source summary
// excerpts flow into the LLM pool (the fact-density lever), truncated and
// window-filtered deterministically.
import { describe, expect, it } from "vitest";

import { collectSourceItems, snippetOf } from "../lib/llm/items.mjs";

const WINDOW_1D = 24 * 60 * 60 * 1000;
const fresh24h = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

function collect(sweep, { freshSources = [], windowMs = WINDOW_1D } = {}) {
  const seen = new Set();
  const sourceMap = {};
  collectSourceItems(sweep, seen, sourceMap, new Set(freshSources), windowMs);
  return sourceMap;
}

describe("snippetOf", () => {
  it("collapses whitespace and prefers description, then summary/content", () => {
    expect(snippetOf({ description: " a\n\n b   c " })).toBe("a b c");
    expect(snippetOf({ summary: "from summary" })).toBe("from summary");
    expect(snippetOf({ content: "from content" })).toBe("from content");
    expect(snippetOf({})).toBe("");
  });

  it("truncates long excerpts with an ellipsis at the 200-char cap", () => {
    const long = "x".repeat(500);
    const out = snippetOf({ description: long });
    expect(out).toHaveLength(200);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("collectSourceItems — excerpts in the pool", () => {
  it("appends the source excerpt so the LLM has facts, not just headlines", () => {
    const sourceMap = collect({
      sources: [
        {
          source: "TechCrunch",
          status: "ok",
          data: {
            items: [
              {
                title: "Arcee AI hits unicorn status",
                url: "https://example.com/arcee",
                published: fresh24h(),
                description:
                  "The startup reached a $1B valuation after training four models for $20M.",
              },
            ],
          },
        },
      ],
    });

    expect(sourceMap.TechCrunch).toHaveLength(1);
    expect(sourceMap.TechCrunch[0]).toContain("Arcee AI hits unicorn status");
    expect(sourceMap.TechCrunch[0]).toContain("https://example.com/arcee");
    expect(sourceMap.TechCrunch[0]).toContain("$1B valuation");
  });

  it("omits the excerpt separator when the source has no description", () => {
    const sourceMap = collect({
      sources: [
        {
          source: "TechCrunch",
          status: "ok",
          data: {
            items: [
              {
                title: "Bare feed item",
                url: "https://example.com/bare",
                published: fresh24h(),
              },
            ],
          },
        },
      ],
    });

    const line = sourceMap.TechCrunch[0];
    expect(line).toMatch(/^Bare feed item \[\d{4}-\d{2}-\d{2}\] \| https:\/\/example\.com\/bare$/);
  });

  it("still filters out dated items outside the window", () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const sourceMap = collect({
      sources: [
        {
          source: "TechCrunch",
          status: "ok",
          data: {
            items: [
              { title: "Too old", published: old, url: "", description: "x" },
            ],
          },
        },
      ],
    });

    expect(sourceMap.TechCrunch).toEqual([]);
  });
});
