/**
 * Route-level tests for GET /api/v3/admin/queue-status (Admin > System >
 * Scanner Queue -- AUDIT-010 admin-feature-gap). Auth goes through the
 * shared requireAdmin() (lib/auth/authorization.ts), which itself calls
 * getSession() and a pool.query role lookup -- both mocked here, the same
 * "mock at the getSession/db boundary" approach
 * tests/app/api/v3/admin/error-logs/route.test.ts uses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockSweepStaleScans = vi.fn();
const mockStaleScanGraceSeconds = vi.fn();
vi.mock("@/lib/scanner/scan-jobs", () => ({
  sweepStaleScans: () => mockSweepStaleScans(),
  staleScanGraceSeconds: () => mockStaleScanGraceSeconds(),
}));
vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: async () => "127.0.0.1",
}));

const { GET, POST } = await import("@/app/api/v3/admin/queue-status/route");

/**
 * The route reads `?failures=1` off request.url, so it needs a real Request
 * with an absolute URL. Origin is irrelevant -- only the search string is
 * ever read.
 */
function req(query = "") {
  return new Request(
    `https://vulnradar.test/api/v3/admin/queue-status${query}`,
  );
}

function withAdmin(userId = 7, role = "admin") {
  mockGetSession.mockResolvedValue({ userId });
  // totp_enabled: true short-circuits requireAdmin's 2FA-enforcement
  // check (lib/auth/authorization.ts's passesTwoFactorEnforcement) so it
  // doesn't issue a second (system_settings) query this suite doesn't
  // care about -- this route's own admin-gating is what's under test.
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: userId, role, totp_enabled: true }],
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/v3/admin/queue-status", () => {
  it("requires a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a caller below admin (e.g. support)", async () => {
    mockGetSession.mockResolvedValue({ userId: 3 });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3, role: "support" }] });
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it("returns zeroed counts and null ages when the queue is empty", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await GET(req());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.counts).toEqual({
      pending: 0,
      running: 0,
      completedLast24h: 0,
      failedLast24h: 0,
    });
    expect(json.oldestPendingAgeMs).toBeNull();
    expect(json.oldestRunningAgeMs).toBeNull();
    expect(json.recentWindowHours).toBe(24);
    expect(json.generatedAt).toBe("2026-08-13T12:00:00.000Z");
  });

  it("maps grouped rows into counts and computes ages from oldest_at", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          status: "pending",
          count: 3,
          oldest_at: "2026-08-13T11:59:00.000Z", // 60s ago
        },
        {
          status: "running",
          count: 1,
          oldest_at: "2026-08-13T11:55:00.000Z", // 5min ago
        },
        { status: "completed", count: 40, oldest_at: null },
        { status: "failed", count: 2, oldest_at: null },
      ],
    });

    const res = await GET(req());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.counts).toEqual({
      pending: 3,
      running: 1,
      completedLast24h: 40,
      failedLast24h: 2,
    });
    expect(json.oldestPendingAgeMs).toBe(60_000);
    expect(json.oldestRunningAgeMs).toBe(5 * 60_000);
  });

  it("scopes pending/running to all-time and completed/failed to the 24h window", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET(req());

    const [sql] = mockQuery.mock.calls[1] as [string];
    expect(sql).toContain("status IN ('pending', 'running')");
    expect(sql).toContain("status IN ('completed', 'failed')");
    expect(sql).toContain("NOW() - INTERVAL '24 hours'");
    expect(sql).toContain("GROUP BY status");
  });

  it("returns a graceful 500 when the query fails", async () => {
    withAdmin();
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});

/**
 * The rows behind the "Failed (24h)" tile. That count used to be a bare
 * number: the endpoint did one GROUP BY and never selected a scan row, so an
 * operator could see THAT scans were failing and never which or why.
 */
