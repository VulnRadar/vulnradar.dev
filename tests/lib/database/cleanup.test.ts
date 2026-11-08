import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Tests for lib/database/cleanup.ts: the periodic cleanup job.
 *
 * One scripted responder answers BOTH `pool.query` and the fake client's
 * `query`, inspecting the SQL text and returning a scripted rowCount -- the
 * same "mock at the database boundary" pattern the rest of this suite uses.
 * Both are routed through it because the pass now runs each retention prune
 * autocommitted on the pool (AUDIT-012#perf-22), and an assertion about a
 * prune must not care which of the two issued it.
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
// How many rows the archive-and-purge statement
// (lib/database/audit-log-archive.ts) reports. Zero means the statement's
// HAVING dropped the INSERT, so it returns no row at all.
let auditPurgedRows = 1;
// Rows the browser_sessions DELETE ... RETURNING returns -- distinct from
// its rowCount above (kept at a fixed 4 for the existing stats-aggregation
// test), used by the plan-usage true-up tests below.
let expiredBrowserSessionRows: {
  user_id: number;
  created_at: string;
  expires_at: string | null;
}[] = [];
// Fails any statement the predicate accepts, for the cases where a prune that
// is not the first in the pass must be the one that breaks.
let failWhen: ((sql: string) => boolean) | null = null;
// What each plan's scan_history DELETE reports, one number per call, in call
// order. A plan with nothing queued answers its old fixed value: 10 for free,
// 4 for core, 0 for the rest. All below the batch size, so one call per plan.
let scanDeleteCounts: Record<string, number[]> = {};
const SCAN_DELETE_DEFAULT: Record<string, number> = {
  free: 10,
  core_supporter: 4,
};
// Which plan each scan_history DELETE belonged to, in call order.
let scanDeletePlans: string[] = [];
// Side effects in the order they happened, for the cases that are about
// "before" and "after" rather than "whether".
let events: string[] = [];
// Runs after every scan_history DELETE, for the wall-clock budget cases.
let afterScanDelete: (() => void) | null = null;

/** The plan a scan_history batch DELETE is scoped to, or null if it is not one. */
function scanDeletePlan(s: string): string | null {
  if (!s.startsWith("DELETE FROM scan_history")) return null;
  const match = /plan = '(\w+)'/.exec(s);
  return match ? match[1] : null;
}

async function scriptedQuery(sql: string, params?: unknown[]) {
  const s = String(sql).trim();
  // The settings resolver reads system_settings through the same pool; it is
  // not part of the cleanup pass, so it is answered before anything is
  // recorded and never enters the positional `calls` queue.
  if (s.startsWith("SELECT key, value FROM system_settings")) {
    return { rows: retentionSettingsRows };
  }
  calls.push({ sql: s, params });

  if (queryFailureFor && s.startsWith(queryFailureFor)) {
    throw new Error(`simulated failure for: ${queryFailureFor}`);
  }
  if (failWhen?.(s)) {
    throw new Error(`simulated failure for: ${s.slice(0, 60)}`);
  }

  if (s.startsWith("DELETE FROM sessions WHERE expires_at"))
    return { rowCount: 3, rows: [] };
  if (s.startsWith("DELETE FROM api_usage")) return { rowCount: 5, rows: [] };
  if (s.startsWith("DELETE FROM api_keys WHERE revoked_at"))
    return { rowCount: 2, rows: [] };
  if (s.startsWith("DELETE FROM data_requests"))
    return { rowCount: 1, rows: [] };
  const scanPlan = scanDeletePlan(s);
  if (scanPlan) {
    scanDeletePlans.push(scanPlan);
    const rowCount =
      scanDeleteCounts[scanPlan]?.shift() ?? SCAN_DELETE_DEFAULT[scanPlan] ?? 0;
    afterScanDelete?.();
    return { rowCount, rows: [] };
  }
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
  if (s.startsWith("WITH purged AS"))
    return {
      rows: auditPurgedRows > 0 ? [{ row_count: auditPurgedRows }] : [],
    };
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
  if (s.startsWith("DELETE FROM ai_usage")) return { rowCount: 12, rows: [] };
  if (s.startsWith("DELETE FROM browserbase_usage"))
    return { rowCount: 13, rows: [] };
  if (s.startsWith("DELETE FROM processed_stripe_events"))
    return { rowCount: 14, rows: [] };
  if (s.startsWith("DELETE FROM browser_sessions")) {
    events.push("delete browser_sessions");
    return { rowCount: 4, rows: expiredBrowserSessionRows };
  }
  if (s.startsWith("DELETE FROM cve_kev_cache")) {
    events.push("delete cve_kev_cache");
    return { rowCount: 1, rows: [] };
  }
  if (s.startsWith("DELETE FROM system_error_logs"))
    return { rowCount: 5, rows: [] };
  if (s.startsWith("DELETE FROM webhook_deliveries"))
    return { rowCount: 11, rows: [] };

  return { rows: [] };
}

const clientQuery = vi.fn(scriptedQuery);

// Nothing in the pass should take a client any more; every assertion that
// says so reads this mock.
const mockConnect = vi.fn(async () => ({
  query: clientQuery,
  release: releaseSpy,
}));

// performDatabaseCleanup now also resolves the four BILLING_*_RETENTION
// settings up front via lib/config/runtime-config's getSettings(), which
// calls pool.query() directly.
// Default is empty rows, i.e. every plan resolves to its shipped default --
// -1 (keep forever) on all four plans, so no scan_history delete fires
// unless a test explicitly overrides one via retentionSettingsRows.
let retentionSettingsRows: { key: string; value: string }[] = [];
const mockPoolQuery = vi.fn(scriptedQuery);

vi.mock("@/lib/database/db", () => ({
  default: {
    connect: () => mockConnect(),
    query: (sql: string, params?: unknown[]) => mockPoolQuery(sql, params),
  },
}));

// Mocked at this library boundary (same reasoning as
// tests/app/api/v3/browser/sessions/route.test.ts): this file tests
// whether cleanup calls the true-up with the right (userId, elapsedSeconds)
// for an expired-without-explicit-DELETE session, not
// browserbase-usage.ts's own accounting math, which has its own tests.
const mockRecordBrowserbaseSeconds = vi.fn();
vi.mock("@/lib/billing/browserbase-usage", () => ({
  recordBrowserbaseSeconds: (...args: unknown[]) =>
    mockRecordBrowserbaseSeconds(...args),
}));

// Same reasoning as recordBrowserbaseSeconds above: this file tests that
// cleanup releases exactly one concurrency slot per reclaimed row, not
// lib/browserbase/concurrency-queue.ts's own admit/priority logic.
const mockReleaseConcurrencySlot = vi.fn();
vi.mock("@/lib/browserbase/concurrency-queue", () => ({
  releaseConcurrencySlot: (...args: unknown[]) =>
    mockReleaseConcurrencySlot(...args),
}));

const {
  performDatabaseCleanup,
  CleanupPassError,
  formatCleanupStats,
  schedulePeriodicCleanup,
  stopPeriodicCleanup,
} = await import("@/lib/database/cleanup");
const { DB_CLEANUP_INTERVAL } = await import("@/lib/config/constants");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");

beforeEach(() => {
  calls = [];
  releaseSpy = vi.fn();
  badgeLookupRows = [];
  queryFailureFor = null;
  retentionSettingsRows = [];
  auditPurgedRows = 1;
  expiredBrowserSessionRows = [];
  failWhen = null;
  scanDeleteCounts = {};
  scanDeletePlans = [];
  events = [];
  afterScanDelete = null;
  clientQuery.mockClear();
  mockConnect.mockClear();
  mockPoolQuery.mockClear();
  mockRecordBrowserbaseSeconds.mockReset();
  mockRecordBrowserbaseSeconds.mockImplementation(async () => {
    events.push("record browserbase usage");
  });
  mockReleaseConcurrencySlot.mockReset();
  mockReleaseConcurrencySlot.mockImplementation(async () => {
    events.push("release concurrency slot");
  });
  invalidateSettingsCache();
  stopPeriodicCleanup();
});

afterEach(() => {
  stopPeriodicCleanup();
  vi.useRealTimers();
});

/** How many passes have started: each one opens with the sessions prune. */
function passesRun(): number {
  return calls.filter((c) => c.sql.startsWith("DELETE FROM sessions")).length;
}

describe("performDatabaseCleanup", () => {
  // ref: AUDIT-012#perf-22. The pass used to wrap all thirty DELETEs in one
  // BEGIN/COMMIT on a single pooled client, holding one of the ten pool
  // connections and every deleted row's lock for the whole run, and undoing
  // twenty-nine unrelated prunes if the last one failed. It is now one
  // autocommitted statement per table.
  it("runs the retention prunes autocommitted, not inside one long transaction", async () => {
    await performDatabaseCleanup();
    expect(calls[0].sql).toBe("DELETE FROM sessions WHERE expires_at < NOW()");
    expect(calls[calls.length - 1].sql).toContain(
      "DELETE FROM webhook_deliveries",
    );
    expect(calls.some((c) => c.sql === "BEGIN")).toBe(false);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("aggregates rowCounts from every delete into the returned stats", async () => {
    const stats = await performDatabaseCleanup();
    expect(stats.expiredSessions).toBe(3);
    expect(stats.oldApiUsage).toBe(5);
    expect(stats.revokedApiKeys).toBe(2);
    expect(stats.oldDataRequests).toBe(1);
    expect(stats.oldScans).toBe(0); // shipped retention is -1 (forever) on every plan
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
    expect(stats.archivedAuditLogs).toBe(1);
    expect(stats.oldAiUsage).toBe(12);
    expect(stats.oldBrowserbaseUsage).toBe(13);
    expect(stats.oldStripeEvents).toBe(14);
  });

  // bug-db-7: the archive was a SELECT followed by an INSERT and a DELETE, so
  // two overlapping passes read the same expired rows and archived them twice.
  // That the rows are really archived once is proved against Postgres in
  // tests/integration/cleanup-retention.test.ts; this pins the shape.
  it("purges and archives admin_audit_log in one statement, on the retention setting", async () => {
    auditPurgedRows = 2;
    const stats = await performDatabaseCleanup();

    const statements = calls.filter((c) => c.sql.includes("admin_audit_log"));
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toMatch(/^WITH purged AS/);
    expect(statements[0].params).toEqual([365]);

    expect(stats.archivedAuditLogs).toBe(2);
    expect(stats.oldAuditLogs).toBe(2);
  });

  it("reports nothing purged when there was nothing to archive", async () => {
    auditPurgedRows = 0;
    const stats = await performDatabaseCleanup();
    expect(stats.archivedAuditLogs).toBe(0);
    expect(stats.oldAuditLogs).toBe(0);
  });

  it("keeps a user's false_positive verdict and every AI-set row out of the feedback prune", async () => {
    // bug-db-2: this DELETE had no verdict filter, so after 90 days a finding
    // the user had dismissed came back. Which rows the predicate really keeps
    // is tests/integration/cleanup-retention.test.ts's job.
    await performDatabaseCleanup();
    const prune = calls.find((c) =>
      c.sql.startsWith("DELETE FROM scan_finding_feedback"),
    );
    expect(prune?.sql).toContain(
      "AND (user_id IS NULL OR verdict <> 'false_positive')",
    );
    expect(prune?.sql).toContain("AND notes IS DISTINCT FROM $2");
    expect(prune?.params?.[0]).toBe(90);
  });

  it("recognises AI-set feedback by the exact note the verifier writes", async () => {
    await performDatabaseCleanup();
    const prune = calls.find((c) =>
      c.sql.startsWith("DELETE FROM scan_finding_feedback"),
    );
    const verifier = readFileSync(
      path.resolve(process.cwd(), "lib/ai/verify-findings.ts"),
      "utf8",
    );
    expect(prune?.params?.[1]).toEqual(expect.any(String));
    expect(verifier).toContain(`'${String(prune?.params?.[1])}'`);
  });

  it("keeps a rate_limits row for the longest window any limiter can be set to", async () => {
    // bug-db-4: a flat 1 day wiped the count of any window longer than that.
    // Raising a window's maximum in the registry without raising this bound
    // brings that bug back, so the two are held equal here.
    const windowMaximaInSeconds = Object.entries(SETTINGS_REGISTRY).flatMap(
      ([key, def]) => {
        const max = "max" in def ? Number(def.max) : 0;
        if (/^RATE_LIMIT_\w+_WINDOW_MINUTES$/.test(key)) return [max * 60];
        if (key === "DEMO_WINDOW_HOURS") return [max * 3600];
        return [];
      },
    );
    expect(windowMaximaInSeconds.length).toBeGreaterThan(1);

    await performDatabaseCleanup();
    const prune = calls.find((c) =>
      c.sql.startsWith("DELETE FROM rate_limits"),
    );
    expect(prune?.sql).toContain("window_start < NOW()");
    expect(prune?.params).toEqual([Math.max(...windowMaximaInSeconds)]);
  });

  it("prunes ai_usage and browserbase_usage by updated_at on the usage retention setting", async () => {
    retentionSettingsRows = [
      { key: "CLEANUP_GITHUB_REVIEW_USAGE_RETENTION_DAYS", value: "100" },
    ];
    await performDatabaseCleanup();
    for (const table of ["ai_usage", "browserbase_usage"]) {
      const prune = calls.find((c) => c.sql.startsWith(`DELETE FROM ${table}`));
      expect(prune?.sql).toContain("WHERE updated_at < NOW()");
      expect(prune?.params).toEqual([100]);
    }
  });

  it("never lets the usage retention setting reach the live window or the one before it", async () => {
    retentionSettingsRows = [
      { key: "CLEANUP_GITHUB_REVIEW_USAGE_RETENTION_DAYS", value: "1" },
      { key: "AI_USAGE_WINDOW_HOURS", value: "168" },
    ];
    await performDatabaseCleanup();
    const paramsFor = (table: string) =>
      calls.find((c) => c.sql.startsWith(`DELETE FROM ${table}`))?.params;
    expect(paramsFor("ai_usage")).toEqual([14]);
    expect(paramsFor("browserbase_usage")).toEqual([62]);
  });

  it("rounds the ai_usage floor up, so a short window still keeps two whole windows", async () => {
    retentionSettingsRows = [
      { key: "CLEANUP_GITHUB_REVIEW_USAGE_RETENTION_DAYS", value: "1" },
      { key: "AI_USAGE_WINDOW_HOURS", value: "13" },
    ];
    await performDatabaseCleanup();
    expect(
      calls.find((c) => c.sql.startsWith("DELETE FROM ai_usage"))?.params,
    ).toEqual([2]);
  });

  it("prunes processed_stripe_events after 30 days, on the indexed column", async () => {
    await performDatabaseCleanup();
    const prune = calls.find((c) =>
      c.sql.startsWith("DELETE FROM processed_stripe_events"),
    );
    expect(prune?.sql).toContain("WHERE processed_at < NOW()");
    expect(prune?.params).toEqual([30]);
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

  it("records plan usage for a session that expired without an explicit DELETE call", async () => {
    expiredBrowserSessionRows = [
      {
        user_id: 42,
        created_at: "2026-08-16T20:00:00.000Z",
        expires_at: "2026-08-16T20:06:00.000Z", // 6-minute TTL
      },
    ];
    await performDatabaseCleanup();
    expect(mockRecordBrowserbaseSeconds).toHaveBeenCalledTimes(1);
    expect(mockRecordBrowserbaseSeconds).toHaveBeenCalledWith(42, 360);
    // Each reclaimed row held a global concurrency slot that nobody ever
    // released via an explicit DELETE -- cleanup must free it too.
    expect(mockReleaseConcurrencySlot).toHaveBeenCalledTimes(1);
  });

  it("records usage for several expired sessions independently, using each one's own duration", async () => {
    expiredBrowserSessionRows = [
      {
        user_id: 1,
        created_at: "2026-08-16T20:00:00.000Z",
        expires_at: "2026-08-16T20:02:00.000Z",
      },
      {
        user_id: 2,
        created_at: "2026-08-16T20:00:00.000Z",
        expires_at: "2026-08-16T20:05:00.000Z",
      },
    ];
    await performDatabaseCleanup();
    expect(mockRecordBrowserbaseSeconds).toHaveBeenCalledTimes(2);
    expect(mockRecordBrowserbaseSeconds).toHaveBeenCalledWith(1, 120);
    expect(mockRecordBrowserbaseSeconds).toHaveBeenCalledWith(2, 300);
    expect(mockReleaseConcurrencySlot).toHaveBeenCalledTimes(2);
  });

  it("falls back to now() as the end time for the rare row with no expires_at", async () => {
    const createdAt = new Date(Date.now() - 45_000).toISOString(); // 45s ago
    expiredBrowserSessionRows = [
      { user_id: 7, created_at: createdAt, expires_at: null },
    ];
    await performDatabaseCleanup();
    expect(mockRecordBrowserbaseSeconds).toHaveBeenCalledTimes(1);
    const [userId, seconds] = mockRecordBrowserbaseSeconds.mock.calls[0];
    expect(userId).toBe(7);
    expect(seconds).toBeGreaterThanOrEqual(44);
    expect(seconds).toBeLessThanOrEqual(47);
  });

  it("never records usage when no sessions expired this pass", async () => {
    expiredBrowserSessionRows = [];
    await performDatabaseCleanup();
    expect(mockRecordBrowserbaseSeconds).not.toHaveBeenCalled();
  });

  it("caps the CVE KEV cache at 7 days -- a performance cache, not user data", async () => {
    // CLEANUP_KEV_CACHE_RETENTION_DAYS is admin-configurable, so the query
    // is parameterized ($1 * INTERVAL '1 day'), not a literal "7 days" in
    // the SQL text. retentionSettingsRows is empty by default (see
    // mockPoolQuery above), so it resolves to its shipped registry default
    // -- CONFIG_CLEANUP_KEV_CACHE_RETENTION_DAYS = 7 in config-values.ts.
    await performDatabaseCleanup();
    const kevCache = calls.find((c) =>
      c.sql.startsWith("DELETE FROM cve_kev_cache"),
    );
    expect(kevCache?.sql).toContain("cached_at");
    expect(kevCache?.sql).toContain("INTERVAL '1 day'");
    expect(kevCache?.params).toEqual([7]);
  });

  it("caps system_error_logs at 30 days -- operational debug output, not a compliance record", async () => {
    // Same admin-configurable, parameterized shape as the KEV cache above.
    // Shipped registry default -- CONFIG_CLEANUP_SYSTEM_ERROR_LOGS_RETENTION_DAYS
    // = 30 in config-values.ts -- applies since retentionSettingsRows is empty.
    await performDatabaseCleanup();
    const errorLogs = calls.find((c) =>
      c.sql.startsWith("DELETE FROM system_error_logs"),
    );
    expect(errorLogs?.sql).toContain("created_at");
    expect(errorLogs?.sql).toContain("INTERVAL '1 day'");
    expect(errorLogs?.params).toEqual([30]);
  });

  it("prunes webhook_deliveries, which used to be the one log table nothing ever deleted (AUDIT-012 perf-27)", async () => {
    // lib/webhooks/delivery.ts writes a row per delivery attempt and
    // retries once on failure, so a customer with a broken endpoint wrote
    // two rows per event forever with no rule to remove any of them.
    const stats = await performDatabaseCleanup();
    const deliveries = calls.find((c) =>
      c.sql.startsWith("DELETE FROM webhook_deliveries"),
    );
    expect(deliveries).toBeDefined();
    expect(deliveries?.sql).toContain("attempted_at");
    expect(deliveries?.sql).toContain("INTERVAL '1 day'");
    expect(deliveries?.params).toEqual([30]);
    expect(stats.oldWebhookDeliveries).toBe(11);
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

  it("issues no scan_history delete at all on the shipped defaults -- every plan is -1 (forever)", async () => {
    await performDatabaseCleanup();
    const scanDeletes = calls.filter((c) =>
      c.sql.includes("FROM scan_history"),
    );
    expect(scanDeletes).toHaveLength(0);
  });

  it("scopes scan-history retention to the correct plan when an admin turns it on, and never touches paid unlimited plans left at -1", async () => {
    retentionSettingsRows = [
      { key: "BILLING_FREE_RETENTION", value: "30" },
      { key: "BILLING_CORE_SUPPORTER_RETENTION", value: "90" },
    ];
    await performDatabaseCleanup();
    const freeScan = calls.find(
      (c) =>
        c.sql.includes("FROM scan_history") && c.sql.includes("plan = 'free'"),
    );
    const coreScan = calls.find(
      (c) =>
        c.sql.includes("FROM scan_history") && c.sql.includes("core_supporter"),
    );
    // The window, then the batch size.
    expect(freeScan?.params).toEqual([30, 2000]);
    expect(coreScan?.params).toEqual([90, 2000]);
    // Only two scan_history deletes total -- pro/elite (still -1, left at
    // their shipped default) never get a delete issued against them at all.
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
    expect(proScan?.params).toEqual([365, 2000]);
    expect(eliteScan?.params).toEqual([730, 2000]);

    const scanDeletes = calls.filter((c) =>
      c.sql.includes("FROM scan_history"),
    );
    // free + core_supporter are still -1 (shipped default) -- only pro +
    // elite (admin override) issue a delete.
    expect(scanDeletes).toHaveLength(2);
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
    // The badge branch's own try/catch swallows the error; every later prune
    // still runs and every other stat is still collected.
    expect(stats.oldAuditLogs).toBe(1);
    expect(calls[calls.length - 1].sql).toContain(
      "DELETE FROM webhook_deliveries",
    );
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // ref: AUDIT-012#perf-22. The prunes that already succeeded are durably
  // committed instead of being rolled back with a later failure, and (this
  // change) the ones after the failure still run.
  it("keeps pruning after one prune fails, then throws so the failure escalator still fires", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    queryFailureFor = "DELETE FROM api_usage";
    const outcome = await performDatabaseCleanup().then(
      () => null,
      (error: unknown) => error,
    );

    expect(outcome).toBeInstanceOf(AggregateError);
    expect(outcome).toBeInstanceOf(CleanupPassError);
    const failure = outcome as InstanceType<typeof CleanupPassError>;
    expect(failure.errors).toHaveLength(1);
    expect((failure.errors[0] as Error).message).toMatch(/simulated failure/);
    // The message names the prune, so the escalator's alert says which one.
    expect(failure.message).toContain("api_usage");
    expect(failure.message).toMatch(/simulated failure/);
    // The error carries what the other prunes removed, so a caller that
    // records the run can still say what it deleted. The failed prune counted
    // nothing.
    expect(failure.stats.expiredSessions).toBe(3);
    expect(failure.stats.oldApiUsage).toBe(0);
    expect(failure.stats.oldRateLimits).toBe(8);

    // The sessions prune ran before the failure and is not undone: there is
    // no ROLLBACK to undo it with.
    expect(calls.some((c) => c.sql.startsWith("DELETE FROM sessions"))).toBe(
      true,
    );
    expect(calls.some((c) => c.sql === "ROLLBACK")).toBe(false);
    // And the prunes after it were reached: the audit statement in the middle
    // of the pass, and the last prune of all.
    expect(calls.some((c) => c.sql.startsWith("WITH purged AS"))).toBe(true);
    expect(calls[calls.length - 1].sql).toContain(
      "DELETE FROM webhook_deliveries",
    );
    // Each failure is logged as it happens, with the error itself.
    expect(
      errSpy.mock.calls.some(
        ([message, error]) =>
          String(message).includes('Prune "api_usage" failed') &&
          error instanceof Error,
      ),
    ).toBe(true);
    errSpy.mockRestore();
  });

  it("collects every failure into the one AggregateError", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    failWhen = (s) =>
      s.startsWith("DELETE FROM rate_limits") ||
      s.startsWith("DELETE FROM email_logs");
    const outcome = await performDatabaseCleanup().then(
      () => null,
      (error: unknown) => error,
    );

    expect(outcome).toBeInstanceOf(AggregateError);
    const failure = outcome as AggregateError;
    expect(failure.errors).toHaveLength(2);
    expect(failure.message).toMatch(/^2 database cleanup prune\(s\) failed/);
    expect(failure.message).toContain("rate_limits");
    expect(failure.message).toContain("email_logs");
    // The prune between them still ran.
    expect(
      calls.some((c) => c.sql.startsWith("DELETE FROM system_error_logs")),
    ).toBe(true);
    errSpy.mockRestore();
  });

  it("does not throw, and returns the stats, when every prune succeeds", async () => {
    const stats = await performDatabaseCleanup();
    expect(stats.expiredSessions).toBe(3);
  });

  it("records browser usage and frees the slots right after the browser_sessions DELETE, before the prunes that follow it", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expiredBrowserSessionRows = [
      {
        user_id: 42,
        created_at: "2026-08-16T20:00:00.000Z",
        expires_at: "2026-08-16T20:06:00.000Z",
      },
    ];
    await performDatabaseCleanup();
    // Not at the very end of the pass, as it used to run: the next prune is
    // cve_kev_cache, and a failure there or later must not be able to strand
    // the usage record or the slot.
    expect(events).toEqual([
      "delete browser_sessions",
      "record browserbase usage",
      "release concurrency slot",
      "delete cve_kev_cache",
    ]);
    errSpy.mockRestore();
  });

  it("still records usage and frees the slots when a prune after browser_sessions fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expiredBrowserSessionRows = [
      {
        user_id: 42,
        created_at: "2026-08-16T20:00:00.000Z",
        expires_at: "2026-08-16T20:06:00.000Z",
      },
      {
        user_id: 43,
        created_at: "2026-08-16T20:00:00.000Z",
        expires_at: "2026-08-16T20:02:00.000Z",
      },
    ];
    failWhen = (s) => s.startsWith("DELETE FROM cve_kev_cache");
    await expect(performDatabaseCleanup()).rejects.toBeInstanceOf(
      AggregateError,
    );
    expect(mockRecordBrowserbaseSeconds).toHaveBeenCalledWith(42, 360);
    expect(mockRecordBrowserbaseSeconds).toHaveBeenCalledWith(43, 120);
    expect(mockReleaseConcurrencySlot).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });

  it("does not record usage for sessions whose DELETE failed, since none were reclaimed", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expiredBrowserSessionRows = [
      {
        user_id: 42,
        created_at: "2026-08-16T20:00:00.000Z",
        expires_at: "2026-08-16T20:06:00.000Z",
      },
    ];
    failWhen = (s) => s.startsWith("DELETE FROM browser_sessions");
    await expect(performDatabaseCleanup()).rejects.toBeInstanceOf(
      AggregateError,
    );
    expect(mockRecordBrowserbaseSeconds).not.toHaveBeenCalled();
    expect(mockReleaseConcurrencySlot).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("reports nothing archived or purged when the archive statement fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    auditPurgedRows = 2;
    queryFailureFor = "WITH purged AS";
    const outcome = await performDatabaseCleanup().then(
      () => null,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(CleanupPassError);
    const { stats } = outcome as InstanceType<typeof CleanupPassError>;
    expect(stats.archivedAuditLogs).toBe(0);
    expect(stats.oldAuditLogs).toBe(0);
    // It is one prune among many: the rest of the pass still ran.
    expect(stats.oldAdminNotes).toBe(1);
    errSpy.mockRestore();
  });
});

describe("plan-scoped scan_history retention", () => {
  const BATCH = 2000;

  function scanDeleteCalls() {
    return calls.filter((c) => c.sql.startsWith("DELETE FROM scan_history"));
  }

  it("deletes a batch at a time by id, until a batch comes back short", async () => {
    retentionSettingsRows = [{ key: "BILLING_FREE_RETENTION", value: "30" }];
    scanDeleteCounts = { free: [BATCH, BATCH, 350] };

    const stats = await performDatabaseCleanup();

    expect(scanDeletePlans).toEqual(["free", "free", "free"]);
    expect(stats.oldScans).toBe(BATCH + BATCH + 350);
    const first = scanDeleteCalls()[0];
    // Selected by id and capped, so no single statement can outrun the
    // statement timeout, and each batch autocommits on the pool.
    expect(first.sql).toContain("WHERE id IN (");
    expect(first.sql).toContain("SELECT id FROM scan_history");
    expect(first.sql).toMatch(/LIMIT \$2/);
    expect(first.sql).not.toContain("ctid");
    for (const call of scanDeleteCalls()) {
      expect(call.params).toEqual([30, BATCH]);
    }
    expect(calls.some((c) => c.sql === "BEGIN")).toBe(false);
  });

  it("asks once more after an exactly full batch, and stops when that comes back empty", async () => {
    retentionSettingsRows = [{ key: "BILLING_FREE_RETENTION", value: "30" }];
    scanDeleteCounts = { free: [BATCH, 0] };
    const stats = await performDatabaseCleanup();
    expect(scanDeletePlans).toEqual(["free", "free"]);
    expect(stats.oldScans).toBe(BATCH);
  });

  it("takes turns between plans, so a deep backlog on one cannot starve the others", async () => {
    retentionSettingsRows = [
      { key: "BILLING_FREE_RETENTION", value: "30" },
      { key: "BILLING_CORE_SUPPORTER_RETENTION", value: "90" },
    ];
    scanDeleteCounts = {
      free: [BATCH, BATCH, 5],
      core_supporter: [BATCH, 7],
    };

    const stats = await performDatabaseCleanup();

    expect(scanDeletePlans).toEqual([
      "free",
      "core_supporter",
      "free",
      "core_supporter",
      "free",
    ]);
    expect(stats.oldScans).toBe(BATCH * 3 + 5 + 7);
  });

  it("stops at the pass budget and leaves the remaining backlog for the next pass", async () => {
    retentionSettingsRows = [{ key: "BILLING_FREE_RETENTION", value: "30" }];
    // A backlog far deeper than the pass can clear: every batch is full.
    scanDeleteCounts = { free: Array.from({ length: 50 }, () => BATCH) };
    // Each batch takes 8 s of wall clock; the budget is 20 s.
    let clock = 1_800_000_000_000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    afterScanDelete = () => {
      clock += 8_000;
    };
    try {
      const stats = await performDatabaseCleanup();
      // Batches start at 0 s, 8 s and 16 s; the fourth would start at 24 s.
      expect(scanDeletePlans).toHaveLength(3);
      expect(stats.oldScans).toBe(BATCH * 3);
      // The budget is for the scan deletes only. The rest of the pass ran.
      expect(calls[calls.length - 1].sql).toContain(
        "DELETE FROM webhook_deliveries",
      );
    } finally {
      now.mockRestore();
    }
  });

  it("reports a plan that fails and still prunes the other plans and every later table", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    retentionSettingsRows = [
      { key: "BILLING_FREE_RETENTION", value: "30" },
      { key: "BILLING_CORE_SUPPORTER_RETENTION", value: "90" },
    ];
    failWhen = (s) =>
      s.startsWith("DELETE FROM scan_history") && s.includes("plan = 'free'");

    const outcome = await performDatabaseCleanup().then(
      () => null,
      (error: unknown) => error,
    );

    expect(outcome).toBeInstanceOf(AggregateError);
    expect((outcome as AggregateError).message).toContain(
      "scan_history (free plan)",
    );
    expect(scanDeletePlans).toEqual(["core_supporter"]);
    expect(calls[calls.length - 1].sql).toContain(
      "DELETE FROM webhook_deliveries",
    );
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
      archivedAuditLogs: 0,
      oldEmailLogs: 0,
      oldWebhookDeliveries: 0,
      oldAiUsage: 0,
      oldBrowserbaseUsage: 0,
      oldStripeEvents: 0,
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
      archivedAuditLogs: 0,
      oldEmailLogs: 0,
      oldWebhookDeliveries: 0,
      oldAiUsage: 0,
      oldBrowserbaseUsage: 0,
      oldStripeEvents: 0,
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
      archivedAuditLogs: 0,
      oldEmailLogs: 0,
      oldWebhookDeliveries: 0,
      oldAiUsage: 0,
      oldBrowserbaseUsage: 0,
      oldStripeEvents: 0,
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
      archivedAuditLogs: 0,
      oldEmailLogs: 0,
      oldWebhookDeliveries: 0,
      oldAiUsage: 0,
      oldBrowserbaseUsage: 0,
      oldStripeEvents: 0,
    };
    const summary = formatCleanupStats(stats);
    expect(summary).toContain("12 total");
    expect(summary).toContain("12 error logs");
  });

  it("reports the archived-audit-log count as its own line without inflating the total", () => {
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
      oldAuditLogs: 6,
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
      archivedAuditLogs: 6,
      oldEmailLogs: 0,
      oldWebhookDeliveries: 0,
      oldAiUsage: 0,
      oldBrowserbaseUsage: 0,
      oldStripeEvents: 0,
    };
    const summary = formatCleanupStats(stats);
    // Same 6 rows counted once via oldAuditLogs -- archivedAuditLogs
    // describes those same rows, not an additional 6 deleted elsewhere.
    expect(summary).toContain("6 total");
    expect(summary).toContain("6 audit logs");
    expect(summary).toContain("6 audit logs archived");
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
      archivedAuditLogs: 0,
      oldEmailLogs: 0,
      oldWebhookDeliveries: 0,
      oldAiUsage: 0,
      oldBrowserbaseUsage: 0,
      oldStripeEvents: 0,
    };
    const summary = formatCleanupStats(stats);
    expect(summary).toContain("23 total");
    expect(summary).toContain("7 finding feedback");
    expect(summary).toContain("9 in-app notifications");
    expect(summary).toContain("2 GitHub review usage rows");
    expect(summary).toContain("4 browser sessions");
    expect(summary).toContain("1 KEV cache rows");
  });

  it("counts and names the usage and Stripe event prunes", () => {
    const summary = formatCleanupStats({
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
      archivedAuditLogs: 0,
      oldEmailLogs: 0,
      oldWebhookDeliveries: 0,
      oldAiUsage: 3,
      oldBrowserbaseUsage: 2,
      oldStripeEvents: 4,
    });
    expect(summary).toContain("9 total");
    expect(summary).toContain("3 AI usage rows");
    expect(summary).toContain("2 browser usage rows");
    expect(summary).toContain("4 Stripe event markers");
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
    expect(passesRun()).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(passesRun()).toBe(1);
  });

  it("fires repeatedly on exactly the interval passed in, not a fixed 24h", async () => {
    vi.useFakeTimers();
    schedulePeriodicCleanup(2000);

    await vi.advanceTimersByTimeAsync(2000);
    expect(passesRun()).toBe(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(passesRun()).toBe(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(passesRun()).toBe(3);
  });

  it("falls back to the configured default interval when called with no argument", async () => {
    vi.useFakeTimers();
    schedulePeriodicCleanup();

    await vi.advanceTimersByTimeAsync(DB_CLEANUP_INTERVAL - 1);
    expect(passesRun()).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(passesRun()).toBe(1);
  });

  it("falls back to the default for an invalid interval (zero, negative, NaN)", async () => {
    vi.useFakeTimers();
    schedulePeriodicCleanup(-500);

    await vi.advanceTimersByTimeAsync(DB_CLEANUP_INTERVAL - 1);
    expect(passesRun()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(passesRun()).toBe(1);
  });

  it("cancels the previous timer when called again, instead of double-scheduling", async () => {
    vi.useFakeTimers();
    schedulePeriodicCleanup(1000);
    await vi.advanceTimersByTimeAsync(500);
    schedulePeriodicCleanup(1000); // reschedule before the first one fires

    await vi.advanceTimersByTimeAsync(999);
    expect(passesRun()).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(passesRun()).toBe(1);
  });

  it("stops firing after stopPeriodicCleanup()", async () => {
    vi.useFakeTimers();
    schedulePeriodicCleanup(1000);
    stopPeriodicCleanup();

    await vi.advanceTimersByTimeAsync(10000);
    expect(passesRun()).toBe(0);
  });

  it("returns a timer handle exposing unref, so a pending run never blocks process exit", () => {
    vi.useFakeTimers();
    const timer = schedulePeriodicCleanup(1000);
    expect(typeof timer.unref).toBe("function");
  });

  it("logs but does not throw when a scheduled run itself fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    queryFailureFor = "DELETE FROM sessions";
    schedulePeriodicCleanup(1000);

    await vi.advanceTimersByTimeAsync(1000);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("Periodic cleanup failed"),
      expect.anything(),
    );
    errSpy.mockRestore();
  });
});
