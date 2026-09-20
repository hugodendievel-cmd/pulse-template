import { describe, expect, it } from "vitest";

import { SOURCE_COUNT, SOURCE_NAMES } from "../apis/briefing.mjs";

describe("apis/briefing.mjs exports", () => {
  it("SOURCE_COUNT equals SOURCE_NAMES.length", () => {
    expect(SOURCE_COUNT).toBe(SOURCE_NAMES.length);
  });

  it("SOURCE_COUNT is 4", () => {
    // Canary: if a source is added or removed without updating this test,
    // the test fails and forces a deliberate count update.
    expect(SOURCE_COUNT).toBe(4);
  });

  it("SOURCE_NAMES includes the generic wire feeds", () => {
    expect(SOURCE_NAMES).toContain("Tech News");
    expect(SOURCE_NAMES).toContain("Google News");
  });
});
