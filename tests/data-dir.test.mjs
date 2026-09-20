// tests/data-dir.test.mjs — PULSE_DATA_DIR override: production mounts a
// persistent volume so editions/digests/budget survive Railway redeploys.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("PULSE_DATA_DIR — runtime data root", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-pulse-data-dir-"));
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PULSE_DATA_DIR;
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("defaults to <cwd>/.pulse", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    const { pulseDataDir, pulsePath } = await import("../lib/data-dir.mjs");

    expect(pulseDataDir()).toBe(join(tmpDir, ".pulse"));
    expect(pulsePath("newsletters")).toBe(
      join(tmpDir, ".pulse", "newsletters"),
    );
  });

  it("PULSE_DATA_DIR overrides the cwd base", async () => {
    process.env.PULSE_DATA_DIR = tmpDir;
    const { pulsePath } = await import("../lib/data-dir.mjs");

    expect(pulsePath("newsletters")).toBe(
      join(tmpDir, ".pulse", "newsletters"),
    );
  });

  it("editions, digests, sweeps and the LLM budget all persist under the override", async () => {
    process.env.PULSE_DATA_DIR = tmpDir;

    const { saveDailyEdition } = await import("../lib/newsletter/store.mjs");
    const { saveDigest } = await import("../lib/digest/store.mjs");
    const { incrementBudget } = await import("../lib/llm/budget.mjs");
    const { pushSweep } = await import("../lib/delta/memory.mjs");

    saveDailyEdition({ tldr: "edition", topStories: [] });
    saveDigest({ tldr: "digest" });
    incrementBudget();
    pushSweep({ timestamp: "t", sources: [] });

    const base = join(tmpDir, ".pulse");
    expect(existsSync(join(base, "newsletters", "latest.json"))).toBe(true);
    expect(existsSync(join(base, "digests", "latest.json"))).toBe(true);
    expect(existsSync(join(base, "memory", "llm-budget.json"))).toBe(true);
    expect(existsSync(join(base, "memory", "hot.json"))).toBe(true);
  });
});
