import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * useClientConfig fetches the browser-visible settings once and shares the
 * answer. The hook is React state around one request and the suite has no
 * DOM, so react is replaced by a stand-in that runs each hook inline and hands
 * the effect back to the test. What is left is the request: where it goes, and
 * that a failed one is retried by the next mount instead of being remembered as
 * "no config".
 */
const effects: Array<() => void | (() => void)> = [];

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => [initial, vi.fn()],
    useMemo: (fn: () => unknown) => fn(),
    useEffect: (fn: () => void | (() => void)) => {
      effects.push(fn);
    },
  };
});

import { API } from "@/lib/config/client-constants";

const body = { notificationPollIntervalMs: 45000 };

describe("useClientConfig request", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    effects.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function mount() {
    const mod = await import("@/lib/hooks/use-client-config");
    mod.useClientConfig();
    effects.at(-1)?.();
  }

  it("reads the config from the client-config endpoint", async () => {
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(API.CONFIG_CLIENT);
  });

  it("asks again on the next mount after a failed request", async () => {
    fetchMock = vi.fn(async () => new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    effects.at(-1)?.();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
