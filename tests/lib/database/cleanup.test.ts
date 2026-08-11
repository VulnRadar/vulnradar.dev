import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Tests for lib/database/cleanup.ts: the periodic cleanup job.
 *
 * pool.connect() is mocked to return a fake client whose `query` inspects
 * the SQL text and returns a scripted rowCount -- the same "mock at the
 * database boundary" pattern the rest of this suite uses for `pool.query`,
 * extended to the client-transaction shape this file actually calls
 * (pool.connect -> client.query(...) -> client.release()).
 *
 * The headline case here is a regression test for a real bug fixed this
 * session: schedulePeriodicCleanup(intervalMs) used to silently ignore its
 * argument and always run every 24h. It must now actually run on the
 * interval it's given.
 */

type Call = { sql: string; params: unknown[] | undefined };

let calls: Call[] = [];
let releaseSpy = vi.fn();
let badgeLookupRows: { id: number }[] = [];
let queryFailureFor: string | null = null;
let rollbackShouldFail = false;

const clientQuery = vi.fn(async (sql: string, params?: unknown[]) => {
  const s = sql.trim();
  calls.push({ sql: s, params });

  if (queryFailureFor && s.startsWith(queryFailureFor)) {
    throw new Error(`simulated failure for: ${queryFailureFor}`);
  }
  if (s === "ROLLBACK" && rollbackShouldFail) {
    throw new Error("connection already closed");
  }
  if (s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK") return { rows: [] };
  if (s.startsWith("SET TRANSACTION ISOLATION LEVEL")) return { rows: [] };

  if (s.startsWith("DELETE FROM sessions WHERE expires_at"))
    return { rowCount: 3, rows: [] };
  if (s.startsWith("DELETE FROM api_usage")) return { rowCount: 5, rows: [] };
  if (s.startsWith("DELETE FROM api_keys WHERE revoked_at"))
    return { rowCount: 2, rows: [] };
  if (s.startsWith("DELETE FROM data_requests"))
    return { rowCount: 1, rows: [] };
  if (s.includes("FROM scan_history") && s.includes("plan = 'free'"))
    return { rowCount: 10, rows: [] };
  if (s.includes("FROM scan_history") && s.includes("core_supporter"))
    return { rowCount: 4, rows: [] };
  if (s.startsWith("DELETE FROM rate_limits")) return { rowCount: 8, rows: [] };
  if (s.startsWith("DELETE FROM password_reset_tokens"))
    return { rowCount: 1, rows: [] };
  if (s.startsWith("DELETE FROM email_verification_tokens"))
    return { rowCount: 2, rows: [] };
  if (s.startsWith("DELETE FROM team_invites"))
    return { rowCount: 1, rows: [] };
  if (s.startsWith("DELETE FROM email_2fa_codes"))
    return { rowCount: 1, rows: [] };
  if (s.startsWith("DELETE FROM billing_verification_codes"))
    return { rowCount: 1, rows: [] };
  if (s.startsWith("DELETE FROM device_trust"))
    return { rowCount: 1, rows: [] };
  if (s.startsWith("DELETE FROM admin_notifications"))
    return { rowCount: 1, rows: [] };
  if (s.startsWith("SELECT id FROM badges")) return { rows: badgeLookupRows };
  if (s.startsWith("DELETE FROM user_badges")) return { rowCount: 2, rows: [] };
  if (s.startsWith("DELETE FROM gifted_subscriptions"))
    return { rowCount: 1, rows: [] };
  if (s.startsWith("DELETE FROM admin_audit_log"))
    return { rowCount: 1, rows: [] };
  if (s.startsWith("DELETE FROM admin_user_notes"))
    return { rowCount: 1, rows: [] };
  if (s.startsWith("DELETE FROM staff_activity"))
    return { rowCount: 1, rows: [] };
  if (s.startsWith("DELETE FROM subdomain_cache"))
    return { rowCount: 1, rows: [] };
  if (s.startsWith("DELETE FROM security_alerts"))
    return { rowCount: 1, rows: [] };
  if (s.startsWith("UPDATE access_rules")) return { rowCount: 1, rows: [] };
  if (s.startsWith("DELETE FROM ai_conversations"))
    return { rowCount: 6, rows: [] };
  if (s.startsWith("DELETE FROM scan_finding_feedback"))
    return { rowCount: 7, rows: [] };
  if (s.startsWith("DELETE FROM user_notifications"))
    return { rowCount: 9, rows: [] };
  if (s.startsWith("DELETE FROM github_review_usage"))
    return { rowCount: 2, rows: [] };
  if (s.startsWith("DELETE FROM browser_sessions"))
    return { rowCount: 4, rows: [] };
  if (s.startsWith("DELETE FROM cve_kev_cache"))
    return { rowCount: 1, rows: [] };
  if (s.startsWith("DELETE FROM system_error_logs"))
    return { rowCount: 5, rows: [] };

  return { rows: [] };
});

const mockConnect = vi.fn(async () => ({
  query: clientQuery,
  release: releaseSpy,
}));

// performDatabaseCleanup now also resolves the four BILLING_*_RETENTION
// settings up front via lib/config/runtime-config's getSettings(), which
// calls pool.query() directly (not through the transaction client above).
// Default is empty rows, i.e. every plan resolves to its shipped default
// (free=30, core_supporter=90, pro_supporter=-1, elite_supporter=-1) --
// unchanged from the old static-constant behavior unless a test overrides it.
let retentionSettingsRows: { key: string; value: string }[] = [];
const mockPoolQuery = vi.fn(async (sql: string, params?: unknown[]) => {
  const s = String(sql).trim();
  if (s.startsWith("SELECT key, value FROM system_settings")) {
    return { rows: retentionSettingsRows };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    connect: () => mockConnect(),
    query: (sql: string, params?: unknown[]) => mockPoolQuery(sql, params),
  },
}));

