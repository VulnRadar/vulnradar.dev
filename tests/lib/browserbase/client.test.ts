/**
 * Tests for the BrowserBase REST client.
 *
 * BrowserBase is a paid third party billed by session-seconds and the credit
 * ledger charges the user for it, so the two calls that cost money if they
 * misbehave are createBrowserSession (which MUST send keepAlive so the
 * session survives a CDP disconnect) and endBrowserSession (which MUST issue
 * the release, or the session keeps billing until its TTL expires). Neither
 * was exercised at all before this file existed (AUDIT-013#cov-12).
 *
 * The HTTP boundary is the only thing mocked: everything else, including the
 * URL shapes and the request bodies, is the real code.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

const {
  createBrowserSession,
  getBrowserSession,
  getBrowserLiveUrls,
  endBrowserSession,
  getBrowserSessionLogs,
  pickLiveViewerUrl,
  isBrowserBaseConfigured,
  parseNetworkRequests,
  BrowserBaseError,
} = await import("@/lib/browserbase/client");

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  process.env.BROWSERBASE_API_KEY = "bb_test_key";
  process.env.BROWSERBASE_PROJECT_ID = "proj_test";
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(300);
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  delete process.env.BROWSERBASE_API_KEY;
  delete process.env.BROWSERBASE_PROJECT_ID;
});

describe("isBrowserBaseConfigured", () => {
  it("needs both the key and the project id", () => {
    expect(isBrowserBaseConfigured()).toBe(true);
    delete process.env.BROWSERBASE_PROJECT_ID;
    expect(isBrowserBaseConfigured()).toBe(false);
  });
});

describe("createBrowserSession", () => {
  it("sends keepAlive only when asked, and always sends the project id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "sess_1", status: "RUNNING" }),
    );

    await createBrowserSession({ keepAlive: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.browserbase.com/v1/sessions");
    expect(init.method).toBe("POST");
    expect(init.headers["X-BB-API-Key"]).toBe("bb_test_key");
    const body = JSON.parse(init.body);
    // keepAlive: true is what stops the session dying the moment the CDP
    // socket closes; dropping it silently breaks the viewer.
    expect(body.keepAlive).toBe(true);
    expect(body.projectId).toBe("proj_test");
    expect(body.browserSettings.recordSession).toBe(true);
  });

  it("omits keepAlive entirely when not requested", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "sess_2", status: "RUNNING" }),
    );
    await createBrowserSession({});
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.keepAlive).toBeUndefined();
  });

  it("clamps the requested timeout to the admin-configured ceiling", async () => {
    mockGetSetting.mockResolvedValue(120);
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "sess_3", status: "RUNNING" }),
    );

    await createBrowserSession({ timeoutSeconds: 100000 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.timeout).toBe(120);
  });

  it("never goes below the 60 second API floor", async () => {
    mockGetSetting.mockResolvedValue(10);
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "sess_4", status: "RUNNING" }),
    );

    await createBrowserSession({ timeoutSeconds: 1 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.timeout).toBe(60);
  });

  it("passes a viewport through when one is given", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "sess_5", status: "RUNNING" }),
    );
    await createBrowserSession({ viewport: { width: 1280, height: 720 } });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.browserSettings.viewport).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("throws a 503 BrowserBaseError when the integration is not configured", async () => {
    delete process.env.BROWSERBASE_API_KEY;
    await expect(createBrowserSession({})).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the upstream status on a failed create", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "nope" }, 402));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(createBrowserSession({})).rejects.toBeInstanceOf(
      BrowserBaseError,
    );
    errSpy.mockRestore();
  });
});

describe("endBrowserSession", () => {
  it("issues REQUEST_RELEASE for the right session id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await endBrowserSession("sess_abc");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.browserbase.com/v1/sessions/sess_abc");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ status: "REQUEST_RELEASE" });
  });

  it("url-encodes the session id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await endBrowserSession("a/b c");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.browserbase.com/v1/sessions/a%2Fb%20c",
    );
  });

  it("stays silent (never throws) when the release call fails", async () => {
    fetchMock.mockRejectedValue(new Error("socket hang up"));
    await expect(endBrowserSession("sess_x")).resolves.toBeUndefined();
  });

  it("does nothing at all when the integration is not configured", async () => {
    delete process.env.BROWSERBASE_PROJECT_ID;
    await endBrowserSession("sess_x");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getBrowserSession / getBrowserLiveUrls", () => {
  it("reads session metadata by id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "sess_9", status: "RUNNING" }),
    );
    const session = await getBrowserSession("sess_9");
    expect(session.id).toBe("sess_9");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.browserbase.com/v1/sessions/sess_9",
    );
  });

  it("reads live viewer URLs from the /debug endpoint, including the pages[0] fallback", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        pages: [{ debuggerFullscreenUrl: "https://viewer.example/full" }],
      }),
    );
    const live = await getBrowserLiveUrls("sess_9");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.browserbase.com/v1/sessions/sess_9/debug",
    );
    expect(live.debuggerFullscreenUrl).toBe("https://viewer.example/full");
  });

  it("throws on a non-2xx logs read", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "gone" }, 404));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getBrowserSessionLogs("sess_9")).rejects.toMatchObject({
      status: 404,
    });
    errSpy.mockRestore();
  });
});

describe("pickLiveViewerUrl", () => {
  it("prefers the fullscreen viewer URL", () => {
    expect(
      pickLiveViewerUrl({
        debuggerFullscreenUrl: "https://a/full",
        debuggerUrl: "https://a/plain",
      }),
    ).toBe("https://a/full");
  });

  it("falls back to the plain debugger URL, then to null", () => {
    expect(pickLiveViewerUrl({ debuggerUrl: "https://a/plain" })).toBe(
      "https://a/plain",
    );
    expect(pickLiveViewerUrl({})).toBeNull();
  });
});

describe("parseNetworkRequests", () => {
  it("pairs a request with its response and derives host and path", () => {
    const out = parseNetworkRequests([
      {
        method: "Network.requestWillBeSent",
        timestamp: 1,
        request: {
          params: {
            requestId: "r1",
            request: { url: "https://example.com/a?b=c", method: "get" },
          },
        },
      },
      {
        method: "Network.responseReceived",
        timestamp: 2,
        request: {
          params: {
            requestId: "r1",
            response: { status: 200, mimeType: "text/html; charset=utf-8" },
          },
        },
      },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      requestId: "r1",
      host: "example.com",
      path: "/a?b=c",
      method: "GET",
      status: 200,
      mimeType: "text/html",
    });
  });

  it("marks a failed load and skips non-http schemes", () => {
    const out = parseNetworkRequests([
      {
        method: "Network.requestWillBeSent",
        request: {
          params: {
            requestId: "r2",
            request: { url: "data:text/plain,hello", method: "GET" },
          },
        },
      },
      {
        method: "Network.requestWillBeSent",
        request: {
          params: {
            requestId: "r3",
            request: { url: "https://example.com/x", method: "GET" },
          },
        },
      },
      {
        method: "Network.loadingFailed",
        request: { params: { requestId: "r3" } },
      },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ requestId: "r3", failed: true, status: 0 });
  });

  it("still reports a request that never got a response", () => {
    const out = parseNetworkRequests([
      {
        method: "Network.requestWillBeSent",
        request: {
          params: {
            requestId: "r4",
            request: { url: "https://example.com/pending", method: "GET" },
          },
        },
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBeUndefined();
  });
});
