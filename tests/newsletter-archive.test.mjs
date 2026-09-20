// tests/newsletter-archive.test.mjs — /newsletter page wiring (static source
// scan, mirroring domain-endpoint.test.mjs) + store list/load-per-id units
// (tmp cwd, no server boot).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

describe("newsletter archive pages — server.mjs wiring (static)", () => {
  const src = readFileSync(resolve(root, "server.mjs"), "utf-8");
  const index = readFileSync(
    resolve(root, "dashboard", "public", "index.html"),
    "utf-8",
  );

  it("registers GET /newsletter and GET /newsletter/:editionId as page routes", () => {
    expect(src).toMatch(/app\.get\("\/newsletter"/);
    expect(src).toMatch(/app\.get\("\/newsletter\/:editionId"/);
  });

  it("renders via lib/newsletter/render.mjs (archive, empty, not-found)", () => {
    expect(src).toMatch(/from "\.\/lib\/newsletter\/render\.mjs"/);
    expect(src).toMatch(/renderDailyEditionHtml/);
    expect(src).toMatch(/renderEmptyArchiveHtml/);
    expect(src).toMatch(/renderNotFoundHtml/);
  });

  it("injects the derived source count into both newsletter call sites", () => {
    // The renderer degrades to a count-free "generated" when sourceCount is
    // omitted, so a dropped argument would silently regress the footer. Lock
    // the wiring: both renderDailyEditionHtml call sites pass SOURCE_COUNT.
    const calls = src.match(
      /renderDailyEditionHtml\([\s\S]*?sourceCount:\s*SOURCE_COUNT/g,
    );
    expect(calls).toHaveLength(2);
  });

  it("unknown edition ids render a 404 page instead of leaking fs errors", () => {
    expect(src).toMatch(/loadDailyEdition\(req\.params\.editionId\)/);
    expect(src).toMatch(/status\(404\)/);
  });

  it("serves pages with no-cache so forced regenerations show up on refresh", () => {
    expect(src).toMatch(/function sendNewsletterHtml/);
    expect(src).toMatch(/"no-cache"/);
  });

  it("header gets a Daily Edition link via the __PULSE_NEWSLETTER_LINK__ token", () => {
    expect(index).toContain("__PULSE_NEWSLETTER_LINK__");
    expect(src).toMatch(/__PULSE_NEWSLETTER_LINK__/);
    expect(src).toMatch(/newsletterLinkHtml/);
  });

  it("the link is a header-right pill, not logo chrome (no more stacked green text)", () => {
    // token sits inside header-right, before the search trigger
    const headerRight = index.match(
      /<div class="header-right">([\s\S]*?)<\/div>/,
    )?.[1];
    expect(headerRight).toContain("__PULSE_NEWSLETTER_LINK__");
    expect(headerRight).toContain("search-trigger");
    // generated markup uses the pill class + sprite icon
    expect(src).toMatch(/class="header-link"/);
    expect(src).toMatch(/#ic-list/);
    // no longer rendered as logo credit
    expect(src).not.toMatch(
      /class="logo-credit"[^>]*href="\/newsletter"/,
    );
    // and the CSS defines the pill
    const css = readFileSync(
      resolve(root, "dashboard", "public", "style.css"),
      "utf-8",
    );
    expect(css).toMatch(/\.header-link\s*\{/);
  });
});

describe("lib/newsletter/render.mjs — redesign shell (static source scan)", () => {
  const src = readFileSync(resolve(root, "lib/newsletter", "render.mjs"), "utf-8");

  it("declares the design-reference §3 token values", () => {
    expect(src).toContain("--paper:#f5f1e9");
    expect(src).toContain("--surface:#faf8f3");
    expect(src).toContain("--surface-2:#f1ede4");
    expect(src).toContain("--inset:#ece8de");
    expect(src).toContain("--ink:#1d1b19");
    expect(src).toContain("--green:#12a150");
    expect(src).toContain("--green-ink:#0c7a3d");
    expect(src).toContain("--amber-ink:#96500c");
    expect(src).toContain("--hairline:rgba(29,27,25,.08)");
  });

  it("no longer ships the legacy bordered card", () => {
    expect(src).not.toContain(".ew{");
    expect(src).not.toContain("#d1cdc6");
    expect(src).not.toContain("border:1px solid #");
  });

  it("keeps the self-hosted font rules and no Google Fonts origin", () => {
    expect(src).toContain('url("/fonts/');
    expect(src).not.toContain("fonts.googleapis");
    expect(src).not.toContain("fonts.gstatic");
  });

  it("ships the daily body primitives and drops the transitional card rules", () => {
    for (const rule of [
      ".doc-lede{",
      ".doc-story{",
      "grid-template-columns:22px 1fr",
      ".doc-rank{",
      ".doc-headline{",
      ".doc-model{",
      ".doc-paper{",
      ".doc-bullets{",
    ]) {
      expect(src).toContain(rule);
    }
    // every legacy body rule is gone now that the weekly renderer migrates too
    expect(src).not.toContain(".nl-tldr{");
    expect(src).not.toContain(".nl-tag{");
    expect(src).not.toContain(".paper{");
    expect(src).not.toContain(".story-num{");
    expect(src).not.toContain(".story-c{");
    expect(src).not.toContain(".model-row{");
    expect(src).not.toContain("ul.buzz{");
    expect(src).not.toContain(".chips a");
    // no transitional marker survives the migration
    expect(src).not.toContain("transitional");
  });

  it("keeps every raw hex inside the :root token declarations", () => {
    // After 9.3 the stylesheet has exactly one token block; any hex elsewhere
    // is a legacy rule that should have been deleted.
    const strayHex = src
      .split("\n")
      .filter((line) => line.includes("#") && !line.includes("--"));
    expect(strayHex).toEqual([]);
  });
});

describe("lib/newsletter/store.mjs — list + load by id", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-pulse-newsletter-list-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("listDailyEditions returns only edition files, newest first (latest.json excluded)", async () => {
    const { listDailyEditions, saveDailyEdition } = await import(
      "../lib/newsletter/store.mjs"
    );
    const { writeFileSync } = await import("node:fs");

    saveDailyEdition({ tldr: "oldest" }); // writes latest.json + {today}.json
    writeFileSync(join(tmpDir, ".pulse", "newsletters", "2026-01-01.json"), "{}");
    writeFileSync(join(tmpDir, ".pulse", "newsletters", "latest.json"), "{}");
    writeFileSync(join(tmpDir, ".pulse", "newsletters", "notes.txt"), "nope");

    const ids = listDailyEditions();
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(ids).not.toContain("latest");
    expect(ids).not.toContain("notes");
    expect(ids).toContain("2026-01-01");
    // descending order
    const sorted = [...ids].sort();
    expect(ids).toEqual([...sorted].reverse());
  });

  it("loadDailyEdition returns the saved edition by id and null for malformed ids", async () => {
    const { saveDailyEdition, loadDailyEdition } = await import(
      "../lib/newsletter/store.mjs"
    );
    saveDailyEdition({ tldr: "hello", topStories: [] });

    const { todayBrussels } = await import("../lib/llm/budget.mjs");
    const today = todayBrussels();

    expect(loadDailyEdition(today)?.tldr).toBe("hello");
    expect(loadDailyEdition("2026-13-45")).toBeNull();
    expect(loadDailyEdition("latest")).toBeNull();
    expect(loadDailyEdition("../../etc/passwd")).toBeNull();
    expect(loadDailyEdition("2026-01-01")).toBeNull(); // valid shape, missing file
  });

  it("loadRecentEditions returns the newest N editions excluding the given day", async () => {
    const { saveDailyEdition, loadRecentEditions } = await import(
      "../lib/newsletter/store.mjs"
    );
    const { todayBrussels } = await import("../lib/llm/budget.mjs");
    const { writeFileSync, mkdirSync } = await import("node:fs");

    saveDailyEdition({ tldr: "today", topStories: [] });
    const nlDir = join(tmpDir, ".pulse", "newsletters");
    for (const [id, tldr] of [
      ["2026-09-09", "third"],
      ["2026-09-08", "second"],
      ["2026-09-07", "first"],
      ["2026-09-06", "fourth — outside window"],
    ]) {
      writeFileSync(
        join(nlDir, `${id}.json`),
        JSON.stringify({ editionId: id, tldr, topStories: [] }),
      );
    }
    void mkdirSync; // dir exists via store import

    const recent = loadRecentEditions({ excludeDay: todayBrussels() });

    expect(recent.map((e) => e.tldr)).toEqual(["third", "second", "first"]);
    expect(recent.some((e) => e.editionId === todayBrussels())).toBe(false);
    expect(recent.some((e) => e.tldr.includes("fourth"))).toBe(false);
  });
});
