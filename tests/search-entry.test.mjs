// tests/search-entry.test.mjs — Story 6.9: search entry point contract.
// Source-scan + pure pack assertions: no DOM, no server boot. The placeholder
// text lives in the pack; the engine only understands the `{n}` token.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import example from "../domains/example.mjs";
import { normalizeViews } from "../domains/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const app = readFileSync(resolve(root, "dashboard/public/app.js"), "utf-8");
const html = readFileSync(
  resolve(root, "dashboard/public/index.html"),
  "utf-8",
);

describe("pack searchPlaceholder (Story 6.9)", () => {
  it("carries a searchPlaceholder on every view", () => {
    for (const view of example.views) {
      expect(view.searchPlaceholder, view.id).toBeTruthy();
    }
  });

  it("shows the {n} count on today and a literal filter on streams", () => {
    const byId = Object.fromEntries(example.views.map((v) => [v.id, v]));
    expect(byId.today.searchPlaceholder).toBe("search {n} signals…");
    expect(byId.streams.searchPlaceholder).toBe("filter streams…");
    expect(byId.editions.searchPlaceholder).toBe("search editions…");
  });

  it("survives normalizeViews (the /api/domain field is not whitelisted away)", () => {
    for (const view of normalizeViews(example)) {
      expect(view.searchPlaceholder, view.id).toBeTruthy();
    }
  });
});

describe("client placeholder wiring (Story 6.9)", () => {
  it("app.js applies the pack template and substitutes {n}", () => {
    expect(app).toContain("applySearchPlaceholder");
    expect(app).toContain("searchPlaceholder");
    expect(app).toContain("{n}");
    // Count derived from data through the pure collector, never hardcoded.
    expect(app).toContain("collectItems(");
    expect(app).toContain("searchTriggerLabel");
    expect(app).toContain("commandInput");
  });

  it("setView and applyData both refresh the placeholder", () => {
    const setViewBody = app.match(/function setView\(id\)[\s\S]*?\n\}/)?.[0] ?? "";
    const applyDataBody =
      app.match(/function applyData\(nextData\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(setViewBody).toContain("applySearchPlaceholder(");
    expect(applyDataBody).toContain("applySearchPlaceholder(");
  });

  it("index.html gives the trigger label a stable id", () => {
    expect(html).toContain('id="searchTriggerLabel"');
  });

  it("keeps the placeholder text in the pack, never in the engine", () => {
    expect(app).not.toContain("search {n} signals");
    expect(app).not.toContain("filter streams");
    expect(app).not.toContain("search editions");
  });
});

describe("palette behaviour preserved (Story 6.9)", () => {
  it("keeps the ⌘K toggle, Esc close, overlay-click close and .open door", () => {
    expect(app).toContain('classList.add("open")');
    expect(app).toContain('classList.remove("open")');
    expect(app).toContain("metaKey || e.ctrlKey");
    expect(app).toContain('e.key === "k"');
    expect(app).toContain('e.key === "Escape"');
    expect(app).toContain("e.target === overlay");
  });

  it("still opens the palette from the header trigger click", () => {
    // AC1: clicking/focusing the header field opens search. Scope the trigger
    // binding to initSearch's `open` handler so an unrelated click handler
    // elsewhere cannot satisfy it.
    expect(app).toMatch(
      /const trigger = document\.getElementById\("searchTrigger"\)[\s\S]*?trigger\.addEventListener\("click", open\)/,
    );
  });

  it("keeps the results-panel contract (first 12, data-url new tab)", () => {
    expect(app).toContain("slice(0, 12)");
    expect(app).toContain("command-result-item");
    expect(app).toContain("data-url=");
    expect(app).toContain('window.open(url, "_blank"');
  });
});

describe("GitHub repo name search (Story 6.9)", () => {
  it("collectSearchItems matches name as well as title", () => {
    expect(app).toContain("item.title || item.name");
  });

  it("keeps results semantics: model id branch and the 20-item cap", () => {
    // Bind to the exact branch, not a bare "m.id" substring: unrelated usages
    // like `item.id` also contain "m.id" and would mask a deleted model branch.
    expect(app).toContain("m.id?.toLowerCase().includes(q)");
    // One cap per collection: items and models are each sliced to 20.
    expect(app.match(/slice\(0, 20\)/g) ?? []).toHaveLength(2);
  });
});
