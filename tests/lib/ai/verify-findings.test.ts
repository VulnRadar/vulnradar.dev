/**
 * Coverage for the chunked/concurrency-capped AI verification batch runner
 * added to fix large scans dropping every result once a fixed total
 * timeout raced the whole (previously unbounded) parallel fan-out. The
 * network (fetch) and DB (pool.query) boundaries are mocked; the chunking,
 * merging, and incremental-persistence logic in lib/ai/verify-findings.ts
 * runs for real.
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

/** What the route's reserveAiTokens gate hands the pass. */
function reservation(
  overrides: Partial<AiTokenReservation> = {},
): AiTokenReservation {
  return {
    userId: 42,
    usingOwnAi: false,
    windowStart: new Date(0),
    budget: null,
    windowPortion: 0,
    creditPortion: 0,
    slotKey: null,
    settled: false,
    ...overrides,
  };
}

const {
  verifyFindingsBatch,
  verifyFindingsBatchWithOutcome,
  runAiVerification,
} = await import("@/lib/ai/verify-findings");
const { CONFIG_AI_VERIFY_CHUNK_SIZE } =
  await import("@/lib/config/config-values");

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

function confirmedResponse(id: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "confirmed",
              confidence: 90,
              reason: `real issue for ${id}`,
            }),
          },
        },
      ],
    }),
  };
}

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  mockQuery.mockReset();
  mockSafeFetch.mockReset();
  mockSafeFetch.mockResolvedValue({
    status: 200,
    url: "https://example.com/",
    headers: new Headers(),
    text: async () => "<html></html>",
  });
  mockSettleAiTokens.mockReset();

  process.env.AI_BASE_URL = "https://api.example-llm.test/v1";
  process.env.AI_API_KEY = "test-key";
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;

  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe("verifyFindingsBatch: concurrency-capped chunking", () => {
  it("never has more than CONFIG_AI_VERIFY_CHUNK_SIZE fetch calls in flight at once", async () => {
    let inFlight = 0;
    let peak = 0;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return confirmedResponse("x");
    });

    const findings = Array.from(
      { length: CONFIG_AI_VERIFY_CHUNK_SIZE * 3 + 2 },
      (_, i) => makeFinding(`f${i}`),
    );

    await verifyFindingsBatch("https://example.com", findings, null, null);

    expect(peak).toBeLessThanOrEqual(CONFIG_AI_VERIFY_CHUNK_SIZE);
    expect(global.fetch).toHaveBeenCalledTimes(findings.length);
  });

  it("applies a verdict to every finding when every call succeeds", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        const findingIdMatch = /finding_id: (\S+)/.exec(
          body.messages[1].content,
        );
        return confirmedResponse(findingIdMatch?.[1] ?? "unknown");
      },
    );

    const findings = [makeFinding("f1"), makeFinding("f2"), makeFinding("f3")];
    const result = await verifyFindingsBatch(
      "https://example.com",
      findings,
      null,
      null,
    );

    expect(result).toHaveLength(3);
    for (const f of result) {
      expect(f.aiVerdict).toBe("confirmed");
      expect(f.aiConfidence).toBe(90);
    }
  });

  it("routes to the native Anthropic adapter (x-api-key, /messages) when the endpoint is Anthropic", async () => {
    process.env.AI_BASE_URL = "https://api.anthropic.com/v1";
    process.env.AI_MODEL = "claude-haiku-4-5-20251001";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              verdict: "confirmed",
              confidence: 88,
              reason: "header absent",
            }),
          },
        ],
      }),
    });

    const findings = [makeFinding("f1")];
    const result = await verifyFindingsBatch(
      "https://example.com",
      findings,
      null,
      null,
    );

    expect(result[0].aiVerdict).toBe("confirmed");
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init as RequestInit).headers).toMatchObject({
      "x-api-key": "test-key",
    });
  });
});

describe("verifyFindingsBatch: large scan coverage", () => {
  it("gets a verdict for every finding in a 60+ finding scan under the production total-timeout budget", async () => {
    // No artificial delay: models a normally-responsive provider. The
    // point of this test is coverage (does every finding reach a verdict
    // before the deadline?), not latency, so real timers are fine -- a
    // scan this size finishing in milliseconds of real test time is well
    // inside even the *old* 90s budget, let alone the current one; what
    // used to fail here was chunk-size x deadline arithmetic capping how
    // many findings could ever be attempted, not per-call speed.
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        const findingIdMatch = /finding_id: (\S+)/.exec(
          body.messages[1].content,
        );
        return confirmedResponse(findingIdMatch?.[1] ?? "unknown");
      },
    );

    // Deliberately not a multiple of the chunk size, and comfortably past
    // the 57 findings from the real scan that exposed this bug.
    const TOTAL_FINDINGS = 62;
    const findings = Array.from({ length: TOTAL_FINDINGS }, (_, i) =>
      makeFinding(`f${i}`),
    );

    const result = await verifyFindingsBatch(
      "https://example.com",
      findings,
      null,
      null,
    );

    expect(result).toHaveLength(TOTAL_FINDINGS);
    const verifiedCount = result.filter(
      (f) => f.aiVerdict === "confirmed",
    ).length;
    expect(verifiedCount).toBe(TOTAL_FINDINGS);
  });
});

