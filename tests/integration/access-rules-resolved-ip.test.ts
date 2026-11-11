import { it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pool from "@/lib/database/db";
import {
  checkAccessRules,
  clearAccessRulesCache,
} from "@/lib/scanner/access-rules";
import { describeIntegration, unique } from "./_db";

/**
 * ip rules against the addresses a hostname resolves to, with the rule table
 * in a real Postgres (gap-domain-verification-active-gating-2).
 *
 * The unit suite fakes pool.query, so it cannot tell whether the query really
 * returns the active ip rules for a hostname target, or whether a malformed
 * rule value breaks the statement. Both are what Postgres decides. A rule
 * value nobody validated (the admin form does not) must not refuse every scan
 * on the deployment, which is what a `value::inet` cast in the WHERE clause
 * would do the moment ip rules applied to hostnames.
 *
 * The addresses are passed in rather than resolved, so nothing here depends on
 * DNS; the rules use documentation ranges no other suite scans.
 */
const RANGE = "203.0.113.0/24";
const MALFORMED = unique("not-an-address");
const EXPIRED = "198.51.100.0/24";

async function removeRules(): Promise<void> {
  await pool.query(
    `DELETE FROM access_rules
      WHERE rule_type = 'blacklist' AND value_type = 'ip'
        AND value = ANY($1::text[])`,
    [[RANGE, MALFORMED, EXPIRED]],
  );
}

describeIntegration("ip rules match what a hostname resolves to", () => {
  beforeAll(async () => {
    await removeRules();
    await pool.query(
      `INSERT INTO access_rules (rule_type, value_type, value, reason, expires_at)
       VALUES ('blacklist', 'ip', $1, 'complainant range', NULL),
              ('blacklist', 'ip', $2, NULL, NULL),
              ('blacklist', 'ip', $3, NULL, NOW() - INTERVAL '1 day')`,
      [RANGE, MALFORMED, EXPIRED],
    );
  });

  afterAll(async () => {
    await removeRules();
    clearAccessRulesCache();
  });

  beforeEach(() => {
    clearAccessRulesCache();
  });

  it("blocks a hostname that resolves into a blocked range", async () => {
    const result = await checkAccessRules("https://a.example/", {
      resolvedAddresses: ["203.0.113.7"],
    });

    expect(result.allowed).toBe(false);
    expect(result.matchedValue).toBe(RANGE);
    expect(result.reason).toBe("complainant range");
  });

  it("allows the same hostname resolving outside every range, malformed rule and all", async () => {
    const result = await checkAccessRules("https://a.example/", {
      resolvedAddresses: ["192.0.2.10"],
    });

    expect(result.allowed).toBe(true);
  });

  it("ignores an expired ip rule", async () => {
    const result = await checkAccessRules("https://b.example/", {
      resolvedAddresses: ["198.51.100.4"],
    });

    expect(result.allowed).toBe(true);
  });

  it("still blocks an IP literal target in the range", async () => {
    const result = await checkAccessRules("http://203.0.113.9/");

    expect(result.allowed).toBe(false);
  });

  it("counts the hit against the rule that matched", async () => {
    const before = await pool.query<{ hit_count: number }>(
      `SELECT hit_count FROM access_rules
        WHERE rule_type = 'blacklist' AND value_type = 'ip' AND value = $1`,
      [RANGE],
    );

    await checkAccessRules("https://c.example/", {
      resolvedAddresses: ["203.0.113.50"],
    });
    // recordBlacklistHit is fire-and-forget; give it its round trip.
    await new Promise((r) => setTimeout(r, 200));

    const after = await pool.query<{ hit_count: number }>(
      `SELECT hit_count FROM access_rules
        WHERE rule_type = 'blacklist' AND value_type = 'ip' AND value = $1`,
      [RANGE],
    );
    expect(after.rows[0].hit_count).toBe(before.rows[0].hit_count + 1);
  });
});
