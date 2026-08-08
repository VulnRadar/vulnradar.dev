/**
 * Route-level tests for GET/POST /api/v3/data-request, the GDPR-style
 * "download my data" export flow.
 *
 * The database is mocked (network/DB boundary) and getSession is mocked
 * (auth boundary). Every one of the ~20 queries this route issues takes
 * `session.userId` (or, for the two data_requests writes, `[session.userId,
 * jsonString]`) as its first bound parameter, so the cross-user-leak check
 * below asserts that invariant across every call the mock ever recorded
 * rather than re-deriving each query's exact SQL text.
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

const { GET, POST } = await import("@/app/api/v3/data-request/route");

const SESSION = { userId: 42 };

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue(SESSION);
});

function postRequest(): NextRequest {
  return new NextRequest("http://localhost/api/v3/data-request", {
    method: "POST",
  });
}

/**
 * Routes every query issued by POST's data-gathering fan-out and the
 * subsequent UPDATE/INSERT into data_requests. Everything not otherwise
 * special-cased returns an empty result set, matching a brand-new account
 * with no scan history, teams, badges, etc.
 */
function routeQueries({
  priorDownloadAt,
  updateRowCount = 1,
  notifRow = null,
  hasUserRow = true,
  aiConfigRow = null,
}: {
  priorDownloadAt?: string | null;
  updateRowCount?: number;
  notifRow?: Record<string, unknown> | null;
  hasUserRow?: boolean;
  aiConfigRow?: Record<string, unknown> | null;
} = {}) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (
      /FROM data_requests WHERE user_id = \$1 AND downloaded_at IS NOT NULL/.test(
        sql,
      )
    ) {
      return {
        rows: priorDownloadAt ? [{ downloaded_at: priorDownloadAt }] : [],
      };
    }
    if (/UPDATE data_requests SET data/.test(sql)) {
      return { rows: [], rowCount: updateRowCount };
    }
    if (/INSERT INTO data_requests/.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    if (/FROM notification_preferences/.test(sql)) {
      return { rows: notifRow ? [notifRow] : [] };
    }
    if (/FROM user_ai_configs/.test(sql)) {
      return { rows: aiConfigRow ? [aiConfigRow] : [] };
    }
    if (/FROM users WHERE id = \$1/.test(sql)) {
      return {
        rows: hasUserRow ? [{ id: 42, email: "user@example.com" }] : [],
      };
    }
    return { rows: [] };
  });
}

describe("GET /api/v3/data-request", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("reports no data and an open cooldown when nothing has ever been exported", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      hasData: false,
      canDownloadNew: true,
      lastDownloadAt: null,
    });
    expect(mockQuery.mock.calls[0][1]).toEqual([42]);
  });

  it("blocks a new download while inside the 30-day cooldown", async () => {
    const recentDownload = new Date(Date.now() - 1000).toISOString();
    mockQuery.mockResolvedValueOnce({
      rows: [{ downloaded_at: recentDownload }],
    });
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.hasData).toBe(true);
    expect(json.canDownloadNew).toBe(false);
    expect(json.cooldownEndsAt).toBeTruthy();
  });

  it("allows a new download once the cooldown has elapsed", async () => {
    const oldDownload = new Date(
      Date.now() - 31 * 24 * 60 * 60 * 1000,
    ).toISOString();
    mockQuery.mockResolvedValueOnce({
      rows: [{ downloaded_at: oldDownload }],
    });
    const res = await GET();
    const json = await res.json();

    expect(json.canDownloadNew).toBe(true);
  });

  it("fails open to the 'no data yet' shape on a database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      hasData: false,
      canDownloadNew: true,
      lastDownloadAt: null,
    });
  });
});

