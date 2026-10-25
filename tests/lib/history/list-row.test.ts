import { describe, it, expect } from "vitest";
import {
  incompleteFlagSql,
  withPublicErrorMessage,
} from "@/lib/history/list-row";
import { publicScanErrorMessage } from "@/lib/api/scan-error-message";

/**
 * The shared read-boundary helpers behind GET /api/v3/history and GET
 * /api/v3/dashboard. The SQL fragment is executed against a real PostgreSQL in
 * tests/integration/list-reads.test.ts; what is pinned here is the part a
 * string comparison can honestly pin.
 *
 * Expectations are written against publicScanErrorMessage itself, not against
 * its sentences: which words a given failure maps to is that module's job and
 * its own suite's, and this one only owns "every list row goes through it".
 */
describe("withPublicErrorMessage", () => {
  it("replaces a stored string that names an internal table and a private address", () => {
    const raw =
      'relation "scan_history_partitioned" does not exist (connect ECONNREFUSED 10.0.0.5:5432)';
    const row = withPublicErrorMessage({
      id: "abc",
      status: "failed",
      error_message: raw,
    });
    expect(row.error_message).toBe(publicScanErrorMessage(raw));
    expect(row.error_message).not.toContain("10.0.0.5");
    expect(row.error_message).not.toContain("scan_history_partitioned");
  });

  it("never lets a driver message through, whatever it says", () => {
    const raw = 'duplicate key value violates unique constraint "x_pkey"';
    const row = withPublicErrorMessage({ error_message: raw });
    expect(row.error_message).toBe(publicScanErrorMessage(raw));
    expect(row.error_message).not.toContain("x_pkey");
  });

  it("keeps the 'Cancelled' passthrough the History row's state check reads", () => {
    // components/history/history-types.ts scanRowState compares the stored
    // value to "cancelled". If the sanitizer reworded it, every cancelled
    // scan would turn into "Did not finish".
    expect(withPublicErrorMessage({ error_message: "Cancelled" })).toEqual({
      error_message: "Cancelled",
    });
  });

  it("returns a row with no error_message untouched, same reference, no new key", () => {
    // publicScanErrorMessage turns a missing value into "The scan failed.",
    // which is right for a failed row and wrong for a scan that worked.
    const completed = { id: "abc", status: "completed", findings_count: 2 };
    expect(withPublicErrorMessage(completed)).toBe(completed);
    expect("error_message" in withPublicErrorMessage(completed)).toBe(false);
  });

  it("leaves an explicit null as null rather than inventing a failure", () => {
    const row = { status: "completed", error_message: null };
    expect(withPublicErrorMessage(row).error_message).toBeNull();
  });

  it("does not mutate the row it was given", () => {
    const row = { error_message: "connect ECONNREFUSED 10.0.0.5:5432" };
    withPublicErrorMessage(row);
    expect(row.error_message).toBe("connect ECONNREFUSED 10.0.0.5:5432");
  });
});

describe("incompleteFlagSql", () => {
  it("reads the incomplete array off the column it is given", () => {
    const sql = incompleteFlagSql("sh.result_meta");
    expect(sql).toContain("sh.result_meta -> 'incomplete'");
  });

  it("only calls jsonb_array_length on something that is an array", () => {
    // PostgreSQL does not promise to short-circuit AND, so the guard has to be
    // a CASE: jsonb_array_length on a scalar raises instead of returning false.
    const sql = incompleteFlagSql("result_meta");
    expect(sql).toMatch(
      /CASE WHEN jsonb_typeof\(result_meta -> 'incomplete'\) = 'array'/,
    );
    expect(sql).toContain(
      "THEN jsonb_array_length(result_meta -> 'incomplete') > 0",
    );
    expect(sql).toContain("ELSE false END");
  });
});
