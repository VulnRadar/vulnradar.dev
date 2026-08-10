/**
 * Route-level tests for POST /api/v3/scan/crawl.
 *
 * The actual crawl work (lib/scanner/execute-crawl-scan.ts) has its own
 * suite; this exercises only what the route itself is responsible for:
 * creating the tracker scan_history row immediately and dispatching the
 * job without awaiting it, rather than holding the request open through
 * discovery and every page scan.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// Runtime-config resolves settings via pool.query under the hood in
// production; mocked here at the module boundary so it does not consume the
// mockQuery call sequence the tracker-row assertions below depend on. The
// shipped registry default keeps the resolved value identical to the old
// static SCANNING.MAX_URL_LENGTH constant.
vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  return {
    getSetting: vi.fn(
      async (key: keyof typeof SETTINGS_REGISTRY) =>
        SETTINGS_REGISTRY[key].default,
    ),
    getSettings: vi.fn(async (keys: (keyof typeof SETTINGS_REGISTRY)[]) =>
      Object.fromEntries(keys.map((k) => [k, SETTINGS_REGISTRY[k].default])),
    ),
  };
});

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: () => mockGetSession() };
});

vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(async () => ({
      allowed: true,
      remaining: 9,
      retryAfterSeconds: 0,
    })),
  };
});

vi.mock("@/lib/scanner/access-rules", () => ({
  checkAccessRules: vi.fn(async () => ({ allowed: true })),
}));

const mockExecuteCrawlScan = vi.fn();
vi.mock("@/lib/scanner/execute-crawl-scan", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/scanner/execute-crawl-scan")>();
  return {
    ...actual,
    executeCrawlScan: (...args: unknown[]) => mockExecuteCrawlScan(...args),
  };
});

const mockValidateApiKey = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
  checkRateLimit: vi.fn(async () => ({
    allowed: true,
    limit: 50,
    used: 1,
    remaining: 49,
    resetsAt: new Date().toISOString(),
  })),
  recordUsage: vi.fn(async () => undefined),
}));

const { POST } = await import("@/app/api/v3/scan/crawl/route");

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v3/scan/crawl", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockExecuteCrawlScan.mockReset();
  mockExecuteCrawlScan.mockResolvedValue(undefined);
  mockValidateApiKey.mockReset();
});

describe("POST /api/v3/scan/crawl", () => {
  it("creates a pending tracker row and returns immediately without waiting for the crawl", async () => {
    let resolveExecute: () => void = () => {};
    mockExecuteCrawlScan.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveExecute = resolve;
        }),
    );
    // resolveScanIsPublic's account-default lookup, then the tracker INSERT.
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 200 }] });

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ scanId: 200, status: "running" });
    expect(mockExecuteCrawlScan).toHaveBeenCalledTimes(1);
    resolveExecute();
  });

  it("passes the tracker scanId and main-origin context to executeCrawlScan", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 201 }] });

    await POST(postRequest({ url: "https://example.com/start" }));

    expect(mockExecuteCrawlScan).toHaveBeenCalledWith(
      expect.objectContaining({
        scanId: 201,
        normalizedMainUrl: "https://example.com/start",
        mainOrigin: "https://example.com",
        authedUserId: 42,
      }),
    );
  });

  it("inserts is_public=true by default and false when the request asks for a private crawl", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 202 }] });
    await POST(postRequest({ url: "https://example.com" }));
    let insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO scan_history"),
    );
    expect(insertCall![0]).toContain("is_public");
    expect(insertCall![1][4]).toBe(true);

    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 203 }] });
    await POST(postRequest({ url: "https://example.com", isPublic: false }));
    // An explicit isPublic in the request skips the account-default lookup
    // entirely, so this is the only query call.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    insertCall = mockQuery.mock.calls[0];
    expect(insertCall[1][4]).toBe(false);
  });

  it("falls back to the account's scans_private_by_default setting when the request omits isPublic", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: true }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 204 }] });

    await POST(postRequest({ url: "https://example.com" }));

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO scan_history"),
    );
    expect(insertCall![1][4]).toBe(false);
  });

  it("rejects a non-http(s) URL before creating a row", async () => {
    const res = await POST(postRequest({ url: "ftp://example.com" }));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockExecuteCrawlScan).not.toHaveBeenCalled();
  });

  it("returns 500 and never dispatches a crawl when the tracker row cannot be created", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockRejectedValueOnce(new Error("db down"));

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(500);
    expect(mockExecuteCrawlScan).not.toHaveBeenCalled();
  });
});
