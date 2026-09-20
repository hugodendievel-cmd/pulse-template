import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("lib/delta/memory.mjs", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-pulse-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("importing the module does NOT create .pulse/ in cwd", async () => {
    await import("../lib/delta/memory.mjs");
    expect(existsSync(join(tmpDir, ".pulse"))).toBe(false);
  });

  it("getPrevious() before any pushSweep returns undefined and does not create a directory", async () => {
    const { getPrevious } = await import("../lib/delta/memory.mjs");
    const result = getPrevious();
    expect(result).toBeUndefined();
    expect(existsSync(join(tmpDir, ".pulse"))).toBe(false);
  });

  it("getLatest() before any pushSweep returns undefined and does not create a directory", async () => {
    const { getLatest } = await import("../lib/delta/memory.mjs");
    const result = getLatest();
    expect(result).toBeUndefined();
    expect(existsSync(join(tmpDir, ".pulse"))).toBe(false);
  });

  it("first pushSweep creates the directory lazily and writes hot.json", async () => {
    const { pushSweep, getLatest } = await import("../lib/delta/memory.mjs");
    const sweep = { timestamp: "2026-04-18T00:00:00.000Z", sources: [] };
    pushSweep(sweep);
    expect(existsSync(join(tmpDir, ".pulse", "memory"))).toBe(true);
    expect(existsSync(join(tmpDir, ".pulse", "memory", "hot.json"))).toBe(
      true,
    );
    expect(getLatest()).toEqual(sweep);
  });

  it("re-importing in a fresh module context after a prior sweep reads the persisted file", async () => {
    const sweep = { timestamp: "2026-04-18T00:00:00.000Z", sources: [] };
    const { pushSweep } = await import("../lib/delta/memory.mjs");
    pushSweep(sweep);

    vi.resetModules();
    const { getLatest } = await import("../lib/delta/memory.mjs");
    expect(getLatest()).toEqual(sweep);
  });

  it("exports ensureMemoryDir which creates the memory directory", async () => {
    const { ensureMemoryDir } = await import("../lib/delta/memory.mjs");
    expect(existsSync(join(tmpDir, ".pulse"))).toBe(false);
    ensureMemoryDir();
    expect(existsSync(join(tmpDir, ".pulse", "memory"))).toBe(true);
  });
});