describe("runAiVerification: says whether it actually ran", () => {
  /**
   * It used to return void, and the route answered `success: true` either
   * way, so a provider outage and a clean sweep reached the browser as the
   * same green "AI didn't confirm any findings" card. The outcome is what
   * lets the modal tell those two apart.
   */
  it("reports configured:false when no endpoint resolves", async () => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    mockQuery.mockResolvedValue({ rows: [] });

    const outcome = await runAiVerification(
      "https://example.com",
      [makeFinding("f1")],
      42,
      null,
      null,
    );

    expect(outcome).toMatchObject({
      configured: false,
      verdicts: 0,
      attempted: 1,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("reports zero verdicts when the provider answers nothing usable", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => "upstream unavailable",
    });

    const outcome = await runAiVerification(
      "https://example.com",
      [makeFinding("f1"), makeFinding("f2")],
      42,
      null,
      null,
    );

    expect(outcome.configured).toBe(true);
    expect(outcome.verdicts).toBe(0);
    expect(outcome.attempted).toBe(2);
  });

  it("stops at the first rate limit instead of sending every finding into it", async () => {
    // A 429 used to be logged and swallowed per finding, and the pass carried
    // on: forty findings meant forty requests into the same limit, forty
    // identical error-log rows, and a limit made longer by adding to it.
    mockQuery.mockResolvedValue({ rows: [] });
    const calls = { n: 0 };
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.n++;
      return {
        ok: false,
        status: 429,
        json: async () => ({}),
        text: async () => "rate limit reached",
      };
    });

    const findings = Array.from(
      { length: CONFIG_AI_VERIFY_CHUNK_SIZE * 4 },
      (_, i) => makeFinding(`f${i}`),
    );
    const outcome = await runAiVerification(
      "https://example.com",
      findings,
      42,
      null,
      null,
    );

    expect(outcome.rateLimited).toBe(true);
    expect(outcome.verdicts).toBe(0);
    // One chunk's worth of requests, then it stopped.
    expect(calls.n).toBeLessThanOrEqual(CONFIG_AI_VERIFY_CHUNK_SIZE);
  });

  it("stops at a refused key or unknown model and says so once", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const calls = { n: 0 };
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.n++;
      return {
        ok: false,
        status: 401,
        json: async () => ({}),
        text: async () => "invalid api key",
      };
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const findings = Array.from(
      { length: CONFIG_AI_VERIFY_CHUNK_SIZE * 4 },
      (_, i) => makeFinding(`f${i}`),
    );
    const outcome = await runAiVerification(
      "https://example.com",
      findings,
      42,
      null,
      null,
    );

    expect(outcome.verdicts).toBe(0);
    expect(calls.n).toBeLessThanOrEqual(CONFIG_AI_VERIFY_CHUNK_SIZE);
    const lines = errors.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes("returned 401"))).toHaveLength(1);
    expect(lines.some((l) => l.includes('for "f'))).toBe(false);
    errors.mockRestore();
  });

  it("counts the findings that did get a verdict", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      confirmedResponse("f1"),
    );

    const outcome = await runAiVerification(
      "https://example.com",
      [makeFinding("f1")],
      42,
      null,
      null,
    );

    expect(outcome).toMatchObject({ configured: true, attempted: 1 });
    expect(outcome.verdicts).toBeGreaterThan(0);
  });
});

describe("runAiVerification: an Anthropic-shaped endpoint fails the way an OpenAI-compatible one does", () => {
  /**
   * The 429 and 401/403/404 handling used to be written twice, once for a
   * Response and once for the Anthropic adapter's thrown error. The request
   * half is one function now (lib/ai/transport.ts) and the mapping is written
   * once, so the two API shapes have to agree on what stops a pass.
   */
  beforeEach(() => {
    process.env.AI_BASE_URL = "https://api.anthropic.com/v1";
    process.env.AI_MODEL = "claude-haiku-4-5-20251001";
    mockQuery.mockResolvedValue({ rows: [] });
  });

  function anthropicError(status: number, message: string): Response {
    return new Response(JSON.stringify({ error: { message } }), { status });
  }

  function manyFindings(): Vulnerability[] {
    return Array.from({ length: CONFIG_AI_VERIFY_CHUNK_SIZE * 4 }, (_, i) =>
      makeFinding(`f${i}`),
    );
  }

  it("stops at the first rate limit instead of sending every finding into it", async () => {
    const calls = { n: 0 };
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.n++;
      return anthropicError(429, "rate limit reached");
    });

    const outcome = await runAiVerification(
      "https://example.com",
      manyFindings(),
      42,
      null,
      null,
    );

    expect(outcome.rateLimited).toBe(true);
    expect(outcome.verdicts).toBe(0);
    expect(calls.n).toBeLessThanOrEqual(CONFIG_AI_VERIFY_CHUNK_SIZE);
  });

  it.each([401, 403, 404])(
    "stops at a %i and says so once, not once per finding",
    async (status) => {
      const calls = { n: 0 };
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        async () => {
          calls.n++;
          return anthropicError(status, "invalid x-api-key");
        },
      );
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});

      const outcome = await runAiVerification(
        "https://example.com",
        manyFindings(),
        42,
        null,
        null,
      );

      expect(outcome.verdicts).toBe(0);
      expect(calls.n).toBeLessThanOrEqual(CONFIG_AI_VERIFY_CHUNK_SIZE);
      const lines = errors.mock.calls.map((c) => String(c[0]));
      expect(
        lines.filter((l) => l.includes(`returned ${status}`)),
      ).toHaveLength(1);
      expect(lines.some((l) => l.includes('for "f'))).toBe(false);
      errors.mockRestore();
    },
  );
});

