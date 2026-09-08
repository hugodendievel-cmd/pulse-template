// tests/llm-default-models.test.mjs — Guardrail for LLM provider default model IDs.
// Asserts each provider's constructor default and that an explicit model override wins.
// No network calls; no API keys required.
import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "../lib/llm/anthropic.mjs";
import { GeminiProvider } from "../lib/llm/gemini.mjs";
import { OpenAIProvider } from "../lib/llm/openai.mjs";
import { OpenCodeProvider } from "../lib/llm/opencode.mjs";

describe("LLM provider default model IDs", () => {
  it("OpenAI default model is gpt-4.1", () => {
    const p = new OpenAIProvider("fake-key");
    expect(p.model).toBe("gpt-4.1");
  });

  it("Gemini default model is gemini-2.5-flash", () => {
    const p = new GeminiProvider("fake-key");
    expect(p.model).toBe("gemini-2.5-flash");
  });

  it("Anthropic default model is claude-sonnet-4-6", () => {
    const p = new AnthropicProvider("fake-key");
    expect(p.model).toBe("claude-sonnet-4-6");
  });

  it("OpenCode default model is gpt-5.6-luna", () => {
    const p = new OpenCodeProvider("fake-key");
    expect(p.model).toBe("gpt-5.6-luna");
  });

  it("LLM_MODEL override wins for OpenAI", () => {
    const p = new OpenAIProvider("fake-key", "gpt-4o-mini");
    expect(p.model).toBe("gpt-4o-mini");
  });

  it("LLM_MODEL override wins for Gemini", () => {
    const p = new GeminiProvider("fake-key", "gemini-1.5-flash");
    expect(p.model).toBe("gemini-1.5-flash");
  });

  it("LLM_MODEL override wins for Anthropic", () => {
    const p = new AnthropicProvider("fake-key", "claude-3-haiku-20240307");
    expect(p.model).toBe("claude-3-haiku-20240307");
  });

  it("LLM_MODEL override wins for OpenCode", () => {
    const p = new OpenCodeProvider("fake-key", "glm-5.3");
    expect(p.model).toBe("glm-5.3");
  });
});
