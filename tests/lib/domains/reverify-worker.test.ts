/**
 * Tests for lib/domains/reverify-worker.ts: periodic re-verification of
 * already-verified domains, closing the gap where a domain that changes
 * hands keeps the original account's active-probes permission forever.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

const mockCheckDnsVerification = vi.fn();
vi.mock("@/lib/domains/verification", () => ({
  checkDnsVerification: (...args: unknown[]) =>
    mockCheckDnsVerification(...args),
}));

const mockCreateUserNotification = vi.fn();
vi.mock("@/lib/notifications/user-notifications", () => ({
  createUserNotification: (...args: unknown[]) =>
    mockCreateUserNotification(...args),
}));

const mockRecordSuccess = vi.fn();
const mockRecordFailure = vi.fn();
vi.mock("@/lib/admin/failure-escalation", () => ({
  createFailureEscalator: () => ({
    recordSuccess: mockRecordSuccess,
    recordFailure: mockRecordFailure,
  }),
}));

const {
  runDomainReverifyPass,
  schedulePeriodicDomainReverify,
  stopPeriodicDomainReverify,
} = await import("@/lib/domains/reverify-worker");
const { CONFIG_DOMAIN_REVERIFY_TICK_INTERVAL_MS } =
  await import("@/lib/config/config-values");

function settings(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    FEATURE_DOMAIN_VERIFICATION: true,
    DOMAIN_REVERIFY_ENABLED: true,
    DOMAIN_REVERIFY_INTERVAL_DAYS: 30,
    DOMAIN_REVERIFY_BATCH_SIZE: 50,
    ...overrides,
  };
  mockGetSetting.mockImplementation(async (key: string) => defaults[key]);
}

/** A due-domain row as the worker's SELECT returns it. */
function due(
  id: number,
  domain: string,
  token = `tok-${id}`,
  userId = 100 + id,
) {
  return { id, user_id: userId, domain, verification_token: token };
}

/**
 * What checkDnsVerification returns when DNS gave no answer. The real function
 * never throws, so this is the shape every resolver failure arrives in; an
 * earlier version of these tests mocked a rejection instead, which is why the
 * `failed` path looked covered while no real outage could reach it.
 */
function noAnswer(message = "DNS lookup timed out") {
  const cause = new Error(message);
  return { outcome: "lookup_error" as const, error: message, cause };
}

function updateCalls() {
  return mockQuery.mock.calls.filter(([sql]) =>
    String(sql).includes("UPDATE domains"),
  );
}

/**
 * The UPDATEs that give a domain a verdict. Every one of them writes
 * last_checked_at; the attempt-only UPDATE for a lookup that got no answer
 * deliberately does not.
 */
function verdictCalls() {
  return updateCalls().filter(([sql]) =>
    String(sql).includes("last_checked_at"),
  );
}

