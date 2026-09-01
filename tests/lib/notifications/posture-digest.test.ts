/**
 * Tests for lib/notifications/posture-digest.ts -- the weekly/monthly
 * cross-site summary email (AUDIT-010).
 *
 * Mocked at the database boundary (pool.query), plus the settings resolver
 * (getSetting), sendNotificationEmail, and the email template builder.
 * diffFindingsByKey (lib/scanner/finding-diff.ts) runs for real, same as
 * tests/lib/scanner/regression-alert.test.ts does for the per-scan
 * regression check this module's diff logic mirrors.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Vulnerability } from "@/lib/scanner/types";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

const mockSendNotificationEmail = vi.fn();
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: (...args: unknown[]) =>
    mockSendNotificationEmail(...args),
}));

const mockPostureDigestEmail = vi.fn((..._args: unknown[]) => ({
  subject: "Posture Digest",
  text: "text",
  html: "<p>html</p>",
}));
vi.mock("@/lib/email/email", () => ({
  postureDigestEmail: (...args: unknown[]) => mockPostureDigestEmail(...args),
}));

const {
  buildDigestForUser,
  getDueDigestUsers,
  sendWeeklyDigests,
  schedulePeriodicPostureDigest,
  stopPeriodicPostureDigest,
} = await import("@/lib/notifications/posture-digest");
const { CONFIG_POSTURE_DIGEST_POLL_INTERVAL_MS } =
  await import("@/lib/config/config-values");

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

interface ScanRow {
  url: string;
  findings: Vulnerability[];
}

/** Route pool.query calls by SQL shape, same technique
 *  regression-alert.test.ts uses. `current` backs the no-cutoff query,
 *  `baseline` backs the "scanned_at <= $2" (as-of-window-start) query. */
function installQueryMock({
  current = [] as ScanRow[],
  baseline = [] as ScanRow[],
  suppressed = [] as string[],
  dueUsers = [] as {
    id: number;
    email: string;
    last_digest_sent_at: Date | null;
  }[],
} = {}) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM scan_finding_feedback")) {
      return { rows: suppressed.map((finding_id) => ({ finding_id })) };
    }
    if (sql.includes("FROM users") && sql.includes("digest_email_enabled")) {
      return { rows: dueUsers };
    }
    if (sql.includes("UPDATE users SET last_digest_sent_at")) {
      return { rows: [] };
    }
    if (sql.includes("scanned_at <= $2")) {
      return {
        rows: baseline.map((r) => ({
          url: r.url,
          findings: JSON.stringify(r.findings),
        })),
      };
    }
    if (sql.includes("FROM scan_history")) {
      return {
        rows: current.map((r) => ({
          url: r.url,
          findings: JSON.stringify(r.findings),
        })),
      };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(true);
  mockSendNotificationEmail.mockReset();
  mockSendNotificationEmail.mockResolvedValue(undefined);
  mockPostureDigestEmail.mockClear();
});

describe("buildDigestForUser", () => {
  it("returns null when the user has no completed scan of anything", async () => {
    installQueryMock({ current: [] });

    const result = await buildDigestForUser(1, new Date());

    expect(result).toBeNull();
  });

  it("flags a critical/high finding not present in the baseline as new, and counts open totals", async () => {
    const baselineFindings = [finding({ id: "a", severity: "high" })];
    const currentFindings = [
      finding({ id: "a", severity: "high" }), // unchanged
      finding({ id: "b", title: "New critical", severity: "critical" }), // new
    ];
    installQueryMock({
      current: [{ url: "https://a.com", findings: currentFindings }],
      baseline: [{ url: "https://a.com", findings: baselineFindings }],
    });

    const result = await buildDigestForUser(1, new Date());

    expect(result).not.toBeNull();
    expect(result!.siteCount).toBe(1);
    expect(result!.newFindings.map((f) => f.title)).toEqual(["New critical"]);
    expect(result!.newCriticalCount).toBe(1);
    expect(result!.newHighCount).toBe(0);
    expect(result!.currentOpenCount).toBe(2); // a (high) + b (critical)
    expect(result!.previousOpenCount).toBe(1); // a (high) only
    expect(result!.trend).toBe("up");
  });

  it("excludes a finding the user marked false_positive from both the new list and the open counts", async () => {
    const currentFindings = [
      finding({ id: "suppressed", severity: "critical" }),
    ];
    installQueryMock({
      current: [{ url: "https://a.com", findings: currentFindings }],
      baseline: [],
      suppressed: ["suppressed"],
    });

    const result = await buildDigestForUser(1, new Date());

    expect(result!.newFindings).toEqual([]);
    expect(result!.currentOpenCount).toBe(0);
  });

  it("ignores medium/low/info findings entirely", async () => {
    const currentFindings = [finding({ id: "m", severity: "medium" })];
    installQueryMock({
      current: [{ url: "https://a.com", findings: currentFindings }],
    });

    const result = await buildDigestForUser(1, new Date());

    expect(result!.newFindings).toEqual([]);
    expect(result!.currentOpenCount).toBe(0);
  });

  it("reports trend 'down' when open critical/high findings dropped since the baseline", async () => {
    installQueryMock({
      current: [{ url: "https://a.com", findings: [] }],
      baseline: [
        {
          url: "https://a.com",
          findings: [finding({ id: "a", severity: "critical" })],
        },
      ],
    });

    const result = await buildDigestForUser(1, new Date());

    expect(result!.trend).toBe("down");
    expect(result!.currentOpenCount).toBe(0);
    expect(result!.previousOpenCount).toBe(1);
  });

  it("reports trend 'flat' when nothing changed", async () => {
    installQueryMock({ current: [{ url: "https://a.com", findings: [] }] });

    const result = await buildDigestForUser(1, new Date());

    expect(result!.trend).toBe("flat");
  });

  it("aggregates across every distinct site the user has scanned", async () => {
    installQueryMock({
      current: [
        { url: "https://a.com", findings: [] },
        { url: "https://b.com", findings: [] },
        { url: "https://c.com", findings: [] },
      ],
    });

    const result = await buildDigestForUser(1, new Date());

    expect(result!.siteCount).toBe(3);
  });

  it("caps the itemized new-findings list without undercounting the real total", async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      finding({ id: `f${i}`, severity: "critical" }),
    );
    installQueryMock({ current: [{ url: "https://a.com", findings: many }] });

    const result = await buildDigestForUser(1, new Date());

    expect(result!.newFindingsTotal).toBe(20);
    expect(result!.newFindings.length).toBeLessThan(20);
    expect(result!.newFindings.length).toBeGreaterThan(0);
  });
});

