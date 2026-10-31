/**
 * The shared request half of the one-shot AI calls (lib/ai/transport.ts).
 *
 * Only the network (fetch) is mocked, with real Response objects so that
 * reading a body behaves as it does in production. Provider detection, the
 * Anthropic adapter and the reasoning rules all run for real: the point of the
 * module is that they are decided in one place, so a test that stubbed them
 * would be testing the stub.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
import {
  openRouterAttributionHeaders,
  postChatCompletion,
  type AiEndpoint,
} from "@/lib/ai/transport";

const OPENAI: AiEndpoint = {
  baseUrl: "https://api.example-llm.test/v1",
  apiKey: "test-key",
  model: "plain-model",
};

const request = {
  system: "You are a test assistant.",
  prompt: "Say hello.",
  maxTokens: 512,
  reasoning: false as const,
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function chatReply(
  content: string,
  usage?: Record<string, number>,
  init: ResponseInit = {},
): Response {
  return json(
    { choices: [{ message: { content } }], ...(usage ? { usage } : {}) },
    init,
  );
}

function anthropicReply(
  text: string,
  usage?: Record<string, number>,
): Response {
  return json({
    content: [{ type: "text", text }],
    ...(usage ? { usage } : {}),
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

/** The n-th request the code under test made, parsed. */
function sent(n = 0) {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
  return {
    url: String(url),
    init,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  };
}

function noticesFor(model: string): string[] {
  return errors.mock.calls
    .map((c: unknown[]) => String(c[0]))
    .filter((line: string) => line.includes(model));
}

describe("openRouterAttributionHeaders", () => {
  it("identifies this deployment to OpenRouter", () => {
    expect(
      openRouterAttributionHeaders("https://openrouter.ai/api/v1"),
    ).toEqual({ "HTTP-Referer": APP_URL, "X-Title": APP_NAME });
  });

  it("matches the host without regard to case", () => {
    expect(
      openRouterAttributionHeaders("https://OpenRouter.AI/api/v1"),
    ).toHaveProperty("X-Title", APP_NAME);
  });

  it.each([
    "https://api.openai.com/v1",
    "https://openrouter.ai.example.com/api/v1",
    "https://notopenrouter.ai/api/v1",
    "http://localhost:11434/v1",
  ])("sends nothing to %s", (baseUrl) => {
    expect(openRouterAttributionHeaders(baseUrl)).toEqual({});
  });

  it.each(["", "not a url", "openrouter.ai/api/v1"])(
    "sends nothing, and does not throw, for the unparseable base URL %j",
    (baseUrl) => {
      expect(openRouterAttributionHeaders(baseUrl)).toEqual({});
    },
  );
});

describe("postChatCompletion: an OpenAI-compatible endpoint", () => {
  it("posts the system and user prompts to /chat/completions", async () => {
    fetchMock.mockResolvedValueOnce(chatReply("Hello."));

    await postChatCompletion(OPENAI, request);

    const call = sent();
    expect(call.url).toBe("https://api.example-llm.test/v1/chat/completions");
    expect(call.init.method).toBe("POST");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(call.headers["Authorization"]).toBe("Bearer test-key");
    expect(call.body).toEqual({
      model: "plain-model",
      max_tokens: 512,
      messages: [
        { role: "system", content: "You are a test assistant." },
        { role: "user", content: "Say hello." },
      ],
    });
  });

  it("sends no Authorization header to an endpoint that has no key", async () => {
    fetchMock.mockResolvedValueOnce(chatReply("Hello."));

    await postChatCompletion({ ...OPENAI, apiKey: "" }, request);

    expect(sent().headers).not.toHaveProperty("Authorization");
  });

  it("attributes the request on OpenRouter and on no other host", async () => {
    fetchMock.mockImplementation(async () => chatReply("Hello."));

    await postChatCompletion(
      { ...OPENAI, baseUrl: "https://openrouter.ai/api/v1" },
      request,
    );
    await postChatCompletion(OPENAI, request);

    expect(sent(0).headers["HTTP-Referer"]).toBe(APP_URL);
    expect(sent(0).headers["X-Title"]).toBe(APP_NAME);
    expect(sent(1).headers).not.toHaveProperty("HTTP-Referer");
    expect(sent(1).headers).not.toHaveProperty("X-Title");
  });

  it("hands the caller's AbortSignal to fetch", async () => {
    fetchMock.mockResolvedValueOnce(chatReply("Hello."));
    const controller = new AbortController();

    await postChatCompletion(OPENAI, { ...request, signal: controller.signal });

    expect(sent().init.signal).toBe(controller.signal);
  });

  it("returns the reply untouched, reasoning included, with the provider's total", async () => {
    fetchMock.mockResolvedValueOnce(
      chatReply("<think>hmm</think>Hello.", {
        prompt_tokens: 30,
        completion_tokens: 12,
        total_tokens: 99,
      }),
    );

    expect(await postChatCompletion(OPENAI, request)).toEqual({
      ok: true,
      text: "<think>hmm</think>Hello.",
      tokensUsed: 99,
    });
  });

  it("adds prompt and completion tokens when the provider gives no total", async () => {
    fetchMock.mockResolvedValueOnce(
      chatReply("Hello.", { prompt_tokens: 30, completion_tokens: 12 }),
    );

    expect(await postChatCompletion(OPENAI, request)).toMatchObject({
      ok: true,
      tokensUsed: 42,
    });
  });

  it("reports zero tokens when the provider reports none", async () => {
    fetchMock.mockResolvedValueOnce(chatReply("Hello."));

    expect(await postChatCompletion(OPENAI, request)).toMatchObject({
      ok: true,
      tokensUsed: 0,
    });
  });

  it("returns empty text, not a failure, for a reply with no content, and still counts the tokens", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ choices: [{ message: {} }], usage: { total_tokens: 7 } }),
    );

    expect(await postChatCompletion(OPENAI, request)).toEqual({
      ok: true,
      text: "",
      tokensUsed: 7,
    });
  });

  it("returns empty text for a reply with no choices at all", async () => {
    fetchMock.mockResolvedValueOnce(json({}));

    expect(await postChatCompletion(OPENAI, request)).toEqual({
      ok: true,
      text: "",
      tokensUsed: 0,
    });
  });
});

