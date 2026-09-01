/**
 * REQUIRED_TABLES is the list /api/v3/health and the boot-time verification in
 * instrumentation.ts check for. Every name on it must be a table the boot
 * sequence creates unconditionally, and the load-bearing ones must actually be
 * on it: the list used to omit `sessions`, so health could report schema_ok
 * with no missing tables while every login 500ed. ref: AUDIT-013#schema-06
 *
 * The parity half reads instrumentation.ts's own DDL, so a name that is
 * renamed or dropped there fails here instead of turning the health check into
 * a permanent false alarm.
 */
import { describe, it, expect } from "vitest";
import { REQUIRED_TABLES } from "@/lib/database/required-tables";

// The same schema scripts/create-fresh-db applies and the schema-parity suite
// compares, so "does the boot sequence create this table" is answered from the
// step list the boot path actually executes rather than by a substring search
// of one file. Three steps have their DDL in an ensure*() module rather than
// inline (staff_invites, admin_audit_log_archive, the posture-digest columns),
// and a plain text search would not see any of them.
const { readBootSchema } =
  await import("@/scripts/_lib/_lib.schema-parity.mjs");
const bootSchema = readBootSchema() as {
  tables: Map<string, Set<string>>;
};

describe("REQUIRED_TABLES", () => {
  it("lists every table whose absence breaks auth, rate limiting, signup or billing idempotency", () => {
    for (const table of [
      "users",
      "sessions",
      "scan_history",
      "api_keys",
      "rate_limits",
      "notification_preferences",
      "processed_stripe_events",
      "ai_credit_purchases",
      "github_credit_purchases",
      "browserbase_credit_purchases",
    ]) {
      expect(REQUIRED_TABLES).toContain(table);
    }
  });

  it("names only tables the boot sequence creates", () => {
    const missing = REQUIRED_TABLES.filter(
      (table) => !bootSchema.tables.has(table),
    );
    expect(missing).toEqual([]);
  });

  it("includes the two tables whose DDL lives in an ensure*Table() module", () => {
    // These were excluded while they were created lazily on first request.
    // instrumentation.ts now creates both at boot (AUDIT-013#schema-02), so a
    // database missing one has a real schema fault and health must report it
    // instead of calling the deployment healthy.
    expect(REQUIRED_TABLES).toContain("staff_invites");
    expect(REQUIRED_TABLES).toContain("admin_audit_log_archive");
  });

  it("has no duplicates", () => {
    expect(new Set(REQUIRED_TABLES).size).toBe(REQUIRED_TABLES.length);
  });
});
