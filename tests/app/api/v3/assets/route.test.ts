/**
 * Route-level tests for GET /api/v3/assets.
 *
 * Mocks the database pool, session, limiter and the runtime-config settings
 * resolver; the route's own auth-gating, disabled-account check, response
 * shaping and safety-rating computation (via the real getSafetyRating) all run
 * for real. What Postgres does with the host grouping, the cap and the totals
 * is proven against a real database in tests/integration/read-perf.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { PUBLIC_HOST_SQL } from "@/lib/database/sql-fragments";
import { RATING_FINDINGS_SQL } from "@/lib/scanner/rating-findings-sql";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockRateLimit(...args),
  RATE_LIMITS: { api: { limit: "api" } },
}));

// Mirrors tests/app/api/v3/dashboard/route.test.ts's approach: mock the
// settings resolver directly rather than the underlying system_settings
// table, since retention-window resolution is already covered by
// tests/app/api/v3/history/route.test.ts, whose SQL branching this route
// deliberately mirrors.
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

function allRequest() {
  return new NextRequest("http://localhost/api/v3/assets?scope=all", {
    method: "GET",
  });
}

const CRITICAL_EXPLOIT_FINDINGS = [
  { title: "SQL Injection Vulnerability", severity: "critical" },
];

function hostRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 2,
    host: "example.com",
    url: "https://example.com/newer",
    summary: { info: 1 },
    findings_count: 1,
    scanned_at: "2024-02-01T00:00:00Z",
    is_public: false,
    scan_count: 1,
    total_hosts: 1,
    total_scans: 1,
    findings: [],
    ...overrides,
  };
}

const USER_ROW = { plan: "free", role: "user", disabled_at: null };

function installDefaultQueryMock(hostRows: unknown[], user = USER_ROW) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT plan, role, disabled_at FROM users")) {
      return { rows: [user] };
    }
    if (sql.includes("DISTINCT ON (host)")) {
      return { rows: hostRows };
    }
    return { rows: [] };
  });
}

function reputationRow(host: string) {
  return {
    host,
    severity_counts: { critical: 1, high: 0, medium: 2, low: 0, info: 1 },
    findings: CRITICAL_EXPLOIT_FINDINGS,
    last_scanned_at: "2024-02-01T00:00:00Z",
    source_scan_id: 55,
  };
}

function installAllHostsMock(rows: unknown[]) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT plan, role, disabled_at FROM users")) {
      return { rows: [USER_ROW] };
    }
    if (sql.includes("FROM host_reputation")) {
      return { rows };
    }
    // The privacy guarantee: scope=all must never touch scan_history (which
    // includes private scans); it reads only the public host_reputation table.
    throw new Error(`scope=all ran an unexpected query: ${sql}`);
  });
}

function hostsCall() {
  return mockQuery.mock.calls.find(([sql]) =>
    String(sql).includes("DISTINCT ON (host)"),
  ) as [string, unknown[]];
}

function reputationSql(): string {
  return String(
    mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("FROM host_reputation"),
    )![0],
  );
}

beforeEach(() => {
  settingsOverride = {};
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7 });
  mockRateLimit.mockReset();
  mockRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 10,
    retryAfterSeconds: 0,
  });
});

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

  describe("scope=all", () => {
    it("lists public hosts from host_reputation and never reads scan_history", async () => {
      installAllHostsMock([
        {
          ...reputationRow("someone-else.com"),
          scanned_url: "https://someone-else.com/x",
        },
      ]);

      const res = await GET(allRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.scope).toBe("all");
      expect(json.assets).toHaveLength(1);
      expect(json.assets[0]).toMatchObject({
        host: "someone-else.com",
        isPublic: true,
        findingsCount: 4,
        safetyRating: "unsafe",
      });
      // Privacy: the scanned URL itself (path + query string) must never leave
      // this branch. It has no owner predicate, so returning it would hand
      // every signed-in caller the exact URL of the latest public scan of
      // every host, tokens included. Only the hostname is public.
      expect(reputationSql()).not.toContain("scanned_url");
      expect(json.assets[0].latestUrl).toBe("https://someone-else.com");
      expect(JSON.stringify(json)).not.toContain("someone-else.com/x");
    });

    it("reads four fields of each finding rather than the whole column", async () => {
      installAllHostsMock([]);

      await GET(allRequest());

      expect(reputationSql()).toContain(`${RATING_FINDINGS_SQL} AS findings`);
    });

    it("is limited per account, and a refused call reads nothing", async () => {
      mockRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 42,
      });
      installAllHostsMock([]);

      const res = await GET(allRequest());

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("42");
      expect(mockRateLimit).toHaveBeenCalledWith(
        expect.objectContaining({ key: "assets-all:7", limit: "api" }),
      );
      expect(
        mockQuery.mock.calls.some(([sql]) =>
          String(sql).includes("FROM host_reputation"),
        ),
      ).toBe(false);
    });

    it("says truncated only when a host was actually left out", async () => {
      const rows = (n: number) =>
        Array.from({ length: n }, (_, i) => reputationRow(`h${i}.test`));

      installAllHostsMock(rows(500));
      const exact = await (await GET(allRequest())).json();
      expect(exact.assets).toHaveLength(500);
      expect(exact.truncated).toBe(false);

      installAllHostsMock(rows(501));
      const over = await (await GET(allRequest())).json();
      expect(over.assets).toHaveLength(500);
      expect(over.limit).toBe(500);
      expect(over.truncated).toBe(true);
    });
  });

  describe("the caller's own hosts", () => {
    it("groups in SQL by the same host expression the public report uses", async () => {
      installDefaultQueryMock([]);

      await GET(getRequest());

      const [sql] = hostsCall();
      expect(sql).toContain(PUBLIC_HOST_SQL);
      expect(sql).toContain("ORDER BY host, scanned_at DESC, id DESC");
      expect(sql).toContain("COUNT(*) OVER (PARTITION BY");
    });

    it("reads four fields of the latest scan's findings, after the cap", async () => {
      installDefaultQueryMock([]);

      await GET(getRequest());

      const [sql] = hostsCall();
      expect(sql).toContain(`${RATING_FINDINGS_SQL} AS findings`);
      // Only the outer SELECT, past the LIMIT, may touch the column.
      const projection = sql.indexOf(RATING_FINDINGS_SQL);
      expect(sql.indexOf("LIMIT $2")).toBeLessThan(projection);
      expect(sql.slice(0, projection)).not.toMatch(/\bfindings\b/);
    });

    it("is not held to the all-hosts limiter", async () => {
      installDefaultQueryMock([]);

      await GET(getRequest());

      expect(mockRateLimit).not.toHaveBeenCalled();
    });

    it("maps each host row, keeping the scan count and its own safety rating", async () => {
      installDefaultQueryMock([
        hostRow({ scan_count: 2, total_hosts: 2, total_scans: 3 }),
        hostRow({
          id: 11,
          host: "vuln.test",
          url: "https://vuln.test",
          summary: { critical: 1 },
          is_public: true,
          findings: CRITICAL_EXPLOIT_FINDINGS,
          total_hosts: 2,
          total_scans: 3,
        }),
      ]);

      const res = await GET(getRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.totalHosts).toBe(2);
      expect(json.totalScans).toBe(3);
      expect(json.truncated).toBe(false);
      expect(json.assets).toEqual([
        {
          host: "example.com",
          scanCount: 2,
          latestScanId: 2,
          latestUrl: "https://example.com/newer",
          latestScannedAt: "2024-02-01T00:00:00.000Z",
          findingsCount: 1,
          summary: { info: 1 },
          safetyRating: "safe",
          isPublic: false,
        },
        {
          host: "vuln.test",
          scanCount: 1,
          latestScanId: 11,
          latestUrl: "https://vuln.test",
          latestScannedAt: "2024-02-01T00:00:00.000Z",
          findingsCount: 1,
          summary: { critical: 1 },
          safetyRating: "unsafe",
          isPublic: true,
        },
      ]);
    });

    it("says truncated when more hosts exist than the cap returned", async () => {
      settingsOverride.HISTORY_LIST_MAX_ROWS = 1;
      installDefaultQueryMock([hostRow({ total_hosts: 3, total_scans: 9 })]);

      const json = await (await GET(getRequest())).json();

      expect(json.assets).toHaveLength(1);
      expect(json.limit).toBe(1);
      expect(json.totalHosts).toBe(3);
      expect(json.totalScans).toBe(9);
      expect(json.truncated).toBe(true);
    });

    it("does not say truncated when the hosts exactly fill the cap", async () => {
      settingsOverride.HISTORY_LIST_MAX_ROWS = 1;
      installDefaultQueryMock([hostRow({ total_hosts: 1, total_scans: 40 })]);

      const json = await (await GET(getRequest())).json();

      expect(json.totalScans).toBe(40);
      expect(json.truncated).toBe(false);
    });

    it("answers zeros for an account with no scans", async () => {
      installDefaultQueryMock([]);

      const res = await GET(getRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toMatchObject({
        assets: [],
        totalHosts: 0,
        totalScans: 0,
        truncated: false,
      });
    });

    it("uses a dated retention window scoped to the caller when the plan's retention is finite", async () => {
      settingsOverride.BILLING_FREE_RETENTION = 30;
      installDefaultQueryMock([]);

      await GET(getRequest());

      const [sql, params] = hostsCall();
      expect(sql).toContain("scanned_at > NOW()");
      expect(sql).toContain("user_id = $1");
      expect(params).toEqual([7, 100, 30]);
    });

    it("gives staff roles unlimited retention regardless of plan", async () => {
      settingsOverride.BILLING_FREE_RETENTION = 30;
      installDefaultQueryMock([], { ...USER_ROW, role: "admin" });

      await GET(getRequest());

      const [sql, params] = hostsCall();
      expect(sql).not.toContain("scanned_at >");
      expect(params).toEqual([7, 100]);
    });
  });

  describe("only a COMPLETED scan can be a host's latest", () => {
    // A scan row exists as 'pending' with summary '{}' and no findings from
    // the moment it is queued, and a failed or cancelled one keeps those
    // defaults. Taken as "latest", one of them made the host read as 0
    // findings and "safe" when its last real result had criticals. Which row
    // PostgreSQL actually returns is proven in tests/integration/list-reads
    // .test.ts; this pins that both retention branches carry the filter.
    it.each([
      ["unlimited retention", -1, [7, 100]],
      ["a dated retention window", 30, [7, 100, 30]],
    ] as const)(
      "filters on status in the %s query",
      async (_name, days, params) => {
        settingsOverride.BILLING_FREE_RETENTION = days;
        installDefaultQueryMock([]);

        await GET(getRequest());

        const [sql, sent] = hostsCall();
        expect(sql).toContain("status = 'completed'");
        expect(sent).toEqual(params);
      },
    );

    it("leaves the public all-hosts branch alone: host_reputation only ever holds completed scans", async () => {
      installAllHostsMock([]);

      await GET(allRequest());

      const hostSql = reputationSql();
      expect(hostSql).not.toContain("scan_history");
      expect(hostSql).not.toContain("status");
    });
  });

  it("returns 500 when a query throws", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT plan, role, disabled_at FROM users")) {
        return { rows: [USER_ROW] };
      }
      throw new Error("db unavailable");
    });

    const res = await GET(getRequest());

    expect(res.status).toBe(500);
  });
});
