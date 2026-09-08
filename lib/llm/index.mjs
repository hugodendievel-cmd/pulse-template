// lib/llm/index.mjs — Factory: create LLM provider from env config
import { env } from "../../apis/utils/env.mjs";
import log from "../logger.mjs";

export async function createLLMProvider() {
  const provider = env("LLM_PROVIDER", "disabled").toLowerCase();
  if (provider === "disabled" || !provider) return null;

  const apiKey = env("LLM_API_KEY");
  const model = env("LLM_MODEL");

  switch (provider) {
    case "anthropic": {
      const { AnthropicProvider } = await import("./anthropic.mjs");
      return new AnthropicProvider(apiKey, model || undefined);
    }
    case "openai": {
      const { OpenAIProvider } = await import("./openai.mjs");
      return new OpenAIProvider(apiKey, model || undefined);
    }
    case "gemini": {
      const { GeminiProvider } = await import("./gemini.mjs");
      return new GeminiProvider(apiKey, model || undefined);
    }
    case "opencode": {
      const { OpenCodeProvider } = await import("./opencode.mjs");
      return new OpenCodeProvider(apiKey, model || undefined);
    }
    default:
      log.warn({ provider }, "[LLM] Unknown provider");
      return null;
  }
}
