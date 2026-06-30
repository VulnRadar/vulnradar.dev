import { describe, it, expect } from "vitest";
import { isLocalUrl, resolveProviderName } from "./provider";

describe("isLocalUrl", () => {
  it("returns true for localhost URLs", () => {
    expect(isLocalUrl("http://localhost:11434/v1")).toBe(true);
    expect(isLocalUrl("http://localhost:3000/api")).toBe(true);
  });

  it("returns true for 127.0.0.1", () => {
    expect(isLocalUrl("http://127.0.0.1:8080/v1")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1/api")).toBe(true);
  });

  it("returns true for 0.0.0.0", () => {
    expect(isLocalUrl("http://0.0.0.0:11434/v1")).toBe(true);
  });

  it("returns true for 10.x.x.x private range", () => {
    expect(isLocalUrl("http://10.0.0.1/v1")).toBe(true);
    expect(isLocalUrl("http://10.255.255.255/v1")).toBe(true);
  });

  it("returns true for 192.168.x.x private range", () => {
    expect(isLocalUrl("http://192.168.1.1/v1")).toBe(true);
    expect(isLocalUrl("http://192.168.0.100/v1")).toBe(true);
  });

  it("returns true for 172.16-31.x.x private range", () => {
    expect(isLocalUrl("http://172.16.0.1/v1")).toBe(true);
    expect(isLocalUrl("http://172.20.50.100/v1")).toBe(true);
    expect(isLocalUrl("http://172.31.255.255/v1")).toBe(true);
  });

  it("returns false for 172.x outside the private range", () => {
    expect(isLocalUrl("http://172.15.0.1/v1")).toBe(false);
    expect(isLocalUrl("http://172.32.0.1/v1")).toBe(false);
  });

  it("returns false for public hosts", () => {
    expect(isLocalUrl("https://api.openai.com/v1")).toBe(false);
    expect(isLocalUrl("https://api.anthropic.com/v1")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isLocalUrl("")).toBe(false);
  });
});

describe("resolveProviderName", () => {
  it("returns Custom LLM for null or empty baseUrl", () => {
    expect(resolveProviderName(null)).toBe("Custom LLM");
  });

  it("returns Custom LLM for localhost URLs", () => {
    expect(resolveProviderName("http://localhost:11434/v1")).toBe("Custom LLM");
    expect(resolveProviderName("http://127.0.0.1:1234/v1")).toBe("Custom LLM");
    expect(resolveProviderName("http://192.168.1.10/v1")).toBe("Custom LLM");
  });

  it("returns ChatGPT for OpenAI URLs", () => {
    expect(resolveProviderName("https://api.openai.com/v1")).toBe("ChatGPT");
  });

  it("returns Claude for Anthropic URLs", () => {
    expect(resolveProviderName("https://api.anthropic.com/v1")).toBe("Claude");
  });

  it("returns Groq for Groq URLs", () => {
    expect(resolveProviderName("https://api.groq.com/openai/v1")).toBe("Groq");
  });

  it("returns Mistral for Mistral URLs", () => {
    expect(resolveProviderName("https://api.mistral.ai/v1")).toBe("Mistral");
  });

  it("returns OpenRouter for OpenRouter URLs", () => {
    expect(resolveProviderName("https://openrouter.ai/api/v1")).toBe(
      "OpenRouter",
    );
  });

  it("returns Together AI for Together URLs", () => {
    expect(resolveProviderName("https://api.together.xyz/v1")).toBe(
      "Together AI",
    );
  });

  it("returns DeepSeek for DeepSeek URLs", () => {
    expect(resolveProviderName("https://api.deepseek.com/v1")).toBe("DeepSeek");
  });

  it("returns MiniMax for MiniMax URLs", () => {
    expect(resolveProviderName("https://api.minimax.chat/v1")).toBe("MiniMax");
  });

  it("returns Ollama for the standard Ollama port", () => {
    expect(resolveProviderName("http://example.com:11434/v1")).toBe("Ollama");
  });

  it("returns LM Studio for the standard LM Studio port", () => {
    expect(resolveProviderName("http://example.com:1234/v1")).toBe("LM Studio");
  });

  it("returns Custom LLM for unknown public URLs", () => {
    expect(resolveProviderName("https://my-custom-llm.example.com/v1")).toBe(
      "Custom LLM",
    );
    expect(resolveProviderName("https://random-api.com/v1/chat")).toBe(
      "Custom LLM",
    );
  });
});
