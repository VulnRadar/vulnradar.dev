/**
 * Tests for lib/admin/failure-escalation.ts: the consecutive-failure
 * tracker behind the background workers' (cleanup, scheduled-scans,
 * posture-digest) admin alert escalation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSendAdminAlert = vi.fn();
vi.mock("@/lib/admin/alert-webhook", () => ({
  sendAdminAlert: (...args: unknown[]) => mockSendAdminAlert(...args),
}));

// The escalator persists its streak best-effort; an empty result means "no
// stored state", so the in-memory behavior these tests assert is unchanged.
const mockDbQuery = vi.fn(async (..._args: unknown[]) => ({
  rows: [],
  rowCount: 0,
}));
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockDbQuery(...args) },
}));

import { createFailureEscalator } from "@/lib/admin/failure-escalation";

beforeEach(() => {
  mockSendAdminAlert.mockReset();
  mockDbQuery.mockClear();
});

describe("createFailureEscalator", () => {
  it("does not alert on failures below the threshold", () => {
    const escalator = createFailureEscalator("test_worker_failing", 3);
    escalator.recordFailure("failed once");
    escalator.recordFailure("failed twice");
    expect(mockSendAdminAlert).not.toHaveBeenCalled();
  });

  it("keeps trying when the alert was not delivered", async () => {
    // The defect this covers: the flag was set and persisted BEFORE the send,
    // and the send result was discarded with a void. sendAdminAlert reports
    // delivered:false for a typo'd webhook URL, a revoked one, an SSRF
    // refusal or an HTTP 500, so the first transient failure at exactly the
    // moment the threshold was crossed disarmed alerting for the rest of the
    // outage: only a later success reset it, and a worker in an outage
    // produces no successes.
    mockSendAdminAlert.mockResolvedValue({
      delivered: false,
      reason: "webhook returned 500",
    });
    const escalator = createFailureEscalator("test_worker_undelivered", 2);
    escalator.recordFailure("1");
    escalator.recordFailure("2");
    await Promise.resolve();
    await Promise.resolve();
    escalator.recordFailure("3");
    await Promise.resolve();
    await Promise.resolve();
    expect(mockSendAdminAlert.mock.calls.length).toBeGreaterThan(1);
  });

  it("alerts exactly once when the streak reaches the threshold, not again on further failures", async () => {
    // The send is awaited internally now, so the flag that suppresses
    // repeats is only set once delivery has come back successful. The mock
    // therefore has to report a delivery; before, it returned undefined and
    // the escalator correctly read that as "not delivered, try again".
    mockSendAdminAlert.mockResolvedValue({ delivered: true, status: 204 });
    const escalator = createFailureEscalator("test_worker_failing", 3);
    escalator.recordFailure("1");
    escalator.recordFailure("2");
    escalator.recordFailure("3");
    await Promise.resolve();
    await Promise.resolve();
    escalator.recordFailure("4");
    escalator.recordFailure("5");
    expect(mockSendAdminAlert).toHaveBeenCalledTimes(1);
    expect(mockSendAdminAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "test_worker_failing",
        severity: "warning",
        message: expect.stringContaining("failed 3 times in a row"),
      }),
    );
  });

  it("re-alerts after a success resets the streak and it fails again", () => {
    const escalator = createFailureEscalator("test_worker_failing", 3);
    escalator.recordFailure("1");
    escalator.recordFailure("2");
    escalator.recordFailure("3");
    expect(mockSendAdminAlert).toHaveBeenCalledTimes(1);

    escalator.recordSuccess();
    escalator.recordFailure("1");
    escalator.recordFailure("2");
    expect(mockSendAdminAlert).toHaveBeenCalledTimes(1); // still below threshold again
    escalator.recordFailure("3");
    expect(mockSendAdminAlert).toHaveBeenCalledTimes(2);
  });

  it("a single success between failures resets the count instead of accumulating across gaps", () => {
    const escalator = createFailureEscalator("test_worker_failing", 3);
    escalator.recordFailure("1");
    escalator.recordFailure("2");
    escalator.recordSuccess();
    escalator.recordFailure("1");
    escalator.recordFailure("2");
    expect(mockSendAdminAlert).not.toHaveBeenCalled();
  });
});

/**
 * What the Admin health view reads back. updated_at alone could not tell a
 * worker that recovered an hour ago from one that has not ticked since, so
 * each tick also records when it last worked, when it last broke and how.
 * These pin which columns each outcome moves, because a success that wiped
 * last_error or an alert that bumped last_failure_at would make the panel lie.
 */
describe("createFailureEscalator: what is persisted", () => {
  const writes = () =>
    mockDbQuery.mock.calls
      .map((c) => c as unknown as [string, unknown[]])
      .filter(([sql]) =>
        String(sql).includes("INSERT INTO worker_failure_state"),
      );

  it("records the time of a success and leaves the failure history alone", () => {
    const escalator = createFailureEscalator("persist_success", 3);
    escalator.recordSuccess();

    const [sql, params] = writes()[0];
    expect(sql).toContain("last_success_at = NOW()");
    expect(sql).not.toContain("last_failure_at");
    expect(sql).not.toContain("last_error");
    expect(params).toEqual(["persist_success", 0, false]);
  });

  it("records the time and the reason of a failure", () => {
    const escalator = createFailureEscalator("persist_failure", 3);
    escalator.recordFailure("The worker could not reach the database");

    const [sql, params] = writes()[0];
    expect(sql).toContain("last_failure_at = NOW()");
    expect(sql).toContain("last_error = EXCLUDED.last_error");
    expect(sql).not.toContain("last_success_at");
    expect(params).toEqual([
      "persist_failure",
      1,
      false,
      "The worker could not reach the database",
    ]);
  });

  it("keeps a runaway reason to a bounded length", () => {
    const escalator = createFailureEscalator("persist_long", 3);
    escalator.recordFailure("x".repeat(5000));

    const params = writes()[0][1];
    expect(String(params[3]).length).toBe(1000);
  });

  it("does not treat a delivered alert as a fresh failure", async () => {
    mockSendAdminAlert.mockResolvedValue({ delivered: true, status: 204 });
    const escalator = createFailureEscalator("persist_alerted", 1);
    escalator.recordFailure("down");
    await vi.waitFor(() => expect(writes()).toHaveLength(2));

    const all = writes();
    // First: the failure itself, with its timestamp and reason.
    expect(all[0][0]).toContain("last_failure_at");
    // Second: only the flag moves. Re-stamping last_failure_at here would make
    // the panel read the alert going out as the worker failing again.
    expect(all[1][0]).not.toContain("last_failure_at");
    expect(all[1][0]).not.toContain("last_error");
    expect(all[1][1]).toEqual(["persist_alerted", 1, true]);
  });
});