describe("postChatCompletion: which reasoning field an OpenAI-compatible endpoint is sent", () => {
  const OPENAI_GPT5: AiEndpoint = {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "gpt-5.4",
  };

  it("sends none when reasoning is off, even to a model that reasons", async () => {
    fetchMock.mockResolvedValueOnce(chatReply("Hello."));

    await postChatCompletion(OPENAI_GPT5, { ...request, reasoning: false });

    expect(sent().body).not.toHaveProperty("reasoning_effort");
  });

  it.each([
    ["verify", "high"],
    ["summary", "low"],
  ] as const)(
    "sends reasoning_effort for the %s purpose at %s",
    async (reasoning, effort) => {
      fetchMock.mockResolvedValueOnce(chatReply("Hello."));

      await postChatCompletion(OPENAI_GPT5, { ...request, reasoning });

      expect(sent().body.reasoning_effort).toBe(effort);
    },
  );

  it("sends nothing to a model that takes no reasoning field", async () => {
    fetchMock.mockResolvedValueOnce(chatReply("Hello."));

    await postChatCompletion(
      { ...OPENAI_GPT5, model: "gpt-4o-mini" },
      { ...request, reasoning: "verify" },
    );

    expect(sent().body).not.toHaveProperty("reasoning_effort");
  });

  it("merges whatever shape the reasoning rules resolve, such as Gemini's thinking config", async () => {
    fetchMock.mockResolvedValueOnce(chatReply("Hello."));

    await postChatCompletion(
      {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey: "test-key",
        model: "gemini-2.5-flash",
      },
      { ...request, reasoning: "summary" },
    );

    expect(sent().body.google).toEqual({
      thinking_config: { include_thoughts: true },
    });
  });
});

