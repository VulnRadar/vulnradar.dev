/**
 * Route-level tests for /api/v3/schedules: GET (list the session user's
 * recurring scan schedules), POST (create one, SSRF-checked via
 * validateScanTarget before it is ever persisted), and DELETE (remove one,
 * scoped to the owner). The database, outbound email, and the SSRF target
 * check are mocked at the network/database boundary; getClientIp is mocked
 * directly at its module (same pattern as
 * tests/app/api/v3/teams/members/route.test.ts) rather than mocking
 * next/headers underneath it.
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

const mockSendNotificationEmail = vi.fn();
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: (...args: unknown[]) =>
    mockSendNotificationEmail(...args),
}));

const mockValidateScanTarget = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  validateScanTarget: (...args: unknown[]) => mockValidateScanTarget(...args),
}));

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

// getUserPlanLimits (lib/billing/plan-limits.ts) is real: only its two DB
// touch points are mocked. Default plan is elite_supporter (scheduledScans:
// -1, unlimited), which reproduces every existing test's original
// unlimited-until-10 assumption without changing them.
const mockGetSetting = vi.fn();
// getSettings resolves from the real registry defaults rather than
// hand-copied numbers, so these tests can't silently drift from what the
// registry actually ships.
async function resolveFromRegistry(keys: string[]) {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  return Object.fromEntries(
    keys.map((k) => [
      k,
      SETTINGS_REGISTRY[k as keyof typeof SETTINGS_REGISTRY].default,
    ]),
  );
}
vi.mock("@/lib/config/runtime-config", () => ({
  // Only BILLING_ENABLED (read inside getUserPlanLimits) goes through the
  // controllable mock; the route's own direct getSetting call
  // (MAX_URL_LENGTH) resolves from the real registry default like
  // getSettings does, so it can't silently drift from what the registry
  // ships -- and so it doesn't collapse to the mock's generic `true`.
  getSetting: async (key: string) => {
    if (key === "BILLING_ENABLED") return mockGetSetting();
    const [resolved] = Object.values(await resolveFromRegistry([key]));
    return resolved;
  },
  getSettings: (keys: string[]) => resolveFromRegistry(keys),
}));

const mockGetUserPlan = vi.fn();
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  getUserPlan: (...args: unknown[]) => mockGetUserPlan(...args),
}));

const mockScheduleCreatedEmail = vi.fn((..._args: unknown[]) => ({
  subject: "Scheduled Scan Created",
  text: "text",
  html: "<p>html</p>",
}));
const mockScheduleDeletedEmail = vi.fn((..._args: unknown[]) => ({
  subject: "Scheduled Scan Deleted",
  text: "text",
  html: "<p>html</p>",
}));
vi.mock("@/lib/email/email", () => ({
  scheduleCreatedEmail: (...args: unknown[]) =>
    mockScheduleCreatedEmail(...args),
  scheduleDeletedEmail: (...args: unknown[]) =>
    mockScheduleDeletedEmail(...args),
}));

const { GET, POST, DELETE } = await import("@/app/api/v3/schedules/route");

function jsonRequest(
  url: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42, email: "user@example.com" });
  mockSendNotificationEmail.mockReset();
  mockSendNotificationEmail.mockResolvedValue(undefined);
  mockValidateScanTarget.mockReset();
  mockValidateScanTarget.mockResolvedValue({ safe: true });
  mockScheduleCreatedEmail.mockClear();
  mockScheduleDeletedEmail.mockClear();
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(true);
  mockGetUserPlan.mockReset();
  mockGetUserPlan.mockResolvedValue("elite_supporter");
});

describe("GET /api/v3/schedules", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("scopes the list to the session user's own schedules", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, url: "https://example.com" }],
    });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual([{ id: 1, url: "https://example.com" }]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM scheduled_scans WHERE user_id = $1");
    expect(params).toEqual([42]);
  });
});

describe("POST /api/v3/schedules", () => {
  function postRequest(body: unknown, headers: Record<string, string> = {}) {
    return jsonRequest(
      "http://localhost/api/v3/schedules",
      "POST",
      body,
      headers,
    );
  }

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a missing url", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockValidateScanTarget).not.toHaveBeenCalled();
  });

  it("rejects a url longer than the max schedule url length", async () => {
    const longUrl = "https://example.com/" + "a".repeat(2048);

    const res = await POST(postRequest({ url: longUrl }));

    expect(res.status).toBe(400);
    expect(mockValidateScanTarget).not.toHaveBeenCalled();
  });

  it("rejects a malformed url before ever calling validateScanTarget", async () => {
    const res = await POST(postRequest({ url: "not-a-url" }));

    expect(res.status).toBe(400);
    expect(mockValidateScanTarget).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects and never persists a target that validateScanTarget flags unsafe (SSRF guard)", async () => {
    mockValidateScanTarget.mockResolvedValueOnce({
      safe: false,
      reason: "Private IP address blocked",
    });

    const res = await POST(postRequest({ url: "http://169.254.169.254/" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Private IP address blocked");
    // No count check, no insert: the unsafe target never reaches the DB.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects creation once the caller is at their plan's scheduled-scan cap", async () => {
    mockGetUserPlan.mockResolvedValue("pro_supporter"); // scheduledScans: 5
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 5 }] });

    const res = await POST(postRequest({ url: "https://example.com" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("up to 5 Scheduled scans");
    // Only the count query ran; no INSERT.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("rejects creation entirely on a plan with no scheduled-scan access", async () => {
    mockGetUserPlan.mockResolvedValue("free"); // scheduledScans: 0
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });

    const res = await POST(postRequest({ url: "https://example.com" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("not available on your plan");
  });

  it("defaults an unknown frequency to weekly (7-day interval)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, url: "https://example.com", frequency: "weekly" }],
    });

    await POST(
      postRequest({ url: "https://example.com", frequency: "biweekly" }),
    );

    const [insertSql, insertParams] = mockQuery.mock.calls[1];
    expect(insertSql).toContain("INSERT INTO scheduled_scans");
    expect(insertParams[2]).toBe("weekly");
    expect(insertParams[3]).toBe(7);
  });

  it("creates the schedule scoped to the session user, validates the target first, and sends a notification email", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 2 }] }); // countRes
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 5,
          url: "https://example.com",
          frequency: "daily",
          active: true,
          last_run_at: null,
          next_run_at: "2024-01-02T00:00:00.000Z",
          created_at: "2024-01-01T00:00:00.000Z",
        },
      ],
    }); // insert

    const res = await POST(
      postRequest(
        { url: "https://example.com", frequency: "daily" },
        { "user-agent": "test-agent" },
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.id).toBe(5);

    // validateScanTarget runs before the insert.
    expect(mockValidateScanTarget).toHaveBeenCalledWith("https://example.com");
    const validateOrder = mockValidateScanTarget.mock.invocationCallOrder[0];
    const insertOrder = mockQuery.mock.invocationCallOrder[1];
    expect(validateOrder).toBeLessThan(insertOrder);

    const [, insertParams] = mockQuery.mock.calls[1];
    expect(insertParams).toEqual([42, "https://example.com", "daily", 1]);

    expect(mockScheduleCreatedEmail).toHaveBeenCalledWith(
      "https://example.com",
      "daily",
      { ipAddress: "127.0.0.1", userAgent: "test-agent" },
    );
    expect(mockSendNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        userEmail: "user@example.com",
        type: "schedules",
      }),
    );
  });

  it("does not fail the request when the notification email fails to send", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 6, url: "https://example.com", frequency: "weekly" }],
    });
    mockSendNotificationEmail.mockRejectedValueOnce(new Error("smtp down"));

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(201);
  });
});

describe("DELETE /api/v3/schedules", () => {
  function deleteRequest(body: unknown, headers: Record<string, string> = {}) {
    return jsonRequest(
      "http://localhost/api/v3/schedules",
      "DELETE",
      body,
      headers,
    );
  }

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await DELETE(deleteRequest({ id: 1 }));

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("scopes both the lookup and the delete to the owning user, and does not send an email for someone else's schedule id", async () => {
    // Guessing another user's schedule id: the SELECT is scoped to
    // user_id = session.userId, so it comes back empty even if the id
    // exists for a different owner.
    mockQuery.mockResolvedValueOnce({ rows: [] }); // select
    mockQuery.mockResolvedValueOnce({}); // delete (matches nothing)

    const res = await DELETE(deleteRequest({ id: 999 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true });
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();

    const [selectSql, selectParams] = mockQuery.mock.calls[0];
    expect(selectSql).toContain("WHERE id = $1 AND user_id = $2");
    expect(selectParams).toEqual([999, 42]);

    const [deleteSql, deleteParams] = mockQuery.mock.calls[1];
    expect(deleteSql).toContain(
      "DELETE FROM scheduled_scans WHERE id = $1 AND user_id = $2",
    );
    expect(deleteParams).toEqual([999, 42]);
  });

  it("deletes the owner's own schedule and sends the deleted-schedule notification", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ url: "https://example.com" }] }); // select
    mockQuery.mockResolvedValueOnce({}); // delete

    const res = await DELETE(
      deleteRequest({ id: 5 }, { "user-agent": "test-agent" }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true });

    expect(mockScheduleDeletedEmail).toHaveBeenCalledWith(
      "https://example.com",
      {
        ipAddress: "127.0.0.1",
        userAgent: "test-agent",
      },
    );
    expect(mockSendNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        userEmail: "user@example.com",
        type: "schedules",
      }),
    );
  });

  it("does not fail the delete response when the deleted-schedule notification email fails to send", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ url: "https://example.com" }] });
    mockQuery.mockResolvedValueOnce({});
    mockSendNotificationEmail.mockRejectedValueOnce(new Error("smtp down"));

    const res = await DELETE(deleteRequest({ id: 5 }));

    expect(res.status).toBe(200);
    // Let the fire-and-forget rejection's .catch handler run before the
    // test exits, so it's exercised rather than left pending.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