describe("runAiVerification: what is logged for a failure that does not stop the pass", () => {
  it.each([
    ["an OpenAI-compatible endpoint", "https://api.example-llm.test/v1"],
    ["an Anthropic-shaped endpoint", "https://api.anthropic.com/v1"],
  ])(
    "names the finding, the status and what %s said",
    async (_label, baseUrl) => {
      process.env.AI_BASE_URL = baseUrl;
      process.env.AI_MODEL = "some-model";
      mockQuery.mockResolvedValue({ rows: [] });
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ error: { message: "upstream exploded" } }),
            { status: 500 },
          ),
      );
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});

      const outcome = await runAiVerification(
        "https://example.com",
        [makeFinding("f1")],
        42,
        null,
        null,
      );

      expect(outcome.verdicts).toBe(0);
      const line = errors.mock.calls
        .map((c) => String(c[0]))
        .find((l) => l.includes('for "f1"'));
      expect(line).toBeDefined();
      expect(line).toContain("[AI-VERIFY]");
      expect(line).toContain("HTTP 500");
      expect(line).toContain("upstream exploded");
      errors.mockRestore();
    },
  );

  it("logs a request that never got an answer against the finding too", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError("fetch failed"),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await runAiVerification(
      "https://example.com",
      [makeFinding("f1")],
      42,
      null,
      null,
    );

    expect(outcome.verdicts).toBe(0);
    const line = errors.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes("callVerify failed"));
    expect(line).toContain('"f1"');
    expect(line).toContain("fetch failed");
    errors.mockRestore();
  });
});

describe("verifyFindingsBatch: reasoning on an OpenAI-compatible endpoint", () => {
  function sentBody(call: number): Record<string, unknown> {
    const init = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[
      call
    ][1] as RequestInit;
    return JSON.parse(init.body as string);
  }

  beforeEach(() => {
    process.env.AI_BASE_URL = "https://api.openai.com/v1";
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it("asks a reasoning model for the most reasoning there is, because the verdict is shown as a statement about the user's security", async () => {
    process.env.AI_MODEL = "gpt-5.4";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      confirmedResponse("f1"),
    );

    await verifyFindingsBatch(
      "https://example.com",
      [makeFinding("f1")],
      null,
      null,
    );

    expect(sentBody(0).reasoning_effort).toBe("high");
  });

  it("sends nothing extra to a model that takes no reasoning field", async () => {
    process.env.AI_MODEL = "gpt-4o-mini";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      confirmedResponse("f1"),
    );

    await verifyFindingsBatch(
      "https://example.com",
      [makeFinding("f1")],
      null,
      null,
    );

    expect(sentBody(0)).not.toHaveProperty("reasoning_effort");
  });

  it("keeps the verdict when the endpoint refuses the reasoning field, by asking again without it", async () => {
    process.env.AI_MODEL = "gpt-5.4-verify-retry";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response("Unknown parameter: reasoning_effort", { status: 400 }),
      )
      .mockResolvedValueOnce(confirmedResponse("f1"));

    const result = await verifyFindingsBatch(
      "https://example.com",
      [makeFinding("f1")],
      null,
      null,
    );

    expect(result[0].aiVerdict).toBe("confirmed");
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(sentBody(0).reasoning_effort).toBe("high");
    expect(sentBody(1)).not.toHaveProperty("reasoning_effort");
    const notice = errors.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes("gpt-5.4-verify-retry"));
    expect(notice).toContain("[AI-VERIFY]");
    errors.mockRestore();
  });
});

