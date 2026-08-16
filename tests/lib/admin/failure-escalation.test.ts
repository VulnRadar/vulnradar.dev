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

import { createFailureEscalator } from "@/lib/admin/failure-escalation";

beforeEach(() => {
  mockSendAdminAlert.mockReset();
});

describe("createFailureEscalator", () => {
  it("does not alert on failures below the threshold", () => {
    const escalator = createFailureEscalator("test_worker_failing", 3);
    escalator.recordFailure("failed once");
    escalator.recordFailure("failed twice");
    expect(mockSendAdminAlert).not.toHaveBeenCalled();
  });

  it("alerts exactly once when the streak reaches the threshold, not again on further failures", () => {
    const escalator = createFailureEscalator("test_worker_failing", 3);
    escalator.recordFailure("1");
    escalator.recordFailure("2");
    escalator.recordFailure("3");
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
