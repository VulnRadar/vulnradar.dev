import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import {
  DELETE,
  GET,
  HEAD,
  OPTIONS,
  PATCH,
  POST,
  PUT,
} from "@/app/api/[...path]/route";

/**
 * An /api path no route serves used to get Next's HTML 404 page, which an API
 * client cannot parse and which a CDN may cache. The catch-all answers every
 * method with the error envelope instead. Static and dynamic routes beat a
 * catch-all in the App Router, so no real route reaches this file.
 */
const route = { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS };
const METHODS = Object.keys(route) as (keyof typeof route)[];

function call(method: keyof typeof route, path: string, id?: string) {
  const handler = route[method];
  return handler(
    new NextRequest(`https://vulnradar.dev${path}`, {
      method,
      headers: id ? { "x-request-id": id } : {},
    }),
  );
}

describe("the /api catch-all", () => {
  it("exports every method", () => {
    for (const method of METHODS) expect(typeof route[method]).toBe("function");
  });

  it.each(METHODS)(
    "answers %s under /api/v4 with NOT_IN_V4",
    async (method) => {
      const res = await call(method, "/api/v4/admin/users", "rid-1");
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-type")).toContain("application/json");
      if (method === "HEAD") return;
      expect(await res.json()).toEqual({
        error: expect.any(String),
        code: "NOT_IN_V4",
        requestId: "rid-1",
        details: {
          hint: "Dashboard routes are not part of the API. See /docs/api.",
        },
      });
    },
  );

  it.each(["/api/v9/scan", "/api/v0", "/api/v12/x/y"])(
    "answers %s with UNSUPPORTED_API_VERSION",
    async (path) => {
      const res = await call("GET", path, "rid-2");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: expect.any(String),
        code: "UNSUPPORTED_API_VERSION",
        requestId: "rid-2",
      });
    },
  );

  it.each([
    "/api/v3/no-such-route",
    "/api/v3/history/abc/extra",
    "/api/internal/no-such-route",
    "/api/no-such-route",
    "/api/v4x",
  ])("answers %s with NOT_FOUND", async (path) => {
    const res = await call("POST", path, "rid-3");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "NOT_FOUND",
      requestId: "rid-3",
    });
  });

  it("mints a request id when it is called without middleware", async () => {
    const res = await call("GET", "/api/nothing");
    const body = (await res.json()) as { requestId: string };
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
