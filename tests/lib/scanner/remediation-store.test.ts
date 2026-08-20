/**
 * The core promise of the remediation feature: a status set on one scan of a
 * target is still attached when the SAME target is scanned again, because it
 * is keyed on the stable (user_id, finding_id, finding_url) identity, NOT on
 * the scan_history row id.
 *
 * Rather than hand back canned rows, the pool is backed by a tiny in-memory
 * store that filters exactly the way the real SELECT does (WHERE user_id=$1
 * AND finding_url=$2). That makes the assertions below meaningful: nothing in
 * attachRemediation ever sees a scan id, so two different scans of the same
 * URL necessarily resolve to the same remediation rows.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Vulnerability } from "@/lib/scanner/types";

interface StoreRow {
  user_id: number;
  finding_id: string;
  finding_url: string;
  status: string;
  note: string | null;
  assignee: string | null;
}

const store: StoreRow[] = [];

// Faithful stand-in for getRemediationMap's query: filter by the two bound
// params (user_id, finding_url), the only keys it selects on.
const mockQuery = vi.fn(async (_sql: string, params: unknown[]) => {
  const [userId, findingUrl] = params as [number, string];
  const rows = store.filter(
    (r) => r.user_id === userId && r.finding_url === findingUrl,
  );
  return { rows };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params: unknown[]) => mockQuery(sql, params),
  },
}));

const { attachRemediation, getRemediationMap } =
  await import("@/lib/scanner/remediation-store");

function finding(id: string): Vulnerability {
  return {
    id,
    title: "t",
    severity: "medium",
    category: "headers",
    description: "d",
    evidence: "e",
    riskImpact: "r",
    explanation: "x",
    fixSteps: [],
    codeExamples: [],
  };
}

const URL_A = "https://example.com/";
const FINDING_ID = "csp-missing--abc123";

beforeEach(() => {
  store.length = 0;
  mockQuery.mockClear();
});

describe("attachRemediation cross-rescan persistence", () => {
  it("attaches the same status to two different scans of the same target", async () => {
    // The user marked the finding "fixed" once (keyed on user+finding+url).
    store.push({
      user_id: 7,
      finding_id: FINDING_ID,
      finding_url: URL_A,
      status: "fixed",
      note: "done in 4.2",
      assignee: "alice",
    });

    // Scan #1 of the target (some scan_history row).
    const scan1 = await attachRemediation(7, URL_A, [finding(FINDING_ID)]);
    expect(scan1[0].remediation?.status).toBe("fixed");

    // Scan #2 of the SAME target: a brand new scan_history row, brand new
    // Vulnerability objects -- but the identical finding_id + url. The status
    // must carry over, proving it keyed on the finding identity, not the scan.
    const scan2 = await attachRemediation(7, URL_A, [finding(FINDING_ID)]);
    expect(scan2[0].remediation?.status).toBe("fixed");
    expect(scan2[0].remediation?.note).toBe("done in 4.2");
    expect(scan2[0].remediation?.assignee).toBe("alice");
  });

  it("does not attach another user's status (scoped by user_id)", async () => {
    store.push({
      user_id: 7,
      finding_id: FINDING_ID,
      finding_url: URL_A,
      status: "fixed",
      note: null,
      assignee: null,
    });
    const other = await attachRemediation(999, URL_A, [finding(FINDING_ID)]);
    expect(other[0].remediation).toBeUndefined();
  });

  it("only annotates findings that have a stored status", async () => {
    store.push({
      user_id: 7,
      finding_id: FINDING_ID,
      finding_url: URL_A,
      status: "accepted_risk",
      note: null,
      assignee: null,
    });
    const findings = await attachRemediation(7, URL_A, [
      finding(FINDING_ID),
      finding("other-check--zzz"),
    ]);
    expect(findings[0].remediation?.status).toBe("accepted_risk");
    expect(findings[1].remediation).toBeUndefined();
  });

  it("returns findings unchanged (no DB read) when the list is empty", async () => {
    const out = await attachRemediation(7, URL_A, []);
    expect(out).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("getRemediationMap keys the returned map by finding_id", async () => {
    store.push({
      user_id: 7,
      finding_id: FINDING_ID,
      finding_url: URL_A,
      status: "in_progress",
      note: null,
      assignee: null,
    });
    const map = await getRemediationMap(7, URL_A);
    expect(map.get(FINDING_ID)?.status).toBe("in_progress");
  });
});
