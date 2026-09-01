/**
 * Tests for lib/scanner/regression-alert.ts -- the diff that decides
 * whether execute-scan.ts / execute-crawl-scan.ts should send the
 * critical/high findings email.
 *
 * Before this module existed, that email fired on every single run where
 * summary.critical > 0 || summary.high > 0, with no comparison against the
 * previous scan -- a persistent finding on an hourly schedule would
 * re-alert every hour forever. This suite proves: a genuinely new
 * critical/high finding triggers the alert; a repeat of one already seen
 * does not; a finding marked false_positive is excluded from both "new"
 * and "still outstanding"; and the first scan ever for a URL (no previous
 * row) treats every current critical/high finding as new.
 *
 * Mocked at the database boundary (pool.query); the diff logic itself
 * (lib/scanner/finding-diff.ts) runs for real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Vulnerability } from "@/lib/scanner/types";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { checkForNewCriticalOrHighFindings } =
  await import("@/lib/scanner/regression-alert");

function finding(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: "check--urlhash",
    title: "Some finding",
    severity: "high",
    category: "headers",
    description: "d",
    evidence: "e",
    riskImpact: "r",
    explanation: "x",
    fixSteps: [],
    codeExamples: [],
    ...overrides,
  };
}

/** Route calls by SQL shape: scan_history lookup vs. feedback lookup. */
function installQueryMock({
  previousFindings = null as Vulnerability[] | null,
  suppressedFindingIds = [] as string[],
} = {}) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM scan_history")) {
      return {
        rows:
          previousFindings === null
            ? []
            : [{ findings: JSON.stringify(previousFindings) }],
      };
    }
    if (sql.includes("FROM scan_finding_feedback")) {
      return {
        rows: suppressedFindingIds.map((finding_id) => ({ finding_id })),
      };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe("checkForNewCriticalOrHighFindings", () => {
  it("flags a critical/high finding not present in the previous scan as new", async () => {
    const previous = [finding({ id: "old--x", severity: "high" })];
    installQueryMock({ previousFindings: previous });

    const current = [
      finding({ id: "old--x", severity: "high" }), // unchanged
      finding({ id: "new--x", title: "New issue", severity: "critical" }),
    ];

    const result = await checkForNewCriticalOrHighFindings({
      userId: 1,
      url: "https://example.com",
      scanId: 99,
      currentFindings: current,
    });

    expect(result.hasNewCriticalOrHigh).toBe(true);
    expect(result.newFindings.map((f) => f.id)).toEqual(["new--x"]);
    expect(result.outstandingFindings.map((f) => f.id)).toEqual(["old--x"]);
  });

  it("does not re-alert for a finding that persisted unchanged from the previous scan", async () => {
    const persistent = finding({ id: "persistent--x", severity: "high" });
    installQueryMock({ previousFindings: [persistent] });

    const result = await checkForNewCriticalOrHighFindings({
      userId: 1,
      url: "https://example.com",
      scanId: 99,
      currentFindings: [persistent],
    });

    // This is the core regression this module fixes: a persistent finding
    // must not re-trigger the alert on every subsequent scan.
    expect(result.hasNewCriticalOrHigh).toBe(false);
    expect(result.newFindings).toEqual([]);
    expect(result.outstandingFindings.map((f) => f.id)).toEqual([
      "persistent--x",
    ]);
  });

  it("ignores medium/low/info findings even when new", async () => {
    installQueryMock({ previousFindings: [] });

    const result = await checkForNewCriticalOrHighFindings({
      userId: 1,
      url: "https://example.com",
      scanId: 99,
      currentFindings: [
        finding({ id: "med--x", severity: "medium" }),
        finding({ id: "low--x", severity: "low" }),
        finding({ id: "info--x", severity: "info" }),
      ],
    });

    expect(result.hasNewCriticalOrHigh).toBe(false);
    expect(result.newFindings).toEqual([]);
  });

  it("treats every current critical/high finding as new on the first scan ever (no previous row)", async () => {
    installQueryMock({ previousFindings: null });

    const result = await checkForNewCriticalOrHighFindings({
      userId: 1,
      url: "https://example.com",
      scanId: 1,
      currentFindings: [finding({ id: "first--x", severity: "critical" })],
    });

    expect(result.hasNewCriticalOrHigh).toBe(true);
    expect(result.newFindings.map((f) => f.id)).toEqual(["first--x"]);
  });

  it("excludes a finding marked false_positive from 'new', even though it never appeared before", async () => {
    installQueryMock({
      previousFindings: [],
      suppressedFindingIds: ["suppressed--x"],
    });

    const result = await checkForNewCriticalOrHighFindings({
      userId: 1,
      url: "https://example.com",
      scanId: 1,
      currentFindings: [
        finding({ id: "suppressed--x", severity: "critical" }),
        finding({ id: "real--x", severity: "critical" }),
      ],
    });

    expect(result.hasNewCriticalOrHigh).toBe(true);
    expect(result.newFindings.map((f) => f.id)).toEqual(["real--x"]);
  });

  it("excludes a finding marked false_positive from 'still outstanding' too", async () => {
    const suppressed = finding({ id: "suppressed--x", severity: "high" });
    installQueryMock({
      previousFindings: [suppressed],
      suppressedFindingIds: ["suppressed--x"],
    });

    const result = await checkForNewCriticalOrHighFindings({
      userId: 1,
      url: "https://example.com",
      scanId: 1,
      currentFindings: [suppressed],
    });

    expect(result.hasNewCriticalOrHigh).toBe(false);
    expect(result.outstandingFindings).toEqual([]);
  });

  // ── Severity escalation (AUDIT-009#regression-01) ───────────────────────
  //
  // The finding id is <checkId>--<urlHash> with no severity component, and
  // several checks pick their severity per run. An id-only diff therefore
  // filed a finding that climbed from medium to high under "unchanged" and
  // never alerted, which is exactly the event the feature exists to report.

  it("treats a finding that escalated into high since the last scan as new", async () => {
    const before = finding({ id: "cookie--x", severity: "medium" });
    const after = finding({ id: "cookie--x", severity: "high" });
    installQueryMock({ previousFindings: [before] });

    const result = await checkForNewCriticalOrHighFindings({
      userId: 1,
      url: "https://example.com",
      scanId: 2,
      currentFindings: [after],
    });

    expect(result.hasNewCriticalOrHigh).toBe(true);
    expect(result.newFindings.map((f) => f.id)).toEqual(["cookie--x"]);
    // Reported once, as new -- not also as "still outstanding".
    expect(result.outstandingFindings).toEqual([]);
  });

  it("does not re-alert a finding that was already high last scan", async () => {
    const same = finding({ id: "cookie--x", severity: "high" });
    installQueryMock({ previousFindings: [same] });

    const result = await checkForNewCriticalOrHighFindings({
      userId: 1,
      url: "https://example.com",
      scanId: 2,
      currentFindings: [same],
    });

    expect(result.hasNewCriticalOrHigh).toBe(false);
    expect(result.outstandingFindings.map((f) => f.id)).toEqual(["cookie--x"]);
  });

  it("does not alert on a finding that dropped out of critical/high", async () => {
    installQueryMock({
      previousFindings: [finding({ id: "cookie--x", severity: "high" })],
    });

    const result = await checkForNewCriticalOrHighFindings({
      userId: 1,
      url: "https://example.com",
      scanId: 2,
      currentFindings: [finding({ id: "cookie--x", severity: "medium" })],
    });

    expect(result.hasNewCriticalOrHigh).toBe(false);
    expect(result.newFindings).toEqual([]);
  });

  it("keeps an escalated finding suppressed when the user marked it a false positive", async () => {
    installQueryMock({
      previousFindings: [finding({ id: "cookie--x", severity: "medium" })],
      suppressedFindingIds: ["cookie--x"],
    });

    const result = await checkForNewCriticalOrHighFindings({
      userId: 1,
      url: "https://example.com",
      scanId: 2,
      currentFindings: [finding({ id: "cookie--x", severity: "high" })],
    });

    expect(result.hasNewCriticalOrHigh).toBe(false);
    expect(result.newFindings).toEqual([]);
    expect(result.outstandingFindings).toEqual([]);
  });

  it("scopes the previous-scan lookup to the same user, URL, and status='completed', excluding the current scan id", async () => {
    installQueryMock({ previousFindings: [] });

    await checkForNewCriticalOrHighFindings({
      userId: 7,
      url: "https://example.com/",
      scanId: 42,
      currentFindings: [],
    });

    const call = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("FROM scan_history"),
    );
    expect(call).toBeDefined();
    const [sql, params] = call!;
    expect(sql).toContain("status = 'completed'");
    expect(sql).toContain("id != $3");
    expect(params).toEqual([7, "https://example.com/", 42]);
  });
});