describe("GET /api/v3/admin/queue-status?failures=1", () => {
  const failedRow = {
    id: 91,
    user_id: 4,
    url: "https://example.com/checkout",
    error_message: "connect ECONNREFUSED 10.0.0.5:5432",
    source: "web",
    duration: 1200,
    started_at: "2026-08-13T11:58:00.000Z",
    scanned_at: "2026-08-13T11:58:03.000Z",
  };

  it("does not touch the failures table unless asked", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await GET(req());
    const json = await res.json();

    // Auth lookup + the one grouped count, and nothing else. The rows carry
    // a customer URL and a user id, and the card behind this polls every 45
    // seconds, so an unasked-for fetch would put targets on the wire
    // continuously to render a collapsed section.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(json.failures).toBeUndefined();
    expect(json.failuresTruncated).toBeUndefined();
  });

  it("ignores any value other than exactly 1", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const json = await (await GET(req("?failures=true"))).json();

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(json.failures).toBeUndefined();
  });

  it("returns the failed rows, newest first and capped", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({
      rows: [{ status: "failed", count: 1, oldest_at: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [failedRow] });

    const json = await (await GET(req("?failures=1"))).json();

    expect(mockQuery).toHaveBeenCalledTimes(3);
    const [sql] = mockQuery.mock.calls[2] as [string];
    expect(sql).toContain("status = 'failed'");
    expect(sql).toContain("NOW() - INTERVAL '24 hours'");
    expect(sql).toContain("ORDER BY scanned_at DESC");
    expect(sql).toContain("LIMIT 25");

    expect(json.failures).toEqual([
      {
        id: 91,
        userId: 4,
        url: "https://example.com/checkout",
        error: "connect ECONNREFUSED 10.0.0.5:5432",
        source: "web",
        durationMs: 1200,
        failedAt: "2026-08-13T11:58:03.000Z",
        ranForMs: 3000,
      },
    ]);
    expect(json.failuresTruncated).toBe(false);
  });

  it("passes error_message through RAW, not through the public sanitizer", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [failedRow] });

    const json = await (await GET(req("?failures=1"))).json();

    // This is the deliberate part, and the reason the assertion is explicit.
    // publicScanErrorMessage() would collapse this to "The target refused the
    // connection or closed it early." -- correct for the person who ran the
    // scan, and the loss of exactly the detail an operator opened this panel
    // to read. If someone later routes this field through the sanitizer,
    // this test is what should stop them.
    expect(json.failures[0].error).toBe("connect ECONNREFUSED 10.0.0.5:5432");
  });

  it("never joins users: an id is this endpoint's permission to give, a name is not", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [failedRow] });

    await GET(req("?failures=1"));

    const [sql] = mockQuery.mock.calls[2] as [string];
    expect(sql).not.toMatch(/\bJOIN\b/i);
    expect(sql).not.toContain("email");
  });

  it("flags truncation when the window holds more than the cap", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: Array.from({ length: 25 }, (_, i) => ({ ...failedRow, id: i })),
    });

    const json = await (await GET(req("?failures=1"))).json();

    expect(json.failures).toHaveLength(25);
    expect(json.failuresTruncated).toBe(true);
  });

  it("leaves ranForMs null when the row never started", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...failedRow, started_at: null }],
    });

    const json = await (await GET(req("?failures=1"))).json();

    expect(json.failures[0].ranForMs).toBeNull();
  });
});

describe("POST /api/v3/admin/queue-status (fail stuck scans)", () => {
  it("requires an admin", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(mockSweepStaleScans).not.toHaveBeenCalled();
  });

  it("refuses support-tier staff: it ends other users' scans", async () => {
    withAdmin(7, "support");
    const res = await POST();
    expect(res.status).toBe(403);
    expect(mockSweepStaleScans).not.toHaveBeenCalled();
  });

  it("runs the stale-scan sweep and reports what it cleared and the grace period", async () => {
    withAdmin();
    mockSweepStaleScans.mockResolvedValue(2);
    mockStaleScanGraceSeconds.mockResolvedValue(3600);
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 }); // audit insert
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ swept: 2, graceSeconds: 3600 });
    expect(mockSweepStaleScans).toHaveBeenCalledTimes(1);
    const audit = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("admin_audit_log"),
    );
    expect(audit?.[1]).toEqual(expect.arrayContaining(["sweep_stale_scans"]));
  });

  it("returns a 500 when the sweep fails", async () => {
    withAdmin();
    mockSweepStaleScans.mockRejectedValue(new Error("db down"));
    mockStaleScanGraceSeconds.mockResolvedValue(3600);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST();
    expect(res.status).toBe(500);
    errSpy.mockRestore();
  });
});