describe("verifyFindingsBatchWithOutcome: says whether the pass actually ran", () => {
  /**
   * verifyFindingsBatch returns the findings and nothing else, so a clean
   * sweep, a missing endpoint and a provider that was down for every chunk
   * are the same array. This returns the same findings plus the outcome
   * runAiVerification already reports, so a route can tell them apart.
   */
  beforeEach(() => {
    mockQuery.mockResolvedValue({ rows: [] });
  });

  function errorResponse(status: number): Response {
    return new Response(JSON.stringify({ error: { message: "nope" } }), {
      status,
    });
  }

  it("returns the findings with their verdicts and an outcome that counts them", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        const id = /finding_id: (\S+)/.exec(body.messages[1].content)?.[1];
        return confirmedResponse(id ?? "unknown");
      },
    );

    const { findings, outcome } = await verifyFindingsBatchWithOutcome(
      "https://example.com",
      [makeFinding("f1"), makeFinding("f2"), makeFinding("f3")],
      null,
      null,
    );

    expect(findings.map((f) => f.aiVerdict)).toEqual([
      "confirmed",
      "confirmed",
      "confirmed",
    ]);
    // Strict: a pass that was not rate limited carries no rateLimited key at all.
    expect(outcome).toStrictEqual({
      configured: true,
      verdicts: 3,
      attempted: 3,
    });
  });

  it("gives verifyFindingsBatch's findings exactly, so the two cannot disagree", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      confirmedResponse("x"),
    );
    const input = [makeFinding("f1"), makeFinding("f2")];

    const bare = await verifyFindingsBatch(
      "https://example.com",
      input,
      null,
      null,
    );
    const { findings } = await verifyFindingsBatchWithOutcome(
      "https://example.com",
      input,
      null,
      null,
    );

    expect(Array.isArray(bare)).toBe(true);
    expect(findings).toEqual(bare);
  });

  it("says no endpoint is configured, and hands the findings back untouched", async () => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    const input = [makeFinding("f1"), makeFinding("f2")];

    const { findings, outcome } = await verifyFindingsBatchWithOutcome(
      "https://example.com",
      input,
      null,
      null,
    );

    expect(findings).toBe(input);
    expect(outcome).toStrictEqual({
      configured: false,
      verdicts: 0,
      attempted: 2,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("treats a batch with nothing in it as configured, because no endpoint was looked for", async () => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    const input: Vulnerability[] = [];

    const { findings, outcome } = await verifyFindingsBatchWithOutcome(
      "https://example.com",
      input,
      null,
      null,
    );

    expect(findings).toBe(input);
    expect(outcome).toStrictEqual({
      configured: true,
      verdicts: 0,
      attempted: 0,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("reports a provider that was down as zero verdicts, not as nothing to confirm", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      errorResponse(503),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const { findings, outcome } = await verifyFindingsBatchWithOutcome(
      "https://example.com",
      [makeFinding("f1"), makeFinding("f2")],
      null,
      null,
    );

    expect(outcome).toStrictEqual({
      configured: true,
      verdicts: 0,
      attempted: 2,
    });
    expect(findings.every((f) => f.aiVerdict === undefined)).toBe(true);
    errors.mockRestore();
  });

  it("counts only the findings that got a verdict when the pass is partial", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        const id = /finding_id: (\S+)/.exec(body.messages[1].content)?.[1];
        return id === "f2" ? errorResponse(500) : confirmedResponse(id!);
      },
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const { findings, outcome } = await verifyFindingsBatchWithOutcome(
      "https://example.com",
      [makeFinding("f1"), makeFinding("f2")],
      null,
      null,
    );

    expect(outcome).toStrictEqual({
      configured: true,
      verdicts: 1,
      attempted: 2,
    });
    expect(findings[0].aiVerdict).toBe("confirmed");
    expect(findings[1].aiVerdict).toBeUndefined();
    errors.mockRestore();
  });

  it("marks a rate-limited pass so the reader is told to wait, not that nothing was wrong", async () => {
    const calls = { n: 0 };
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.n++;
      return errorResponse(429);
    });
    const findings = Array.from(
      { length: CONFIG_AI_VERIFY_CHUNK_SIZE * 4 },
      (_, i) => makeFinding(`f${i}`),
    );

    const { outcome } = await verifyFindingsBatchWithOutcome(
      "https://example.com",
      findings,
      null,
      null,
    );

    expect(outcome).toMatchObject({
      configured: true,
      verdicts: 0,
      rateLimited: true,
    });
    expect(outcome.attempted).toBe(findings.length);
    expect(calls.n).toBeLessThanOrEqual(CONFIG_AI_VERIFY_CHUNK_SIZE);
  });

  it("does not call a refused key a rate limit", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      errorResponse(401),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const { outcome } = await verifyFindingsBatchWithOutcome(
      "https://example.com",
      [makeFinding("f1")],
      null,
      null,
    );

    expect(outcome.verdicts).toBe(0);
    expect(outcome).not.toHaveProperty("rateLimited");
    errors.mockRestore();
  });

  it("settles the batch's real tokens once, exactly as verifyFindingsBatch does", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      confirmedResponseWithUsage("x", 100, 50),
    );
    const held = reservation();

    await verifyFindingsBatchWithOutcome(
      "https://example.com",
      [makeFinding("f1"), makeFinding("f2")],
      42,
      held,
    );

    expect(mockSettleAiTokens).toHaveBeenCalledTimes(1);
    expect(mockSettleAiTokens).toHaveBeenCalledWith(held, 300);
  });

  it("writes nothing to scan_history: persisting verdicts is runAiVerification's job", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      confirmedResponse("x"),
    );

    await verifyFindingsBatchWithOutcome(
      "https://example.com",
      [makeFinding("f1")],
      null,
      null,
    );

    const wrote = mockQuery.mock.calls.some(([sql]) =>
      String(sql).includes("UPDATE scan_history"),
    );
    expect(wrote).toBe(false);
  });
});

describe("runAiVerification: incremental persistence", () => {
  it("writes scan_history after every chunk, not only once at the end", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      confirmedResponse("x"),
    );

    // Two chunks' worth of findings (chunk size + a partial second chunk).
    const findings = Array.from(
      { length: CONFIG_AI_VERIFY_CHUNK_SIZE + 2 },
      (_, i) => makeFinding(`f${i}`),
    );

    await runAiVerification("https://example.com", findings, 42, null, null);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    for (const call of mockQuery.mock.calls) {
      expect(call[0]).toContain("UPDATE scan_history SET findings");
      expect(call[1][1]).toBe(42);
    }
    // The final write carries every finding's verdict, not just the last chunk's.
    const lastWriteFindings = JSON.parse(
      mockQuery.mock.calls[1][1][0] as string,
    );
    expect(
      lastWriteFindings.every(
        (f: { aiVerdict?: string }) => f.aiVerdict === "confirmed",
      ),
    ).toBe(true);
  });

  it("keeps verdicts from chunks that finished before the deadline, instead of discarding everything", async () => {
    vi.resetModules();

    // AI_VERIFY_TOTAL_TIMEOUT_MS is now resolved through the DB-backed
    // settings resolver (lib/config/runtime-config.ts) instead of read as a
    // static constant, so drive the deadline through a mocked
    // system_settings row rather than mocking lib/config/constants. This is
    // the first pool.query call resolveVerifySettings() makes; every other
    // key it asks for falls back to its shipped default since no other row
    // is returned. 5000 is the smallest value the registry allows for this
    // key (see lib/config/registry.ts), so it is the deadline itself, not a
    // stand-in for a real one.
    mockQuery.mockResolvedValueOnce({
      rows: [{ key: "AI_VERIFY_TOTAL_TIMEOUT_MS", value: "5000" }],
    });

    const { runAiVerification: runWithTinyDeadline } =
      await import("@/lib/ai/verify-findings");

    // Drive the deadline check with a controlled clock instead of a real
    // multi-second sleep: each AI call advances the fake clock by 6000ms,
    // which clears the 5000ms deadline above after the first chunk without
    // the test itself taking several real seconds to run.
    let simulatedNow = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => simulatedNow);

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      // Each call "takes" longer than the 5000ms total budget above, so
      // only the first chunk should complete before the deadline check trips.
      simulatedNow += 6000;
      return confirmedResponse("x");
    });

    const findings = Array.from(
      { length: CONFIG_AI_VERIFY_CHUNK_SIZE * 3 },
      (_, i) => makeFinding(`f${i}`),
    );

    try {
      await runWithTinyDeadline(
        "https://example.com",
        findings,
        42,
        null,
        null,
      );
    } finally {
      nowSpy.mockRestore();
    }

    // At least the first chunk's write happened, and it's strictly fewer
    // than every finding — proving partial progress survives instead of
    // every result being thrown away once the deadline passed. (The first
    // recorded call is the settings load, so more than one call means at
    // least one scan_history write also happened.)
    expect(mockQuery.mock.calls.length).toBeGreaterThan(1);
    const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
    expect(lastCall[0]).toContain("UPDATE scan_history SET findings");
    const lastWrite = JSON.parse(lastCall[1][0] as string);
    const verifiedCount = lastWrite.filter(
      (f: { aiVerdict?: string }) => f.aiVerdict === "confirmed",
    ).length;
    expect(verifiedCount).toBeGreaterThan(0);
    expect(verifiedCount).toBeLessThan(findings.length);
  });
});

