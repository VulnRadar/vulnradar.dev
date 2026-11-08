import { it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import pool from "@/lib/database/db";
import { performDatabaseCleanup } from "@/lib/database/cleanup";
import { getFalsePositiveIds } from "@/lib/scanner/remediation-store";
import { checkRateLimit } from "@/lib/rate-limiting/rate-limit";
import {
  describeIntegration,
  createUser,
  setSettings,
  clearSettings,
  unique,
} from "./_db";

/**
 * What the retention pass must leave behind, and what it must archive once.
 *
 * cleanup.test.ts covers the pair every prune has (one row past the window, one
 * inside it). These are the prunes whose correctness is a second condition: a
 * verdict that is a standing instruction rather than telemetry, a limiter
 * bucket that outlives a day, a floor under a setting that can be set too low,
 * and an archive that has to count each row once when two passes overlap. A
 * faked pool answers all of them the same way whether the WHERE is right or
 * not.
 */
const FEEDBACK_RETENTION_DAYS = 90;
const AI_NOTE = "Set automatically from an AI verify verdict.";
const DAY_MS = 24 * 60 * 60 * 1000;

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(sql, params);
  return rows[0].n;
}

describeIntegration("retention rules that are more than an age check", () => {
  beforeAll(async () => {
    await setSettings({
      CLEANUP_SCAN_FINDING_FEEDBACK_RETENTION_DAYS: FEEDBACK_RETENTION_DAYS,
      CLEANUP_ADMIN_AUDIT_LOG_RETENTION_DAYS: 30,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await clearSettings();
  });

  async function seedFeedback(
    userId: number | null,
    findingId: string,
    verdict: string,
    daysOld: number,
    notes: string | null = null,
  ) {
    await pool.query(
      `INSERT INTO scan_finding_feedback
         (user_id, finding_id, finding_url, verdict, notes, created_at)
       VALUES ($1, $2, 'https://feedback.example.test/', $3, $4,
               NOW() - ($5::int * INTERVAL '1 day'))`,
      [userId, findingId, verdict, notes, daysOld],
    );
  }

  const feedbackRows = (findingId: string) =>
    count(
      "SELECT COUNT(*)::int AS n FROM scan_finding_feedback WHERE finding_id = $1",
      [findingId],
    );

  it("keeps a user's false_positive verdict past the retention window, so the finding stays hidden", async () => {
    const { id: userId } = await createUser();
    const dismissed = unique("dismissed");
    await seedFeedback(
      userId,
      dismissed,
      "false_positive",
      FEEDBACK_RETENTION_DAYS + 1,
    );

    await performDatabaseCleanup();

    expect(await feedbackRows(dismissed)).toBe(1);
    expect((await getFalsePositiveIds(userId)).has(dismissed)).toBe(true);
  });

  it("still prunes the verdicts that are only telemetry", async () => {
    const { id: userId } = await createUser();
    const confirmed = unique("confirmed");
    const notApplicable = unique("not-applicable");
    const orphaned = unique("orphaned-fp");
    const recent = unique("recent");
    await seedFeedback(
      userId,
      confirmed,
      "confirmed",
      FEEDBACK_RETENTION_DAYS + 1,
    );
    await seedFeedback(
      userId,
      notApplicable,
      "not_applicable",
      FEEDBACK_RETENTION_DAYS + 1,
    );
    // No account left for the suppression to belong to, so nothing reads it.
    await seedFeedback(
      null,
      orphaned,
      "false_positive",
      FEEDBACK_RETENTION_DAYS + 1,
    );
    await seedFeedback(userId, recent, "confirmed", 1);

    await performDatabaseCleanup();

    expect(await feedbackRows(confirmed)).toBe(0);
    expect(await feedbackRows(notApplicable)).toBe(0);
    expect(await feedbackRows(orphaned)).toBe(0);
    expect(await feedbackRows(recent)).toBe(1);
  });

  it("never prunes a row the AI verifier set, whatever its verdict", async () => {
    const { id: userId } = await createUser();
    const aiConfirmed = unique("ai-confirmed");
    const aiFalsePositive = unique("ai-fp");
    await seedFeedback(
      userId,
      aiConfirmed,
      "confirmed",
      FEEDBACK_RETENTION_DAYS + 1,
      AI_NOTE,
    );
    await seedFeedback(
      userId,
      aiFalsePositive,
      "false_positive",
      FEEDBACK_RETENTION_DAYS + 1,
      AI_NOTE,
    );

    await performDatabaseCleanup();

    expect(await feedbackRows(aiConfirmed)).toBe(1);
    expect(await feedbackRows(aiFalsePositive)).toBe(1);
  });

  it("does not reset a 72-hour limiter when the pass runs", async () => {
    // Only the JS clock moves, and only to pick the bucket. The limiter stores
    // a bucket start computed from Date; the prune compares it against
    // Postgres's real NOW(). Without pinning, the bucket is whichever 72-hour
    // slice of the epoch today falls in, and for a third of every slice it is
    // under a day old, where the old 1-day prune would have passed this too.
    // This one started two to five days ago: past the old prune, inside the
    // real window bound.
    const windowSeconds = 72 * 60 * 60;
    const windowMs = windowSeconds * 1000;
    const bucketStart =
      Math.floor((Date.now() - 2 * DAY_MS) / windowMs) * windowMs;
    const key = `demo_scan:${unique("ip")}`;
    const limit = { key, maxAttempts: 1, windowSeconds };

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(bucketStart + 60_000);
    expect((await checkRateLimit(limit)).allowed).toBe(true);
    expect((await checkRateLimit(limit)).allowed).toBe(false);
    vi.useRealTimers();

    await performDatabaseCleanup();

    expect(
      await count("SELECT COUNT(*)::int AS n FROM rate_limits WHERE key = $1", [
        key,
      ]),
    ).toBe(1);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(bucketStart + 120_000);
    expect((await checkRateLimit(limit)).allowed).toBe(false);
  });

  it("prunes a limiter row once no window could still be counting it", async () => {
    const stale = unique("rl-stale");
    await pool.query(
      `INSERT INTO rate_limits (key, "count", window_start)
       VALUES ($1, 1, NOW() - INTERVAL '8 days')`,
      [stale],
    );

    await performDatabaseCleanup();

    expect(
      await count("SELECT COUNT(*)::int AS n FROM rate_limits WHERE key = $1", [
        stale,
      ]),
    ).toBe(0);
  });

  it("archives each expired audit row exactly once when two passes overlap", async () => {
    const { id: adminId } = await createUser();
    const action = unique("overlap");
    await pool.query(
      `INSERT INTO admin_audit_log (admin_id, action, created_at)
       SELECT $1::int, $2::text, NOW() - INTERVAL '60 days'
         FROM generate_series(1, 3)`,
      [adminId, action],
    );

    const [first, second] = await Promise.all([
      performDatabaseCleanup(),
      performDatabaseCleanup(),
    ]);

    const archivedCopies = await count(
      `SELECT COUNT(*)::int AS n
         FROM admin_audit_log_archive a,
              jsonb_array_elements(a.rows) AS e
        WHERE e->>'action' = $1`,
      [action],
    );
    expect(archivedCopies).toBe(3);
    expect(first.archivedAuditLogs + second.archivedAuditLogs).toBe(3);
    expect(first.oldAuditLogs + second.oldAuditLogs).toBe(3);
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM admin_audit_log WHERE action = $1",
        [action],
      ),
    ).toBe(0);
  });

  it("keeps the columns of an archived row, and writes no batch when nothing expired", async () => {
    const { id: adminId } = await createUser();
    const action = unique("shape");
    await pool.query(
      `INSERT INTO admin_audit_log
         (admin_id, target_user_id, action, details, ip_address, created_at)
       VALUES ($1, $1, $2, 'the details', '203.0.113.9', NOW() - INTERVAL '60 days')`,
      [adminId, action],
    );

    await performDatabaseCleanup();

    const { rows } = await pool.query<{
      row_count: number;
      retention_days: number;
      entry: Record<string, unknown>;
    }>(
      `SELECT a.row_count, a.retention_days, e AS entry
         FROM admin_audit_log_archive a,
              jsonb_array_elements(a.rows) AS e
        WHERE e->>'action' = $1`,
      [action],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].row_count).toBe(1);
    expect(rows[0].retention_days).toBe(30);
    expect(rows[0].entry).toMatchObject({
      admin_id: adminId,
      target_user_id: adminId,
      details: "the details",
      ip_address: "203.0.113.9",
    });
    expect(rows[0].entry.id).toEqual(expect.any(Number));
    expect(rows[0].entry.created_at).toEqual(expect.any(String));

    const batchesBefore = await count(
      "SELECT COUNT(*)::int AS n FROM admin_audit_log_archive",
    );
    await performDatabaseCleanup();
    expect(
      await count("SELECT COUNT(*)::int AS n FROM admin_audit_log_archive"),
    ).toBe(batchesBefore);
  });

  async function seedUsage(
    table: "ai_usage" | "browserbase_usage",
    userId: number,
    daysOld: number,
  ) {
    const startColumn = table === "ai_usage" ? "window_start" : "period_start";
    const amountColumn = table === "ai_usage" ? "tokens_used" : "seconds_used";
    await pool.query(
      `INSERT INTO ${table} (user_id, ${startColumn}, ${amountColumn}, updated_at)
       VALUES ($1, NOW() - ($2::int * INTERVAL '1 day'), 10,
               NOW() - ($2::int * INTERVAL '1 day'))`,
      [userId, daysOld],
    );
  }

  const usageRows = (table: "ai_usage" | "browserbase_usage", userId: number) =>
    count(`SELECT COUNT(*)::int AS n FROM ${table} WHERE user_id = $1`, [
      userId,
    ]);

  it("prunes old usage counters and leaves current ones on the retention setting", async () => {
    await setSettings({ CLEANUP_GITHUB_REVIEW_USAGE_RETENTION_DAYS: 100 });
    const { id: userId } = await createUser();
    await seedUsage("ai_usage", userId, 150);
    await seedUsage("ai_usage", userId, 1);
    await seedUsage("browserbase_usage", userId, 150);
    await seedUsage("browserbase_usage", userId, 1);

    const stats = await performDatabaseCleanup();

    expect(await usageRows("ai_usage", userId)).toBe(1);
    expect(await usageRows("browserbase_usage", userId)).toBe(1);
    expect(stats.oldAiUsage).toBeGreaterThanOrEqual(1);
    expect(stats.oldBrowserbaseUsage).toBeGreaterThanOrEqual(1);
  });

  it("holds a usage row one window past the current one, however low the setting is", async () => {
    await setSettings({
      CLEANUP_GITHUB_REVIEW_USAGE_RETENTION_DAYS: 1,
      AI_USAGE_WINDOW_HOURS: 168,
    });
    const { id: userId } = await createUser();
    await seedUsage("ai_usage", userId, 10);
    await seedUsage("browserbase_usage", userId, 40);

    await performDatabaseCleanup();

    expect(await usageRows("ai_usage", userId)).toBe(1);
    expect(await usageRows("browserbase_usage", userId)).toBe(1);
  });

  it("forgets Stripe event markers after 30 days and keeps recent ones", async () => {
    const stale = unique("evt_stale");
    const recent = unique("evt_recent");
    await pool.query(
      `INSERT INTO processed_stripe_events (event_id, event_type, processed_at) VALUES
         ($1, 'invoice.paid', NOW() - INTERVAL '31 days'),
         ($2, 'invoice.paid', NOW() - INTERVAL '29 days')`,
      [stale, recent],
    );

    const stats = await performDatabaseCleanup();

    const held = (id: string) =>
      count(
        "SELECT COUNT(*)::int AS n FROM processed_stripe_events WHERE event_id = $1",
        [id],
      );
    expect(await held(stale)).toBe(0);
    expect(await held(recent)).toBe(1);
    expect(stats.oldStripeEvents).toBeGreaterThanOrEqual(1);
  });
});
