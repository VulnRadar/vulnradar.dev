/**
 * A verification call has to fit inside what the route reserved for it, on
 * the page's own content, before the call is made.
 *
 * The ceiling counted three characters per token, and the target chooses most
 * of what a verify prompt holds: the body snippet and the response headers.
 * A page of emoji, CJK text or symbol-heavy code tokenises far denser than
 * that, so one call could cost several times its reservation, and the settle
 * charged the overrun afterwards with a floor at zero.
 *
 * The provider below answers every call with the most a byte-level tokenizer
 * can charge for it: one input token per UTF-8 byte sent, plus the whole
 * output allowance. Whatever the run spends against that provider is the
 * worst case, and it has to stay inside the reservation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Vulnerability } from "@/lib/scanner/types";
import type { AiTokenReservation } from "@/lib/billing/ai-usage";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockSafeFetch = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));

const mockSettleAiTokens = vi.fn();
vi.mock("@/lib/billing/ai-usage", () => ({
  settleAiTokens: (...args: unknown[]) => mockSettleAiTokens(...args),
}));

const { verifyFindingsBatchWithOutcome, estimateVerifyTokens } =
  await import("@/lib/ai/verify-findings");
const { CONFIG_AI_VERIFY_PROBE_BODY_SNIPPET_CHARS } =
  await import("@/lib/config/config-values");

function reservation(budget: number): AiTokenReservation {
  return {
    userId: 42,
    usingOwnAi: false,
    windowStart: new Date(0),
    budget,
    windowPortion: budget,
    creditPortion: 0,
    slotKey: null,
    settled: false,
  };
}

function makeFinding(id: string): Vulnerability {
  return {
    id,
    title: `Finding ${id}`,
    severity: "medium",
    category: "headers",
    description: "",
    evidence: "some evidence",
    riskImpact: "",
    explanation: "",
    fixSteps: [],
    codeExamples: [],
  } as unknown as Vulnerability;
}

/** A probe response whose body is exactly these bytes. */
function probeWithBody(bytes: Uint8Array, headers = new Headers()) {
  return {
    status: 200,
    url: "https://example.com/",
    headers,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

/** Bytes of `text` repeated until they fill the probe's whole body cap. */
function fillCap(text: string): Uint8Array {
  const unit = Buffer.from(text, "utf8");
  const out = new Uint8Array(CONFIG_AI_VERIFY_PROBE_BODY_SNIPPET_CHARS);
  for (let i = 0; i < out.length; i++) out[i] = unit[i % unit.length];
  return out;
}

/** Every call the provider received, as the bytes it was sent. */
const sentInputBytes: number[] = [];

/**
 * Bills each call at one token per UTF-8 byte of its messages, plus its whole
 * max_tokens, which no byte-level tokenizer can exceed.
 */
function worstCaseProvider() {
  (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
    async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as {
        max_tokens: number;
        messages: { content: string }[];
      };
      const input = body.messages.reduce(
        (sum, m) => sum + Buffer.byteLength(m.content, "utf8"),
        0,
      );
      sentInputBytes.push(input);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  verdict: "confirmed",
                  confidence: 90,
                  reason: "seen in the probe",
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: input,
            completion_tokens: body.max_tokens,
            total_tokens: input + body.max_tokens,
          },
        }),
      };
    },
  );
}

/** What the pass settled its reservation with. */
function spent(): number {
  expect(mockSettleAiTokens).toHaveBeenCalledTimes(1);
  return mockSettleAiTokens.mock.calls[0][1] as number;
}

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockSafeFetch.mockReset();
  mockSettleAiTokens.mockReset();
  sentInputBytes.length = 0;

  process.env.AI_BASE_URL = "https://api.example-llm.test/v1";
  process.env.AI_API_KEY = "test-key";
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;

  global.fetch = vi.fn();
  worstCaseProvider();
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe("verification stays inside its reservation on dense page content", () => {
  it.each([
    ["emoji", "\u{1F600}\u{1F525}\u{1F680}"],
    ["CJK text", "漢字のページ"],
    ["symbol-heavy code", "{}[]();=>!&|^~?:"],
  ])("a probe body of %s costs no more than was reserved", async (_, text) => {
    mockSafeFetch.mockResolvedValue(probeWithBody(fillCap(text)));
    const findings = [makeFinding("f1"), makeFinding("f2")];
    const { estimate } = await estimateVerifyTokens(findings);

    await verifyFindingsBatchWithOutcome(
      "https://example.com",
      findings,
      42,
      reservation(estimate),
    );

    // The full reservation covers both findings: they are verified, and at
    // the worst a provider could bill them the pass is still inside it.
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(spent()).toBeLessThanOrEqual(estimate);
  });

  it("a probe body of control characters is cut to fit rather than sent at six times its size", async () => {
    // A control character is one byte on the wire and six (\u0001) once the
    // prompt JSON-encodes it, so a page of them used to make each call cost
    // several reservations.
    mockSafeFetch.mockResolvedValue(
      probeWithBody(
        new Uint8Array(CONFIG_AI_VERIFY_PROBE_BODY_SNIPPET_CHARS).fill(1),
      ),
    );
    const findings = [makeFinding("f1")];
    const { estimate } = await estimateVerifyTokens(findings);

    const { outcome } = await verifyFindingsBatchWithOutcome(
      "https://example.com",
      findings,
      42,
      reservation(estimate),
    );

    expect(outcome.verdicts).toBe(1);
    expect(spent()).toBeLessThanOrEqual(estimate);
  });

  it("refuses a call whose prompt would overrun the reservation, before sending it", async () => {
    // Response headers are counted at a fixed allowance when the route
    // reserves, before the probe has run. A target that sends more than that
    // makes the built prompt larger than the reservation: the call is not
    // made, rather than made and charged afterwards.
    const headers = new Headers();
    for (let i = 0; i < 40; i++) {
      headers.set(`x-pad-${i}`, "é".repeat(1000));
    }
    mockSafeFetch.mockResolvedValue(probeWithBody(fillCap("a"), headers));
    const findings = [makeFinding("f1")];
    const { estimate } = await estimateVerifyTokens(findings);

    const { outcome } = await verifyFindingsBatchWithOutcome(
      "https://example.com",
      findings,
      42,
      reservation(estimate),
    );

    expect(global.fetch).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ verdicts: 0, budgetExhausted: true });
    expect(spent()).toBe(0);
  });

  it("admits a call at what it really sends, so a small page does not use up a full-size reservation", async () => {
    // Two findings' worth of reservation, three findings. The reservation
    // assumed a full-size body and header block for each; this page has
    // neither, so its real worst case leaves room for the third.
    mockSafeFetch.mockResolvedValue(
      probeWithBody(Buffer.from("<html></html>")),
    );
    const findings = [makeFinding("f1"), makeFinding("f2"), makeFinding("f3")];
    const { minimum } = await estimateVerifyTokens(findings);

    const { outcome } = await verifyFindingsBatchWithOutcome(
      "https://example.com",
      findings,
      42,
      reservation(minimum * 2),
    );

    expect(outcome.verdicts).toBe(3);
    expect(spent()).toBeLessThanOrEqual(minimum * 2);
  });
});