let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSetting.mockReset();
  mockCheckDnsVerification.mockReset();
  mockCreateUserNotification.mockReset();
  mockCreateUserNotification.mockResolvedValue(undefined);
  mockRecordSuccess.mockReset();
  mockRecordFailure.mockReset();
  settings();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runDomainReverifyPass", () => {
  it("does nothing and queries nothing when FEATURE_DOMAIN_VERIFICATION is off", async () => {
    settings({ FEATURE_DOMAIN_VERIFICATION: false });
    const stats = await runDomainReverifyPass();
    expect(stats).toEqual({
      checked: 0,
      stillVerified: 0,
      downgraded: 0,
      failed: 0,
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("does nothing and queries nothing when DOMAIN_REVERIFY_ENABLED is off", async () => {
    settings({ DOMAIN_REVERIFY_ENABLED: false });
    const stats = await runDomainReverifyPass();
    expect(stats).toEqual({
      checked: 0,
      stillVerified: 0,
      downgraded: 0,
      failed: 0,
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("selects only verified domains due for recheck, using the configured staleness window and batch size", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await runDomainReverifyPass();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'verified'");
    expect(sql).toContain("last_checked_at < NOW()");
    // The owner is needed to tell them about a downgrade.
    expect(sql).toContain("user_id");
    expect(params).toEqual([30, 50]);
  });

  it("orders the batch by when a domain was last TRIED, never tried first, then by last answer", async () => {
    // last_checked_at only moves on an answer, so ordering by it alone pinned
    // domains whose nameserver never replies at the front of every batch.
    // The row-level proof is tests/integration/domain-reverify-rotation.test.ts.
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await runDomainReverifyPass();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain(
      "ORDER BY last_attempt_at ASC NULLS FIRST, last_checked_at ASC NULLS FIRST",
    );
  });

  it("updates last_checked_at and clears last_check_error for a domain that still verifies", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [due(1, "example.com", "tok-1")],
    });
    mockCheckDnsVerification.mockResolvedValue({ outcome: "verified" });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE

    const stats = await runDomainReverifyPass();
    expect(stats).toEqual({
      checked: 1,
      stillVerified: 1,
      downgraded: 0,
      failed: 0,
    });
    expect(mockCheckDnsVerification).toHaveBeenCalledWith(
      "example.com",
      "tok-1",
    );
    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toContain("SET last_checked_at = NOW()");
    expect(updateSql).toContain("last_attempt_at = NOW()");
    expect(updateSql).toContain("last_check_error = NULL");
    expect(updateParams).toEqual([1]);
    expect(mockCreateUserNotification).not.toHaveBeenCalled();
  });

  describe("when the TXT record is gone (DNS answered)", () => {
    it("downgrades status to reverify_failed and stores the reason", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [due(2, "gone.example.com", "tok-2")],
      });
      mockCheckDnsVerification.mockResolvedValue({
        outcome: "not_found",
        error: "No matching TXT record found.",
      });
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE

      const stats = await runDomainReverifyPass();
      expect(stats).toEqual({
        checked: 1,
        stillVerified: 0,
        downgraded: 1,
        failed: 0,
      });
      const [updateSql, updateParams] = mockQuery.mock.calls[1];
      expect(updateSql).toContain("status = 'reverify_failed'");
      expect(updateSql).toContain("last_attempt_at = NOW()");
      expect(updateParams).toEqual([2, "No matching TXT record found."]);
    });

    it("logs the downgrade at error level with the ids that identify it", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [due(2, "gone.example.com", "tok-2", 77)],
      });
      mockCheckDnsVerification.mockResolvedValue({
        outcome: "not_found",
        error: "No matching TXT record found.",
      });
      mockQuery.mockResolvedValue({ rows: [] });

      await runDomainReverifyPass();

      // console.error, not log: only an error is persisted to the admin Error
      // Logs, and this is the one place the downgrade is on record.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, ctx] = errorSpy.mock.calls[0];
      expect(message).toBe(
        "[domain-reverify] verified domain no longer resolves its verification record, downgraded to reverify_failed",
      );
      expect(ctx).toEqual({
        domainId: 2,
        userId: 77,
        domain: "gone.example.com",
        reason: "No matching TXT record found.",
      });
    });

    it("tells the domain's owner through the bell", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [due(2, "gone.example.com", "tok-2", 77)],
      });
      mockCheckDnsVerification.mockResolvedValue({
        outcome: "not_found",
        error: "No matching TXT record found.",
      });
      mockQuery.mockResolvedValue({ rows: [] });

      await runDomainReverifyPass();

      expect(mockCreateUserNotification).toHaveBeenCalledTimes(1);
      const input = mockCreateUserNotification.mock.calls[0][0];
      expect(input).toMatchObject({
        userId: 77,
        type: "domain_reverify_failed",
        relatedType: "domain",
        relatedId: 2,
      });
      expect(input.message).toContain("gone.example.com");
      expect(input.actionUrl).toMatch(/\/attack-surface$/);
    });

    it("finishes the pass when the notification cannot be written", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [due(1, "a.example.com"), due(2, "b.example.com")],
      });
      mockCheckDnsVerification
        .mockResolvedValueOnce({ outcome: "not_found", error: "gone" })
        .mockResolvedValueOnce({ outcome: "verified" });
      mockQuery.mockResolvedValue({ rows: [] });
      mockCreateUserNotification.mockRejectedValueOnce(new Error("db down"));

      const stats = await runDomainReverifyPass();

      expect(stats).toEqual({
        checked: 2,
        stillVerified: 1,
        downgraded: 1,
        failed: 0,
      });
      // The downgrade itself is still written, and the failure is logged with
      // the Error so it keeps a stack.
      expect(updateCalls().length).toBe(2);
      expect(
        errorSpy.mock.calls.some(
          ([message, , err]) =>
            message ===
              "[domain-reverify] could not notify the owner of the downgrade" &&
            err instanceof Error,
        ),
      ).toBe(true);
    });
  });

  describe("when DNS did not answer (lookup_error)", () => {
    it("leaves the verdict alone and only records the attempt: no downgrade, no notification", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [due(1, "flaky.example.com")],
      });
      mockCheckDnsVerification.mockResolvedValue(noAnswer());

      const stats = await runDomainReverifyPass();

      expect(stats).toEqual({
        checked: 1,
        stillVerified: 0,
        downgraded: 0,
        failed: 1,
      });
      // Not last_checked_at and not status: the domain stays due and keeps its
      // permission, since silence is not a verdict.
      expect(verdictCalls()).toHaveLength(0);
      // What moves is last_attempt_at, so the domain goes to the back of the
      // batch order instead of pinning the front of it forever.
      const attempts = updateCalls();
      expect(attempts).toHaveLength(1);
      const [sql, params] = attempts[0];
      expect(sql).toContain("SET last_attempt_at = NOW()");
      expect(sql).not.toContain("status");
      expect(params).toEqual([1]);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockCreateUserNotification).not.toHaveBeenCalled();
    });

    it("logs the resolver error itself, with the domain's ids", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [due(1, "flaky.example.com", "tok-1", 9)],
      });
      const result = noAnswer("queryTxt ESERVFAIL");
      mockCheckDnsVerification.mockResolvedValue(result);

      await runDomainReverifyPass();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, ctx, err] = errorSpy.mock.calls[0];
      expect(message).toBe(
        "[domain-reverify] DNS lookup got no answer, domain left unchanged this tick",
      );
      expect(ctx).toEqual({
        domainId: 1,
        userId: 9,
        domain: "flaky.example.com",
      });
      // The original Error, so the captured row keeps its stack.
      expect(err).toBe(result.cause);
    });

    it("keeps checking the remaining domains and still resolves the others", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [due(1, "flaky.com"), due(2, "fine.com"), due(3, "gone.com")],
      });
      mockCheckDnsVerification
        .mockResolvedValueOnce(noAnswer())
        .mockResolvedValueOnce({ outcome: "verified" })
        .mockResolvedValueOnce({ outcome: "not_found", error: "gone" });
      mockQuery.mockResolvedValue({ rows: [] });

      const stats = await runDomainReverifyPass();

      // `failed` is how the timer tells a pass that reached no verdict apart
      // from a pass that had nothing to do.
      expect(stats).toEqual({
        checked: 3,
        stillVerified: 1,
        downgraded: 1,
        failed: 1,
      });
      // Every domain is touched once (the flaky one only for its attempt), but
      // only the two that got an answer receive a verdict.
      expect(updateCalls().map(([, params]) => params[0])).toEqual([1, 2, 3]);
      expect(verdictCalls().map(([, params]) => params[0])).toEqual([2, 3]);
    });

    it("downgrades nothing when the resolver is down for the whole batch", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [due(1, "a.com"), due(2, "b.com"), due(3, "c.com")],
      });
      mockCheckDnsVerification.mockResolvedValue(noAnswer());

      const stats = await runDomainReverifyPass();

      expect(stats).toEqual({
        checked: 3,
        stillVerified: 0,
        downgraded: 0,
        failed: 3,
      });
      expect(verdictCalls()).toHaveLength(0);
      // All three are marked tried, so the next pass starts with whatever
      // this one did not reach.
      expect(updateCalls().map(([, params]) => params[0])).toEqual([1, 2, 3]);
    });
  });

  it("processes multiple due domains independently, some verified and some not", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [due(1, "still-good.com"), due(2, "lost-it.com")],
    });
    mockCheckDnsVerification
      .mockResolvedValueOnce({ outcome: "verified" })
      .mockResolvedValueOnce({ outcome: "not_found", error: "gone" });
    mockQuery.mockResolvedValue({ rows: [] }); // both UPDATEs

    const stats = await runDomainReverifyPass();
    expect(stats).toEqual({
      checked: 2,
      stillVerified: 1,
      downgraded: 1,
      failed: 0,
    });
  });

  it("returns zero stats when no domains are due", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const stats = await runDomainReverifyPass();
    expect(stats).toEqual({
      checked: 0,
      stillVerified: 0,
      downgraded: 0,
      failed: 0,
    });
    expect(mockCheckDnsVerification).not.toHaveBeenCalled();
  });
});

