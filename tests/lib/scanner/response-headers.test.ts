/**
 * The redaction applied to a target's response headers before they are
 * stored on a scan. Removing the call, or a casing slip in the list, would
 * persist third-party session tokens in scan_history for the whole retention
 * window, and nothing else would notice.
 */
import { describe, it, expect } from "vitest";
import { redactSensitiveResponseHeaders } from "@/lib/scanner/response-headers";

describe("redactSensitiveResponseHeaders", () => {
  it.each([
    "Set-Cookie",
    "set-cookie",
    "SET-COOKIE",
    "Cookie",
    "cookie",
    "Authorization",
    "AUTHORIZATION",
    "Proxy-Authorization",
    "WWW-Authenticate",
    "Proxy-Authenticate",
    "X-CSRF-Token",
    "x-xsrf-token",
    "X-XSRF-TOKEN",
  ])("redacts %s and keeps the key exactly as it arrived", (key) => {
    const out = redactSensitiveResponseHeaders({ [key]: "secret-value" });
    expect(Object.keys(out)).toEqual([key]);
    expect(out[key]).toBe("[redacted]");
  });

  it("leaves every other header and its casing alone", () => {
    const input = {
      "Content-Type": "text/html",
      server: "nginx",
      "Strict-Transport-Security": "max-age=63072000",
      "X-Session-Hint": "not on the list",
    };
    expect(redactSensitiveResponseHeaders(input)).toEqual(input);
  });

  it("redacts inside a mixed set without touching its neighbours", () => {
    const out = redactSensitiveResponseHeaders({
      "content-type": "text/html",
      "Set-Cookie": "sid=abc; HttpOnly",
      Authorization: "Bearer xyz",
      "x-xsrf-token": "t0k3n",
    });
    expect(out).toEqual({
      "content-type": "text/html",
      "Set-Cookie": "[redacted]",
      Authorization: "[redacted]",
      "x-xsrf-token": "[redacted]",
    });
    expect(JSON.stringify(out)).not.toMatch(/abc|xyz|t0k3n/);
  });

  it("returns a copy, never the object it was given", () => {
    const input = { cookie: "a=1" };
    const out = redactSensitiveResponseHeaders(input);
    expect(out).not.toBe(input);
    expect(input.cookie).toBe("a=1");
  });
});
