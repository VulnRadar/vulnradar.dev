/**
 * resolveChatModel (lib/ai/chat/model.ts): what the chat hands the AI SDK for
 * each kind of endpoint.
 *
 * The two provider factories are the boundary (they would otherwise build real
 * HTTP clients), so they are mocked to record the settings they were given and
 * return a minimal model. wrapLanguageModel and the reasoning extractor are the
 * SDK's own and run for real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { APP_NAME, APP_URL } from "@/lib/config/constants";

function fakeModel(modelId: string) {
  return {
    specificationVersion: "v4" as const,
    provider: "fake",
    modelId,
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  };
}

const createOpenAI = vi.fn();
const createAnthropic = vi.fn();

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (...args: unknown[]) => createOpenAI(...args),
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: (...args: unknown[]) => createAnthropic(...args),
}));

const { resolveChatModel } = await import("@/lib/ai/chat/model");

beforeEach(() => {
  createOpenAI.mockReset();
  createOpenAI.mockImplementation(() => ({
    chat: (modelId: string) => fakeModel(modelId),
  }));
  createAnthropic.mockReset();
  createAnthropic.mockImplementation(
    () => (modelId: string) => fakeModel(modelId),
  );
});

function config(overrides: Record<string, unknown> = {}) {
  return {
    baseUrl: "https://api.example-llm.test/v1",
    apiKey: "test-key",
    model: "plain-model",
    maxTokens: 4000,
    reasoning: false,
    ...overrides,
  };
}

function openAiSettings(): Record<string, unknown> {
  return createOpenAI.mock.calls[0][0] as Record<string, unknown>;
}

describe("resolveChatModel: an OpenAI-compatible endpoint", () => {
  it("identifies this deployment to OpenRouter", () => {
    resolveChatModel(config({ baseUrl: "https://openrouter.ai/api/v1" }));

    expect(openAiSettings().headers).toEqual({
      "HTTP-Referer": APP_URL,
      "X-Title": APP_NAME,
    });
  });

  it("sends no attribution to any other host", () => {
    resolveChatModel(config());

    expect(openAiSettings().headers).toEqual({});
  });

  it("does not throw on a base URL it cannot parse, and sends no attribution", () => {
    expect(() =>
      resolveChatModel(config({ baseUrl: "not a url" })),
    ).not.toThrow();

    expect(openAiSettings().headers).toEqual({});
  });

  it("passes the base URL and key through, and a placeholder key when there is none", () => {
    resolveChatModel(config({ apiKey: "" }));

    expect(openAiSettings()).toMatchObject({
      baseURL: "https://api.example-llm.test/v1",
      apiKey: "not-needed",
    });
  });

  it("asks for the chat-completions surface of the model it was given", () => {
    const { model } = resolveChatModel(config({ model: "some-model-id" }));

    // LanguageModel also admits a bare gateway id string; this one is the object.
    expect(typeof model).toBe("object");
    expect((model as { modelId: string }).modelId).toBe("some-model-id");
  });

  it("splices reasoning into the request body for a model that reasons, and only then", () => {
    resolveChatModel(
      config({
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4",
        reasoning: true,
      }),
    );
    expect(openAiSettings()).toHaveProperty("fetch");

    createOpenAI.mockClear();
    resolveChatModel(
      config({
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4",
        reasoning: false,
      }),
    );
    expect(openAiSettings()).not.toHaveProperty("fetch");
  });

  it("returns no provider options of its own", () => {
    expect(resolveChatModel(config()).providerOptions).toEqual({});
  });

  describe("the fetch it installs for a model that reasons", () => {
    const reasoningConfig = () =>
      config({
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4",
        reasoning: true,
      });

    /** Runs the installed fetch against a stand-in for the network and returns what reached it. */
    async function through(body: BodyInit | undefined): Promise<unknown> {
      resolveChatModel(reasoningConfig());
      const wrapped = openAiSettings().fetch as typeof fetch;
      const upstream = vi.fn(async () => new Response("{}"));
      const realFetch = global.fetch;
      global.fetch = upstream as unknown as typeof fetch;
      try {
        await wrapped("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          body,
        });
      } finally {
        global.fetch = realFetch;
      }
      return (upstream.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body;
    }

    it("splices the reasoning field into a JSON request body", async () => {
      const sent = await through(
        JSON.stringify({ model: "gpt-5.4", messages: [] }),
      );

      expect(JSON.parse(sent as string)).toEqual({
        model: "gpt-5.4",
        messages: [],
        reasoning_effort: "medium",
      });
    });

    it("sends a body that is not JSON exactly as it was", async () => {
      expect(await through("not json")).toBe("not json");
    });

    it("sends a request with no body as it was", async () => {
      expect(await through(undefined)).toBeUndefined();
    });
  });
});

describe("resolveChatModel: an Anthropic-shaped endpoint", () => {
  const anthropic = (overrides: Record<string, unknown> = {}) =>
    config({
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-haiku-4-5-20251001",
      ...overrides,
    });

  it("uses the Anthropic provider and never builds an OpenAI client", () => {
    resolveChatModel(anthropic());

    expect(createOpenAI).not.toHaveBeenCalled();
    expect(createAnthropic).toHaveBeenCalledWith({
      baseURL: "https://api.anthropic.com/v1",
      apiKey: "test-key",
    });
  });

  it("asks for a thinking budget only when reasoning is on", () => {
    expect(
      resolveChatModel(anthropic({ reasoning: true })).providerOptions,
    ).toEqual({
      anthropic: { thinking: { type: "enabled", budgetTokens: 2000 } },
    });
    expect(resolveChatModel(anthropic()).providerOptions).toEqual({});
  });

  it("asks a model that picks its own thinking depth for adaptive thinking, with no budget", () => {
    expect(
      resolveChatModel(anthropic({ model: "claude-sonnet-5", reasoning: true }))
        .providerOptions,
    ).toEqual({ anthropic: { thinking: { type: "adaptive" } } });
  });

  it("says so out loud to a model that thinks unless told not to", () => {
    expect(
      resolveChatModel(anthropic({ model: "claude-sonnet-5" })).providerOptions,
    ).toEqual({ anthropic: { thinking: { type: "disabled" } } });
  });
});
