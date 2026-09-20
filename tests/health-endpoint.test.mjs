import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SOURCE_COUNT } from "../apis/briefing.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

describe("/api/health sourceCount field", () => {
  it("SOURCE_COUNT is the value health will report", () => {
    expect(typeof SOURCE_COUNT).toBe("number");
    expect(SOURCE_COUNT).toBeGreaterThan(0);
  });

  it("server.mjs /api/health response includes sourceCount: SOURCE_COUNT", () => {
    const src = readFileSync(resolve(root, "server.mjs"), "utf-8");
    // Confirm the literal wiring: sourceCount set from SOURCE_COUNT.
    expect(src).toMatch(/sourceCount:\s*SOURCE_COUNT/);
  });

  it("server.mjs /api/health payload includes cooldownMs: REFRESH_MS", () => {
    const src = readFileSync(resolve(root, "server.mjs"), "utf-8");
    // Scope to the health handler: cooldownMs also appears in the SSE
    // on-connect path, so a file-wide toMatch would pass without the field.
    const health =
      src.match(/app\.get\("\/api\/health",[\s\S]*?\n\}\);/)?.[0] ?? "";
    expect(health).not.toBe("");
    expect(health).toMatch(/cooldownMs:\s*REFRESH_MS/);
  });

  it("server.mjs /api/health payload includes currentWeekId: weekIdBrussels()", () => {
    const src = readFileSync(resolve(root, "server.mjs"), "utf-8");
    // Additive field (Story 5.2): scoped to the health handler like cooldownMs
    // so the guard note can be decided on render without a new endpoint.
    const health =
      src.match(/app\.get\("\/api\/health",[\s\S]*?\n\}\);/)?.[0] ?? "";
    expect(health).not.toBe("");
    expect(health).toMatch(/currentWeekId:\s*weekIdBrussels\(\)/);
  });

  // `llm` only says a provider is configured; `analysis` says whether the
  // briefing actually landed (a configured-but-failing LLM was invisible).
  it("server.mjs /api/health payload includes analysis: lastAnalysis", () => {
    const src = readFileSync(resolve(root, "server.mjs"), "utf-8");
    const health =
      src.match(/app\.get\("\/api\/health",[\s\S]*?\n\}\);/)?.[0] ?? "";
    expect(health).not.toBe("");
    expect(health).toMatch(/analysis:\s*lastAnalysis/);
    // Recorded from the sweep's LLM result, not hardcoded.
    expect(src).toMatch(
      /lastAnalysis = \{[\s\S]*?state: llmResult\.state[\s\S]*?detail: llmResult\.detail/,
    );
  });
});
