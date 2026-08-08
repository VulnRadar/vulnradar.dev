/**
 * Route-level tests for POST /api/v3/admin/features (access_rules,
 * security_alerts, system_settings, broadcast). The database is mocked;
 * `requireAdmin()` (lib/auth/authorization.ts) runs for real so the
 * admin-only role gate is actually exercised, not assumed. Only
 * `getSession` is mocked (network/DB boundary sits inside requireAdmin's
 * own `pool.query`), and `logAction` is spied via importOriginal so the
 * rest of lib/auth/authorization.ts stays real.
 *
 * The registry-based validation in lib/config/registry.ts (isSettingKey /
 * validateSettingValue) is NOT mocked — this suite exists specifically to
 * prove a value that fails its registry constraint is rejected before it
 * ever reaches the database.
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

const mockLogAction = vi.fn();
vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return {
    ...actual,
    logAction: (...args: unknown[]) => mockLogAction(...args),
  };
});

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const mockSendEmail = vi.fn();
vi.mock("@/lib/email/email", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

const mockInvalidateSettingsCache = vi.fn();
const mockGetSettings = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  invalidateSettingsCache: (...args: unknown[]) =>
    mockInvalidateSettingsCache(...args),
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
}));

const { POST } = await import("@/app/api/v3/admin/features/route");
const routeModule = await import("@/app/api/v3/admin/features/route");

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/admin/features", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Queue requireAdmin's own role lookup as the next query response. */
function queueRole(role: string | null) {
  mockQuery.mockResolvedValueOnce({
    rows: role ? [{ id: 1, role }] : [],
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockLogAction.mockReset();
  mockSendEmail.mockReset();
  mockSendEmail.mockResolvedValue(undefined);
  mockInvalidateSettingsCache.mockReset();
  mockGetSession.mockResolvedValue({ userId: 1 });
});

describe("POST /api/v3/admin/features — authorization", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(
      postRequest({ section: "access_rules", action: "list" }),
    );
    expect(res.status).toBe(401);
    // requireAdmin short-circuits before any of the route's own queries.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a support-tier caller (this route is admin-only, not staff-only)", async () => {
    queueRole("support");
    const res = await POST(
      postRequest({ section: "access_rules", action: "list" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a moderator (moderator has many other admin permissions, but not this route)", async () => {
    queueRole("moderator");
    const res = await POST(
      postRequest({ section: "system_settings", action: "list" }),
    );
    expect(res.status).toBe(401);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("allows an admin through the gate", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // access_rules list
    const res = await POST(
      postRequest({ section: "access_rules", action: "list" }),
    );
    expect(res.status).toBe(200);
  });

  it("only exports POST", () => {
    const mod = routeModule as unknown as Record<string, unknown>;
    expect(mod.GET).toBeUndefined();
    expect(mod.PUT).toBeUndefined();
    expect(mod.PATCH).toBeUndefined();
    expect(mod.DELETE).toBeUndefined();
  });
});

describe("POST /api/v3/admin/features — access_rules", () => {
  it("creates a rule and audit-logs it", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 5, rule_type: "block", value_type: "ip", ip_address: "1.2.3.4" },
      ],
    });
    const res = await POST(
      postRequest({
        section: "access_rules",
        action: "create",
        rule_type: "block",
        value_type: "ip",
        ip_address: "1.2.3.4",
        description: "bad actor",
        reason: "abuse",
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.rule.id).toBe(5);
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "access_rule_created",
      expect.any(String),
      "127.0.0.1",
    );
  });

  it("lists rules", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const res = await POST(
      postRequest({ section: "access_rules", action: "list" }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.rules).toHaveLength(1);
  });

  it("deletes an existing rule and audit-logs it", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({
      rows: [{ ip_address: "1.2.3.4", value_type: "ip" }],
    }); // lookup
    mockQuery.mockResolvedValueOnce({ rows: [] }); // delete
    const res = await POST(
      postRequest({ section: "access_rules", action: "delete", id: 9 }),
    );
    expect(res.status).toBe(200);
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "access_rule_deleted",
      expect.any(String),
      "127.0.0.1",
    );
  });

  it("does not audit-log deleting a rule that was already gone", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // lookup: not found
    mockQuery.mockResolvedValueOnce({ rows: [] }); // delete (no-op)
    const res = await POST(
      postRequest({ section: "access_rules", action: "delete", id: 999 }),
    );
    expect(res.status).toBe(200);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("rejects an update with no whitelisted columns", async () => {
    queueRole("admin");
    const res = await POST(
      postRequest({
        section: "access_rules",
        action: "update",
        id: 3,
        some_random_column: "x",
      }),
    );
    expect(res.status).toBe(400);
    // Only requireAdmin's own role lookup ran — no update was attempted.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("updates an allowed column and audit-logs it", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE
    const res = await POST(
      postRequest({
        section: "access_rules",
        action: "update",
        id: 3,
        is_active: false,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "access_rule_updated",
      expect.stringContaining("3"),
      "127.0.0.1",
    );
  });
});

describe("POST /api/v3/admin/features — security_alerts", () => {
  it("lists alerts", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, severity: "high" }] });
    const res = await POST(
      postRequest({ section: "security_alerts", action: "list" }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.alerts).toHaveLength(1);
  });

  it("resolves an alert and audit-logs it", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({
      rows: [{ alert_type: "brute_force", severity: "high" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE
    const res = await POST(
      postRequest({
        section: "security_alerts",
        action: "resolve",
        id: 4,
        action_taken: "banned ip",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "security_alert_resolved",
      expect.stringContaining("high"),
      "127.0.0.1",
    );
  });
});

describe("POST /api/v3/admin/features — system_settings", () => {
  it("gets a stored value", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [{ value: "5" }] });
    const res = await POST(
      postRequest({
        section: "system_settings",
        action: "get",
        key: "RATE_LIMIT_LOGIN_ATTEMPTS",
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.value).toBe("5");
  });

  it("lists settings", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await POST(
      postRequest({ section: "system_settings", action: "list" }),
    );
    expect(res.status).toBe(200);
  });

  it("sets a valid registry value, invalidates the cache, and audit-logs it", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [{ value: "5" }] }); // oldResult
    mockQuery.mockResolvedValueOnce({ rows: [] }); // upsert
    const res = await POST(
      postRequest({
        section: "system_settings",
        action: "set",
        key: "RATE_LIMIT_LOGIN_ATTEMPTS",
        value: 10,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockInvalidateSettingsCache).toHaveBeenCalledTimes(1);
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "system_setting_changed",
      expect.stringContaining("10"),
      "127.0.0.1",
    );
    // The value bound to the upsert is the validated, coerced string form.
    // calls[0] = requireAdmin's role lookup, [1] = oldResult SELECT, [2] = upsert.
    const upsertParams = mockQuery.mock.calls[2][1] as unknown[];
    expect(upsertParams[1]).toBe("10");
  });

  it("rejects a value below the registry's minimum without touching the database", async () => {
    queueRole("admin");
    const res = await POST(
      postRequest({
        section: "system_settings",
        action: "set",
        key: "RATE_LIMIT_LOGIN_ATTEMPTS", // min: 1
        value: 0,
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/RATE_LIMIT_LOGIN_ATTEMPTS/);
    // Validation runs before the oldResult SELECT / upsert — only
    // requireAdmin's own role lookup touched the database.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockInvalidateSettingsCache).not.toHaveBeenCalled();
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("rejects a value above the registry's maximum", async () => {
    queueRole("admin");
    const res = await POST(
      postRequest({
        section: "system_settings",
        action: "set",
        key: "RATE_LIMIT_LOGIN_ATTEMPTS", // max: 100
        value: 999,
      }),
    );
    expect(res.status).toBe(400);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("rejects a value outside an enum setting's allowed options", async () => {
    queueRole("admin");
    const res = await POST(
      postRequest({
        section: "system_settings",
        action: "set",
        key: "DEFAULT_SEVERITY_THRESHOLD",
        value: "catastrophic",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed value for an email-typed setting", async () => {
    queueRole("admin");
    const res = await POST(
      postRequest({
        section: "system_settings",
        action: "set",
        key: "SUPPORT_EMAIL",
        value: "not-an-email",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("rejects a TERMS_UPDATED_AT value that isn't shaped like YYYY-MM-DD", async () => {
    queueRole("admin");
    const res = await POST(
      postRequest({
        section: "system_settings",
        action: "set",
        key: "TERMS_UPDATED_AT",
        value: "03/16/2026",
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/YYYY-MM-DD/);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockInvalidateSettingsCache).not.toHaveBeenCalled();
  });

  it("rejects a TERMS_UPDATED_AT value that is shaped right but isn't a real calendar date", async () => {
    queueRole("admin");
    const res = await POST(
      postRequest({
        section: "system_settings",
        action: "set",
        key: "TERMS_UPDATED_AT",
        value: "2026-02-30", // February never has a 30th
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/real calendar date/);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("accepts a valid TERMS_UPDATED_AT date, invalidates the cache, and audit-logs it", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [{ value: "2026-03-16" }] }); // oldResult
    mockQuery.mockResolvedValueOnce({ rows: [] }); // upsert
    const res = await POST(
      postRequest({
        section: "system_settings",
        action: "set",
        key: "TERMS_UPDATED_AT",
        value: "2026-09-01",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockInvalidateSettingsCache).toHaveBeenCalledTimes(1);
    const upsertParams = mockQuery.mock.calls[2][1] as unknown[];
    expect(upsertParams[1]).toBe("2026-09-01");
  });

  it("passes a non-registry (legacy) key through without validation", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // oldResult
    mockQuery.mockResolvedValueOnce({ rows: [] }); // upsert
    const res = await POST(
      postRequest({
        section: "system_settings",
        action: "set",
        key: "maintenance_mode",
        value: "anything at all",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("never lets any auth-route rate limit be set to zero", async () => {
    // The guard rail from the plan doc: a rate limit of 0 on login, signup,
    // or forgot-password would lock every admin out of the login form
    // itself. Tested here at the route (not just the registry validator)
    // for every one of those keys, not only RATE_LIMIT_LOGIN_ATTEMPTS.
    const authRateLimitKeys = [
      "RATE_LIMIT_LOGIN_ATTEMPTS",
      "RATE_LIMIT_LOGIN_WINDOW_MINUTES",
      "RATE_LIMIT_SIGNUP_ATTEMPTS",
      "RATE_LIMIT_SIGNUP_WINDOW_MINUTES",
      "RATE_LIMIT_FORGOT_PASSWORD_ATTEMPTS",
      "RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MINUTES",
    ];

    for (const key of authRateLimitKeys) {
      queueRole("admin");
      mockQuery.mockClear();
      const res = await POST(
        postRequest({
          section: "system_settings",
          action: "set",
          key,
          value: 0,
        }),
      );
      const json = await res.json();
      expect(res.status, key).toBe(400);
      expect(json.error, key).toMatch(new RegExp(key));
      // Only requireAdmin's own role lookup touched the database; the write
      // never reached the oldResult SELECT or the upsert.
      expect(mockQuery, key).toHaveBeenCalledTimes(1);
      expect(mockInvalidateSettingsCache, key).not.toHaveBeenCalled();
      mockInvalidateSettingsCache.mockClear();
      mockLogAction.mockClear();
    }
  });

  it("returns the effective value and override set for every registry key", async () => {
    queueRole("admin");
    mockGetSettings.mockResolvedValueOnce({
      RATE_LIMIT_LOGIN_ATTEMPTS: 9,
      BILLING_ENABLED: false,
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ key: "RATE_LIMIT_LOGIN_ATTEMPTS" }],
    });
    const res = await POST(
      postRequest({ section: "system_settings", action: "effective" }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.effective).toEqual({
      RATE_LIMIT_LOGIN_ATTEMPTS: 9,
      BILLING_ENABLED: false,
    });
    expect(json.overridden).toEqual(["RATE_LIMIT_LOGIN_ATTEMPTS"]);
    // getSettings is called with every registry key, not a hand-picked list.
    const requestedKeys = mockGetSettings.mock.calls[0][0] as string[];
    expect(requestedKeys).toContain("BILLING_ENABLED");
    expect(requestedKeys).toContain("RATE_LIMIT_SCAN_REQUESTS");
    expect(requestedKeys.length).toBeGreaterThan(80);
  });

  it("resets a setting by deleting its row, not by writing the default back", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [{ value: "10" }] }); // oldResult
    mockQuery.mockResolvedValueOnce({ rows: [] }); // DELETE
    const res = await POST(
      postRequest({
        section: "system_settings",
        action: "reset",
        key: "RATE_LIMIT_LOGIN_ATTEMPTS",
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.default).toBe(5);
    expect(mockInvalidateSettingsCache).toHaveBeenCalledTimes(1);
    // calls[0] = requireAdmin's role lookup, [1] = oldResult SELECT, [2] = DELETE.
    const deleteSql = String(mockQuery.mock.calls[2][0]);
    expect(deleteSql).toMatch(/DELETE FROM system_settings/);
    expect(deleteSql).not.toMatch(/UPDATE|INSERT/);
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "system_setting_reset",
      expect.stringContaining("RATE_LIMIT_LOGIN_ATTEMPTS"),
      "127.0.0.1",
    );
  });

  it("rejects resetting an unknown key without touching the database", async () => {
    queueRole("admin");
    const res = await POST(
      postRequest({
        section: "system_settings",
        action: "reset",
        key: "NOT_A_REAL_SETTING",
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Unknown setting key/);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockInvalidateSettingsCache).not.toHaveBeenCalled();
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("rejects resetting a legacy non-registry key", async () => {
    queueRole("admin");
    const res = await POST(
      postRequest({
        section: "system_settings",
        action: "reset",
        key: "maintenance_mode",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/v3/admin/features — broadcast", () => {
  it("creates a draft broadcast and audit-logs it", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, title: "Hello", status: "draft" }],
    });
    const res = await POST(
      postRequest({
        section: "broadcast",
        action: "create",
        title: "Hello",
        content: "<p>hi</p>",
        message_type: "email",
        segment_filter: { segment: "all" },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "broadcast_created",
      expect.stringContaining("Hello"),
      "127.0.0.1",
    );
  });

  it("lists broadcasts", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await POST(
      postRequest({ section: "broadcast", action: "list" }),
    );
    expect(res.status).toBe(200);
  });

  it("refuses to delete a broadcast that has already been sent", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [{ title: "Sent one" }] }); // title lookup
    mockQuery.mockResolvedValueOnce({ rows: [] }); // delete WHERE status='draft' -> no match
    const res = await POST(
      postRequest({ section: "broadcast", action: "delete", id: 1 }),
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Cannot delete sent broadcasts/);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("deletes a draft broadcast and audit-logs it", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [{ title: "Draft one" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 2 }] });
    const res = await POST(
      postRequest({ section: "broadcast", action: "delete", id: 2 }),
    );
    expect(res.status).toBe(200);
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "broadcast_deleted",
      expect.stringContaining("Draft one"),
      "127.0.0.1",
    );
  });

  it("returns 404 sending a broadcast that is not a pending draft", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // check: not found / not draft
    const res = await POST(
      postRequest({ section: "broadcast", action: "send", id: 5 }),
    );
    expect(res.status).toBe(404);
  });

  it("sends a draft broadcast and audit-logs it", async () => {
    vi.useFakeTimers();
    try {
      queueRole("admin");
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] }); // check
      mockQuery.mockResolvedValueOnce({ rows: [{ title: "Go live" }] }); // title lookup
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE status='sent'
      const res = await POST(
        postRequest({ section: "broadcast", action: "send", id: 5 }),
      );
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.message).toMatch(/queued/i);
      expect(mockLogAction).toHaveBeenCalledWith(
        1,
        null,
        "broadcast_sent",
        expect.stringContaining("Go live"),
        "127.0.0.1",
      );
      // The background setTimeout email job is left un-advanced deliberately
      // so it never fires during (or bleeds into) this suite's mocks.
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("POST /api/v3/admin/features — routing", () => {
  it("rejects an unknown section", async () => {
    queueRole("admin");
    const res = await POST(postRequest({ section: "not_a_real_section" }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe("Unknown section");
  });

  it("falls through to Unknown section for an unrecognized action within a known section", async () => {
    queueRole("admin");
    const res = await POST(
      postRequest({ section: "access_rules", action: "not_a_real_action" }),
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe("Unknown section");
  });
});