describe("POST /api/v3/data-request", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest());
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a new request within the 30-day cooldown without gathering any data", async () => {
    const recentDownload = new Date(Date.now() - 1000).toISOString();
    mockQuery.mockResolvedValueOnce({
      rows: [{ downloaded_at: recentDownload }],
    });

    const res = await POST(postRequest());
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error).toMatch(/once every 30 days/);
    // The cooldown check is the only query issued: the 18-query data
    // fan-out never runs, so a user cannot spam exports.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("uses singular 'day' when exactly one day remains", async () => {
    // 29 days + a few seconds ago -> just under 1 day left, rounds up to 1.
    const almostExpired = new Date(
      Date.now() - (29 * 24 * 60 * 60 * 1000 + 5000),
    ).toISOString();
    mockQuery.mockResolvedValueOnce({
      rows: [{ downloaded_at: almostExpired }],
    });

    const res = await POST(postRequest());
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error).toContain("1 day.");
    expect(json.error).not.toContain("1 days");
  });

  it("gathers and returns the full export, scoping every query to the caller's user id", async () => {
    routeQueries({ priorDownloadAt: null, updateRowCount: 1 });

    const res = await POST(postRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.account).toEqual({ id: 42, email: "user@example.com" });
    expect(json.data).toHaveProperty("scanHistory");
    expect(json.data).toHaveProperty("apiKeys");
    expect(json.data).toHaveProperty("billingHistory");
    expect(json.data).toHaveProperty("adminNotesAboutYou");
    // GDPR audit (2026-08): these categories existed as real, current
    // tables tied to the caller's user_id but were missing from the
    // export entirely (Art. 15/20 completeness gap).
    expect(json.data).toHaveProperty("aiConfig");
    expect(json.data).toHaveProperty("aiConversations");
    expect(json.data).toHaveProperty("scanFindingFeedback");
    expect(json.data).toHaveProperty("inAppNotifications");
    expect(json.data).toHaveProperty("browserSessions");
    expect(json.data.dataExportVersion).toBeDefined();

    // Cross-user leak check: every single query this request issued -
    // cooldown check, all data-gathering queries, and the final
    // UPDATE - was scoped to this caller's own id, never anyone else's.
    expect(mockQuery.mock.calls.length).toBeGreaterThan(20);
    for (const call of mockQuery.mock.calls) {
      const params = call[1] as unknown[];
      expect(params[0]).toBe(42);
    }
  });

  it("never includes the encrypted AI API key in the export", async () => {
    routeQueries({
      priorDownloadAt: null,
      aiConfigRow: {
        use_vulnradar_ai: false,
        ai_disabled: false,
        provider: "openai",
        model_id: "gpt-4o-mini",
        base_url: "https://api.openai.com/v1",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    });

    const res = await POST(postRequest());
    const json = await res.json();

    expect(json.data.aiConfig).toEqual({
      use_vulnradar_ai: false,
      ai_disabled: false,
      provider: "openai",
      model_id: "gpt-4o-mini",
      base_url: "https://api.openai.com/v1",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    expect(JSON.stringify(json.data.aiConfig)).not.toContain(
      "api_key_encrypted",
    );

    const aiConfigQuery = mockQuery.mock.calls.find((c) =>
      (c[0] as string).includes("FROM user_ai_configs"),
    );
    expect(aiConfigQuery?.[0]).not.toContain("api_key_encrypted");
  });

  it("exports null aiConfig when the caller has no custom AI configuration", async () => {
    routeQueries({ priorDownloadAt: null, aiConfigRow: null });

    const res = await POST(postRequest());
    const json = await res.json();

    expect(json.data.aiConfig).toBeNull();
  });

  it("gathers a fresh export once a prior download's cooldown has elapsed", async () => {
    const oldDownload = new Date(
      Date.now() - 31 * 24 * 60 * 60 * 1000,
    ).toISOString();
    routeQueries({ priorDownloadAt: oldDownload, updateRowCount: 1 });

    const res = await POST(postRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.account).toEqual({ id: 42, email: "user@example.com" });
  });

  it("exports a null account when the user row is unexpectedly missing", async () => {
    routeQueries({ priorDownloadAt: null, hasUserRow: false });

    const res = await POST(postRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.account).toBeNull();
  });

  it("inserts a new data_requests row when no existing row was updated", async () => {
    routeQueries({ priorDownloadAt: null, updateRowCount: 0 });

    await POST(postRequest());

    const insertCalls = mockQuery.mock.calls.filter((c) =>
      /INSERT INTO data_requests/.test(c[0] as string),
    );
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0][1]).toEqual([42, expect.any(String)]);
  });

  it("does not insert a new row when the UPDATE already touched one", async () => {
    routeQueries({ priorDownloadAt: null, updateRowCount: 1 });

    await POST(postRequest());

    const insertCalls = mockQuery.mock.calls.filter((c) =>
      /INSERT INTO data_requests/.test(c[0] as string),
    );
    expect(insertCalls).toHaveLength(0);
  });

  it("strips id and user_id from the exported notification preferences", async () => {
    routeQueries({
      priorDownloadAt: null,
      notifRow: { id: 9, user_id: 42, email_enabled: true },
    });

    const res = await POST(postRequest());
    const json = await res.json();

    expect(json.data.notificationPreferences).toEqual({
      email_enabled: true,
    });
  });

  it("returns 500 when the data-gathering fan-out fails", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // cooldown check passes
    mockQuery.mockRejectedValue(new Error("db down")); // every fan-out query fails

    const res = await POST(postRequest());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to export data");
  });
});
