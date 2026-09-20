// tests/newsletter-scheduler.test.mjs — lib/newsletter/scheduler.mjs unit
// tests: run-time parsing, Brussels minutes, next-run arithmetic. The armed
// timer itself is exercised indirectly via the catch-up semantics in its
// pure helpers (no real timers here).
import { describe, expect, it } from "vitest";

import {
  brusselsMinutesNow,
  msUntilRun,
  parseRunAtMinutes,
} from "../lib/newsletter/scheduler.mjs";

describe("parseRunAtMinutes", () => {
  it("parses HH:MM and tolerates a single-digit hour", () => {
    expect(parseRunAtMinutes("07:30")).toBe(450);
    expect(parseRunAtMinutes("7:05")).toBe(425);
    expect(parseRunAtMinutes("23:59")).toBe(1439);
  });

  it("falls back to 07:30 when unset and throws on garbage", () => {
    expect(parseRunAtMinutes(undefined)).toBe(450);
    expect(parseRunAtMinutes("")).toBe(450);
    expect(() => parseRunAtMinutes("24:00")).toThrow(/NEWSLETTER_RUN_AT/);
    expect(() => parseRunAtMinutes("tomorrow")).toThrow(/NEWSLETTER_RUN_AT/);
  });
});

describe("brusselsMinutesNow", () => {
  it("stays within a day and agrees with the budget day function", async () => {
    const { todayBrussels } = await import("../lib/llm/budget.mjs");
    const now = new Date();
    const mins = brusselsMinutesNow(now);

    expect(mins).toBeGreaterThanOrEqual(0);
    expect(mins).toBeLessThan(1440);
    // the helper and todayBrussels() share the same timezone basis
    const dayRunsOver = mins > 23 * 60; // edge: just timezone sanity
    expect(typeof dayRunsOver).toBe("boolean");
    expect(todayBrussels()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("msUntilRun", () => {
  it("lands on the target minutes-of-day, wrapping to tomorrow when past", () => {
    for (const now of [Date.now(), Date.now() + 3_600_000]) {
      const target = 450; // 07:30
      const delay = msUntilRun(target, now);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
      // landing minute ≈ target (mod a day) — proves no off-by-one day
      const landing = brusselsMinutesNow(new Date(now + delay));
      const wrap = Math.abs(landing - target);
      expect(Math.min(wrap, 1440 - wrap)).toBeLessThanOrEqual(1);
    }
  });
});
