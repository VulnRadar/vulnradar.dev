import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockLogError = vi.fn();
vi.mock("@/lib/logging/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

const { versioned } = await import("@/lib/api/v4/wrap");
const { API_VERSION_HEADER } = await import("@/lib/api/versions");
const { currentApiClient, currentApiVersion, currentRequestId } =
  await import("@/lib/database/request-context");

function request(
  headers: Record<string, string> = {},
  path = "/api/v3/scan",
): NextRequest {
  return new NextRequest(`https://x.test${path}`, { headers });
}

beforeEach(() => mockLogError.mockClear());

describe("versioned, v3 side", () => {
  it("returns the handler's own response object", async () => {
    const response = NextResponse.json({ scanId: 1 });
    const result = await versioned(
      "scan.create",
      async () => response,
    )(request());
    expect(result).toBe(response);
  });

  it("does not reshape the body", async () => {
    const body = { scanId: 1, status: "running", snake_case: true };
    const result = await versioned("scan.create", async () =>
      NextResponse.json(body),
    )(request());
    expect(await result.json()).toEqual(body);
  });

  // The header classes a client's retry and auth logic depends on.
  it.each([
    [429, { "Retry-After": "37" }],
    [401, { "WWW-Authenticate": 'Bearer realm="VulnRadar"' }],
    [
      429,
      {
        "X-RateLimit-Limit": "100",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Used": "100",
        "X-RateLimit-Reset": "2026-11-09T00:00:00.000Z",
        "X-RateLimit-Policy": "daily",
      },
    ],
    [200, { "Cache-Control": "no-store", Vary: "Origin" }],
  ] as [number, Record<string, string>][])(
    "keeps status %i and its headers",
    async (status, headers) => {
      const result = await versioned("scan.create", async () =>
        NextResponse.json({}, { status, headers }),
      )(request());
      expect(result.status).toBe(status);
      for (const [name, value] of Object.entries(headers)) {
        expect(result.headers.get(name)).toBe(value);
      }
    },
  );

  it("leaves a non-JSON body alone", async () => {
    const result = await versioned(
      "history.report",
      async () =>
        new NextResponse("a,b\n1,2", {
          headers: { "Content-Type": "text/csv" },
        }),
    )(request());
    expect(result.headers.get("Content-Type")).toBe("text/csv");
    expect(await result.text()).toBe("a,b\n1,2");
  });

  it("passes every argument through", async () => {
    const ctx = { params: Promise.resolve({ id: "7" }) };
    const handler = vi.fn(async (_request: NextRequest, _ctx: typeof ctx) =>
      NextResponse.json({}),
    );
    const req = request();
    await versioned("history.get", handler)(req, ctx);
    expect(handler).toHaveBeenCalledWith(req, ctx);
  });
});

describe("versioned, ambient context", () => {
  async function seen(req: NextRequest) {
    let captured: unknown;
    await versioned("scan.create", async () => {
      await Promise.resolve();
      captured = {
        version: currentApiVersion(),
        client: currentApiClient(),
        requestId: currentRequestId(),
      };
      return NextResponse.json({});
    })(req);
    return captured as {
      version: string;
      client: string | null;
      requestId: string;
    };
  }

  it("takes the version from the trusted marker", async () => {
    expect((await seen(request({ [API_VERSION_HEADER]: "v4" }))).version).toBe(
      "v4",
    );
  });

  it("falls back to the URL with no marker", async () => {
    expect((await seen(request())).version).toBe("v3");
    expect((await seen(request({}, "/api/v4/scan"))).version).toBe("v4");
  });

  it("keeps a valid client name", async () => {
    const context = await seen(request({ "X-VulnRadar-Client": "cli/2.1.0" }));
    expect(context.client).toBe("cli/2.1.0");
  });

  it("drops one that does not fit", async () => {
    const context = await seen(
      request({ "X-VulnRadar-Client": "<script>alert(1)</script>" }),
    );
    expect(context.client).toBeNull();
  });

  it("names no client when the header is absent", async () => {
    expect((await seen(request())).client).toBeNull();
  });

  it("enters the middleware's request id for an unwrapped handler", async () => {
    const context = await seen(request({ "x-request-id": "req-abcdef12" }));
    expect(context.requestId).toBe("req-abcdef12");
  });

  it("has an id even when the header is unusable", async () => {
    const context = await seen(request({ "x-request-id": "bad id" }));
    expect(context.requestId).toEqual(expect.any(String));
    expect(context.requestId).not.toBe("bad id");
  });

  it("does not leak past the request", async () => {
    await seen(request({ "X-VulnRadar-Client": "cli/2.1.0" }));
    expect(currentApiVersion()).toBeNull();
    expect(currentApiClient()).toBeNull();
  });
});

describe("versioned, a handler that throws", () => {
  const boom = async (): Promise<NextResponse> => {
    throw new Error("db password is hunter2");
  };

  it("answers in the envelope without the error's text", async () => {
    const result = await versioned(
      "scan.create",
      boom,
    )(request({ "x-request-id": "req-abcdef12" }));
    expect(result.status).toBe(500);
    const body = await result.json();
    expect(body).toEqual({
      error: "An unexpected error occurred",
      code: "INTERNAL_ERROR",
      requestId: "req-abcdef12",
    });
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });

  it("logs the operation and the error", async () => {
    await versioned("history.get", boom)(request());
    expect(mockLogError).toHaveBeenCalledTimes(1);
    const [, message, error] = mockLogError.mock.calls[0];
    expect(message).toContain("history.get");
    expect(error).toBeInstanceOf(Error);
  });
});