describe("runAiVerification: syncs 'Mark this result' feedback from the AI verdict", () => {
  it("upserts scan_finding_feedback as confirmed when the AI verdict is confirmed", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      confirmedResponse("x"),
    );

    await runAiVerification(
      "https://example.com",
      [makeFinding("f1")],
      42,
      7,
      null,
    );

    const feedbackCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("scan_finding_feedback"),
    );
    expect(feedbackCall).toBeDefined();
    const [sql, params] = feedbackCall!;
    expect(sql).toContain(
      "ON CONFLICT (user_id, finding_id, finding_url) DO NOTHING",
    );
    // One statement per chunk, findings passed as arrays, so a chunk of ten
    // is one round trip rather than ten.
    expect(params).toEqual([
      7,
      42,
      "https://example.com",
      ["f1"],
      ["confirmed"],
    ]);
  });

  it("upserts scan_finding_feedback as false_positive when the AI verdict is possible_fp", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: "possible_fp",
                confidence: 80,
                reason: "header is present",
              }),
            },
          },
        ],
      }),
    });

    await runAiVerification(
      "https://example.com",
      [makeFinding("f1")],
      42,
      7,
      null,
    );

    const feedbackCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("scan_finding_feedback"),
    );
    expect(feedbackCall![1]).toEqual([
      7,
      42,
      "https://example.com",
      ["f1"],
      ["false_positive"],
    ]);
  });

  // Production logged this thirty times in one burst: a scan deleted while a
  // multi-minute verification was still running leaves every feedback insert
  // pointing at a row that is gone. The verdicts are still worth keeping, and
  // the schema says so, scan_history_id is nullable with ON DELETE SET NULL.
  it("re-inserts the feedback unlinked when the scan row was deleted mid-run", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      confirmedResponse("x"),
    );
    let sawFkViolation = false;
    mockQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      if (
        String(sql).includes("scan_finding_feedback") &&
        params?.[1] !== null
      ) {
        sawFkViolation = true;
        const err = new Error(
          'insert or update on table "scan_finding_feedback" violates foreign key constraint',
        ) as Error & { code?: string };
        err.code = "23503";
        throw err;
      }
      return { rows: [], rowCount: 0 };
    });

    await runAiVerification(
      "https://example.com",
      [makeFinding("f1")],
      42,
      7,
      null,
    );

    expect(sawFkViolation, "the linked insert must be attempted first").toBe(
      true,
    );
    const unlinked = mockQuery.mock.calls.filter(
      ([sql, params]) =>
        String(sql).includes("scan_finding_feedback") &&
        (params as unknown[])?.[1] === null,
    );
    expect(
      unlinked.length,
      "the verdicts must be retried with a null scan_history_id rather than dropped",
    ).toBe(1);
    expect((unlinked[0][1] as unknown[])[3]).toEqual(["f1"]);
  });

  it("logs once for a whole chunk, not once per finding", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      confirmedResponse("x"),
    );
    const errors: unknown[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        if (String(args[0]).includes("Mark this result")) errors.push(args);
      });
    mockQuery.mockImplementation(async (sql: unknown) => {
      if (String(sql).includes("scan_finding_feedback")) {
        throw new Error("connection terminated");
      }
      return { rows: [], rowCount: 0 };
    });

    try {
      await runAiVerification(
        "https://example.com",
        [makeFinding("f1"), makeFinding("f2"), makeFinding("f3")],
        42,
        7,
        null,
      );
      expect(errors.length).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not write feedback for an 'uncertain' AI verdict, no honest mapping exists", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: "uncertain",
                confidence: 60,
                reason: "probe error",
              }),
            },
          },
        ],
      }),
    });

    await runAiVerification(
      "https://example.com",
      [makeFinding("f1")],
      42,
      7,
      null,
    );

    const feedbackCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("scan_finding_feedback"),
    );
    expect(feedbackCall).toBeUndefined();
  });

  it("does not write feedback when no userId is available (matches the existing null-userId test path)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      confirmedResponse("x"),
    );

    await runAiVerification(
      "https://example.com",
      [makeFinding("f1")],
      42,
      null,
      null,
    );

    const feedbackCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("scan_finding_feedback"),
    );
    expect(feedbackCall).toBeUndefined();
  });
});

