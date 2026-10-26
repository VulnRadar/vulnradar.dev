import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { aliasRewrite } from "@/lib/api/rewrite";
import { PREFIX } from "@/lib/api/route-registry";

const ORIGIN = "http://localhost:3000";

function init(request: NextRequest) {
  return { request: { headers: new Headers(request.headers) } };
}

function destinationOf(response: Response): URL {
  const target = response.headers.get("x-middleware-rewrite");
  expect(target).toBeTruthy();
  return new URL(target as string);
}

describe("aliasRewrite", () => {
  it("rewrites to the canonical path on the request's own origin", () => {
    const request = new NextRequest(`${ORIGIN}/api/v3/scan/status/42`);
    const response = aliasRewrite(
      request,
      `${PREFIX.V4}/scan/status/42`,
      init(request),
    );
    const destination = destinationOf(response);
    expect(destination.origin).toBe(request.nextUrl.origin);
    expect(destination.pathname).toBe("/api/v4/scan/status/42");
  });

  it("never produces a redirect", () => {
    const request = new NextRequest(`${ORIGIN}/api/v3/scan`, {
      method: "POST",
    });
    const response = aliasRewrite(request, `${PREFIX.V4}/scan`, init(request));
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("keeps the query string and the encoding of the rest of the URL", () => {
    const request = new NextRequest(
      `${ORIGIN}/api/v3/host/ex%20ample.com?x=1&y=a%2Fb&y=2`,
    );
    const response = aliasRewrite(
      request,
      `${PREFIX.INTERNAL}/host/ex%20ample.com`,
      init(request),
    );
    const destination = destinationOf(response);
    expect(destination.search).toBe("?x=1&y=a%2Fb&y=2");
    expect(destination.pathname).toBe("/api/internal/host/ex%20ample.com");
  });

  it("hands the request headers it was given to the route", () => {
    const request = new NextRequest(`${ORIGIN}/api/v3/scan`, {
      headers: { "x-keep": "1" },
    });
    const headers = new Headers(request.headers);
    headers.set("x-vr-api-version", "v3");
    const response = aliasRewrite(request, `${PREFIX.V4}/scan`, {
      request: { headers },
    });
    expect(response.headers.get("x-middleware-override-headers")).toContain(
      "x-vr-api-version",
    );
    expect(response.headers.get("x-middleware-request-x-vr-api-version")).toBe(
      "v3",
    );
    expect(response.headers.get("x-middleware-request-x-keep")).toBe("1");
  });

  describe("S11: the destination cannot be steered by the client", () => {
    const hostile = {
      host: "evil.example",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
      forwarded: "host=evil.example;proto=https",
      origin: "https://evil.example",
    };
    const paths = [
      ["/api/v3/scan", `${PREFIX.V4}/scan`],
      ["/api/v3/history/abc/report", `${PREFIX.V4}/history/abc/report`],
      ["/api/v3/admin/backup", `${PREFIX.INTERNAL}/admin/backup`],
      ["/api/v3/auth/me", `${PREFIX.INTERNAL}/auth/me`],
    ] as const;

    it.each(["GET", "POST", "PUT", "PATCH", "DELETE"])(
      "keeps the origin for %s, plain and with hostile Host headers",
      (method) => {
        for (const [from, to] of paths) {
          for (const headers of [{}, hostile]) {
            const request = new NextRequest(`${ORIGIN}${from}?q=1`, {
              method,
              headers,
            });
            const response = aliasRewrite(request, to, init(request));
            const destination = destinationOf(response);
            expect(destination.origin, `${method} ${from}`).toBe(
              request.nextUrl.origin,
            );
            expect(destination.origin).toBe(ORIGIN);
            expect(destination.host).not.toContain("evil");
          }
        }
      },
    );
  });

  it("refuses a destination that is not an /api path", () => {
    const request = new NextRequest(`${ORIGIN}/api/v3/scan`);
    for (const bad of [
      "",
      "scan",
      "/dashboard",
      "//evil.example/api/x",
      "https://evil.example/api/x",
    ]) {
      expect(() => aliasRewrite(request, bad, init(request)), bad).toThrow();
    }
  });
});
