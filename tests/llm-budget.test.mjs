import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("lib/llm/budget.mjs", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-pulse-budget-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("todayBrussels() returns a YYYY-MM-DD string", async () => {
    const { todayBrussels } = await import("../lib/llm/budget.mjs");
    expect(todayBrussels()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("loadBudget() with no file returns {day: todayBrussels(), count: 0} without warn", async () => {
    const log = (await import("../lib/logger.mjs")).default;
    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    const { loadBudget, todayBrussels } = await import("../lib/llm/budget.mjs");

    const result = loadBudget();

    expect(result).toEqual({ day: todayBrussels(), count: 0 });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("loadBudget() on corrupt JSON returns default and logs pino.warn", async () => {
    const memDir = join(tmpDir, ".pulse", "memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, "llm-budget.json"), "not-valid-json{{{");

    const log = (await import("../lib/logger.mjs")).default;
    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    const { loadBudget, todayBrussels } = await import("../lib/llm/budget.mjs");

    const result = loadBudget();

    expect(result).toEqual({ day: todayBrussels(), count: 0 });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][1]).toMatch(/corrupt|unreadable/i);
  });

  it("loadBudget() on wrong-shape JSON returns default and logs pino.warn", async () => {
    const memDir = join(tmpDir, ".pulse", "memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(
      join(memDir, "llm-budget.json"),
      JSON.stringify({ foo: "bar" }),
    );

    const log = (await import("../lib/logger.mjs")).default;
    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    const { loadBudget, todayBrussels } = await import("../lib/llm/budget.mjs");

    const result = loadBudget();

    expect(result).toEqual({ day: todayBrussels(), count: 0 });
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("incrementBudget() × 3 returns count=3 and persists to disk", async () => {
    const { incrementBudget } = await import("../lib/llm/budget.mjs");
    incrementBudget();
    incrementBudget();
    const result = incrementBudget();
    expect(result.count).toBe(3);

    // Fresh module re-read must see 3 (simulates a process restart)
    vi.resetModules();
    const { loadBudget: loadFresh } = await import("../lib/llm/budget.mjs");
    expect(loadFresh().count).toBe(3);
  });

  it("loadBudget() resumes at persisted count when today matches", async () => {
    // Simulates AC: "80 LLM calls made today, when the server restarts, then llmCallsToday resumes at 80"
    const { incrementBudget, todayBrussels } = await import(
      "../lib/llm/budget.mjs"
    );
    for (let i = 0; i < 5; i++) incrementBudget();

    vi.resetModules();
    const { loadBudget: loadFresh } = await import("../lib/llm/budget.mjs");
    expect(loadFresh()).toEqual({ day: todayBrussels(), count: 5 });
  });

  it("incrementBudget() resets to 1 when stored day is yesterday (Brussels rollover)", async () => {
    // Write a budget file with a stale day value — the rollover path is
    // triggered purely by the stored `day` not matching `todayBrussels()`.
    const memDir = join(tmpDir, ".pulse", "memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(
      join(memDir, "llm-budget.json"),
      JSON.stringify({ day: "1999-01-01", count: 5 }),
    );

    const { incrementBudget, todayBrussels } = await import(
      "../lib/llm/budget.mjs"
    );

    const result = incrementBudget();
    expect(result.count).toBe(1);
    expect(result.day).toBe(todayBrussels());
    expect(result.day).not.toBe("1999-01-01");
  });

  it("loadBudget() mid-process Brussels midnight rollover applies without restart", async () => {
    // AC: Brussels day boundary crosses mid-process, next read sees a fresh counter.
    // Simulated by writing a stale-day file after incrementing today's counter —
    // no restart, same module instance.
    const { incrementBudget, loadBudget, todayBrussels } = await import(
      "../lib/llm/budget.mjs"
    );
    incrementBudget();
    incrementBudget();
    expect(loadBudget().count).toBe(2);

    // Simulate the clock crossing midnight: the on-disk `day` is no longer
    // today. Same module instance (no reset).
    const budgetPath = join(tmpDir, ".pulse", "memory", "llm-budget.json");
    writeFileSync(
      budgetPath,
      JSON.stringify({ day: "1999-01-01", count: 2 }),
    );

    const rolled = loadBudget();
    expect(rolled.count).toBe(0);
    expect(rolled.day).toBe(todayBrussels());
  });

  it("isBudgetExhausted({cap:3}) is false at count=2, true at count=3 with skipReason", async () => {
    const { incrementBudget, isBudgetExhausted } = await import(
      "../lib/llm/budget.mjs"
    );
    incrementBudget();
    incrementBudget();
    const below = isBudgetExhausted({ cap: 3 });
    expect(below.exhausted).toBe(false);
    expect(below.count).toBe(2);
    expect(below.cap).toBe(3);
    expect(below.skipReason).toBeUndefined();

    incrementBudget();
    const at = isBudgetExhausted({ cap: 3 });
    expect(at.exhausted).toBe(true);
    expect(at.count).toBe(3);
    expect(at.cap).toBe(3);
    expect(at.skipReason).toBe("Daily LLM budget exhausted");
  });

  it("incrementBudget() writes atomically: no stale .tmp, file is valid JSON", async () => {
    const { incrementBudget } = await import("../lib/llm/budget.mjs");
    incrementBudget();

    const tmpPath = join(tmpDir, ".pulse", "memory", "llm-budget.json.tmp");
    const finalPath = join(tmpDir, ".pulse", "memory", "llm-budget.json");

    expect(existsSync(tmpPath)).toBe(false);
    expect(existsSync(finalPath)).toBe(true);

    const content = JSON.parse(readFileSync(finalPath, "utf-8"));
    expect(content).toMatchObject({ day: expect.any(String), count: 1 });
  });
});
