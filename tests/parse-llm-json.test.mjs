import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import log from "../lib/logger.mjs";
import { parseLlmJson } from "../lib/llm/parse-json.mjs";

describe("parseLlmJson", () => {
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("parses plain JSON and returns all fields", () => {
    const raw = JSON.stringify({
      summary: "Hello",
      topStories: [{ headline: "X" }],
    });
    const result = parseLlmJson(raw, {
      required: ["summary"],
      defaults: { topStories: [] },
    });
    expect(result.summary).toBe("Hello");
    expect(result.topStories).toHaveLength(1);
  });

  it("strips ```json fences and parses", () => {
    const raw = '```json\n{"summary":"ok","topStories":[]}\n```';
    const result = parseLlmJson(raw, { required: ["summary"] });
    expect(result.summary).toBe("ok");
  });

  it("strips plain ``` fences without a language tag", () => {
    const raw = '```\n{"summary":"ok"}\n```';
    const result = parseLlmJson(raw, { required: ["summary"] });
    expect(result.summary).toBe("ok");
  });

  it("extracts JSON from amid surrounding prose", () => {
    const raw =
      'Here is my analysis:\n{"summary":"extracted"}\nHope this helps!';
    const result = parseLlmJson(raw, { required: ["summary"] });
    expect(result.summary).toBe("extracted");
  });

  it("returns null and calls log.error on malformed JSON", () => {
    const raw = '{"summary": "unclosed';
    const result = parseLlmJson(raw, { required: ["summary"] });
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledOnce();
    const [bindings] = errorSpy.mock.calls[0];
    expect(bindings).toHaveProperty("snippet");
    expect(bindings.snippet.length).toBeLessThanOrEqual(200);
    expect(bindings).toHaveProperty("provider");
    expect(bindings).toHaveProperty("model");
  });

  it("returns null and calls log.warn when a required field is absent", () => {
    const raw = '{"topStories":[]}';
    const result = parseLlmJson(raw, { required: ["summary"] });
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("fills missing optional fields from defaults", () => {
    const raw = '{"summary":"s"}';
    const result = parseLlmJson(raw, {
      required: ["summary"],
      defaults: {
        topStories: [],
        trends: [],
        modelRadar: [],
        signals: [],
      },
    });
    expect(result.topStories).toEqual([]);
    expect(result.trends).toEqual([]);
    expect(result.modelRadar).toEqual([]);
    expect(result.signals).toEqual([]);
  });

  it("preserves unknown fields in the parsed object", () => {
    const raw = '{"summary":"s","futureField":"preserved"}';
    const result = parseLlmJson(raw, { required: ["summary"] });
    expect(result.futureField).toBe("preserved");
  });

  it("does not close the JSON block on } inside a string value", () => {
    const raw = '{"summary":"ends with }","topStories":[]}';
    const result = parseLlmJson(raw, { required: ["summary"] });
    expect(result).not.toBeNull();
    expect(result.summary).toBe("ends with }");
    expect(result.topStories).toEqual([]);
  });

  it("does not close the JSON block on { inside a string value", () => {
    const raw = '{"summary":"contains { brace","topStories":[]}';
    const result = parseLlmJson(raw, { required: ["summary"] });
    expect(result).not.toBeNull();
    expect(result.summary).toBe("contains { brace");
  });

  it("handles escaped quotes inside strings", () => {
    const raw = '{"summary":"has \\"quoted\\" text"}';
    const result = parseLlmJson(raw, { required: ["summary"] });
    expect(result).not.toBeNull();
    expect(result.summary).toBe('has "quoted" text');
  });

  // LLMs intermittently emit JSON they never escaped. Losing the whole
  // briefing to one stray character is worse than repairing it.
  it("repairs an unescaped quote inside a string value", () => {
    const raw = `\`\`\`json
{
  "summary": "Google said "Gemini" broke out during testing.",
  "topStories": []
}
\`\`\``;
    const result = parseLlmJson(raw, { required: ["summary"] });
    expect(result).not.toBeNull();
    expect(result.summary).toBe(
      'Google said "Gemini" broke out during testing.',
    );
  });

  it("repairs a literal newline inside a string value", () => {
    const raw = `{"summary": "line one
line two", "topStories": []}`;
    const result = parseLlmJson(raw, { required: ["summary"] });
    expect(result).not.toBeNull();
    expect(result.summary).toBe("line one\nline two");
  });

  it("repairs a literal tab inside a string value", () => {
    const raw = '{"summary": "a\tb", "topStories": []}';
    const result = parseLlmJson(raw, { required: ["summary"] });
    expect(result).not.toBeNull();
    expect(result.summary).toBe("a\tb");
  });

  it("does not corrupt already-valid JSON with quotes in arrays and legs", () => {
    const raw =
      '{"summary":"ok","topStories":[{"headline":"he said \\"hi\\"","url":"https://x.test/a"}],"trends":["a"],"modelRadar":[],"signals":[]}';
    const result = parseLlmJson(raw, { required: ["summary"] });
    expect(result).not.toBeNull();
    expect(result.topStories[0].headline).toBe('he said "hi"');
    expect(result.topStories[0].url).toBe("https://x.test/a");
  });

  it("still returns null for a genuinely truncated response", () => {
    const raw = '{"summary": "unclosed and never finished';
    const result = parseLlmJson(raw, { required: ["summary"] });
    expect(result).toBeNull();
  });

  it("handles escaped backslash followed by brace in strings", () => {
    const raw = '{"summary":"path\\\\","topStories":[]}';
    const result = parseLlmJson(raw, { required: ["summary"] });
    expect(result).not.toBeNull();
    expect(result.summary).toBe("path\\");
    expect(result.topStories).toEqual([]);
  });

  it("truncates snippet to 200 chars in error log", () => {
    const longPrefix = "A".repeat(500);
    const raw = `${longPrefix}{"summary": "unclosed`;
    const result = parseLlmJson(raw, { required: ["summary"] });
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledOnce();
    const [bindings] = errorSpy.mock.calls[0];
    expect(bindings.snippet.length).toBeLessThanOrEqual(200);
  });

  it("returns null and logs error when no { is found at all", () => {
    const raw = "Sorry, I cannot help with that.";
    const result = parseLlmJson(raw, { required: ["summary"] });
    expect(result).toBeNull();
    // no balanced block → error path (JSON.parse throws on empty/invalid)
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("includes provider and model in error log bindings", () => {
    const raw = "{ malformed";
    const result = parseLlmJson(raw, {
      required: ["summary"],
      provider: "openai",
      model: "gpt-5",
    });
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledOnce();
    const [bindings] = errorSpy.mock.calls[0];
    expect(bindings.provider).toBe("openai");
    expect(bindings.model).toBe("gpt-5");
  });

  it("does not overwrite provided fields with defaults (empty array preserved)", () => {
    const raw = '{"summary":"s","topStories":[{"headline":"x"}]}';
    const result = parseLlmJson(raw, {
      required: ["summary"],
      defaults: { topStories: [] },
    });
    expect(result.topStories).toHaveLength(1);
  });

  it("returns null gracefully when raw is null", () => {
    const result = parseLlmJson(null, { required: ["summary"] });
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("returns null gracefully when raw is undefined", () => {
    const result = parseLlmJson(undefined, { required: ["summary"] });
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("returns null gracefully when raw is an empty string", () => {
    const result = parseLlmJson("", { required: ["summary"] });
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("rejects top-level JSON arrays (not plain objects)", () => {
    const result = parseLlmJson("[1, 2, 3]", { required: [] });
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("does not leak prototype pollution via __proto__ in response", () => {
    const raw = '{"summary":"s","__proto__":{"polluted":true}}';
    parseLlmJson(raw, { required: ["summary"] });
    // eslint-disable-next-line no-proto
    expect({}.polluted).toBeUndefined();
  });
});
