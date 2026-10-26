import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * useVerifySubscription polls the checkout-verification endpoint after a
 * payment. The hook is plain React state around one fetch loop, and the
 * suite runs under `node` with no DOM, so react is replaced by a stand-in
 * that runs each hook inline. What is left is the part that can be wrong
 * without a browser: which URL the loop asks for, and what it does with the
 * answer.
 */
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => [
      typeof initial === "function" ? (initial as () => unknown)() : initial,
      vi.fn(),
    ],
    useRef: (initial: unknown) => ({ current: initial }),
    useCallback: (fn: unknown) => fn,
    useEffect: () => {},
  };
});

import { useVerifySubscription } from "@/hooks/use-verify-subscription";
import { API } from "@/lib/config/client-constants";

const okPlan = (plan: string) =>
  new Response(JSON.stringify({ success: true, data: { plan } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("useVerifySubscription", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => okPlan("pro_supporter"));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the checkout verification endpoint with the Stripe session id", async () => {
    const { startVerification } = useVerifySubscription({
      sessionId: "cs_test_123",
      autoStart: false,
    });
    startVerification();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${API.CHECKOUT_VERIFY_SUBSCRIPTION}?session_id=cs_test_123`,
    );
  });

  it("asks the bare endpoint when there is no session id", async () => {
    const { startVerification } = useVerifySubscription({ autoStart: false });
    startVerification();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe(API.CHECKOUT_VERIFY_SUBSCRIPTION);
  });

  it("encodes a session id that is not URL safe", async () => {
    const { startVerification } = useVerifySubscription({
      sessionId: "a b&c=d",
      autoStart: false,
    });
    startVerification();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${API.CHECKOUT_VERIFY_SUBSCRIPTION}?session_id=a%20b%26c%3Dd`,
    );
  });
});
