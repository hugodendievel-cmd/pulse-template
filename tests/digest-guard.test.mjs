import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

describe("digest guard — server.mjs wiring (static)", () => {
  const src = readFileSync(resolve(root, "server.mjs"), "utf-8");

  it("imports weekIdBrussels from lib/digest/week-id.mjs", () => {
    expect(src).toMatch(/from\s+"\.\/lib\/digest\/week-id\.mjs"/);
    expect(src).toMatch(/weekIdBrussels/);
  });

  it("no longer uses the once-per-calendar-day 429 guard", () => {
    expect(src).not.toMatch(
      /Digest already generated today\. Try again tomorrow\./,
    );
    // The 429 in the route should only be for the LLM budget cap, not the
    // once-per-day guard. The toDateString()-based comparison must be gone.
    expect(src).not.toMatch(/generatedDate\s*===\s*new Date\(\)\.toDateString/);
  });

  it("guard returns 409 with existing metadata when weekId matches", () => {
    // The new guard: latest?.weekId === currentWeekId → 409 { existing: {...} }
    expect(src).toMatch(/latest\?\.weekId\s*===\s*currentWeekId/);
    expect(src).toMatch(/status\(409\)/);
    expect(src).toMatch(/existing:/);
  });

  it("honours ?force=1 to skip the once-per-week guard", () => {
    expect(src).toMatch(/req\.query\.force\s*===\s*"1"/);
  });

  it("route signature accepts req (not _req) so req.query is accessible", () => {
    expect(src).toMatch(
      /app\.post\(\s*"\/api\/digest\/generate"\s*,\s*async\s*\(\s*req\s*,/,
    );
  });

  it("digestGenerating mutex and budget cap guards are preserved", () => {
    expect(src).toMatch(/digestGenerating/);
    expect(src).toMatch(/isBudgetExhausted\(\{\s*cap:\s*MAX_LLM_CALLS_PER_DAY/);
  });
});

describe("digest guard — weekId-based once-per-week logic", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-pulse-guard-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadLatestDigest returns null when no digest saved — guard should proceed", async () => {
    const { loadLatestDigest } = await import("../lib/digest/store.mjs");
    expect(loadLatestDigest()).toBeNull();
    // Guard precondition: latest?.weekId === currentWeekId → false → proceed
  });

  it("saved digest weekId matches weekIdBrussels — guard would fire for same week", async () => {
    const { saveDigest, loadLatestDigest } = await import(
      "../lib/digest/store.mjs"
    );
    const { weekIdBrussels } = await import("../lib/digest/week-id.mjs");

    saveDigest({
      tldr: "t",
      highlights: [],
      modelUpdates: [],
      paperPicks: [],
      communityBuzz: [],
      lookAhead: "",
    });
    const latest = loadLatestDigest();
    const currentWeekId = weekIdBrussels();

    expect(latest.weekId).toBe(currentWeekId);
    // Guard condition: latest.weekId === currentWeekId → true → return 409
  });

  it("stale weekId on disk — guard should not fire (different weekId)", async () => {
    const { saveDigest, loadLatestDigest } = await import(
      "../lib/digest/store.mjs"
    );
    const { weekIdBrussels } = await import("../lib/digest/week-id.mjs");

    saveDigest({
      tldr: "t",
      highlights: [],
      modelUpdates: [],
      paperPicks: [],
      communityBuzz: [],
      lookAhead: "",
    });
    const latest = loadLatestDigest();
    const current = weekIdBrussels();

    // Simulate a different current week by comparing against a known-different id.
    const stale = "2099-W52";
    expect(latest.weekId).not.toBe(stale);
    expect(current).not.toBe(stale);
    // Guard condition: latest.weekId !== stale → proceed
  });

  it("dashboard/public/app.js handles 409 without showError and re-renders the digest", () => {
    const appSrc = readFileSync(
      resolve(root, "dashboard", "public", "app.js"),
      "utf-8",
    );
    // 409 branch exists
    expect(appSrc).toMatch(/res\.status\s*===\s*409/);
    // Uses existing digest metadata, merged over the last digest
    expect(appSrc).toMatch(/payload\.existing/);
    expect(appSrc).toMatch(
      /renderDigest\(\{\s*\.\.\.lastDigest,\s*\.\.\.payload\.existing\s*\}\)/,
    );
    // Surfaced as a state note, not an error banner
    expect(appSrc).not.toMatch(/showError\([^)]*payload\.existing/);
  });

  it("409 body shape includes existing.generatedAt, existing.weekId, existing.weekOf", async () => {
    // Model the body the handler builds from loadLatestDigest().
    const { saveDigest, loadLatestDigest } = await import(
      "../lib/digest/store.mjs"
    );
    saveDigest({
      tldr: "t",
      highlights: [],
      modelUpdates: [],
      paperPicks: [],
      communityBuzz: [],
      lookAhead: "",
      weekOf: "2026-04-13",
    });
    const latest = loadLatestDigest();

    const body = {
      error: `Digest already generated for ${latest.weekId}`,
      existing: {
        generatedAt: latest.generatedAt,
        weekId: latest.weekId,
        weekOf: latest.weekOf ?? null,
      },
    };

    expect(body.existing.generatedAt).toBeTruthy();
    expect(body.existing.weekId).toMatch(/^\d{4}-W\d{2}$/);
    expect(body.existing.weekOf).toBe("2026-04-13");
  });
});

describe("digest guard — client presentation contract (Story 5.2)", () => {
  const appSrc = readFileSync(
    resolve(root, "dashboard", "public", "app.js"),
    "utf-8",
  );

  it("seeds currentWeekId from /api/health", () => {
    expect(appSrc).toMatch(/currentWeekId:\s*""/);
    expect(appSrc).toMatch(/state\.currentWeekId\s*=\s*h\?\.currentWeekId/);
  });

  it("surfaces the once-per-week guard as a render-time note", () => {
    // Deterministic note on render when the digest belongs to the current week.
    expect(appSrc).toMatch(
      /lastDigest\.weekId\s*===\s*state\.currentWeekId/,
    );
    expect(appSrc).toContain("already generated this week");
  });

  it("never sends the operator-only force query", () => {
    expect(appSrc).not.toContain("force=1");
    expect(appSrc).not.toMatch(/[?&]force/);
  });

  it("keeps the regeneration request POST-only", () => {
    expect(appSrc).toMatch(
      /fetch\("\/api\/digest\/generate",\s*\{\s*method:\s*"POST"\s*\}\)/,
    );
  });

  it("disables the control while generation is in flight", () => {
    expect(appSrc).toMatch(/btn\.disabled\s*=\s*true/);
    expect(appSrc).toContain("digest-loading");
  });

  it("a failure restores the last digest instead of clearing content", () => {
    // showError re-renders lastDigest before prepending the transient notice.
    expect(appSrc).toMatch(
      /function showError\(msg\)\s*\{[\s\S]*?if \(lastDigest\) \{\s*renderDigest\(lastDigest\);/,
    );
  });

  it("renders no accumulating-draft UI (deferred scope)", () => {
    expect(appSrc).not.toContain("daysCollected");
    expect(appSrc).not.toContain("shaping up");
    expect(appSrc).not.toContain("read draft");
    expect(appSrc).not.toMatch(/weekday/i);
  });

  it("labels the weekly card with the ISO week and the pack run time (AC6)", () => {
    // Label is derived from the pure helper and the pack's `weeklyRun`, never
    // from `weekOf` (a date string) or duplicated ISO arithmetic.
    expect(appSrc).toMatch(/RenderCore\.weekNumberOf\(digest\.weekId\)/);
    // The card's label row carries it once, via the panel header meta — the
    // toolbar used to repeat the same string directly beneath it.
    expect(appSrc).toMatch(/week \$\{weekNo\} · \$\{runLabel\}/);
    expect(appSrc).not.toContain('class="digest-toolbar"');
    // Empty state: `sun 18:00 · next run`.
    expect(appSrc).toMatch(/\$\{esc\(p\.weeklyRun \|\| ""\)\} · next run/);
    // Lowercase signature chrome, both controls.
    expect(appSrc).toContain("generate weekly digest");
    expect(appSrc).toContain(">regenerate</button>");
  });

  it("renders the digest body on a successful generate (AC1)", () => {
    expect(appSrc).toMatch(
      /if \(res\.ok\) \{\s*const digest = await res\.json\(\);\s*renderDigest\(digest\);/,
    );
  });

  it("gives the weekly digest body the green-tint card surface (AC1)", () => {
    const css = readFileSync(
      resolve(root, "dashboard", "public", "style.css"),
      "utf-8",
    );
    expect(css).toMatch(
      /\.panel\[data-panel-id="digest"\] \.digest-body\s*\{[^}]*background:\s*var\(--green-tint\)/,
    );
  });
});
