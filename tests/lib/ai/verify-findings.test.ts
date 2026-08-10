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

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockSafeFetch = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));

const { verifyFindingsBatch, runAiVerification } =
  await import("@/lib/ai/verify-findings");
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

    await verifyFindingsBatch("https://example.com", findings, null);

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
    );

    expect(result).toHaveLength(TOTAL_FINDINGS);
    const verifiedCount = result.filter(
      (f) => f.aiVerdict === "confirmed",
    ).length;
    expect(verifiedCount).toBe(TOTAL_FINDINGS);
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

    await runAiVerification("https://example.com", findings, 42, null);

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
      await runWithTinyDeadline("https://example.com", findings, 42, null);
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

    await verifyFindingsBatch("https://example.com", [makeFinding("f1")], null);

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

    await verifyFindingsBatch("https://example.com", [finding], null);

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

    await verifyFindingsBatch("https://example.com", [makeFinding("f1")], null);

    expect(sentPrompt).not.toContain("evidence_excerpts:");
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
    );

    expect(result[0].aiVerdict).toBe("possible_fp");
    expect(result[0].aiConfidence).toBe(80);
  });
});
