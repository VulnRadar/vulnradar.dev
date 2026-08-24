/**
 * Route-level tests for GET /api/v3/assets.
 *
 * Mocks the database pool, session, and the runtime-config settings
 * resolver; the route's own auth-gating, disabled-account check, host
 * grouping (via the real normalizeHostForReputation), and safety-rating
 * computation (via the real getSafetyRating) all run for real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

// Mirrors tests/app/api/v3/dashboard/route.test.ts's approach: mock the
// settings resolver directly rather than the underlying system_settings
// table, since this route's own job is host grouping and safety-rating
// computation, not retention-window resolution (that's already covered by
// tests/app/api/v3/history/route.test.ts, whose SQL branching this route
// deliberately mirrors).
let settingsOverride: Record<string, number> = {};
vi.mock("@/lib/config/runtime-config", () => ({
  getSettings: vi.fn(async (keys: string[]) => {
    const defaults: Record<string, number> = {
      BILLING_FREE_RETENTION: -1,
      BILLING_CORE_SUPPORTER_RETENTION: -1,
      BILLING_PRO_SUPPORTER_RETENTION: -1,
      BILLING_ELITE_SUPPORTER_RETENTION: -1,
      HISTORY_LIST_MAX_ROWS: 100,
    };
    const out: Record<string, number> = {};
    for (const k of keys) out[k] = settingsOverride[k] ?? defaults[k];
    return out;
  }),
}));

const { GET } = await import("@/app/api/v3/assets/route");

function getRequest() {
  return new NextRequest("http://localhost/api/v3/assets", { method: "GET" });
}

const CLEAN_FINDINGS: unknown[] = [];
const CRITICAL_EXPLOIT_FINDINGS = [
  { title: "SQL Injection Vulnerability", severity: "critical" },
];

beforeEach(() => {
  settingsOverride = {};
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7 });
});

function installDefaultQueryMock(scanRows: unknown[], findingsRows: unknown[]) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT plan, role, disabled_at FROM users")) {
      return { rows: [{ plan: "free", role: "user", disabled_at: null }] };
    }
    if (
      sql.includes("FROM scan_history") &&
      sql.includes("ORDER BY scanned_at DESC")
    ) {
      return { rows: scanRows };
    }
    if (sql.includes("SELECT id, findings FROM scan_history WHERE id = ANY")) {
      return { rows: findingsRows };
    }
    return { rows: [] };
  });
}

describe("GET /api/v3/assets", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET(getRequest());

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a disabled account without running the asset queries", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT plan, role, disabled_at FROM users")) {
        return {
          rows: [{ plan: "free", role: "user", disabled_at: "2024-01-01" }],
        };
      }
      throw new Error("asset queries should not run for a disabled account");
    });

    const res = await GET(getRequest());

    expect(res.status).toBe(403);
  });

  it("scope=all lists public hosts from host_reputation and never reads scan_history", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT plan, role, disabled_at FROM users")) {
        return { rows: [{ plan: "free", role: "user", disabled_at: null }] };
      }
      if (sql.includes("FROM host_reputation")) {
        return {
          rows: [
            {
              host: "someone-else.com",
              severity_counts: {
                critical: 1,
                high: 0,
                medium: 2,
                low: 0,
                info: 1,
              },
              findings: [
                { title: "SQL Injection Vulnerability", severity: "critical" },
              ],
              last_scanned_at: "2024-02-01T00:00:00Z",
              source_scan_id: 55,
              scanned_url: "https://someone-else.com/x",
            },
          ],
        };
      }
      // The privacy guarantee: scope=all must never touch scan_history (which
      // includes private scans); it reads only the public host_reputation table.
      if (sql.includes("FROM scan_history")) {
        throw new Error("scope=all must not read scan_history");
      }
      return { rows: [] };
    });

    const req = new NextRequest("http://localhost/api/v3/assets?scope=all", {
      method: "GET",
    });
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.scope).toBe("all");
    expect(json.assets).toHaveLength(1);
    expect(json.assets[0]).toMatchObject({
      host: "someone-else.com",
      isPublic: true,
      findingsCount: 4,
    });
  });

  it("groups scans of the same host (www-stripped) and counts them, keyed to the newest scan", async () => {
    installDefaultQueryMock(
      [
        {
          id: 2,
          url: "https://example.com/newer",
          summary: { info: 1 },
          findings_count: 1,
          scanned_at: "2024-02-01T00:00:00Z",
        },
        {
          id: 1,
          url: "https://www.example.com/older",
          summary: {},
          findings_count: 0,
          scanned_at: "2024-01-01T00:00:00Z",
        },
      ],
      [{ id: 2, findings: CLEAN_FINDINGS }],
    );

    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.totalHosts).toBe(1);
    expect(json.assets).toHaveLength(1);
    expect(json.assets[0]).toMatchObject({
      host: "example.com",
      scanCount: 2,
      latestScanId: 2,
      latestUrl: "https://example.com/newer",
      safetyRating: "safe",
    });

    // Findings are fetched only for the one latest-per-host scan id, not
    // for every row in the retention window.
    const findingsCall = mockQuery.mock.calls.find(([sql]) =>
      sql.includes("SELECT id, findings FROM scan_history WHERE id = ANY"),
    );
    expect(findingsCall?.[1]).toEqual([[2]]);
  });

  it("keeps distinct hosts as separate rows and computes each one's own safety rating", async () => {
    installDefaultQueryMock(
      [
        {
          id: 10,
          url: "https://safe.test",
          summary: {},
          findings_count: 0,
          scanned_at: "2024-03-01T00:00:00Z",
        },
        {
          id: 11,
          url: "https://vuln.test",
          summary: { critical: 1 },
          findings_count: 1,
          scanned_at: "2024-02-15T00:00:00Z",
        },
      ],
      [
        { id: 10, findings: CLEAN_FINDINGS },
        { id: 11, findings: CRITICAL_EXPLOIT_FINDINGS },
      ],
    );

    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.totalHosts).toBe(2);
    const byHost = Object.fromEntries(
      (json.assets as Array<{ host: string; safetyRating: string }>).map(
        (a) => [a.host, a.safetyRating],
      ),
    );
    expect(byHost["safe.test"]).toBe("safe");
    expect(byHost["vuln.test"]).toBe("unsafe");
  });

  it("groups a bare-IP scanned target by its raw hostname instead of dropping it", async () => {
    installDefaultQueryMock(
      [
        {
          id: 20,
          url: "http://203.0.113.5/admin",
          summary: {},
          findings_count: 0,
          scanned_at: "2024-04-01T00:00:00Z",
        },
      ],
      [{ id: 20, findings: CLEAN_FINDINGS }],
    );

    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.assets).toHaveLength(1);
    expect(json.assets[0].host).toBe("203.0.113.5");
  });

  it("skips the findings lookup entirely when there are no scans", async () => {
    installDefaultQueryMock([], []);

    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.assets).toEqual([]);
    expect(json.totalHosts).toBe(0);
    expect(
      mockQuery.mock.calls.some((call) =>
        String(call[0]).includes(
          "SELECT id, findings FROM scan_history WHERE id = ANY",
        ),
      ),
    ).toBe(false);
  });

  it("uses a dated retention window scoped to the caller when the plan's retention is finite", async () => {
    settingsOverride.BILLING_FREE_RETENTION = 30;
    installDefaultQueryMock([], []);

    await GET(getRequest());

    const scanCall = mockQuery.mock.calls.find(
      ([sql]) =>
        sql.includes("FROM scan_history") &&
        sql.includes("ORDER BY scanned_at DESC"),
    );
    expect(scanCall?.[0]).toContain("scanned_at > NOW()");
    expect(scanCall?.[0]).toContain("user_id = $1");
    expect(scanCall?.[1]).toEqual([7, 30, 100]);
  });

  it("gives staff roles unlimited retention regardless of plan", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT plan, role, disabled_at FROM users")) {
        return { rows: [{ plan: "free", role: "admin", disabled_at: null }] };
      }
      if (
        sql.includes("FROM scan_history") &&
        sql.includes("ORDER BY scanned_at DESC")
      ) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    settingsOverride.BILLING_FREE_RETENTION = 30;

    await GET(getRequest());

    const scanCall = mockQuery.mock.calls.find(
      ([sql]) =>
        sql.includes("FROM scan_history") &&
        sql.includes("ORDER BY scanned_at DESC"),
    );
    expect(scanCall?.[0]).not.toContain("scanned_at >");
    expect(scanCall?.[1]).toEqual([7, 100]);
  });

  it("returns 500 when a query throws", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT plan, role, disabled_at FROM users")) {
        return { rows: [{ plan: "free", role: "user", disabled_at: null }] };
      }
      throw new Error("db unavailable");
    });

    const res = await GET(getRequest());

    expect(res.status).toBe(500);
  });
});
