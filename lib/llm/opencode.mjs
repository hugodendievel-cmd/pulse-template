// lib/llm/opencode.mjs — OpenCode Zen provider (raw fetch, no SDK)
import { LLMProvider } from "./provider.mjs";
import { env } from "../../apis/utils/env.mjs";

export class OpenCodeProvider extends LLMProvider {
  constructor(apiKey, model = "gpt-5.6-luna") {
    super("opencode", model, apiKey);
    this.baseUrl = env("LLM_BASE_URL", "https://opencode.ai/zen/v1");
  }

  _endpoint() {
    if (this.model.startsWith("gpt-")) {
      return { url: `${this.baseUrl}/responses`, shape: "responses" };
    }
    if (this.model.startsWith("claude-") || this.model.startsWith("qwen3.7-")) {
      return { url: `${this.baseUrl}/messages`, shape: "messages" };
    }
    return { url: `${this.baseUrl}/chat/completions`, shape: "chat" };
  }

  async chat(messages, opts = {}) {
    const { url, shape } = this._endpoint();
    const body = this._body(shape, messages, opts);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenCode ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return this._extract(shape, data);
  }

  _body(shape, messages, opts) {
    if (shape === "responses") {
      return {
        model: this.model,
        input: messages.map((m) => ({
          role: m.role,
          content: [
            {
              type: m.role === "assistant" ? "output_text" : "input_text",
              text: m.content,
            },
          ],
        })),
        max_output_tokens: opts.maxTokens || 4096,
      };
    }
    if (shape === "messages") {
      return {
        model: this.model,
        max_tokens: opts.maxTokens || 4096,
        messages,
      };
    }
    return {
      model: this.model,
      max_completion_tokens: opts.maxTokens || 4096,
      messages,
    };
  }

  _extract(shape, data) {
    if (shape === "responses") {
      let text = "";
      for (const item of data.output || []) {
        if (item.type !== "message") continue;
        for (const part of item.content || []) {
          if (part.type === "output_text") text += part.text;
        }
      }
      return text;
    }
    if (shape === "messages") {
      return data.content?.[0]?.text || "";
    }
    return data.choices?.[0]?.message?.content || "";
  }
}
