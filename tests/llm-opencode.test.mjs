// tests/llm-opencode.test.mjs — OpenCode Zen provider tests (fetch stubbed, no network).
// Covers: endpoint routing by model prefix, token field per API shape, Bearer auth,
// text extraction per shape, "" fallback, error on non-2xx, LLM_BASE_URL override.
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenCodeProvider } from "../lib/llm/opencode.mjs";

const MESSAGES = [{ role: "user", content: "hello" }];

// Build a fetch stub that captures the request and returns `payload` with `status`.
function stubFetch(payload, status = 200) {
  const calls = [];
  const fetchMock = vi.fn(async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LLM_BASE_URL;
});

describe("OpenCodeProvider — endpoint routing by model prefix", () => {
  it("gpt-* → POST {baseUrl}/responses (Responses API)", async () => {
    const calls = stubFetch({ output: [] });
    const p = new OpenCodeProvider("k", "gpt-5.6-luna");
    await p.chat(MESSAGES);
    expect(calls[0].url).toBe("https://opencode.ai/zen/v1/responses");
  });

  it("claude-* → POST {baseUrl}/messages (Messages API)", async () => {
    const calls = stubFetch({ content: [] });
    const p = new OpenCodeProvider("k", "claude-sonnet-4-6");
    await p.chat(MESSAGES);
    expect(calls[0].url).toBe("https://opencode.ai/zen/v1/messages");
  });

  it("qwen3.7-* → POST {baseUrl}/messages (Messages API)", async () => {
    const calls = stubFetch({ content: [] });
    const p = new OpenCodeProvider("k", "qwen3.7-max");
    await p.chat(MESSAGES);
    expect(calls[0].url).toBe("https://opencode.ai/zen/v1/messages");
  });

  it("other models (glm) → POST {baseUrl}/chat/completions", async () => {
    const calls = stubFetch({ choices: [] });
    const p = new OpenCodeProvider("k", "glm-5.3");
    await p.chat(MESSAGES);
    expect(calls[0].url).toBe("https://opencode.ai/zen/v1/chat/completions");
  });
});

describe("OpenCodeProvider — request bodies", () => {
  it("responses shape: input items + max_output_tokens", async () => {
    const calls = stubFetch({ output: [] });
    const p = new OpenCodeProvider("k", "gpt-5.6-luna");
    await p.chat(MESSAGES);
    expect(calls[0].body).toEqual({
      model: "gpt-5.6-luna",
      input: [
        { role: "user", content: [{ type: "input_text", text: "hello" }] },
      ],
      max_output_tokens: 4096,
    });
  });

  it("responses shape: assistant messages use output_text type", async () => {
    const calls = stubFetch({ output: [] });
    const p = new OpenCodeProvider("k", "gpt-5.6-luna");
    await p.chat([{ role: "assistant", content: "hi" }]);
    expect(calls[0].body.input).toEqual([
      { role: "assistant", content: [{ type: "output_text", text: "hi" }] },
    ]);
  });

  it("responses shape: opts.maxTokens → max_output_tokens", async () => {
    const calls = stubFetch({ output: [] });
    const p = new OpenCodeProvider("k", "gpt-5.6-luna");
    await p.chat(MESSAGES, { maxTokens: 3000 });
    expect(calls[0].body.max_output_tokens).toBe(3000);
  });

  it("messages shape: messages passed through + max_tokens", async () => {
    const calls = stubFetch({ content: [] });
    const p = new OpenCodeProvider("k", "claude-sonnet-4-6");
    await p.chat(MESSAGES, { maxTokens: 4000 });
    expect(calls[0].body).toEqual({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: MESSAGES,
    });
  });

  it("chat/completions shape: messages passed through + max_completion_tokens", async () => {
    const calls = stubFetch({ choices: [] });
    const p = new OpenCodeProvider("k", "glm-5.3");
    await p.chat(MESSAGES, { maxTokens: 1234 });
    expect(calls[0].body).toEqual({
      model: "glm-5.3",
      max_completion_tokens: 1234,
      messages: MESSAGES,
    });
  });

  it("sends Authorization: Bearer header and JSON content type", async () => {
    const calls = stubFetch({ output: [] });
    const p = new OpenCodeProvider("zen-key-123", "gpt-5.6-luna");
    await p.chat(MESSAGES);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer zen-key-123",
    });
  });
});

describe("OpenCodeProvider — response text extraction", () => {
  it("responses shape: concatenates output_text items", async () => {
    stubFetch({
      output: [
        { type: "reasoning" },
        {
          type: "message",
          content: [
            { type: "output_text", text: "Hello " },
            { type: "output_text", text: "world" },
          ],
        },
      ],
    });
    const p = new OpenCodeProvider("k", "gpt-5.6-luna");
    expect(await p.chat(MESSAGES)).toBe("Hello world");
  });

  it("messages shape: content[0].text", async () => {
    stubFetch({ content: [{ text: "claude says hi" }] });
    const p = new OpenCodeProvider("k", "claude-sonnet-4-6");
    expect(await p.chat(MESSAGES)).toBe("claude says hi");
  });

  it("chat/completions shape: choices[0].message.content", async () => {
    stubFetch({ choices: [{ message: { content: "glm says hi" } }] });
    const p = new OpenCodeProvider("k", "glm-5.3");
    expect(await p.chat(MESSAGES)).toBe("glm says hi");
  });

  it('returns "" on empty payload per shape', async () => {
    stubFetch({});
    expect(await new OpenCodeProvider("k", "gpt-5.6-luna").chat(MESSAGES)).toBe("");
    expect(await new OpenCodeProvider("k", "claude-sonnet-4-6").chat(MESSAGES)).toBe("");
    expect(await new OpenCodeProvider("k", "glm-5.3").chat(MESSAGES)).toBe("");
  });
});

describe("OpenCodeProvider — errors and base URL", () => {
  it('throws Error("OpenCode <status>: <body>") on non-2xx', async () => {
    stubFetch("unauthorized", 401);
    const p = new OpenCodeProvider("k", "gpt-5.6-luna");
    await expect(p.chat(MESSAGES)).rejects.toThrow("OpenCode 401: unauthorized");
  });

  it("LLM_BASE_URL overrides the default Zen base URL", async () => {
    process.env.LLM_BASE_URL = "https://zen.example.test/v9";
    const calls = stubFetch({ output: [] });
    const p = new OpenCodeProvider("k", "gpt-5.6-luna");
    await p.chat(MESSAGES);
    expect(p.baseUrl).toBe("https://zen.example.test/v9");
    expect(calls[0].url).toBe("https://zen.example.test/v9/responses");
  });
});
