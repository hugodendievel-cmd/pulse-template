import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { analyzeWithLLM } from "../lib/llm/analysis.mjs";
import { generateWeeklyDigest } from "../lib/llm/weekly-digest.mjs";

describe("lib/llm/* routes errors through pino (not console)", () => {
  let consoleErrorSpy;
  let consoleWarnSpy;
  let consoleLogSpy;
  let consoleInfoSpy;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleInfoSpy.mockRestore();
  });

  it("analyzeWithLLM: returns null and does not call console.error on failure", async () => {
    const mockLlm = {
      chat: vi.fn().mockRejectedValue(new Error("timeout")),
      name: "test-provider",
      model: "test-model",
    };

    const result = await analyzeWithLLM(
      mockLlm,
      {
        sources: [],
        sourcesOk: 0,
        timestamp: "2026-04-18T00:00:00.000Z",
      },
      { prompt: "Test prompt" },
    );

    expect(result).toBeNull();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it("generateWeeklyDigest: returns null and does not call console.error on failure", async () => {
    const mockLlm = {
      chat: vi.fn().mockRejectedValue(new Error("rate limited")),
      name: "test-provider",
      model: "test-model",
    };

    const result = await generateWeeklyDigest(
      mockLlm,
      {
        sources: [],
        sourcesOk: 0,
        timestamp: "2026-04-18T00:00:00.000Z",
      },
      { prompt: "Test prompt", freshSources: ["Hacker News"] },
    );

    expect(result).toBeNull();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });
});