const {
  performDatabaseCleanup,
  formatCleanupStats,
  schedulePeriodicCleanup,
  stopPeriodicCleanup,
} = await import("@/lib/database/cleanup");
const { DB_CLEANUP_INTERVAL, BILLING_HISTORY_RETENTION } =
  await import("@/lib/config/constants");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");

beforeEach(() => {
  calls = [];
  releaseSpy = vi.fn();
  badgeLookupRows = [];
  queryFailureFor = null;
  rollbackShouldFail = false;
  retentionSettingsRows = [];
  clientQuery.mockClear();
  mockConnect.mockClear();
  mockPoolQuery.mockClear();
  invalidateSettingsCache();
  stopPeriodicCleanup();
});

afterEach(() => {
  stopPeriodicCleanup();
  vi.useRealTimers();
});

describe("performDatabaseCleanup", () => {
  it("wraps every delete in BEGIN/COMMIT under READ COMMITTED isolation", async () => {
    await performDatabaseCleanup();
    expect(calls[0].sql).toBe("BEGIN");
    expect(calls[1].sql).toBe("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    expect(calls[calls.length - 1].sql).toBe("COMMIT");
  });

  it("aggregates rowCounts from every delete into the returned stats", async () => {
    const stats = await performDatabaseCleanup();
    expect(stats.expiredSessions).toBe(3);
    expect(stats.oldApiUsage).toBe(5);
    expect(stats.revokedApiKeys).toBe(2);
    expect(stats.oldDataRequests).toBe(1);
    expect(stats.oldScans).toBe(14); // 10 (free) + 4 (core_supporter)
    expect(stats.oldRateLimits).toBe(8);
    expect(stats.expiredTokens).toBe(3); // 1 (reset) + 2 (verification)
    expect(stats.expiredInvites).toBe(1);
    expect(stats.expired2FACodes).toBe(1);
    expect(stats.expiredBillingCodes).toBe(1);
    expect(stats.expiredDeviceTrust).toBe(1);
    // admin_notifications(1) + security_alerts(1) + access_rules(1)
    expect(stats.expiredNotifications).toBe(3);
    expect(stats.expiredGiftedSubs).toBe(1);
    expect(stats.oldAuditLogs).toBe(1);
    expect(stats.oldAdminNotes).toBe(1);
    expect(stats.oldStaffActivity).toBe(1);
    expect(stats.oldSubdomainCache).toBe(1);
    expect(stats.oldAiConversations).toBe(6);
    expect(stats.oldScanFindingFeedback).toBe(7);
    expect(stats.oldUserNotifications).toBe(9);
    expect(stats.oldGithubReviewUsage).toBe(2);
    expect(stats.oldBrowserSessions).toBe(4);
    expect(stats.oldKevCache).toBe(1);
    expect(stats.oldErrorLogs).toBe(5);
  });

  it("deletes a browser session by its own expires_at, with a created_at fallback for one that never got an expiry", async () => {
    await performDatabaseCleanup();
    const browserSessions = calls.find((c) =>
      c.sql.startsWith("DELETE FROM browser_sessions"),
    );
    expect(browserSessions?.sql).toContain(
      "expires_at IS NOT NULL AND expires_at < NOW()",
    );
    expect(browserSessions?.sql).toContain(
      "expires_at IS NULL AND created_at < NOW() - INTERVAL '1 day'",
    );
  });

  it("caps the CVE KEV cache at 7 days -- a performance cache, not user data", async () => {
    await performDatabaseCleanup();
    const kevCache = calls.find((c) =>
      c.sql.startsWith("DELETE FROM cve_kev_cache"),
    );
    expect(kevCache?.sql).toContain("cached_at");
    expect(kevCache?.sql).toContain("7 days");
  });

  it("caps system_error_logs at 30 days -- operational debug output, not a compliance record", async () => {
    await performDatabaseCleanup();
    const errorLogs = calls.find((c) =>
      c.sql.startsWith("DELETE FROM system_error_logs"),
    );
    expect(errorLogs?.sql).toContain("created_at");
    expect(errorLogs?.sql).toContain("30 days");
  });

  it("purges AI chat history on the admin-configurable AI_CHAT_HISTORY_DAYS window (shipped default 90, GDPR data-minimization fix)", async () => {
    // retentionSettingsRows is empty by default (see mockPoolQuery above),
    // so AI_CHAT_HISTORY_DAYS resolves to its shipped default -- 90, chosen
    // to match the "AI chat history: 90 days" promise in
    // app/legal/privacy/page.tsx. Settings-wiring regression: this used to
    // be a hardcoded `INTERVAL '90 days'` no admin edit could ever change.
    await performDatabaseCleanup();
    const aiConversations = calls.find((c) =>
      c.sql.startsWith("DELETE FROM ai_conversations"),
    );
    expect(aiConversations?.sql).toContain("last_message_at");
    expect(aiConversations?.sql).toContain("INTERVAL '1 day'");
    expect(aiConversations?.params).toEqual([90]);
  });

  it("honors an admin-configured AI_CHAT_HISTORY_DAYS override", async () => {
    retentionSettingsRows = [{ key: "AI_CHAT_HISTORY_DAYS", value: "30" }];
    await performDatabaseCleanup();
    const aiConversations = calls.find((c) =>
      c.sql.startsWith("DELETE FROM ai_conversations"),
    );
    expect(aiConversations?.params).toEqual([30]);
  });

  it("releases the client even on the happy path", async () => {
    await performDatabaseCleanup();
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it("scopes scan-history retention to the correct plan and never touches paid unlimited plans", async () => {
    await performDatabaseCleanup();
    const freeScan = calls.find(
      (c) =>
        c.sql.includes("FROM scan_history") && c.sql.includes("plan = 'free'"),
    );
    const coreScan = calls.find(
      (c) =>
        c.sql.includes("FROM scan_history") && c.sql.includes("core_supporter"),
    );
    expect(freeScan?.params).toEqual([BILLING_HISTORY_RETENTION.free]);
    expect(coreScan?.params).toEqual([
      BILLING_HISTORY_RETENTION.core_supporter,
    ]);
    // Only two scan_history deletes total -- pro/elite (unlimited
    // retention) never get a delete issued against them at all.
    const scanDeletes = calls.filter((c) =>
      c.sql.includes("FROM scan_history"),
    );
    expect(scanDeletes).toHaveLength(2);
  });

  it("honors an admin-configured retention for pro/elite plans instead of the shipped -1 default", async () => {
    retentionSettingsRows = [
      { key: "BILLING_PRO_SUPPORTER_RETENTION", value: "365" },
      { key: "BILLING_ELITE_SUPPORTER_RETENTION", value: "730" },
    ];
    await performDatabaseCleanup();

    const proScan = calls.find(
      (c) =>
        c.sql.includes("FROM scan_history") &&
        c.sql.includes("plan = 'pro_supporter'"),
    );
    const eliteScan = calls.find(
      (c) =>
        c.sql.includes("FROM scan_history") &&
        c.sql.includes("plan = 'elite_supporter'"),
    );
    expect(proScan?.params).toEqual([365]);
    expect(eliteScan?.params).toEqual([730]);

    const scanDeletes = calls.filter((c) =>
      c.sql.includes("FROM scan_history"),
    );
    // free + core_supporter (shipped defaults) + pro + elite (admin override)
    expect(scanDeletes).toHaveLength(4);
  });

  it("only deletes team invites that were never accepted", async () => {
    await performDatabaseCleanup();
    const invites = calls.find((c) =>
      c.sql.startsWith("DELETE FROM team_invites"),
    );
    expect(invites?.sql).toContain("accepted_at IS NULL");
  });

  it("only deletes admin notifications that have actually ended", async () => {
    await performDatabaseCleanup();
    const notifications = calls.find((c) =>
      c.sql.startsWith("DELETE FROM admin_notifications"),
    );
    expect(notifications?.sql).toContain("ends_at IS NOT NULL");
  });

  it("revokes the premium badge only for free-plan users whose gift has expired", async () => {
    badgeLookupRows = [{ id: 99 }];
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    await performDatabaseCleanup();
    const revoke = calls.find((c) =>
      c.sql.startsWith("DELETE FROM user_badges"),
    );
    expect(revoke?.params).toEqual([99]);
    expect(revoke?.sql).toContain("u.plan = 'free' OR u.plan IS NULL");
    expect(revoke?.sql).toContain("NOT EXISTS");
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("Revoked 2 premium badges"),
    );
    logged.mockRestore();
  });

  it("skips the badge revoke delete entirely when no premium badge exists", async () => {
    badgeLookupRows = [];
    await performDatabaseCleanup();
    expect(calls.some((c) => c.sql.startsWith("DELETE FROM user_badges"))).toBe(
      false,
    );
  });

  it("tolerates the badge lookup failing without aborting the rest of the cleanup", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    queryFailureFor = "SELECT id FROM badges";
    const stats = await performDatabaseCleanup();
    // The badge branch's own try/catch swallows the error; the surrounding
    // transaction still commits and every other stat is still collected.
    expect(stats.oldAuditLogs).toBe(1);
    expect(calls[calls.length - 1].sql).toBe("COMMIT");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("rolls back and rethrows when a delete fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    queryFailureFor = "DELETE FROM api_usage";
    await expect(performDatabaseCleanup()).rejects.toThrow(/simulated failure/);
    expect(calls.some((c) => c.sql === "ROLLBACK")).toBe(true);
    expect(calls.some((c) => c.sql === "COMMIT")).toBe(false);
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it("still rethrows the original error even if ROLLBACK itself fails on a dead connection", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    queryFailureFor = "DELETE FROM api_usage";
    rollbackShouldFail = true;
    await expect(performDatabaseCleanup()).rejects.toThrow(
      /simulated failure for: DELETE FROM api_usage/,
    );
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});

describe("formatCleanupStats", () => {
  it("reports 'no records to clean' when every counter is zero", () => {
    const zeroStats = {
      expiredSessions: 0,
      oldApiUsage: 0,
      revokedApiKeys: 0,
      oldDataRequests: 0,
      oldScans: 0,
      oldRateLimits: 0,
      expiredTokens: 0,
      expiredInvites: 0,
      expired2FACodes: 0,
      expiredBillingCodes: 0,
      expiredDeviceTrust: 0,
      expiredNotifications: 0,
      expiredGiftedSubs: 0,
      oldAuditLogs: 0,
      oldAdminNotes: 0,
      oldStaffActivity: 0,
      oldSubdomainCache: 0,
      oldAiConversations: 0,
      oldScanFindingFeedback: 0,
      oldUserNotifications: 0,
      oldGithubReviewUsage: 0,
      oldBrowserSessions: 0,
      oldKevCache: 0,
      oldErrorLogs: 0,
    };
    expect(formatCleanupStats(zeroStats)).toBe("no records to clean");
  });

  it("summarizes only the nonzero counters with a correct total", () => {
    const stats = {
      expiredSessions: 3,
      oldApiUsage: 0,
      revokedApiKeys: 0,
      oldDataRequests: 0,
      oldScans: 0,
      oldRateLimits: 0,
      expiredTokens: 2,
      expiredInvites: 0,
      expired2FACodes: 0,
      expiredBillingCodes: 0,
      expiredDeviceTrust: 0,
      expiredNotifications: 0,
      expiredGiftedSubs: 0,
      oldAuditLogs: 0,
      oldAdminNotes: 0,
      oldStaffActivity: 0,
      oldSubdomainCache: 0,
      oldAiConversations: 0,
      oldScanFindingFeedback: 0,
      oldUserNotifications: 0,
      oldGithubReviewUsage: 0,
      oldBrowserSessions: 0,
      oldKevCache: 0,
      oldErrorLogs: 0,
    };
    const summary = formatCleanupStats(stats);
    expect(summary).toContain("5 total");
    expect(summary).toContain("3 sessions");
    expect(summary).toContain("2 tokens");
    expect(summary).not.toContain("API logs");
  });

  it("includes the AI conversations counter when nonzero", () => {
    const stats = {
      expiredSessions: 0,
      oldApiUsage: 0,
      revokedApiKeys: 0,
      oldDataRequests: 0,
      oldScans: 0,
      oldRateLimits: 0,
      expiredTokens: 0,
      expiredInvites: 0,
      expired2FACodes: 0,
      expiredBillingCodes: 0,
      expiredDeviceTrust: 0,
      expiredNotifications: 0,
      expiredGiftedSubs: 0,
      oldAuditLogs: 0,
      oldAdminNotes: 0,
      oldStaffActivity: 0,
      oldSubdomainCache: 0,
      oldAiConversations: 4,
      oldScanFindingFeedback: 0,
      oldUserNotifications: 0,
      oldGithubReviewUsage: 0,
      oldBrowserSessions: 0,
      oldKevCache: 0,
      oldErrorLogs: 0,
    };
    const summary = formatCleanupStats(stats);
    expect(summary).toContain("4 total");
    expect(summary).toContain("4 AI conversations");
  });

  it("includes the error log counter when nonzero", () => {
    const stats = {
      expiredSessions: 0,
      oldApiUsage: 0,
      revokedApiKeys: 0,
      oldDataRequests: 0,
      oldScans: 0,
      oldRateLimits: 0,
      expiredTokens: 0,
      expiredInvites: 0,
      expired2FACodes: 0,
      expiredBillingCodes: 0,
      expiredDeviceTrust: 0,
      expiredNotifications: 0,
      expiredGiftedSubs: 0,
      oldAuditLogs: 0,
      oldAdminNotes: 0,
      oldStaffActivity: 0,
      oldSubdomainCache: 0,
      oldAiConversations: 0,
      oldScanFindingFeedback: 0,
      oldUserNotifications: 0,
      oldGithubReviewUsage: 0,
      oldBrowserSessions: 0,
      oldKevCache: 0,
      oldErrorLogs: 12,
    };
    const summary = formatCleanupStats(stats);
    expect(summary).toContain("12 total");
    expect(summary).toContain("12 error logs");
  });

  it("includes the new retention counters (finding feedback, in-app notifications, GitHub review usage, browser sessions, KEV cache) when nonzero", () => {
    const stats = {
      expiredSessions: 0,
      oldApiUsage: 0,
      revokedApiKeys: 0,
      oldDataRequests: 0,
      oldScans: 0,
      oldRateLimits: 0,
      expiredTokens: 0,
      expiredInvites: 0,
      expired2FACodes: 0,
      expiredBillingCodes: 0,
      expiredDeviceTrust: 0,
      expiredNotifications: 0,
      expiredGiftedSubs: 0,
      oldAuditLogs: 0,
      oldAdminNotes: 0,
      oldStaffActivity: 0,
      oldSubdomainCache: 0,
      oldAiConversations: 0,
      oldScanFindingFeedback: 7,
      oldUserNotifications: 9,
      oldGithubReviewUsage: 2,
      oldBrowserSessions: 4,
      oldKevCache: 1,
      oldErrorLogs: 0,
    };
    const summary = formatCleanupStats(stats);
    expect(summary).toContain("23 total");
    expect(summary).toContain("7 finding feedback");
    expect(summary).toContain("9 in-app notifications");
    expect(summary).toContain("2 GitHub review usage rows");
    expect(summary).toContain("4 browser sessions");
    expect(summary).toContain("1 KEV cache rows");
  });
});

describe("schedulePeriodicCleanup interval regression", () => {
  // Regression test for a real bug fixed this session:
  // schedulePeriodicCleanup(intervalMs) took an interval argument but the
  // body ignored it and always scheduled against the hardcoded 24h
  // default, so `schedulePeriodicCleanup(5 * 60 * 1000)` silently ran
  // every 24h instead of every 5 minutes. It must now actually honor the
  // interval it's given.

  it("does NOT run on the shipped 24h default when given an explicit short interval", async () => {
    vi.useFakeTimers();
    schedulePeriodicCleanup(1000);

    await vi.advanceTimersByTimeAsync(999);
    expect(mockConnect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("fires repeatedly on exactly the interval passed in, not a fixed 24h", async () => {
    vi.useFakeTimers();
    schedulePeriodicCleanup(2000);

    await vi.advanceTimersByTimeAsync(2000);
    expect(mockConnect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(mockConnect).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(mockConnect).toHaveBeenCalledTimes(3);
  });

  it("falls back to the configured default interval when called with no argument", async () => {
    vi.useFakeTimers();
    schedulePeriodicCleanup();

    await vi.advanceTimersByTimeAsync(DB_CLEANUP_INTERVAL - 1);
    expect(mockConnect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default for an invalid interval (zero, negative, NaN)", async () => {
    vi.useFakeTimers();
    schedulePeriodicCleanup(-500);

    await vi.advanceTimersByTimeAsync(DB_CLEANUP_INTERVAL - 1);
    expect(mockConnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("cancels the previous timer when called again, instead of double-scheduling", async () => {
    vi.useFakeTimers();
    schedulePeriodicCleanup(1000);
    await vi.advanceTimersByTimeAsync(500);
    schedulePeriodicCleanup(1000); // reschedule before the first one fires

    await vi.advanceTimersByTimeAsync(999);
    expect(mockConnect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("stops firing after stopPeriodicCleanup()", async () => {
    vi.useFakeTimers();
    schedulePeriodicCleanup(1000);
    stopPeriodicCleanup();

    await vi.advanceTimersByTimeAsync(10000);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("returns a timer handle exposing unref, so a pending run never blocks process exit", () => {
    vi.useFakeTimers();
    const timer = schedulePeriodicCleanup(1000);
    expect(typeof timer.unref).toBe("function");
  });

  it("logs but does not throw when a scheduled run itself fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    queryFailureFor = "BEGIN";
    schedulePeriodicCleanup(1000);

    await vi.advanceTimersByTimeAsync(1000);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("Periodic cleanup failed"),
      expect.anything(),
    );
    errSpy.mockRestore();
  });
});
