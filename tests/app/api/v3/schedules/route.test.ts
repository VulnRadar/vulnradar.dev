/**
 * Route-level tests for /api/v3/schedules: GET (list the session user's
 * recurring scan schedules), POST (create one -- SSRF-checked via
 * validateScanTarget, plan-limit checked, and now also frequency-tier
 * gated for hourly/6hourly before it is ever persisted), and DELETE
 * (remove one, scoped to the owner).
 *
 * POST now writes the row in two statements: an INSERT (to obtain the
 * DB-assigned id, which lib/scanner/schedule-timing.ts's computeNextRunAt
 * needs for its per-schedule jitter) followed by an UPDATE that stamps the
 * real next_run_at. The database, outbound email, and the SSRF target
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

// getUserPlanLimits / userMeetsScheduleFrequency (lib/billing/plan-limits.ts)
// are real: only their DB/setting touch points are mocked. Default plan is
// elite_supporter (scheduledScans: -1, unlimited; clears every frequency
// gate), which reproduces every existing test's original
// unlimited-until-10 assumption without changing them.
const mockGetSetting = vi.fn();
const mockGetFeatureScheduledScans = vi.fn();
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
  // BILLING_ENABLED (read inside getUserPlanLimits and
  // userMeetsScheduleFrequency) and FEATURE_SCHEDULED_SCANS (the route's
  // own deployment-wide kill switch) go through controllable mocks; the
  // route's own direct getSetting call (MAX_URL_LENGTH) resolves from the
  // real registry default like getSettings does, so it can't silently
  // drift from what the registry ships -- and so it doesn't collapse to
  // the mock's generic `true`.
  getSetting: async (key: string) => {
    if (key === "BILLING_ENABLED") return mockGetSetting();
    if (key === "FEATURE_SCHEDULED_SCANS")
      return mockGetFeatureScheduledScans();
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

const { GET, POST, PATCH, DELETE } =
  await import("@/app/api/v3/schedules/route");

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

/** Queue the two writes POST issues after the plan-limit count query: the
 *  INSERT (RETURNING id) and the follow-up UPDATE that stamps the real
 *  next_run_at (RETURNING the full row). */
