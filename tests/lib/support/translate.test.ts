/**
 * Support across a language barrier (lib/support/translate.ts).
 *
 * The rules that matter here are about a support record, not about
 * translation quality: the original is never replaced, a translation is
 * generated once and then read from the cache, and nothing about the thread
 * breaks when there is no AI provider to ask.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockComplete = vi.fn();
vi.mock("@/lib/ai/complete", () => ({
  completeShortText: (...args: unknown[]) => mockComplete(...args),
}));

const mockResolveEndpoint = vi.fn();
vi.mock("@/lib/ai/verify-findings", () => ({
  resolveServerEndpoint: () => mockResolveEndpoint(),
}));

const {
  detectMessageLanguage,
  translateText,
  translateTicketMessage,
  prepareMessageTranslation,
} = await import("@/lib/support/translate");

const ENDPOINT = {
  baseUrl: "https://api.example/v1",
  apiKey: "k",
  model: "m",
};

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockComplete.mockReset();
  mockResolveEndpoint.mockReset();
  mockResolveEndpoint.mockReturnValue(ENDPOINT);
});

describe("without an AI provider", () => {
  it("detects nothing and translates nothing, rather than failing", async () => {
    mockResolveEndpoint.mockReturnValue(null);
    expect(await detectMessageLanguage("Hola, tengo un problema")).toBeNull();
    expect(await translateText("Hola", "en")).toBeNull();
    expect(mockComplete).not.toHaveBeenCalled();
  });
});

describe("detectMessageLanguage", () => {
  it("takes a language the app speaks", async () => {
    mockComplete.mockResolvedValue("es");
    expect(
      await detectMessageLanguage("Hola, no puedo escanear mi dominio"),
    ).toBe("es");
  });

  it("refuses an answer that is not one of ours", async () => {
    mockComplete.mockResolvedValue("other");
    expect(
      await detectMessageLanguage("Bok, imam problem sa skeniranjem"),
    ).toBeNull();
  });

  it("does not guess from a couple of words", async () => {
    expect(await detectMessageLanguage("hi")).toBeNull();
    expect(mockComplete).not.toHaveBeenCalled();
  });
});

describe("translateTicketMessage", () => {
  const message = {
    id: 7,
    body: "No puedo escanear mi dominio",
    body_locale: "es",
    translations: null as Record<string, string> | null,
  };

  it("reads a cached translation instead of asking again", async () => {
    const result = await translateTicketMessage(
      { ...message, translations: { en: "I cannot scan my domain" } },
      "en",
    );
    expect(result).toEqual({ text: "I cannot scan my domain", cached: true });
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("treats a message already in that language as its own translation", async () => {
    const result = await translateTicketMessage({ ...message }, "es");
    expect(result?.text).toBe(message.body);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("translates once, then writes it back for the next reader", async () => {
    mockComplete.mockResolvedValue("I cannot scan my domain");

    const result = await translateTicketMessage({ ...message }, "en");

    expect(result).toEqual({ text: "I cannot scan my domain", cached: false });
    const write = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes("translations ="),
    );
    expect(write).toBeDefined();
    expect(JSON.parse((write![1] as unknown[])[0] as string)).toEqual({
      en: "I cannot scan my domain",
    });
  });

  it("leaves the message as written when the model does not answer", async () => {
    mockComplete.mockResolvedValue(null);
    expect(await translateTicketMessage({ ...message }, "en")).toBeNull();
  });

  it("does not send a message longer than the cap", async () => {
    const huge = "a".repeat(6001);
    expect(await translateText(huge, "en")).toBeNull();
    expect(mockComplete).not.toHaveBeenCalled();
  });
});

describe("prepareMessageTranslation", () => {
  it("records the language and translates it for the other side", async () => {
    mockComplete
      .mockResolvedValueOnce("es") // detection
      .mockResolvedValueOnce("I cannot scan my domain"); // translation

    await prepareMessageTranslation({
      messageId: 7,
      body: "No puedo escanear mi dominio",
      authorLocale: null,
      counterpartLocales: ["en"],
    });

    const wroteLocale = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes("SET body_locale"),
    );
    expect(wroteLocale?.[1]).toEqual(["es", 7]);
    const wroteTranslation = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes("translations ="),
    );
    expect(
      JSON.parse((wroteTranslation![1] as unknown[])[0] as string),
    ).toEqual({ en: "I cannot scan my domain" });
  });

  it("does not translate a message into the language it is already in", async () => {
    mockComplete.mockResolvedValueOnce("en");

    await prepareMessageTranslation({
      messageId: 8,
      body: "I cannot scan my domain, it keeps timing out",
      authorLocale: "en",
      counterpartLocales: ["en"],
    });

    // One call: the detection. Nothing to translate.
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default language when the other side has none", async () => {
    mockComplete
      .mockResolvedValueOnce("ja")
      .mockResolvedValueOnce("The scan will not start");

    await prepareMessageTranslation({
      messageId: 9,
      body: "スキャンが開始できません。ドメインは確認済みです。",
      authorLocale: null,
      counterpartLocales: [],
    });

    const wrote = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes("translations ="),
    );
    expect(JSON.parse((wrote![1] as unknown[])[0] as string)).toEqual({
      en: "The scan will not start",
    });
  });
});

describe("a cache that cannot be written", () => {
  // Every one of these used to be `.catch(() => {})`. A cache that never
  // writes means every reader pays for the model again, which reaches the
  // operator as a bill and never as an error. The translation itself must
  // still reach the reader, so none of these may throw.
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const writeFailure = new Error("deadlock detected");

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValue(writeFailure);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("still returns the translation, and logs the message and language", async () => {
    mockComplete.mockResolvedValue("I cannot scan my domain");

    const result = await translateTicketMessage(
      {
        id: 7,
        body: "No puedo escanear mi dominio",
        body_locale: "es",
        translations: null,
      },
      "en",
    );

    expect(result).toEqual({ text: "I cannot scan my domain", cached: false });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message, ctx, err] = errorSpy.mock.calls[0];
    expect(message).toBe("[support] could not cache a ticket translation");
    expect(ctx).toEqual({ messageId: 7, locale: "en" });
    expect(err).toBe(writeFailure);
  });

  it("logs a failure to store the detected language, and carries on translating", async () => {
    mockComplete
      .mockResolvedValueOnce("es")
      .mockResolvedValueOnce("I cannot scan my domain");

    await expect(
      prepareMessageTranslation({
        messageId: 11,
        body: "No puedo escanear mi dominio",
        authorLocale: null,
        counterpartLocales: ["en"],
      }),
    ).resolves.toBeUndefined();

    const messages = errorSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(messages).toEqual([
      "[support] could not store a ticket message's language",
      "[support] could not cache a ticket translation",
    ]);
    expect(errorSpy.mock.calls[0][1]).toEqual({ messageId: 11, locale: "es" });
    expect(errorSpy.mock.calls[1][1]).toEqual({ messageId: 11, locale: "en" });
  });

  it("is silent when the writes succeed", async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockComplete.mockResolvedValue("I cannot scan my domain");
    await translateTicketMessage(
      {
        id: 7,
        body: "No puedo escanear mi dominio",
        body_locale: "es",
        translations: null,
      },
      "en",
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
