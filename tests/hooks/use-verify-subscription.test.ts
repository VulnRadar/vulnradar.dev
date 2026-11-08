// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import "../_helpers/dom";

/**
 * useVerifySubscription polls the checkout-verification endpoint after a
 * payment, and what it decides is what the customer is told about money they
 * just spent. Real React, fake clock: the poll ladder is 15 steps and 17.5
 * seconds long, and every step of it is part of the contract.
 *
 * useState is wrapped only to count setter calls. Once a component has
 * unmounted, renderHook's result stops changing whether or not the hook still
 * writes, so the count is the one thing that can see a stale write.
 */
const state = vi.hoisted(() => ({ writes: 0 }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: <T>(initial: T | (() => T)) => {
      const [value, set] = actual.useState(initial);
      return [
        value,
        (next: T) => {
          state.writes += 1;
          set(next);
        },
      ];
    },
  };
});

import { useVerifySubscription } from "@/hooks/use-verify-subscription";
import { API } from "@/lib/config/client-constants";

const LADDER_TOTAL_MS = 500 * 5 + 1000 * 5 + 2000 * 5;
const LADDER_POLLS = 15;

const okPlan = (plan: string) =>
  new Response(JSON.stringify({ success: true, data: { plan } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useVerifySubscription", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  /** Answers each poll from the list, then repeats the last entry. */
  function answers(...plans: (string | Error | Response)[]) {
    let i = 0;
    fetchMock.mockImplementation(async () => {
      const next = plans[Math.min(i++, plans.length - 1)];
      if (next instanceof Error) throw next;
      return next instanceof Response ? next.clone() : okPlan(next);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    state.writes = 0;
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("verifies on the poll that first reports a paid plan", async () => {
    answers("free", "free", "free", "pro_supporter");
    const { result } = renderHook(() => useVerifySubscription());
    expect(result.current.verifying).toBe(true);

    await advance(1_499);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.verified).toBe(false);
    expect(result.current.verifying).toBe(true);

    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current).toMatchObject({
      verified: true,
      verifying: false,
      pending: false,
      planId: "pro_supporter",
      planName: "Pro Supporter",
    });

    await advance(LADDER_TOTAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("gives up as pending after 15 polls, never as verified", async () => {
    answers("free");
    const { result } = renderHook(() => useVerifySubscription());

    await advance(LADDER_TOTAL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(LADDER_POLLS);
    expect(result.current.pending).toBe(false);
    expect(result.current.verifying).toBe(true);

    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(LADDER_POLLS);
    expect(result.current).toMatchObject({
      pending: true,
      verified: false,
      verifying: false,
      planId: null,
      planName: null,
    });
  });

  it("keeps polling past a paid plan that is not the one bought", async () => {
    answers("core_supporter", "core_supporter", "pro_supporter");
    const { result } = renderHook(() =>
      useVerifySubscription({ expectedPlanId: "pro_supporter" }),
    );

    await advance(999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.verified).toBe(false);

    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.verified).toBe(true);
    expect(result.current.planId).toBe("pro_supporter");
  });

  it("ends pending when only the wrong plan ever comes back", async () => {
    answers("core_supporter");
    const { result } = renderHook(() =>
      useVerifySubscription({ expectedPlanId: "pro_supporter" }),
    );
    await advance(LADDER_TOTAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(LADDER_POLLS);
    expect(result.current.pending).toBe(true);
    expect(result.current.verified).toBe(false);
    expect(result.current.planId).toBeNull();
  });

  it("verifies the expected plan even when that plan is free", async () => {
    answers("free");
    const { result } = renderHook(() =>
      useVerifySubscription({ expectedPlanId: "free" }),
    );
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.verified).toBe(true);
    expect(result.current.planName).toBe("Free");
  });

  it("retries through a network error and a non-OK response", async () => {
    answers(
      new Error("offline"),
      new Response("nope", { status: 502 }),
      "pro_supporter",
    );
    const { result } = renderHook(() => useVerifySubscription());
    await advance(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.verified).toBe(true);
  });

  it("treats a body with no plan as free", async () => {
    answers(
      new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
      }),
    );
    const { result } = renderHook(() => useVerifySubscription());
    await advance(LADDER_TOTAL_MS);
    expect(result.current.pending).toBe(true);
  });

  it("shows the raw id for a plan the catalog does not know", async () => {
    answers("legacy_plan");
    const { result } = renderHook(() => useVerifySubscription());
    await advance(0);
    expect(result.current.planId).toBe("legacy_plan");
    expect(result.current.planName).toBe("legacy_plan");
  });

  describe("after unmount", () => {
    it("polls no further and writes nothing when unmounted between polls", async () => {
      answers("free");
      const { unmount } = renderHook(() => useVerifySubscription());
      await advance(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      unmount();
      const writes = state.writes;
      await advance(LADDER_TOTAL_MS * 2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(state.writes).toBe(writes);
    });

    it("writes nothing when the poll in flight comes back confirmed", async () => {
      let answer!: (response: Response) => void;
      fetchMock.mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      );
      const { unmount } = renderHook(() => useVerifySubscription());
      await advance(0);

      unmount();
      const writes = state.writes;
      answer(okPlan("pro_supporter"));
      await advance(LADDER_TOTAL_MS);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(state.writes).toBe(writes);
    });

    it("does not report pending when unmounted during the last wait", async () => {
      answers("free");
      const { unmount } = renderHook(() => useVerifySubscription());
      await advance(LADDER_TOTAL_MS - 1);
      expect(fetchMock).toHaveBeenCalledTimes(LADDER_POLLS);

      unmount();
      const writes = state.writes;
      await advance(1);
      expect(state.writes).toBe(writes);
    });
  });

  describe("autoStart: false", () => {
    it("does nothing until startVerification is called", async () => {
      answers("pro_supporter");
      const { result } = renderHook(() =>
        useVerifySubscription({ autoStart: false }),
      );
      await advance(LADDER_TOTAL_MS);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.current.verifying).toBe(false);

      act(() => result.current.startVerification());
      expect(result.current.verifying).toBe(true);
      await advance(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.current.verified).toBe(true);
    });

    it("clears pending when a retry starts", async () => {
      answers("free");
      const { result } = renderHook(() =>
        useVerifySubscription({ autoStart: false }),
      );
      act(() => result.current.startVerification());
      await advance(LADDER_TOTAL_MS);
      expect(result.current.pending).toBe(true);

      act(() => result.current.startVerification());
      expect(result.current.pending).toBe(false);
      expect(result.current.verifying).toBe(true);
      await advance(LADDER_TOTAL_MS);
    });
  });

  describe("the request", () => {
    it("asks the checkout verification endpoint with the Stripe session id", async () => {
      answers("pro_supporter");
      renderHook(() => useVerifySubscription({ sessionId: "cs_test_123" }));
      await advance(0);
      expect(fetchMock.mock.calls[0][0]).toBe(
        `${API.CHECKOUT_VERIFY_SUBSCRIPTION}?session_id=cs_test_123`,
      );
    });

    it("asks the bare endpoint when there is no session id", async () => {
      answers("pro_supporter");
      renderHook(() => useVerifySubscription());
      await advance(0);
      expect(fetchMock.mock.calls[0][0]).toBe(API.CHECKOUT_VERIFY_SUBSCRIPTION);
    });

    it("encodes a session id that is not URL safe", async () => {
      answers("pro_supporter");
      renderHook(() => useVerifySubscription({ sessionId: "a b&c=d" }));
      await advance(0);
      expect(fetchMock.mock.calls[0][0]).toBe(
        `${API.CHECKOUT_VERIFY_SUBSCRIPTION}?session_id=a%20b%26c%3Dd`,
      );
    });
  });
});
