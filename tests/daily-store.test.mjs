import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("lib/newsletter/store.mjs — Brussels dayId", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-pulse-newsletter-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saveDailyEdition stamps an editionId in YYYY-MM-DD format", async () => {
    const { saveDailyEdition } = await import("../lib/newsletter/store.mjs");
    const saved = saveDailyEdition({
      dateOf: "September 10, 2026",
      tldr: "test",
      topStories: [],
      modelReleases: [],
      paperPick: {},
      communityBuzz: [],
    });
    expect(saved.editionId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(saved.generatedAt).toBeTruthy();
  });

  it("saveDailyEdition editionId matches todayBrussels()", async () => {
    const { saveDailyEdition } = await import("../lib/newsletter/store.mjs");
    const { todayBrussels } = await import("../lib/llm/budget.mjs");
    const saved = saveDailyEdition({
      tldr: "t",
      topStories: [],
      modelReleases: [],
      paperPick: {},
      communityBuzz: [],
    });
    expect(saved.editionId).toBe(todayBrussels());
  });

  it("loadLatestDailyEdition returns the saved edition with matching editionId", async () => {
    const { saveDailyEdition, loadLatestDailyEdition } = await import(
      "../lib/newsletter/store.mjs"
    );
    const { todayBrussels } = await import("../lib/llm/budget.mjs");
    saveDailyEdition({
      tldr: "hello",
      topStories: [],
      modelReleases: [],
      paperPick: {},
      communityBuzz: [],
    });
    const latest = loadLatestDailyEdition();
    expect(latest).not.toBeNull();
    expect(latest.editionId).toBe(todayBrussels());
    expect(latest.tldr).toBe("hello");
  });

  it("loadLatestDailyEdition returns null when nothing saved yet", async () => {
    const { loadLatestDailyEdition } = await import(
      "../lib/newsletter/store.mjs"
    );
    expect(loadLatestDailyEdition()).toBeNull();
  });
});