describe("schedulePeriodicDomainReverify / stopPeriodicDomainReverify", () => {
  // `expect(timer).toBeDefined()` was the whole assertion, and a
  // `setInterval(fn, 0)` satisfies it just as well as the right one. What
  // matters is the interval actually registered and that stop releases that
  // same handle rather than leaving a tick running past shutdown.
  it("registers the interval it was given and clears that exact handle on stop", () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    try {
      const timer = schedulePeriodicDomainReverify(60_000);

      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][1]).toBe(60_000);
      expect(setSpy.mock.results[0].value).toBe(timer);

      stopPeriodicDomainReverify();
      expect(clearSpy).toHaveBeenCalledTimes(1);
      expect(clearSpy).toHaveBeenCalledWith(timer);

      // Idempotent, not merely non-throwing.
      stopPeriodicDomainReverify();
      expect(clearSpy).toHaveBeenCalledTimes(1);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  // The escalator is the only thing that ever pages anyone about this worker,
  // and the loop moves past per-domain failures, so a pass that reached no
  // verdict at all used to be reported as healthy: the streak reset on every
  // tick and the alert could never fire however long DNS had been broken. The
  // real checkDnsVerification reports an outage as a lookup_error result and
  // never rejects, so that is what these feed it.
  it("records a failed pass when every domain due for a recheck got no DNS answer", async () => {
    vi.useFakeTimers();
    try {
      mockQuery.mockResolvedValueOnce({
        rows: [due(1, "a.example.com"), due(2, "b.example.com")],
      });
      mockCheckDnsVerification.mockResolvedValue(noAnswer());

      schedulePeriodicDomainReverify(60_000);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(mockRecordFailure).toHaveBeenCalledTimes(1);
      expect(mockRecordSuccess).not.toHaveBeenCalled();
      // And the outage did not strip anyone's permission on the way.
      expect(verdictCalls()).toHaveLength(0);
    } finally {
      stopPeriodicDomainReverify();
      vi.useRealTimers();
    }
  });

  it("records a successful pass when at least one domain reached a verdict", async () => {
    vi.useFakeTimers();
    try {
      mockQuery.mockResolvedValueOnce({
        rows: [due(1, "a.example.com"), due(2, "b.example.com")],
      });
      mockCheckDnsVerification
        .mockResolvedValueOnce(noAnswer())
        .mockResolvedValueOnce({ outcome: "verified" });
      mockQuery.mockResolvedValue({ rows: [] });

      schedulePeriodicDomainReverify(60_000);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(mockRecordSuccess).toHaveBeenCalledTimes(1);
      expect(mockRecordFailure).not.toHaveBeenCalled();
    } finally {
      stopPeriodicDomainReverify();
      vi.useRealTimers();
    }
  });

  it("records a successful pass when every domain reached a downgrade verdict", async () => {
    // A domain that changed hands is a verdict, not a failure of the worker.
    vi.useFakeTimers();
    try {
      mockQuery.mockResolvedValueOnce({
        rows: [due(1, "a.example.com")],
      });
      mockCheckDnsVerification.mockResolvedValue({
        outcome: "not_found",
        error: "gone",
      });
      mockQuery.mockResolvedValue({ rows: [] });

      schedulePeriodicDomainReverify(60_000);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(mockRecordSuccess).toHaveBeenCalledTimes(1);
      expect(mockRecordFailure).not.toHaveBeenCalled();
    } finally {
      stopPeriodicDomainReverify();
      vi.useRealTimers();
    }
  });

  it("records a successful pass when nothing was due, rather than an empty failure", async () => {
    vi.useFakeTimers();
    try {
      mockQuery.mockResolvedValue({ rows: [] });

      schedulePeriodicDomainReverify(60_000);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(mockRecordSuccess).toHaveBeenCalledTimes(1);
      expect(mockRecordFailure).not.toHaveBeenCalled();
    } finally {
      stopPeriodicDomainReverify();
      vi.useRealTimers();
    }
  });

  it("falls back to the shipped interval instead of registering a 0 ms timer", () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(globalThis, "setInterval");
    try {
      schedulePeriodicDomainReverify(0);
      expect(setSpy.mock.calls[0][1]).toBe(
        CONFIG_DOMAIN_REVERIFY_TICK_INTERVAL_MS,
      );

      setSpy.mockClear();
      schedulePeriodicDomainReverify(Number.NaN);
      expect(setSpy.mock.calls[0][1]).toBe(
        CONFIG_DOMAIN_REVERIFY_TICK_INTERVAL_MS,
      );
    } finally {
      stopPeriodicDomainReverify();
      setSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