function queueInsertAndUpdate(
  insertedId: number,
  updatedRow: Record<string, unknown>,
) {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: insertedId }] }); // INSERT
  mockQuery.mockResolvedValueOnce({ rows: [updatedRow] }); // UPDATE
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
  mockGetFeatureScheduledScans.mockReset();
  mockGetFeatureScheduledScans.mockResolvedValue(true);
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

  it("scopes the list to the session user's own schedules and selects the time-of-day columns", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, url: "https://example.com" }],
    });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual([{ id: 1, url: "https://example.com" }]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM scheduled_scans WHERE user_id = $1");
    expect(sql).toContain("preferred_hour_utc");
    expect(sql).toContain("preferred_day_of_week");
    expect(sql).toContain("preferred_day_of_month");
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

  /**
   * Settings-wiring regression: FEATURE_SCHEDULED_SCANS is a registry-backed
   * deployment-wide kill switch. It used to resolve into a dead
   * FEATURES.SCHEDULED_SCANS object nothing ever read, so an admin
   * disabling scheduled scans in /admin had zero effect. This proves the
   * live (mocked) value actually gates schedule creation.
   */
  it("rejects schedule creation when FEATURE_SCHEDULED_SCANS is disabled", async () => {
    mockGetFeatureScheduledScans.mockResolvedValue(false);

    const res = await POST(postRequest({ url: "https://example.com" }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toMatch(/disabled/i);
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
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("defaults an unknown frequency to weekly", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] }); // countRes
    queueInsertAndUpdate(5, {
      id: 5,
      url: "https://example.com",
      frequency: "weekly",
    });

    await POST(
      postRequest({ url: "https://example.com", frequency: "biweekly" }),
    );

    const [insertSql, insertParams] = mockQuery.mock.calls[1];
    expect(insertSql).toContain("INSERT INTO scheduled_scans");
    expect(insertParams[2]).toBe("weekly");
  });

  it("creates the schedule scoped to the session user, validates the target first, computes next_run_at from the new row's id, and sends a notification email", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 2 }] }); // countRes
    queueInsertAndUpdate(5, {
      id: 5,
      url: "https://example.com",
      frequency: "daily",
      active: true,
      last_run_at: null,
      next_run_at: "2024-01-02T00:00:00.000Z",
      created_at: "2024-01-01T00:00:00.000Z",
    });

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

    const [insertSql, insertParams] = mockQuery.mock.calls[1];
    expect(insertSql).toContain("INSERT INTO scheduled_scans");
    expect(insertParams[0]).toBe(42);
    expect(insertParams[1]).toBe("https://example.com");
    expect(insertParams[2]).toBe("daily");
    // hour/day-of-week/day-of-month default from "now" when omitted.
    expect(insertParams[3]).toEqual(expect.any(Number));
    expect(insertParams[4]).toEqual(expect.any(Number));
    expect(insertParams[5]).toEqual(expect.any(Number));

    // The follow-up UPDATE writes a real (future) next_run_at derived from
    // the id the INSERT just returned.
    const [updateSql, updateParams] = mockQuery.mock.calls[2];
    expect(updateSql).toContain("UPDATE scheduled_scans SET next_run_at");
    expect(updateParams[1]).toBe(5);
    expect(new Date(updateParams[0] as string).getTime()).toBeGreaterThan(
      Date.now(),
    );

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

  it("clamps and forwards explicit preferredHourUtc/DayOfWeek/DayOfMonth instead of the 'now' default", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    queueInsertAndUpdate(9, { id: 9, url: "https://example.com" });

    await POST(
      postRequest({
        url: "https://example.com",
        frequency: "monthly",
        preferredHourUtc: 14,
        preferredDayOfWeek: 3,
        preferredDayOfMonth: 15,
      }),
    );

    const [, insertParams] = mockQuery.mock.calls[1];
    expect(insertParams).toEqual([
      42,
      "https://example.com",
      "monthly",
      14,
      3,
      15,
    ]);
  });

  it("clamps an out-of-range preferredHourUtc/DayOfMonth back to the 'now' default instead of persisting garbage", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    queueInsertAndUpdate(10, { id: 10, url: "https://example.com" });

    await POST(
      postRequest({
        url: "https://example.com",
        frequency: "daily",
        preferredHourUtc: 99, // out of range
        preferredDayOfMonth: -5, // out of range
      }),
    );

    const [, insertParams] = mockQuery.mock.calls[1];
    expect(insertParams[3]).not.toBe(99);
    expect(insertParams[3]).toBeGreaterThanOrEqual(0);
    expect(insertParams[3]).toBeLessThanOrEqual(23);
    expect(insertParams[5]).not.toBe(-5);
    expect(insertParams[5]).toBeGreaterThanOrEqual(1);
    expect(insertParams[5]).toBeLessThanOrEqual(28);
  });

  it("allows hourly for an elite_supporter", async () => {
    mockGetUserPlan.mockResolvedValue("elite_supporter");
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    queueInsertAndUpdate(11, { id: 11, url: "https://example.com" });

    const res = await POST(
      postRequest({ url: "https://example.com", frequency: "hourly" }),
    );

    expect(res.status).toBe(201);
  });

  it("rejects hourly for a pro_supporter with a clear upgrade message, and never persists it", async () => {
    mockGetUserPlan.mockResolvedValue("pro_supporter");
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });

    const res = await POST(
      postRequest({ url: "https://example.com", frequency: "hourly" }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Hourly");
    expect(json.error.toLowerCase()).toContain("upgrade");
    // Only the count query ran -- the frequency gate rejected before INSERT.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("rejects 6hourly for a free plan (which also has no scheduled-scan access at all)", async () => {
    mockGetUserPlan.mockResolvedValue("free");
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });

    const res = await POST(
      postRequest({ url: "https://example.com", frequency: "6hourly" }),
    );

    expect(res.status).toBe(400);
  });

  it("allows 6hourly for a pro_supporter", async () => {
    mockGetUserPlan.mockResolvedValue("pro_supporter");
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    queueInsertAndUpdate(12, { id: 12, url: "https://example.com" });

    const res = await POST(
      postRequest({ url: "https://example.com", frequency: "6hourly" }),
    );

    expect(res.status).toBe(201);
  });

  it("rejects 6hourly for a pro_supporter when BILLING is disabled is irrelevant -- but bypasses the gate entirely when billing is off", async () => {
    mockGetSetting.mockResolvedValue(false); // BILLING_ENABLED = false
    mockGetUserPlan.mockResolvedValue("free");
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    queueInsertAndUpdate(13, { id: 13, url: "https://example.com" });

    const res = await POST(
      postRequest({ url: "https://example.com", frequency: "hourly" }),
    );

    // Billing off means getUserPlanLimits() also returns null (unlimited),
    // so the base scheduledScans gate is bypassed too, not just the
    // frequency gate.
    expect(res.status).toBe(201);
  });

  it("does not fail the request when the notification email fails to send", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    queueInsertAndUpdate(6, { id: 6, url: "https://example.com" });
    mockSendNotificationEmail.mockRejectedValueOnce(new Error("smtp down"));

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(201);
  });
});

describe("PATCH /api/v3/schedules", () => {
  function patchRequest(body: unknown, headers: Record<string, string> = {}) {
    return jsonRequest(
      "http://localhost/api/v3/schedules",
      "PATCH",
      body,
      headers,
    );
  }

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await PATCH(patchRequest({ id: 1, active: false }));

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a missing id", async () => {
    const res = await PATCH(patchRequest({ active: false }));

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean active value", async () => {
    const res = await PATCH(patchRequest({ id: 1, active: "false" }));

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("scopes the update to the owning user and returns the updated row", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, url: "https://example.com", active: false }],
    });

    const res = await PATCH(patchRequest({ id: 5, active: false }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ id: 5, url: "https://example.com", active: false });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("UPDATE scheduled_scans SET active = $1");
    expect(sql).toContain("WHERE id = $2 AND user_id = $3");
    expect(params).toEqual([false, 5, 42]);
  });

  it("re-enables a schedule the worker had auto-disabled", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, url: "https://example.com", active: true }],
    });

    const res = await PATCH(patchRequest({ id: 5, active: true }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.active).toBe(true);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([true, 5, 42]);
  });

  it("returns 404 and never leaks another user's schedule id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await PATCH(patchRequest({ id: 999, active: false }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBeTruthy();
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