describe("getDueDigestUsers", () => {
  it("queries opted-in, non-disabled users whose digest window has elapsed", async () => {
    installQueryMock({
      dueUsers: [{ id: 1, email: "a@x.com", last_digest_sent_at: null }],
    });

    const result = await getDueDigestUsers(7);

    expect(result).toHaveLength(1);
    const call = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("digest_email_enabled = true"),
    );
    expect(call).toBeDefined();
    const [sql, params] = call!;
    expect(sql).toContain("disabled_at IS NULL");
    expect(sql).toContain("last_digest_sent_at IS NULL");
    expect(params).toEqual([7]);
  });
});

describe("sendWeeklyDigests", () => {
  it("does nothing and touches no other query when POSTURE_DIGEST_ENABLED is off", async () => {
    mockGetSetting.mockResolvedValueOnce(false);

    const stats = await sendWeeklyDigests();

    expect(stats).toEqual({
      candidates: 0,
      sent: 0,
      skippedNoSites: 0,
      errors: 0,
    });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("sends a digest for a due user with completed scans, and stamps last_digest_sent_at", async () => {
    installQueryMock({
      dueUsers: [{ id: 5, email: "user@x.com", last_digest_sent_at: null }],
      current: [{ url: "https://a.com", findings: [] }],
    });

    const stats = await sendWeeklyDigests();

    expect(stats.candidates).toBe(1);
    expect(stats.sent).toBe(1);
    expect(stats.skippedNoSites).toBe(0);
    expect(mockSendNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 5,
        userEmail: "user@x.com",
        type: "posture_digest",
      }),
    );
    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE users SET last_digest_sent_at"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1][1]).toBe(5);
  });

  it("skips sending (but still stamps the timestamp) for a due user with no completed scans", async () => {
    installQueryMock({
      dueUsers: [{ id: 6, email: "empty@x.com", last_digest_sent_at: null }],
      current: [],
    });

    const stats = await sendWeeklyDigests();

    expect(stats.sent).toBe(0);
    expect(stats.skippedNoSites).toBe(1);
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE users SET last_digest_sent_at"),
    );
    expect(updateCall).toBeDefined();
  });

  it("counts a failure for one user without aborting the rest of the batch", async () => {
    installQueryMock({
      dueUsers: [
        { id: 7, email: "a@x.com", last_digest_sent_at: null },
        { id: 8, email: "b@x.com", last_digest_sent_at: null },
      ],
      current: [{ url: "https://a.com", findings: [] }],
    });
    mockSendNotificationEmail.mockRejectedValueOnce(new Error("smtp down"));

    const stats = await sendWeeklyDigests();

    expect(stats.candidates).toBe(2);
    expect(stats.errors).toBe(1);
    expect(stats.sent).toBe(1);
  });
});

describe("schedulePeriodicPostureDigest / stopPeriodicPostureDigest", () => {
  // Was `expect(timer).toBeDefined()`, which is true of any timer at any
  // interval, including a 0 ms one that would try to send the weekly digest
  // on every tick of the event loop. Assert the registration and the
  // release of the same handle instead.
  it("registers the interval it was given and clears that exact handle on stop", () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    try {
      const timer = schedulePeriodicPostureDigest(60_000);

      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][1]).toBe(60_000);
      expect(setSpy.mock.results[0].value).toBe(timer);

      stopPeriodicPostureDigest();
      expect(clearSpy).toHaveBeenCalledTimes(1);
      expect(clearSpy).toHaveBeenCalledWith(timer);

      // Idempotent, not merely non-throwing.
      stopPeriodicPostureDigest();
      expect(clearSpy).toHaveBeenCalledTimes(1);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("falls back to the shipped interval instead of registering a 0 ms timer", () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(globalThis, "setInterval");
    try {
      schedulePeriodicPostureDigest(0);
      expect(setSpy.mock.calls[0][1]).toBe(
        CONFIG_POSTURE_DIGEST_POLL_INTERVAL_MS,
      );

      setSpy.mockClear();
      schedulePeriodicPostureDigest(Number.NaN);
      expect(setSpy.mock.calls[0][1]).toBe(
        CONFIG_POSTURE_DIGEST_POLL_INTERVAL_MS,
      );
    } finally {
      stopPeriodicPostureDigest();
      setSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