describe("postChatCompletion: an endpoint that refuses the reasoning field", () => {
  const STRICT = (model: string): AiEndpoint => ({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model,
  });
  const refusal = () =>
    new Response("Unknown parameter: reasoning_effort", { status: 400 });

  it("posts again without the field and returns the second answer", async () => {
    fetchMock
      .mockResolvedValueOnce(refusal())
      .mockResolvedValueOnce(chatReply("Hello.", { total_tokens: 21 }));

    const result = await postChatCompletion(STRICT("gpt-5.4-a"), {
      ...request,
      reasoning: "verify",
    });

    expect(result).toEqual({ ok: true, text: "Hello.", tokensUsed: 21 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(0).body.reasoning_effort).toBe("high");
    expect(sent(1).body).not.toHaveProperty("reasoning_effort");
    const { reasoning_effort: _field, ...firstWithoutField } = sent(0).body;
    expect(sent(1).body).toEqual(firstWithoutField);
    expect(sent(1).url).toBe(sent(0).url);
    expect(sent(1).headers).toEqual(sent(0).headers);
  });

  it("names the feature and model that refused, once per process", async () => {
    for (let i = 0; i < 3; i++) {
      fetchMock
        .mockResolvedValueOnce(refusal())
        .mockResolvedValueOnce(chatReply("Hello."));
      await postChatCompletion(STRICT("gpt-5.4-b"), {
        ...request,
        reasoning: "verify",
        scope: "AI-VERIFY",
      });
    }

    const notices = noticesFor("gpt-5.4-b");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("[AI-VERIFY]");
    expect(notices[0]).toContain("reasoning_effort");
  });

  it("falls back to a generic scope when the caller names none", async () => {
    fetchMock
      .mockResolvedValueOnce(refusal())
      .mockResolvedValueOnce(chatReply("Hello."));

    await postChatCompletion(STRICT("gpt-5.4-c"), {
      ...request,
      reasoning: "summary",
    });

    expect(noticesFor("gpt-5.4-c")[0]).toContain("[AI]");
  });

  it("does not retry a 400 that is not about reasoning, and returns what the endpoint said", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("max_tokens is too large", { status: 400 }),
    );

    expect(
      await postChatCompletion(STRICT("gpt-5.4-d"), {
        ...request,
        reasoning: "verify",
      }),
    ).toEqual({ ok: false, status: 400, detail: "max_tokens is too large" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry when reasoning is off, whatever the 400 says", async () => {
    fetchMock.mockResolvedValueOnce(refusal());

    const result = await postChatCompletion(STRICT("gpt-5.4-e"), request);

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the model was never sent the field", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("the reasoning you gave is invalid", { status: 400 }),
    );

    const result = await postChatCompletion(STRICT("gpt-4o-mini"), {
      ...request,
      reasoning: "verify",
    });

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a status other than 400, even if the body mentions reasoning", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("reasoning engine overloaded", { status: 503 }),
    );

    expect(
      await postChatCompletion(STRICT("gpt-5.4-f"), {
        ...request,
        reasoning: "verify",
      }),
    ).toEqual({
      ok: false,
      status: 503,
      detail: "reasoning engine overloaded",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once and reports the second refusal rather than looping", async () => {
    fetchMock
      .mockResolvedValueOnce(refusal())
      .mockResolvedValueOnce(new Response("still no", { status: 400 }));

    expect(
      await postChatCompletion(STRICT("gpt-5.4-g"), {
        ...request,
        reasoning: "verify",
      }),
    ).toEqual({ ok: false, status: 400, detail: "still no" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a different failure on the retry as that failure", async () => {
    fetchMock
      .mockResolvedValueOnce(refusal())
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }));

    expect(
      await postChatCompletion(STRICT("gpt-5.4-h"), {
        ...request,
        reasoning: "verify",
      }),
    ).toEqual({ ok: false, status: 429, detail: "slow down" });
  });
});

describe("postChatCompletion: an HTTP failure is a value, not a throw", () => {
  it.each([401, 403, 404, 429, 500, 503])(
    "returns status %i and the endpoint's own words",
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        new Response(`upstream said ${status}`, { status }),
      );

      expect(await postChatCompletion(OPENAI, request)).toEqual({
        ok: false,
        status,
        detail: `upstream said ${status}`,
      });
    },
  );

  it("returns an empty detail when the error body cannot be read", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => {
        throw new Error("socket hang up");
      },
    });

    expect(await postChatCompletion(OPENAI, request)).toEqual({
      ok: false,
      status: 502,
      detail: "",
    });
  });

  it("does not log the failure: what a 429 or a 401 means is the caller's call", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401 }));

    await postChatCompletion(OPENAI, request);

    expect(errors).not.toHaveBeenCalled();
  });
});

