import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for GET /api/v3/browser/sessions/logs. Same mocking
 * boundary as tests/app/api/v3/browser/sessions/route.test.ts: the database
 * and the BrowserBase REST client are mocked, parseNetworkRequests (a pure
 * function) runs for real.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockGetBrowserSessionLogs = vi.fn();
vi.mock("@/lib/browserbase/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/browserbase/client")>();
  return {
    ...actual,
    getBrowserSessionLogs: (...args: unknown[]) =>
      mockGetBrowserSessionLogs(...args),
  };
});

process.env.BROWSERBASE_API_KEY = "test-key";
process.env.BROWSERBASE_PROJECT_ID = "test-project";

const { GET } = await import("@/app/api/v3/browser/sessions/logs/route");
const { BrowserBaseError } = await import("@/lib/browserbase/client");

const SESSION = { userId: 42, email: "u@x.com", name: null, role: "user" };

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue(SESSION);
  mockGetBrowserSessionLogs.mockReset();
});

function logsRequest(id?: string): NextRequest {
  const url = id
    ? `http://localhost/api/v3/browser/sessions/logs?id=${encodeURIComponent(id)}`
    : "http://localhost/api/v3/browser/sessions/logs";
  return new NextRequest(url, { method: "GET" });
}

describe("GET /api/v3/browser/sessions/logs", () => {
  it("returns 503 when BrowserBase is not configured", async () => {
    vi.resetModules();
    const savedKey = process.env.BROWSERBASE_API_KEY;
    delete process.env.BROWSERBASE_API_KEY;
    const { GET: GetDisabled } =
      await import("@/app/api/v3/browser/sessions/logs/route");
    const res = await GetDisabled(logsRequest("sess_1"));
    expect(res.status).toBe(503);
    process.env.BROWSERBASE_API_KEY = savedKey;
    vi.resetModules();
  });

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(logsRequest("sess_1"));
    expect(res.status).toBe(401);
  });

  it("requires a session id", async () => {
    const res = await GET(logsRequest());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Missing session id.");
  });

  it("denies reading logs for a session owned by a different user", async () => {
    mockQuery.mockResolvedValue({ rows: [{ user_id: 999 }] });
    const res = await GET(logsRequest("sess_other"));
    expect(res.status).toBe(403);
    expect(mockGetBrowserSessionLogs).not.toHaveBeenCalled();
  });

  it("returns parsed network requests for a session the caller owns", async () => {
    mockQuery.mockResolvedValue({ rows: [{ user_id: 42 }] });
    mockGetBrowserSessionLogs.mockResolvedValue([
      {
        method: "Network.requestWillBeSent",
        timestamp: 1000,
        request: {
          params: {
            requestId: "req-1",
            request: {
              url: "https://target.example/api/data",
              method: "get",
            },
          },
        },
      },
      {
        method: "Network.responseReceived",
        timestamp: 1050,
        request: {
          params: {
            requestId: "req-1",
            response: {
              status: 200,
              mimeType: "application/json; charset=utf-8",
            },
          },
        },
      },
    ]);

    const res = await GET(logsRequest("sess_mine"));
    expect(res.status).toBe(200);
    expect(mockGetBrowserSessionLogs).toHaveBeenCalledWith("sess_mine");

    const json = await res.json();
    expect(json.requests).toHaveLength(1);
    expect(json.requests[0]).toMatchObject({
      requestId: "req-1",
      url: "https://target.example/api/data",
      method: "GET",
      host: "target.example",
      path: "/api/data",
      status: 200,
      mimeType: "application/json",
    });
  });

  // Documented, intentional tradeoff shared with the sessions route (see
  // AUDIT-004#idor-01 in app/api/v3/browser/sessions/logs/route.ts): a
  // session with no ownership row is allowed through rather than denied.
  it("fails open when no ownership row exists for the session id", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockGetBrowserSessionLogs.mockResolvedValue([]);
    const res = await GET(logsRequest("sess_legacy"));
    expect(res.status).toBe(200);
    expect(mockGetBrowserSessionLogs).toHaveBeenCalledWith("sess_legacy");
  });

  it("surfaces a BrowserBaseError's status and message", async () => {
    mockQuery.mockResolvedValue({ rows: [{ user_id: 42 }] });
    mockGetBrowserSessionLogs.mockRejectedValue(
      new BrowserBaseError("gone", 410),
    );
    const res = await GET(logsRequest("sess_expired"));
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.error).toBe("gone");
  });
});