describe("verifyFindingsBatch: Set-Cookie header capture in the live probe", () => {
  // Regression test for a bug where probeTarget() built response_headers by
  // running Headers.forEach() into a plain Record<string, string>. forEach()
  // calls back once per raw Set-Cookie header (it does not comma-join them
  // the way Headers.get("set-cookie") does), but assigning each callback
  // into the same object key overwrote every earlier cookie with the last
  // one. A response setting three cookies would leave response_headers
  // with only the final cookie — the AI verifier then judged cookie
  // findings against data that was silently missing the other cookies,
  // producing exactly the kind of "the live probe only saw one Set-Cookie
  // header" mismatch that triggered this investigation. This proves every
  // Set-Cookie header — including one with a comma inside its Expires=
  // date, which is why naive comma-joining is unsafe in the first place —
  // survives into the prompt as its own separate entry.
  it("keeps every Set-Cookie header as its own array entry instead of collapsing them into the last one", async () => {
    const headers = new Headers();
    headers.append(
      "set-cookie",
      "isoLoc=US_CA; Domain=.example.com; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT",
    );
    headers.append("set-cookie", "ak_bmsc=abc123; Path=/; HttpOnly");
    headers.append("set-cookie", "bm_mi=xyz; Secure; SameSite=None");

    mockSafeFetch.mockResolvedValue({
      status: 200,
      url: "https://example.com/",
      headers,
      text: async () => "<html></html>",
    });

    let sentPrompt = "";
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        sentPrompt = body.messages[1].content as string;
        return confirmedResponse("f1");
      },
    );

    await verifyFindingsBatch(
      "https://example.com",
      [makeFinding("f1")],
      null,
      null,
    );

    const startIdx = sentPrompt.indexOf("live_probe: {");
    expect(startIdx).toBeGreaterThan(-1);
    const jsonStart = sentPrompt.indexOf("{", startIdx);
    const returnIdx = sentPrompt.indexOf("\n\nReturn only JSON");
    const probe = JSON.parse(sentPrompt.slice(jsonStart, returnIdx).trim());

    const setCookie = probe.response_headers["set-cookie"];
    expect(Array.isArray(setCookie)).toBe(true);
    expect(setCookie).toHaveLength(3);

    // Each cookie keeps its own attributes — none corrupted by, or merged
    // with, another cookie's attributes.
    expect(setCookie[0]).toContain("isoLoc=US_CA");
    expect(setCookie[0]).toContain("Expires=Wed, 21 Oct 2026 07:28:00 GMT");
    expect(setCookie[0]).not.toContain("HttpOnly");
    expect(setCookie[0]).not.toContain("Secure");

    expect(setCookie[1]).toContain("ak_bmsc=abc123");
    expect(setCookie[1]).toContain("HttpOnly");
    expect(setCookie[1]).not.toContain("isoLoc");

    expect(setCookie[2]).toContain("bm_mi=xyz");
    expect(setCookie[2]).toContain("Secure");
    expect(setCookie[2]).toContain("SameSite=None");
    expect(setCookie[2]).not.toContain("ak_bmsc");
  });
});

describe("verifyFindingsBatch: no endpoint configured", () => {
  it("returns findings unchanged when no AI endpoint is configured", async () => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;

    const findings = [makeFinding("f1")];
    const result = await verifyFindingsBatch(
      "https://example.com",
      findings,
      null,
      null,
    );

    expect(result).toEqual(findings);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("verifyFindingsBatch: evidence handed to the AI reviewer", () => {
  it("includes the detector's own evidenceExcerpts in the prompt, not just the generic evidence summary", async () => {
    let sentPrompt = "";
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        sentPrompt = body.messages[1].content as string;
        return confirmedResponse("f1");
      },
    );

    const finding = {
      ...makeFinding("f1"),
      evidence: "1 active resource(s) loaded over HTTP on an HTTPS page.",
      evidenceExcerpts: [
        { label: "script src", value: "http://cdn.example.com/widget.js" },
      ],
    };

    await verifyFindingsBatch("https://example.com", [finding], null, null);

    // The prompt must carry the detector's own verbatim proof, not rely
    // solely on the generic summary + a truncated body snippet that may
    // not contain the actual matched text.
    expect(sentPrompt).toContain("evidence_excerpts:");
    expect(sentPrompt).toContain("http://cdn.example.com/widget.js");
  });

  it("omits the evidence_excerpts line entirely when the finding has none", async () => {
    let sentPrompt = "";
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        sentPrompt = body.messages[1].content as string;
        return confirmedResponse("f1");
      },
    );

    await verifyFindingsBatch(
      "https://example.com",
      [makeFinding("f1")],
      null,
      null,
    );

    expect(sentPrompt).not.toContain("evidence_excerpts:");
  });
});

