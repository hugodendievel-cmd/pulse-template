// tests/editions-archive.test.mjs — Story 5.3: the archive card is rendered
// from existing endpoints only (GET /api/health persistence ids + GET /api/digest
// weekId), with daily rows linking out to the retained /newsletter pages.
// Pure source scan, no DOM, no server boot.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const app = readFileSync(resolve(root, "dashboard/public/app.js"), "utf-8");
const css = readFileSync(resolve(root, "dashboard/public/style.css"), "utf-8");

describe("archive card — client dispatch (source scan)", () => {
  it("dispatches the archive variant before the aggregate/select logic", () => {
    expect(app).toContain('panel.variant === "archive"');
  });

  it("consumes the pure archiveRows helper with the edition-id list", () => {
    expect(app).toContain("archiveRows");
    expect(app).toContain("lastEditionIds");
    expect(app).toContain("persistence");
  });

  it("reuses the pure digestSignalCount helper for the digest scroll count", () => {
    // No second inline formula in renderDigest: the card and the archive's
    // weekly row share the tested helper, so the counts cannot drift.
    expect(app).toContain("window.RenderCore.digestSignalCount(digest)");
  });

  it("renders hairline rows and the honest empty state", () => {
    expect(app).toContain('class="archive-rows"');
    expect(app).toContain("archive-row");
    expect(app).toContain("no past editions yet");
  });

  it("links daily rows to /newsletter/:id", () => {
    expect(app).toContain("/newsletter/");
  });

  it("the weekly row scrolls digestPanel into view and never calls setView", () => {
    const body = app.match(/function renderArchive[\s\S]*?\n\}/)?.[0] ?? "";
    expect(body).toContain("digestPanel");
    expect(body).toContain("scrollIntoView");
    expect(body).not.toContain("setView");
  });

  it("reads the existing health + digest endpoints and adds no new route", () => {
    expect(app).toContain('fetch("/api/health")');
    expect(app).not.toContain("/api/editions");
  });
});

describe("archive card — stylesheet token binding", () => {
  it("binds .archive-row to the hairline token", () => {
    const rule = css.match(/\.archive-row\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("border-top: 1px solid var(--hairline)");
  });

  it("binds .archive-link to the mono/green-ink tokens", () => {
    const rule = css.match(/\.archive-link\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("font-family: var(--mono)");
    expect(rule).toContain("color: var(--green-ink)");
  });

  it("binds .archive-meta to the mono/ink-4 tokens", () => {
    const rule = css.match(/\.archive-meta\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("font-family: var(--mono)");
    expect(rule).toContain("color: var(--ink-4)");
  });
});
