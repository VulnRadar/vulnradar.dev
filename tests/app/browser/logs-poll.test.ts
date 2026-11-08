import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { NetworkRequest } from "@/lib/browserbase/client";

/**
 * The viewer's network-log poll used to be a bare setInterval: it kept
 * calling the logs endpoint while the tab was hidden, started a new request
 * while the last was still pending, and replaced the rows with an equal array
 * every time.
 */

// Run the hook's effects inline so the real useVisibleInterval can be driven in
// this node environment (no DOM library here).
const cleanups: Array<() => void> = [];
vi.mock("react", () => ({
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (fn: () => void | (() => void)) => {
    const cleanup = fn();
    if (typeof cleanup === "function") cleanups.push(cleanup);
  },
}));

import { useVisibleInterval } from "@/lib/hooks/use-visible-interval";
import {
  createLogsPoller,
  logsSignature,
  readLogs,
  type LogsOutcome,
} from "@/lib/browserbase/logs-poller";

const req = (id: string): NetworkRequest => ({
  requestId: id,
  url: `https://example.test/${id}`,
  method: "GET",
  host: "example.test",
  path: `/${id}`,
});

describe("the poll's timer", () => {
  let visibility: "visible" | "hidden";
  const listeners: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
    listeners.length = 0;
    vi.stubGlobal("document", {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: (_: string, fn: () => void) => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
    });
  });

  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const setVisibility = (v: "visible" | "hidden") => {
    visibility = v;
    for (const fn of listeners) fn();
  };

  it("stops fetching while the document is hidden", () => {
    const tick = vi.fn();
    useVisibleInterval(tick, 1000);

    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(3);

    setVisibility("hidden");
    vi.advanceTimersByTime(60_000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("catches up once when the tab comes back, then resumes", () => {
    const tick = vi.fn();
    useVisibleInterval(tick, 1000);
    setVisibility("hidden");
    vi.advanceTimersByTime(10_000);
    setVisibility("visible");
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("does not run at all when the dock is closed (null delay)", () => {
    const tick = vi.fn();
    useVisibleInterval(tick, null);
    vi.advanceTimersByTime(10_000);
    expect(tick).not.toHaveBeenCalled();
  });
});

describe("the poller", () => {
  const handlers = () => ({ onRequests: vi.fn(), onError: vi.fn() });

  it("issues one request for two ticks while a fetch is pending", async () => {
    let resolve!: (o: LogsOutcome) => void;
    const read = vi
      .fn<() => Promise<LogsOutcome>>()
      .mockImplementationOnce(
        () =>
          new Promise<LogsOutcome>((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValue({ kind: "ok", requests: [req("a")] });
    const h = handlers();
    const poller = createLogsPoller(read, h);

    const first = poller.poll();
    await poller.poll();
    expect(read).toHaveBeenCalledTimes(1);

    resolve({ kind: "ok", requests: [req("a")] });
    await first;
    expect(h.onRequests).toHaveBeenCalledTimes(1);

    await poller.poll();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("frees the guard after a failed read", async () => {
    const read = vi
      .fn<() => Promise<LogsOutcome>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ kind: "ok", requests: [req("a")] });
    const h = handlers();
    const poller = createLogsPoller(read, h);
    await expect(poller.poll()).rejects.toThrow("boom");
    await poller.poll();
    expect(read).toHaveBeenCalledTimes(2);
    expect(h.onRequests).toHaveBeenCalledTimes(1);
  });

  it("skips the state update when the length and last request id are unchanged", async () => {
    const read = vi
      .fn<() => Promise<LogsOutcome>>()
      .mockResolvedValueOnce({ kind: "ok", requests: [req("a"), req("b")] })
      .mockResolvedValueOnce({ kind: "ok", requests: [req("a"), req("b")] })
      .mockResolvedValueOnce({
        kind: "ok",
        requests: [req("a"), req("b"), req("c")],
      });
    const h = handlers();
    const poller = createLogsPoller(read, h);
    await poller.poll();
    await poller.poll();
    expect(h.onRequests).toHaveBeenCalledTimes(1);
    await poller.poll();
    expect(h.onRequests).toHaveBeenCalledTimes(2);
  });

  it("treats a changed last id at the same length as new data", () => {
    expect(logsSignature([req("a"), req("b")])).not.toBe(
      logsSignature([req("a"), req("c")]),
    );
  });

  it("writes the rows when one in flight gets its status, with the length and last id unchanged", async () => {
    const pending = [req("a"), req("b")];
    const answered = [req("a"), { ...req("b"), status: 200 }];
    const read = vi
      .fn<() => Promise<LogsOutcome>>()
      .mockResolvedValueOnce({ kind: "ok", requests: pending })
      .mockResolvedValueOnce({ kind: "ok", requests: answered });
    const h = handlers();
    const poller = createLogsPoller(read, h);
    await poller.poll();
    await poller.poll();
    expect(h.onRequests).toHaveBeenCalledTimes(2);
    expect(h.onRequests).toHaveBeenLastCalledWith(answered);
  });

  it("counts a failed row as settled", () => {
    expect(logsSignature([req("a")])).not.toBe(
      logsSignature([{ ...req("a"), failed: true }]),
    );
  });

  it("does not replace rows with an empty payload, and clears the error on success", async () => {
    const read = vi
      .fn<() => Promise<LogsOutcome>>()
      .mockResolvedValue({ kind: "ok", requests: [] });
    const h = handlers();
    await createLogsPoller(read, h).poll();
    expect(h.onRequests).not.toHaveBeenCalled();
    expect(h.onError).toHaveBeenCalledWith(null);
  });

  it("stays silent on a rate limit and reports other failures", async () => {
    const h = handlers();
    await createLogsPoller(async () => ({ kind: "rate-limited" }), h).poll();
    expect(h.onError).not.toHaveBeenCalled();
    expect(h.onRequests).not.toHaveBeenCalled();

    await createLogsPoller(
      async () => ({ kind: "error", message: "down" }),
      h,
    ).poll();
    expect(h.onError).toHaveBeenCalledWith("down");
  });

  it("ignores a result that lands after dispose", async () => {
    let resolve!: (o: LogsOutcome) => void;
    const h = handlers();
    const poller = createLogsPoller(
      () =>
        new Promise<LogsOutcome>((r) => {
          resolve = r;
        }),
      h,
    );
    const pending = poller.poll();
    poller.dispose();
    resolve({ kind: "ok", requests: [req("a")] });
    await pending;
    expect(h.onRequests).not.toHaveBeenCalled();
    await poller.poll();
  });
});

describe("readLogs", () => {
  const spy = () => vi.spyOn(console, "error").mockImplementation(() => {});
  const res = (status: number, body: unknown) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response;

  it("maps the response to an outcome", async () => {
    spy();
    expect(
      await readLogs("/x", async () => res(200, { requests: [req("a")] })),
    ).toEqual({ kind: "ok", requests: [req("a")] });
    expect(await readLogs("/x", async () => res(429, {}))).toEqual({
      kind: "rate-limited",
    });
    expect(
      await readLogs("/x", async () => res(502, { error: "Upstream down" })),
    ).toEqual({ kind: "error", message: "Upstream down" });
    expect(await readLogs("/x", async () => res(500, null))).toEqual({
      kind: "error",
      message: "The network log for this session is not available right now.",
    });
    expect(
      await readLogs("/x", async () => {
        throw new Error("offline");
      }),
    ).toEqual({
      kind: "error",
      message: "Could not reach the server for this session's network log.",
    });
  });
});

describe("the viewer page wiring", () => {
  const src = fs
    .readFileSync(
      path.resolve(__dirname, "../../../app/browser/[id]/page.tsx"),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("polls through useVisibleInterval with no hidden-tab period", () => {
    expect(src).toContain("@/lib/hooks/use-visible-interval");
    expect(src).toMatch(/useVisibleInterval\(/);
    expect(src).not.toContain("hiddenDelayMs");
    expect(src).not.toMatch(/\bsetInterval\(/);
  });

  it("goes through the poller's in-flight guard, not a bare fetch loop", () => {
    expect(src).toContain("createLogsPoller(");
    expect(src).not.toMatch(/async function fetchLogs/);
  });

  it("leaves the DELETE call on unload unchanged", () => {
    expect(src).toContain('method: "DELETE"');
    expect(src).toContain("keepalive: true");
  });
});
