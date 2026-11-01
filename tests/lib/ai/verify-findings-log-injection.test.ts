/**
 * Log lines on the verification and repo review paths carry values nobody on
 * the server chose: verify-batch takes the URL and every finding id from the
 * request body, the provider writes its own error text, and a user saves their
 * own AI base URL and model. console.error is persisted to Admin > Error Logs,
 * so a CR or LF in any of them wrote what read as a separate, forged entry
 * into the page admins trust, and an unbounded one filled the row.
 * (CodeQL js/log-injection #235 to #238.)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Vulnerability } from "@/lib/scanner/types";
import type { RepoFile } from "@/lib/scanner/github-repo-scan";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockSafeFetch = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));

vi.mock("@/lib/billing/ai-usage", () => ({ settleAiTokens: vi.fn() }));
vi.mock("@/lib/billing/github-review-usage", () => ({
  recordGithubReviewTokens: vi.fn(),
}));

const { verifyFindingsBatch, runAiVerification } =
  await import("@/lib/ai/verify-findings");
const { runGithubAiReview } = await import("@/lib/ai/review-source");

const FORGED = "\r\n[AI-VERIFY] Admin password reset approved";
const HOSTILE_URL = `https://example.com/${FORGED}`;
const HOSTILE_ID = `hsts-missing${FORGED}${"x".repeat(5_000)}`;

function makeFinding(id: string): Vulnerability {
  return {
    id,
    title: "t",
    severity: "medium",
    category: "headers",
    description: "",
    evidence: "e",
    riskImpact: "",
    explanation: "",
    fixSteps: [],
    codeExamples: [],
  } as unknown as Vulnerability;
}

function fetchMock() {
  return global.fetch as ReturnType<typeof vi.fn>;
}

let errors: { mock: { calls: unknown[][] }; mockRestore: () => void };

/** Every console.error call, joined the way the error-log capture joins it. */
function loggedLines(): string[] {
  return errors.mock.calls.map((args) =>
    args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "),
  );
}

/** The one Error logged, which must keep frames under an escaped head. */
function expectLoggedErrorWithFrames() {
  const err = errors.mock.calls.flat().find((a) => a instanceof Error) as
    Error | undefined;
  expect(err, "the thrown error is logged as an Error").toBeDefined();
  const [head, ...frames] = String(err?.stack).split("\n");
  expect(head).toContain("[AI-VERIFY] Admin password reset approved");
  expect(frames.length).toBeGreaterThan(0);
  for (const frame of frames) expect(frame).toMatch(/^\s+at /);
}

/** No logged line breaks or control characters, and nothing unbounded. */
function expectNoForgedLines() {
  const lines = loggedLines();
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line).not.toMatch(/[\r\n\u2028\u2029]/);
    expect(line).not.toMatch(/\p{Cc}/u);
    expect(line.length).toBeLessThan(2_000);
  }
}

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockSafeFetch.mockReset();
  mockSafeFetch.mockResolvedValue({
    status: 200,
    url: "https://example.com/",
    headers: new Headers(),
  });
  process.env.AI_BASE_URL = "https://api.example-llm.test/v1";
  process.env.AI_API_KEY = "test-key";
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
  global.fetch = vi.fn();
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errors.mockRestore();
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe("verification logs carry no raw request, target or provider text", () => {
  it("an HTTP failure line (#235) escapes the finding id and the provider's detail", async () => {
    fetchMock().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => `upstream broke${FORGED}`,
    });

    await verifyFindingsBatch(
      HOSTILE_URL,
      [makeFinding(HOSTILE_ID)],
      null,
      null,
    );

    expectNoForgedLines();
    expect(loggedLines().join("\n")).toContain("hsts-missing\\r\\n[AI-VERIFY]");
  });

  it("a thrown call (#236) escapes the finding id and the error text", async () => {
    fetchMock().mockRejectedValue(new Error(`socket hang up${FORGED}`));

    await verifyFindingsBatch(
      HOSTILE_URL,
      [makeFinding(HOSTILE_ID)],
      null,
      null,
    );

    expectNoForgedLines();
    expectLoggedErrorWithFrames();
  });

  it("the rate-limit line (#237) escapes the URL being verified", async () => {
    fetchMock().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "slow down",
    });

    await verifyFindingsBatch(HOSTILE_URL, [makeFinding("f1")], null, null);

    expectNoForgedLines();
    expect(loggedLines().join("\n")).toContain("rate-limited the pass");
  });

  it("the fatal-status line (#238) escapes the URL, and a user's own base URL and model", async () => {
    // A user's saved endpoint is theirs to write, so its base URL and model
    // name reach these lines as freely as the request body does.
    const { encryptApiKey } = await import("@/lib/auth/crypto");
    process.env.API_KEY_ENCRYPTION_KEY ??= "a".repeat(64);
    mockQuery.mockResolvedValue({
      rows: [
        {
          use_vulnradar_ai: false,
          base_url: `https://llm.example.test/v1${FORGED}`,
          model_id: `model${FORGED}`,
          api_key_encrypted: encryptApiKey("k"),
        },
      ],
    });
    fetchMock().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "bad key",
    });

    await verifyFindingsBatch(HOSTILE_URL, [makeFinding("f1")], 7, null);

    expectNoForgedLines();
    expect(loggedLines().join("\n")).toContain("returned 401");
  });

  it("the nothing-came-back line escapes the stored scan's URL", async () => {
    fetchMock().mockRejectedValue(new Error("aborted"));

    await runAiVerification(HOSTILE_URL, [makeFinding("f1")], 1, null, null);

    expectNoForgedLines();
    expect(loggedLines().join("\n")).toContain("returned null or timed out");
  });
});

describe("repo review logs carry no raw provider text", () => {
  const FILES: RepoFile[] = [{ path: "a.js", content: "x" }];

  it("an HTTP failure line escapes the provider's detail", async () => {
    fetchMock().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => `bad gateway${FORGED}`,
    });

    await runGithubAiReview(FILES, 1, false, null);

    expectNoForgedLines();
  });

  it("a thrown call escapes the error text", async () => {
    fetchMock().mockRejectedValue(new Error(`reset${FORGED}`));

    await runGithubAiReview(FILES, 1, false, null);

    expectNoForgedLines();
    expectLoggedErrorWithFrames();
  });
});
