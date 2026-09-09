import { describe, expect, it } from "vitest";

import { SOURCE_COUNT, SOURCE_NAMES } from "../apis/briefing.mjs";
import example from "../domains/example.mjs";

describe("apis/briefing.mjs exports", () => {
  it("SOURCE_COUNT equals SOURCE_NAMES.length", () => {
    expect(SOURCE_COUNT).toBe(SOURCE_NAMES.length);
  });

  it("matches the default (example) pack", () => {
    // Canary: the orchestrator derives its source list from the active pack;
    // if pack and briefing drift apart, this fails and forces a check.
    expect(SOURCE_NAMES).toEqual(example.sources.map((s) => s.name));
  });

  it("SOURCE_NAMES includes the example pack's core sources", () => {
    expect(SOURCE_NAMES).toContain("Hacker News");
    expect(SOURCE_NAMES).toContain("GitHub Trending");
  });
});
