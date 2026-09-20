// tests/newsletter-pipeline.test.mjs — lib/newsletter/pipeline.mjs (guards,
// happy path, budget) + server wiring assertions for the INTERNAL scheduler
// (no public POST trigger, no token machinery, GH cron workflow removed).
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

describe("newsletter generation — internal-only wiring (static)", () => {
  const src = readFileSync(resolve(root, "server.mjs"), "utf-8");

  it("POST trigger route is gone — generation is not publicly callable", () => {
    expect(src).not.toMatch(/app\.post\("\/api\/newsletter\/generate"/);
    expect(src).not.toMatch(/NEWSLETTER_TOKEN/);
    expect(src).not.toMatch(/newsletterTokenMatches/);
  });

  it("GET /api/newsletter stays available (read-only mirror)", () => {
    expect(src).toMatch(/app\.get\("\/api\/newsletter"/);
  });

  it("internal scheduler is wired in boot() via the shared pipeline", () => {
    expect(src).toMatch(/startNewsletterScheduler/);
    expect(src).toMatch(/generateDailyEditionPipeline/);
    expect(src).toMatch(/NEWSLETTER_RUN_AT/);
  });

  it("the GitHub Actions cron workflow was removed with the external trigger", () => {
    expect(existsSync(resolve(root, ".github/workflows/daily-newsletter.yml"))).toBe(
      false,
    );
  });

  it("health exposes persistence state for deploy diagnostics", () => {
    expect(src).toMatch(/dataDirConfigured/);
    expect(src).toMatch(/editions: listDailyEditions\(\)/);
  });
});

describe("generateDailyEditionPipeline", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-pulse-pipeline-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("../apis/briefing.mjs");
    vi.doUnmock("../lib/llm/daily-edition.mjs");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const OPTS = () => ({
    prompt: "P",
    freshSources: ["Hacker News"],
    cap: 100,
    broadcast: vi.fn(),
  });

  it("happy path: sweeps, increments budget, saves, broadcasts", async () => {
    const sweep = vi.fn(
      async () => ({ sources: [], sourcesOk: 0, timestamp: "t" }),
    );
    vi.doMock("../apis/briefing.mjs", () => ({
      runDigestSweep: sweep,
      runSweep: vi.fn(),
      SOURCE_COUNT: 12,
      SOURCE_NAMES: [],
    }));
    const generate = vi.fn(async () => ({
      tldr: "generated",
      topStories: [],
    }));
    vi.doMock("../lib/llm/daily-edition.mjs", () => ({
      generateDailyEdition: generate,
    }));

    const llm = { name: "t", model: "m", chat: vi.fn() };
    const { generateDailyEditionPipeline } = await import(
      "../lib/newsletter/pipeline.mjs"
    );
    const opts = OPTS();
    const outcome = await generateDailyEditionPipeline(llm, opts);

    expect(outcome.edition).toBeTruthy();
    expect(outcome.edition.editionId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sweep).toHaveBeenCalledWith({ days: 1 });
    expect(opts.broadcast).toHaveBeenCalledTimes(1);
    expect(opts.broadcast.mock.calls[0][0].type).toBe("newsletter");

    const budgetPath = join(
      tmpDir,
      ".pulse",
      "memory",
      "llm-budget.json",
    );
    expect(JSON.parse(readFileSync(budgetPath, "utf-8")).count).toBe(1);

    const { loadDailyEdition } = await import("../lib/newsletter/store.mjs");
    const { todayBrussels } = await import("../lib/llm/budget.mjs");
    expect(loadDailyEdition(todayBrussels())?.tldr).toBe("generated");
  });

  it("once-per-day: a second run is a no-op (no sweep, no budget spend)", async () => {
    const sweep = vi.fn(async () => ({ sources: [] }));
    vi.doMock("../apis/briefing.mjs", () => ({
      runDigestSweep: sweep,
      runSweep: vi.fn(),
      SOURCE_COUNT: 12,
      SOURCE_NAMES: [],
    }));
    vi.doMock("../lib/llm/daily-edition.mjs", () => ({
      generateDailyEdition: vi.fn(),
    }));

    const { saveDailyEdition, loadDailyEdition } = await import(
      "../lib/newsletter/store.mjs"
    );
    const { todayBrussels } = await import("../lib/llm/budget.mjs");
    saveDailyEdition({ tldr: "today", topStories: [] });

    const { generateDailyEditionPipeline } = await import(
      "../lib/newsletter/pipeline.mjs"
    );
    const outcome = await generateDailyEditionPipeline(
      { name: "t", model: "m" },
      OPTS(),
    );

    expect(outcome.skipped).toBe("already-generated");
    expect(outcome.editionId).toBe(todayBrussels());
    expect(sweep).not.toHaveBeenCalled();
    expect(loadDailyEdition(todayBrussels())?.tldr).toBe("today");
  });

  it("force bypasses the day guard (but not the budget)", async () => {
    const sweep = vi.fn(
      async () => ({ sources: [], sourcesOk: 0, timestamp: "t" }),
    );
    vi.doMock("../apis/briefing.mjs", () => ({
      runDigestSweep: sweep,
      runSweep: vi.fn(),
      SOURCE_COUNT: 12,
      SOURCE_NAMES: [],
    }));
    vi.doMock("../lib/llm/daily-edition.mjs", () => ({
      generateDailyEdition: vi.fn(async () => ({ tldr: "regen", topStories: [] })),
    }));

    const { saveDailyEdition } = await import("../lib/newsletter/store.mjs");
    saveDailyEdition({ tldr: "earlier", topStories: [] });

    const { generateDailyEditionPipeline } = await import(
      "../lib/newsletter/pipeline.mjs"
    );
    const outcome = await generateDailyEditionPipeline(
      { name: "t", model: "m" },
      { ...OPTS(), force: true },
    );

    expect(outcome.edition?.tldr).toBe("regen");
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it("budget exhausted: skips before sweeping", async () => {
    const sweep = vi.fn(async () => ({ sources: [] }));
    vi.doMock("../apis/briefing.mjs", () => ({
      runDigestSweep: sweep,
      runSweep: vi.fn(),
      SOURCE_COUNT: 12,
      SOURCE_NAMES: [],
    }));
    vi.doMock("../lib/llm/daily-edition.mjs", () => ({
      generateDailyEdition: vi.fn(),
    }));

    const budgetDir = join(tmpDir, ".pulse", "memory");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(budgetDir, { recursive: true });
    const { todayBrussels } = await import("../lib/llm/budget.mjs");
    writeFileSync(
      join(budgetDir, "llm-budget.json"),
      JSON.stringify({ day: todayBrussels(), count: 100 }),
    );

    const { generateDailyEditionPipeline, SKIP_REASONS } = await import(
      "../lib/newsletter/pipeline.mjs"
    );
    const outcome = await generateDailyEditionPipeline(
      { name: "t", model: "m" },
      OPTS(),
    );

    expect(outcome.skipped).toBe(SKIP_REASONS.budget);
    expect(sweep).not.toHaveBeenCalled();
  });

  it("missing llm or pack prompt is a loud misconfiguration", async () => {
    const { generateDailyEditionPipeline } = await import(
      "../lib/newsletter/pipeline.mjs"
    );
    await expect(generateDailyEditionPipeline(null, OPTS())).rejects.toThrow(
      /missing llm/,
    );
    await expect(
      generateDailyEditionPipeline({ name: "t", model: "m" }, {}),
    ).rejects.toThrow(/prompts\.daily/);
  });
});