describe("verifyFindingsBatch: reason text is never truncated", () => {
  it("returns a long, well-formed reason in full, whatever its length", async () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`);
    const longReason = words.join(" "); // ~1300 chars, well past the old 300-char cap
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: "confirmed",
                confidence: 90,
                reason: longReason,
              }),
            },
          },
        ],
      }),
    });

    const result = await verifyFindingsBatch(
      "https://example.com",
      [makeFinding("f1")],
      null,
      null,
    );

    expect(result[0].aiReason).toBe(longReason);
  });

  it("returns the model's full hedging text in the unparseable-response fallback, not just the first 200 chars", async () => {
    const words = Array.from({ length: 100 }, (_, i) => `hedge${i}`);
    const longHedge = words.join(" ");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: longHedge } }],
      }),
    });

    const result = await verifyFindingsBatch(
      "https://example.com",
      [makeFinding("f1")],
      null,
      null,
    );

    expect(result[0].aiVerdict).toBe("uncertain");
    expect(result[0].aiReason).toContain(longHedge);
  });
});

describe("verifyFindingsBatch: AI response that isn't clean JSON", () => {
  it("reports 'uncertain' with the model's own text instead of silently dropping the finding when the AI hedges in prose", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                "The body_snippet shows only the first 8KB and I cannot locate the URL in the visible content, so I cannot confirm or refute the finding from the provided probe data alone.",
            },
          },
        ],
      }),
    });

    const findings = [makeFinding("f1")];
    const result = await verifyFindingsBatch(
      "https://example.com",
      findings,
      null,
      null,
    );

    // Previously this finding would have no aiVerdict at all (silently
    // dropped) because JSON.parse on the pure-prose response throws.
    expect(result[0].aiVerdict).toBe("uncertain");
    expect(result[0].aiReason).toContain("not a parseable verdict");
  });

  it("recovers a verdict wrapped in a short preamble the model added despite the JSON-only instruction", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                'Sure, here is my assessment: {"verdict":"possible_fp","confidence":80,"reason":"header is present"}',
            },
          },
        ],
      }),
    });

    const findings = [makeFinding("f1")];
    const result = await verifyFindingsBatch(
      "https://example.com",
      findings,
      null,
      null,
    );

    expect(result[0].aiVerdict).toBe("possible_fp");
    expect(result[0].aiConfidence).toBe(80);
  });
});

function confirmedResponseWithUsage(
  id: string,
  promptTokens: number,
  completionTokens: number,
) {
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "confirmed",
              confidence: 90,
              reason: `real issue for ${id}`,
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    }),
  };
}

describe("verifyFindingsBatch / runAiVerification: settling the route's reservation", () => {
  it("settles with the summed real token usage across every call in the batch, once, after it completes", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      confirmedResponseWithUsage("x", 100, 50),
    );
    const held = reservation();

    const findings = [makeFinding("f1"), makeFinding("f2")];
    await verifyFindingsBatch("https://example.com", findings, 42, held);

    expect(mockSettleAiTokens).toHaveBeenCalledTimes(1);
    expect(mockSettleAiTokens).toHaveBeenCalledWith(held, 300); // (100+50) * 2 findings
  });

  it("extracts real usage from the native Anthropic adapter's response too", async () => {
    process.env.AI_BASE_URL = "https://api.anthropic.com/v1";
    process.env.AI_MODEL = "claude-haiku-4-5-20251001";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              verdict: "confirmed",
              confidence: 88,
              reason: "header absent",
            }),
          },
        ],
        usage: { input_tokens: 200, output_tokens: 30 },
      }),
    });
    const held = reservation();

    await verifyFindingsBatch(
      "https://example.com",
      [makeFinding("f1")],
      42,
      held,
    );

    expect(mockSettleAiTokens).toHaveBeenCalledWith(held, 230);
  });

  it("settles nothing when there is no reservation to settle", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      confirmedResponseWithUsage("x", 100, 50),
    );

    await verifyFindingsBatch(
      "https://example.com",
      [makeFinding("f1")],
      null,
      null,
    );

    expect(mockSettleAiTokens).not.toHaveBeenCalled();
  });

  it("settles zero when the provider response omits usage, which hands the whole reservation back", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      confirmedResponse("x"),
    );
    const held = reservation({ budget: 50_000 });

    await verifyFindingsBatch(
      "https://example.com",
      [makeFinding("f1")],
      42,
      held,
    );

    expect(mockSettleAiTokens).toHaveBeenCalledWith(held, 0);
  });

  it("settles a pass that never reached a provider: no endpoint, no findings", async () => {
    delete process.env.AI_BASE_URL;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = reservation({ budget: 10_000 });
    const b = reservation({ budget: 10_000 });

    await runAiVerification(
      "https://example.com",
      [makeFinding("f1")],
      1,
      null,
      a,
    );
    await runAiVerification("https://example.com", [], 1, 42, b);

    expect(mockSettleAiTokens).toHaveBeenCalledWith(a, 0);
    expect(mockSettleAiTokens).toHaveBeenCalledWith(b, 0);
    errors.mockRestore();
  });

  it("runAiVerification settles the same way as verifyFindingsBatch", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      confirmedResponseWithUsage("x", 40, 10),
    );
    mockQuery.mockResolvedValue({ rows: [] });
    const held = reservation({ userId: 7 });

    await runAiVerification(
      "https://example.com",
      [makeFinding("f1")],
      42,
      7,
      held,
    );

    expect(mockSettleAiTokens).toHaveBeenCalledWith(held, 50);
  });
});

describe("verification is held to the reservation's budget", () => {
  /**
   * The gate reserves a worst case per finding, and the pass admits each
   * finding at that worst case, so the run cannot spend past what was taken
   * from the account even if every call comes back at its ceiling. What it
   * cannot pay for is left unjudged and the outcome says so.
   */
  async function ceilingOf(finding: Vulnerability): Promise<number> {
    const { verifyCallCeiling } = await import("@/lib/ai/verify-findings");
    const {
      CONFIG_AI_VERIFY_MAX_TOKENS,
      CONFIG_AI_VERIFY_PROBE_BODY_SNIPPET_CHARS,
    } = await import("@/lib/config/config-values");
    return verifyCallCeiling(finding, {
      maxTokens: CONFIG_AI_VERIFY_MAX_TOKENS,
      probeBodySnippetChars: CONFIG_AI_VERIFY_PROBE_BODY_SNIPPET_CHARS,
    });
  }

  it("stops at the first finding the budget cannot cover and reports budgetExhausted", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      confirmedResponseWithUsage("x", 100, 50),
    );
    const findings = [makeFinding("f1"), makeFinding("f2"), makeFinding("f3")];
    const one = await ceilingOf(findings[0]);
    const held = reservation({ budget: one * 2 + one / 2 });

    const { outcome } = await verifyFindingsBatchWithOutcome(
      "https://example.com",
      findings,
      42,
      held,
    );

    // Two fit at their worst case in the first chunk. They really cost 150
    // each, so the room they leave admits the third in a second chunk.
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(outcome.verdicts).toBe(3);
    expect(outcome).not.toHaveProperty("budgetExhausted");
  });

  it("verifies nothing and says why when the budget is below one finding's ceiling", async () => {
    const findings = [makeFinding("f1"), makeFinding("f2")];
    const held = reservation({ budget: (await ceilingOf(findings[0])) - 1 });

    const { outcome } = await verifyFindingsBatchWithOutcome(
      "https://example.com",
      findings,
      42,
      held,
    );

    expect(global.fetch).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      configured: true,
      verdicts: 0,
      attempted: 2,
      budgetExhausted: true,
    });
    expect(mockSettleAiTokens).toHaveBeenCalledWith(held, 0);
  });

  it("counts a call that came back without a cost at its ceiling, so timeouts cannot admit the whole pass", async () => {
    // A timed-out call is settled at zero, since nothing says what it cost,
    // but the provider may still bill it. Counting it at zero for admission
    // let a pass whose calls all timed out send every finding.
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("This operation was aborted"),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const findings = [makeFinding("f1"), makeFinding("f2"), makeFinding("f3")];
    const one = await ceilingOf(findings[0]);
    const held = reservation({ budget: one * 2 + one / 2 });

    const { outcome } = await verifyFindingsBatchWithOutcome(
      "https://example.com",
      findings,
      42,
      held,
    );

    // Two fit in the first chunk. Neither reported a cost, so both count at
    // their ceilings and the third no longer fits.
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({ verdicts: 0, budgetExhausted: true });
    expect(mockSettleAiTokens).toHaveBeenCalledWith(held, 0);
    errors.mockRestore();
  });

  it("admits a call at the prompt it really builds, so a page of control characters cannot outgrow its reservation", async () => {
    // Every byte of this body is a control character, which the prompt's
    // JSON encoding writes out as six characters. The reserved ceiling
    // counted it as one, which let one call cost several reservations.
    const { CONFIG_AI_VERIFY_PROBE_BODY_SNIPPET_CHARS } =
      await import("@/lib/config/config-values");
    const bytes = new Uint8Array(
      CONFIG_AI_VERIFY_PROBE_BODY_SNIPPET_CHARS,
    ).fill(1);
    mockSafeFetch.mockResolvedValue({
      status: 200,
      url: "https://example.com/",
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      confirmedResponseWithUsage("x", 100, 50),
    );
    const findings = [makeFinding("f1")];
    const held = reservation({ budget: await ceilingOf(findings[0]) });

    const { outcome } = await verifyFindingsBatchWithOutcome(
      "https://example.com",
      findings,
      42,
      held,
    );

    expect(global.fetch).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ verdicts: 0, budgetExhausted: true });
  });

  it("an uncapped reservation (own key, billing off) is not held to anything", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      confirmedResponseWithUsage("x", 100, 50),
    );
    const findings = Array.from({ length: 12 }, (_, i) => makeFinding(`f${i}`));

    const { outcome } = await verifyFindingsBatchWithOutcome(
      "https://example.com",
      findings,
      42,
      reservation({ budget: null, usingOwnAi: true }),
    );

    expect(outcome.verdicts).toBe(12);
  });

  it("estimateVerifyTokens reserves every finding at its ceiling and needs at least the first one", async () => {
    const { estimateVerifyTokens } = await import("@/lib/ai/verify-findings");
    const findings = [makeFinding("f1"), makeFinding("f2")];
    const one = await ceilingOf(findings[0]);

    const { estimate, minimum } = await estimateVerifyTokens(findings);

    expect(minimum).toBe(one);
    expect(estimate).toBe(one + (await ceilingOf(findings[1])));
    expect(await estimateVerifyTokens([])).toEqual({ estimate: 0, minimum: 0 });
  });

  it("a ceiling covers the whole output allowance plus a full-size probe", async () => {
    const {
      CONFIG_AI_VERIFY_MAX_TOKENS,
      CONFIG_AI_VERIFY_PROBE_BODY_SNIPPET_CHARS,
    } = await import("@/lib/config/config-values");
    const one = await ceilingOf(makeFinding("f1"));
    expect(one).toBeGreaterThan(
      CONFIG_AI_VERIFY_MAX_TOKENS +
        CONFIG_AI_VERIFY_PROBE_BODY_SNIPPET_CHARS / 4,
    );
  });

  it("a null element in a caller-supplied batch costs the bare template instead of throwing", async () => {
    const { estimateVerifyTokens } = await import("@/lib/ai/verify-findings");
    const { estimate } = await estimateVerifyTokens([
      null as unknown as Vulnerability,
    ]);
    expect(estimate).toBeGreaterThan(0);
  });
});

describe("probeTarget: the scanned site's body is read with a cap, not whole", () => {
  /**
   * The probe goes to the URL being verified, which on /scan/verify-batch is
   * whatever the caller put in the request body. It used to call res.text()
   * and slice afterwards, so a target answering with an endless or
   * decompression-bomb body was buffered whole into the server's memory
   * before a single character was thrown away.
   */
  it("stops reading at AI_VERIFY_PROBE_BODY_SNIPPET_CHARS and never calls text()", async () => {
    const chunk = new Uint8Array(64 * 1024).fill(0x61);
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        // 200 chunks is 12.5 MB: far past the cap, and finite so a reader
        // that does not stop still finishes and fails the assertion below
        // rather than hanging the suite.
        if (pulls > 200) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const text = vi.fn(async () => "a".repeat(200 * 64 * 1024));
    mockSafeFetch.mockResolvedValue({
      status: 200,
      url: "https://example.com/",
      headers: new Headers(),
      body,
      text,
    });

    let sentPrompt = "";
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url: string, init: RequestInit) => {
        const sent = JSON.parse(init.body as string);
        sentPrompt = sent.messages[1].content as string;
        return confirmedResponse("f1");
      },
    );

    await verifyFindingsBatch(
      "https://example.com",
      [makeFinding("f1")],
      null,
      null,
    );

    expect(text).not.toHaveBeenCalled();
    // The cap is 24576 characters, under one 64 KB chunk.
    expect(pulls).toBeLessThan(5);
    const snippet = /"body_snippet": "(a*)"/.exec(sentPrompt)?.[1] ?? "";
    expect(snippet.length).toBeGreaterThan(0);
    expect(snippet.length).toBeLessThanOrEqual(24_576);
  });
});
