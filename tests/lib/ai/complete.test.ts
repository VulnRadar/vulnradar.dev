/**
 * completeShortText (lib/ai/complete.ts): the one-shot plain-text answer used
 * for the small mechanical asks, such as translating a support message.
 *
 * Only the network (fetch) is mocked. The transport it sends through, provider
 * detection and the Anthropic adapter run for real, so these tests also pin
 * what a short completion puts on the wire for each API shape.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { completeShortText } from "@/lib/ai/complete";
import type { AiEndpoint } from "@/lib/ai/transport";

const OPENAI: AiEndpoint = {
  baseUrl: "https://api.example-llm.test/v1",
  apiKey: "sk-test-secret",
  model: "plain-model",
};

const ANTHROPIC: AiEndpoint = {
  baseUrl: "https://api.anthropic.com/v1",
  apiKey: "sk-ant-secret",
  model: "claude-haiku-4-5-20251001",
};

const input = {
  system: "Translate to Japanese. Reply with the translation only.",
  prompt: "Where is my invoice?",
  maxTokens: 400,
};

function chatReply(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function anthropicReply(text: string): Response {
  return new Response(JSON.stringify({ content: [{ type: "text", text }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const originalFetch = global.fetch;
let fetchMock: ReturnType<typeof vi.fn>;
let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  errors.mockRestore();
});

function sentBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string);
}

function loggedLines(): string[] {
  return errors.mock.calls.map((call: unknown[]) =>
    call.map((part) => String(part)).join(" "),
  );
}

describe("completeShortText: an OpenAI-compatible endpoint", () => {
  it("returns the model's answer", async () => {
    fetchMock.mockResolvedValueOnce(chatReply("請求書はどこですか？"));

    expect(await completeShortText(OPENAI, input)).toBe("請求書はどこですか？");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example-llm.test/v1/chat/completions",
    );
  });

  it("sends the prompts and the token cap as given", async () => {
    fetchMock.mockResolvedValueOnce(chatReply("ok"));

    await completeShortText(OPENAI, input);

    expect(sentBody()).toEqual({
      model: "plain-model",
      max_tokens: 400,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.prompt },
      ],
    });
  });

  it("never asks the model to reason, even one that would", async () => {
    fetchMock.mockResolvedValueOnce(chatReply("ok"));

    await completeShortText(
      { baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "gpt-5.4" },
      input,
    );

    expect(sentBody()).not.toHaveProperty("reasoning_effort");
  });

  it("does not retry an endpoint that answers 400, whatever it says about reasoning", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("reasoning_effort is not supported", { status: 400 }),
    );

    expect(
      await completeShortText(
        { baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "gpt-5.4" },
        input,
      ),
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("identifies this deployment to OpenRouter and to no other host", async () => {
    fetchMock.mockImplementation(async () => chatReply("ok"));

    await completeShortText(
      { ...OPENAI, baseUrl: "https://openrouter.ai/api/v1" },
      input,
    );
    await completeShortText(OPENAI, input);

    const openRouter = (fetchMock.mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    const other = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(openRouter).toHaveProperty("HTTP-Referer");
    expect(openRouter).toHaveProperty("X-Title");
    expect(other).not.toHaveProperty("HTTP-Referer");
  });

  it("cuts inline reasoning out of the answer, because the answer is sent to a customer", async () => {
    fetchMock.mockResolvedValueOnce(
      chatReply("<think>They want Japanese.</think>請求書はどこですか？"),
    );

    expect(await completeShortText(OPENAI, input)).toBe("請求書はどこですか？");
  });

  it("returns null when the reply is only reasoning that never finished", async () => {
    fetchMock.mockResolvedValueOnce(chatReply("<think>still working it out"));

    expect(await completeShortText(OPENAI, input)).toBeNull();
  });

  it("returns null for an empty or missing reply", async () => {
    fetchMock
      .mockResolvedValueOnce(chatReply("   "))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [] }), { status: 200 }),
      );

    expect(await completeShortText(OPENAI, input)).toBeNull();
    expect(await completeShortText(OPENAI, input)).toBeNull();
  });
});

describe("completeShortText: an Anthropic-shaped endpoint", () => {
  it("returns the answer from /messages with the key in x-api-key", async () => {
    fetchMock.mockResolvedValueOnce(anthropicReply("請求書はどこですか？"));

    expect(await completeShortText(ANTHROPIC, input)).toBe(
      "請求書はどこですか？",
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
      "sk-ant-secret",
    );
  });

  it("asks for no thinking", async () => {
    fetchMock.mockResolvedValueOnce(anthropicReply("ok"));

    await completeShortText(ANTHROPIC, input);

    expect(sentBody()).not.toHaveProperty("thinking");
  });

  it("says no thinking out loud to a model that would otherwise think", async () => {
    fetchMock.mockResolvedValueOnce(anthropicReply("ok"));

    await completeShortText({ ...ANTHROPIC, model: "claude-sonnet-5" }, input);

    expect(sentBody().thinking).toEqual({ type: "disabled" });
  });
});

describe("completeShortText: when it cannot answer", () => {
  // The model is whatever a user saved and the detail is whatever their
  // endpoint answered. console.error is stored in Admin > Error Logs, so a
  // line break in either wrote a forged entry there.
  it("logs a refusal and a failed request on one line each", async () => {
    const hostile: AiEndpoint = {
      ...OPENAI,
      model: "plain-model\r\n[AI-SHORT-TEXT] Admin password reset approved",
    };
    fetchMock
      .mockResolvedValueOnce(
        new Response("bad\r\n[AI-SHORT-TEXT] forged", { status: 401 }),
      )
      .mockRejectedValueOnce(new Error("socket hang up\r\n[AI] forged"))
      // Not every rejection is an Error; a thrown string is logged as itself.
      .mockRejectedValueOnce("aborted\r\n[AI] forged");

    expect(await completeShortText(hostile, input)).toBeNull();
    expect(await completeShortText(hostile, input)).toBeNull();
    expect(await completeShortText(hostile, input)).toBeNull();

    const lines = loggedLines();
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain("aborted");
    for (const line of lines) {
      expect(line).toContain("plain-model");
      expect(line).not.toMatch(/[\r\n]/);
    }
  });

  it("returns null and logs the status, the host and the model, never the key", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("invalid api key", { status: 401 }),
    );

    expect(await completeShortText(OPENAI, input)).toBeNull();

    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[AI-SHORT-TEXT]");
    expect(lines[0]).toContain("HTTP 401");
    expect(lines[0]).toContain("api.example-llm.test");
    expect(lines[0]).toContain("plain-model");
    expect(lines[0]).toContain("invalid api key");
    expect(lines[0]).not.toContain("sk-test-secret");
    expect(lines[0]).not.toContain("/v1");
  });

  it("logs an Anthropic refusal in the same shape", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: "invalid x-api-key" } }),
        {
          status: 401,
        },
      ),
    );

    expect(await completeShortText(ANTHROPIC, input)).toBeNull();

    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("HTTP 401");
    expect(lines[0]).toContain("api.anthropic.com");
    expect(lines[0]).toContain("invalid x-api-key");
    expect(lines[0]).not.toContain("sk-ant-secret");
  });

  it("keeps only the start of what the endpoint said", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("x".repeat(500), { status: 502 }),
    );

    await completeShortText(OPENAI, input);

    expect(loggedLines()[0]).not.toContain("x".repeat(201));
    expect(loggedLines()[0]).toContain("x".repeat(200));
  });

  it("returns null and logs when the request never got an answer", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    expect(await completeShortText(OPENAI, input)).toBeNull();

    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("request to api.example-llm.test");
    expect(lines[0]).toContain("failed");
    expect(lines[0]).toContain("fetch failed");
  });

  it("gives up and returns null once timeoutMs has passed", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const abort = new Error("This operation was aborted");
            abort.name = "AbortError";
            reject(abort);
          });
        }),
    );

    expect(
      await completeShortText(OPENAI, { ...input, timeoutMs: 20 }),
    ).toBeNull();
    expect(loggedLines()[0]).toContain("failed");
  });

  it("names a base URL it cannot parse instead of throwing while logging it", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));

    expect(
      await completeShortText({ ...OPENAI, baseUrl: "not a url" }, input),
    ).toBeNull();
    expect(loggedLines()[0]).toContain("invalid-url");
  });
});
