import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The viewer stops polling the logs route while its tab is hidden, so "nobody
 * has polled for a while" no longer means the viewer is gone. A capture reaped
 * in that gap closes its CDP socket and comes back empty, which drops every
 * row the panel had already shown.
 */

const close = vi.fn();
const handlers = new Map<string, (params: Record<string, unknown>) => void>();

vi.mock("@/lib/browserbase/client", () => ({
  getBrowserSession: async () => ({ connectUrl: "wss://example.test/cdp" }),
  openCdpPageSession: async () => ({
    send: async () => ({}),
    on: (method: string, fn: (params: Record<string, unknown>) => void) =>
      handlers.set(method, fn),
    close,
  }),
}));

const MINUTE = 60_000;

async function startedCapture(id: string) {
  const { getLiveNetworkRequests } =
    await import("@/lib/browserbase/network-capture");
  await getLiveNetworkRequests(id);
  await vi.advanceTimersByTimeAsync(0);
  return getLiveNetworkRequests;
}

function sendAndComplete(requestId: string) {
  handlers.get("Network.requestWillBeSent")!({
    requestId,
    timestamp: 1,
    request: { url: `https://example.test/${requestId}`, method: "GET" },
  });
  handlers.get("Network.responseReceived")!({
    requestId,
    response: { status: 200, mimeType: "text/html" },
  });
}

describe("the live capture's idle reaper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    close.mockClear();
    handlers.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the buffer through a hidden tab as long as a session can last", async () => {
    const getLive = await startedCapture("hidden");
    sendAndComplete("a");

    await vi.advanceTimersByTimeAsync(5 * MINUTE);

    expect(close).not.toHaveBeenCalled();
    const rows = await getLive("hidden");
    expect(rows.map((r) => r.requestId)).toEqual(["a"]);
  });

  it("still closes a capture whose viewer never came back", async () => {
    await startedCapture("abandoned");

    await vi.advanceTimersByTimeAsync(8 * MINUTE);

    expect(close).toHaveBeenCalledTimes(1);
  });
});
