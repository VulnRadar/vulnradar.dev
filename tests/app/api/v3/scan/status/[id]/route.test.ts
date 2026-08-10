/**
 * Tests for GET/DELETE /api/v3/scan/status/:id.
 *
 * Covers the response shape for each job status, ownership scoping (a
 * scan is only ever visible to the user who started it), and that DELETE
 * both flags the in-memory cancellation registry and writes the terminal
 * state immediately rather than waiting for the background job to notice.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: () => mockGetSession() };
});

const mockValidateApiKey = vi.fn();
const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const { GET, DELETE } = await import("@/app/api/v3/scan/status/[id]/route");
const { isCancelled, clearCancel } = await import("@/lib/scanner/scan-jobs");

function req(method: "GET" | "DELETE" = "GET", apiKey?: string) {
  return new NextRequest("http://localhost/api/v3/scan/status/1", {
    method,
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const OWNER_ID = 42;
const OTHER_ID = 99;

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    user_id: OWNER_ID,
    url: "https://example.com/",
    status: "running",
    current_category: "headers",
    categories_completed: 2,
    categories_total: 5,
    started_at: new Date(Date.now() - 3000).toISOString(),
    duration: 0,
    scanned_at: new Date().toISOString(),
    summary: null,
    findings: null,
    response_headers: null,
    result_meta: null,
    error_message: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: OWNER_ID });
  mockValidateApiKey.mockReset();
  mockCheckRateLimit.mockReset();
  clearCancel(1);
});

describe("GET /api/v3/scan/status/:id", () => {
  it("returns pending/running progress fields without a result or error", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row({ status: "running" })] });

    const res = await GET(req(), ctx("1"));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.status).toBe("running");
    expect(json.currentCategory).toBe("headers");
    expect(json.categoriesCompleted).toBe(2);
    expect(json.categoriesTotal).toBe(5);
    expect(json.elapsedMs).toBeGreaterThanOrEqual(3000);
    expect(json.result).toBeUndefined();
    expect(json.error).toBeUndefined();
  });

  it("includes the full result inline when completed", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        row({
          status: "completed",
          current_category: null,
          categories_completed: 5,
          duration: 4321,
          summary: { critical: 0, high: 1, total: 1 },
          findings: [{ id: "f1" }],
          response_headers: { "x-test": "1" },
          result_meta: { checksRun: 40, dangerScore: 3 },
        }),
      ],
    });

    const res = await GET(req(), ctx("1"));
    const json = await res.json();

    expect(json.status).toBe("completed");
    expect(json.elapsedMs).toBe(4321);
    expect(json.result).toMatchObject({
      url: "https://example.com/",
      duration: 4321,
      findings: [{ id: "f1" }],
      summary: { critical: 0, high: 1, total: 1 },
      responseHeaders: { "x-test": "1" },
      scanHistoryId: 1,
      checksRun: 40,
      dangerScore: 3,
    });
    expect(json.error).toBeUndefined();
  });

  it("includes a real error reason when failed", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        row({
          status: "failed",
          error_message: "Could not reach the target URL: ECONNREFUSED.",
          duration: 1500,
        }),
      ],
    });

    const res = await GET(req(), ctx("1"));
    const json = await res.json();

    expect(json.status).toBe("failed");
    expect(json.error).toBe("Could not reach the target URL: ECONNREFUSED.");
    expect(json.elapsedMs).toBe(1500);
    expect(json.result).toBeUndefined();
  });

  it("returns 404 for a scan that does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET(req(), ctx("999"));
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 403) for a scan owned by a different user", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row({ user_id: OTHER_ID })] });
    const res = await GET(req(), ctx("1"));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Scan not found");
  });

  it("rejects an unauthenticated caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(req(), ctx("1"));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("does not spend API-key daily quota on a status poll -- checkRateLimit is never called here", async () => {
    // A client polls this endpoint repeatedly to watch one scan it already
    // paid quota for at POST /scan time; charging quota again on every
    // poll would exhaust the key's daily limit on status checks alone.
    mockValidateApiKey.mockResolvedValue({
      userId: OWNER_ID,
      keyId: 7,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockQuery.mockResolvedValueOnce({ rows: [row({ status: "running" })] });

    const res = await GET(req("GET", "vr_live_test"), ctx("1"));

    expect(res.status).toBe(200);
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it("rejects an invalid or revoked API key", async () => {
    mockValidateApiKey.mockResolvedValue(null);
    const res = await GET(req("GET", "vr_live_bad"), ctx("1"));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v3/scan/status/:id", () => {
  it("flags cancellation and marks a running scan failed with reason 'Cancelled'", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row({ status: "running" })] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

    const res = await DELETE(req("DELETE"), ctx("1"));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: "failed", cancelled: true });

    expect(isCancelled(1)).toBe(false); // finalizeScanFailure clears it again
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("status = 'failed'");
    expect(params[0]).toBe("Cancelled");
    expect(params[1]).toBe(1);
  });

  it("returns 409 for a scan that already finished", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row({ status: "completed" })] });

    const res = await DELETE(req("DELETE"), ctx("1"));

    expect(res.status).toBe(409);
    // Only the ownership SELECT ran — no UPDATE was attempted.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for a scan owned by a different user, without cancelling anything", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row({ user_id: OTHER_ID })] });

    const res = await DELETE(req("DELETE"), ctx("1"));

    expect(res.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when the scan finishes in the race between the SELECT and the cancel UPDATE", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row({ status: "pending" })] });
    // finalizeScanFailure's guarded UPDATE finds the row already terminal.
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await DELETE(req("DELETE"), ctx("1"));

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/finished just before/);
  });
});
