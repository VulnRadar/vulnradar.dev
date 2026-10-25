import { describe, it, expect, vi, afterEach } from "vitest";
import { reportRequestError } from "@/lib/logging/request-error";
import { currentRequestId } from "@/lib/database/request-context";

/**
 * reportRequestError is what instrumentation.ts's onRequestError records for
 * an error nothing caught. The defect it fixes: such an error reached the log
 * as a bare stack, with nothing saying which URL, route or request it
 * belonged to, and a NULL request_id because the request context is only
 * entered by withErrorHandling, which most routes do not use.
 */
const RID = "d4e5f6a7-b8c9-4d0e-9f1a-3b4c5d6e7f80";

const request = (
  over: Partial<Parameters<typeof reportRequestError>[1]> = {},
) => ({
  path: "/api/v3/scan",
  method: "POST",
  headers: { "x-request-id": RID } as NodeJS.Dict<string | string[]>,
  ...over,
});

const context = {
  routePath: "/api/v3/scan",
  routeType: "route",
  renderSource: undefined,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reportRequestError", () => {
  it("logs the method and the path, with the Error itself", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("handler exploded");

    reportRequestError(boom, request(), context);

    expect(spy.mock.calls[0][0]).toBe("[route-error] POST /api/v3/scan threw");
    expect(spy.mock.calls[0]).toContain(boom);
  });

  it("records the route, its type and the request id in the context", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportRequestError(
      new Error("x"),
      request({ path: "/host/example.com", method: "GET" }),
      {
        routePath: "/host/[hostname]",
        routeType: "render",
        renderSource: "react-server-components",
      },
    );

    expect(spy.mock.calls[0][1]).toEqual({
      method: "GET",
      path: "/host/example.com",
      routePath: "/host/[hostname]",
      routeType: "render",
      renderSource: "react-server-components",
      requestId: RID,
    });
  });

  it("enters the request context, so the stored row carries the id", () => {
    let seen: string | null = null;
    vi.spyOn(console, "error").mockImplementation(() => {
      seen = currentRequestId();
    });

    reportRequestError(new Error("x"), request(), context);

    expect(seen).toBe(RID);
  });

  it("leaves the query string out", () => {
    // Reset tokens, OAuth codes and addresses end up there.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportRequestError(
      new Error("x"),
      request({ path: "/api/v3/auth/reset?token=s3cret&email=a@b.co" }),
      context,
    );

    const logged = JSON.stringify(spy.mock.calls[0]);
    expect(logged).toContain("POST /api/v3/auth/reset threw");
    expect(logged).not.toContain("s3cret");
    expect(logged).not.toContain("a@b.co");
  });

  it("reads the id from a repeated header", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportRequestError(
      new Error("x"),
      request({ headers: { "x-request-id": [RID, "ignored-second-value"] } }),
      context,
    );

    expect(spy.mock.calls[0][1]).toMatchObject({ requestId: RID });
  });

  it("drops an id that is not a plain opaque token, and still logs", () => {
    // The value goes verbatim into an admin-facing table.
    let seen: string | null = "unset";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      seen = currentRequestId();
    });

    reportRequestError(
      new Error("x"),
      request({ headers: { "x-request-id": "<script>alert(1)</script>" } }),
      context,
    );

    expect(seen).toBeNull();
    expect(spy.mock.calls[0][1]).not.toHaveProperty("requestId");
  });

  it("still logs when there is no header at all", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportRequestError(new Error("x"), request({ headers: {} }), context);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).not.toHaveProperty("requestId");
  });

  it("carries the digest Next shows the visitor, so the two can be matched", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("render failed"), {
      digest: "1234567",
    });

    reportRequestError(err, request(), context);

    expect(spy.mock.calls[0][1]).toMatchObject({ digest: "1234567" });
  });

  it("copes with a thrown value that is not an Error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      reportRequestError("a string", request(), context),
    ).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