describe("postChatCompletion: a request that got no answer still throws", () => {
  it("rejects when the network does", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(postChatCompletion(OPENAI, request)).rejects.toThrow(
      "fetch failed",
    );
  });

  it("rejects when the caller aborts", async () => {
    const abort = new Error("This operation was aborted");
    abort.name = "AbortError";
    fetchMock.mockRejectedValueOnce(abort);

    await expect(postChatCompletion(OPENAI, request)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("rejects on a 200 that is not JSON, as the callers' own catch blocks expect", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>gateway</html>"));

    await expect(postChatCompletion(OPENAI, request)).rejects.toThrow();
  });
});

describe("postChatCompletion: an Anthropic-shaped endpoint", () => {
  const ANTHROPIC: AiEndpoint = {
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "sk-ant-test",
    model: "claude-haiku-4-5-20251001",
  };

  it("posts to /messages with x-api-key and the system prompt out of band", async () => {
    fetchMock.mockResolvedValueOnce(anthropicReply("Hello."));

    await postChatCompletion(ANTHROPIC, request);

    const call = sent();
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.headers["x-api-key"]).toBe("sk-ant-test");
    expect(call.headers).toHaveProperty("anthropic-version");
    expect(call.headers).not.toHaveProperty("Authorization");
    expect(call.body.system).toBe("You are a test assistant.");
    expect(call.body.messages).toEqual([
      { role: "user", content: "Say hello." },
    ]);
    expect(call.body.max_tokens).toBe(512);
  });

  it("treats a provider's /anthropic path as Anthropic-shaped", async () => {
    fetchMock.mockResolvedValueOnce(anthropicReply("Hello."));

    await postChatCompletion(
      { ...ANTHROPIC, baseUrl: "https://api.minimax.io/anthropic" },
      request,
    );

    expect(sent().url).toBe("https://api.minimax.io/anthropic/messages");
  });

  it("returns the text and the input and output tokens added together", async () => {
    fetchMock.mockResolvedValueOnce(
      anthropicReply("Hello.", { input_tokens: 200, output_tokens: 30 }),
    );

    expect(await postChatCompletion(ANTHROPIC, request)).toEqual({
      ok: true,
      text: "Hello.",
      tokensUsed: 230,
    });
  });

  it("reports zero tokens when the response has no usage", async () => {
    fetchMock.mockResolvedValueOnce(anthropicReply("Hello."));

    expect(await postChatCompletion(ANTHROPIC, request)).toMatchObject({
      tokensUsed: 0,
    });
  });

  it("hands the caller's AbortSignal to fetch", async () => {
    fetchMock.mockResolvedValueOnce(anthropicReply("Hello."));
    const controller = new AbortController();

    await postChatCompletion(ANTHROPIC, {
      ...request,
      signal: controller.signal,
    });

    expect(sent().init.signal).toBe(controller.signal);
  });

  it("asks for thinking, with a budget scaled off maxTokens, when reasoning is on", async () => {
    fetchMock.mockResolvedValueOnce(anthropicReply("Hello."));

    await postChatCompletion(ANTHROPIC, {
      ...request,
      maxTokens: 4000,
      reasoning: "verify",
    });

    expect(sent().body.thinking).toEqual({
      type: "enabled",
      budget_tokens: 2000,
    });
  });

  it("asks for no thinking when reasoning is off", async () => {
    fetchMock.mockResolvedValueOnce(anthropicReply("Hello."));

    await postChatCompletion(ANTHROPIC, { ...request, maxTokens: 4000 });

    expect(sent().body).not.toHaveProperty("thinking");
  });

  it("says so explicitly to a model that thinks unless told not to", async () => {
    fetchMock.mockResolvedValueOnce(anthropicReply("Hello."));

    await postChatCompletion(
      { ...ANTHROPIC, model: "claude-sonnet-5" },
      { ...request, maxTokens: 4000 },
    );

    expect(sent().body.thinking).toEqual({ type: "disabled" });
  });

  it("lets an explicit thinkingBudget replace the derived one", async () => {
    fetchMock.mockResolvedValueOnce(anthropicReply("Hello."));

    await postChatCompletion(ANTHROPIC, {
      ...request,
      maxTokens: 8000,
      reasoning: "verify",
      thinkingBudget: 1500,
    });

    expect(sent().body.thinking).toEqual({
      type: "enabled",
      budget_tokens: 1500,
    });
  });

  it("treats an explicit thinkingBudget of 0 as no thinking even when reasoning is on", async () => {
    fetchMock.mockResolvedValueOnce(anthropicReply("Hello."));

    await postChatCompletion(ANTHROPIC, {
      ...request,
      maxTokens: 8000,
      reasoning: "verify",
      thinkingBudget: 0,
    });

    expect(sent().body).not.toHaveProperty("thinking");
  });

  it("turns the adapter's thrown error into the same failure value", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: { message: "invalid x-api-key" } }, { status: 401 }),
    );

    expect(await postChatCompletion(ANTHROPIC, request)).toEqual({
      ok: false,
      status: 401,
      detail: "invalid x-api-key",
    });
  });

  it("does not retry here: the refused-field retry belongs to the chat-completions path", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        { error: { message: "thinking is not supported" } },
        { status: 400 },
      ),
    );

    expect(
      await postChatCompletion(ANTHROPIC, {
        ...request,
        maxTokens: 4000,
        reasoning: "verify",
      }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still throws when there was no answer to read", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(postChatCompletion(ANTHROPIC, request)).rejects.toThrow(
      "fetch failed",
    );
  });
});
