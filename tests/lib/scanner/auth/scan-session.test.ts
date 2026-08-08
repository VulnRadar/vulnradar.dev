import { describe, it, expect } from "vitest";
import { ScanSession } from "@/lib/scanner/auth/scan-session";

function headersWithSetCookie(...cookies: string[]): Headers {
  const h = new Headers();
  for (const c of cookies) h.append("set-cookie", c);
  return h;
}

describe("ScanSession scope", () => {
  it("returns headers for a URL on its own origin", () => {
    const session = new ScanSession({
      origin: "https://app.example.com",
      authType: "header",
      staticHeaders: { Authorization: "Bearer secret-token" },
    });
    const headers = session.authHeadersFor("https://app.example.com/api/data");
    expect(headers).toEqual({ Authorization: "Bearer secret-token" });
  });

  it("returns null for a URL on a different origin: this is what drops credentials on an off-origin redirect", () => {
    const session = new ScanSession({
      origin: "https://app.example.com",
      authType: "header",
      staticHeaders: { Authorization: "Bearer secret-token" },
    });
    expect(session.authHeadersFor("https://evil.example.com/steal")).toBeNull();
    expect(session.authHeadersFor("https://sub.app.example.com/")).toBeNull();
    expect(session.authHeadersFor("http://app.example.com/")).toBeNull(); // scheme differs too
  });

  it("refuses to attach credentials to a sign-out URL even on-origin", () => {
    const session = new ScanSession({
      origin: "https://app.example.com",
      authType: "cookie",
    });
    session.jar.seed("https://app.example.com", [{ name: "sid", value: "x" }]);
    expect(session.authHeadersFor("https://app.example.com/logout")).toBeNull();
  });

  it("refuses to attach credentials to a destructive URL even on-origin", () => {
    const session = new ScanSession({
      origin: "https://app.example.com",
      authType: "cookie",
    });
    session.jar.seed("https://app.example.com", [{ name: "sid", value: "x" }]);
    expect(
      session.authHeadersFor("https://app.example.com/account/delete"),
    ).toBeNull();
  });
});

describe("ScanSession.observe: mid-scan session loss detection", () => {
  it("marks the session lost when the target clears an adopted session cookie", () => {
    const session = new ScanSession({
      origin: "https://app.example.com",
      authType: "form",
    });
    session.jar.seed("https://app.example.com", [
      { name: "session", value: "abc" },
    ]);
    session.adoptSessionCookies(["session"]);
    expect(session.lost).toBe(false);

    session.observe(
      "https://app.example.com/dashboard",
      200,
      headersWithSetCookie("session=; Max-Age=0"),
    );

    expect(session.lost).toBe(true);
    expect(session.reason).toMatch(/cleared/i);
  });

  it("does not mark the session lost for a cookie it never adopted", () => {
    const session = new ScanSession({
      origin: "https://app.example.com",
      authType: "form",
    });
    session.jar.seed("https://app.example.com", [
      { name: "session", value: "abc" },
    ]);
    session.adoptSessionCookies(["session"]);

    session.observe(
      "https://app.example.com/dashboard",
      200,
      headersWithSetCookie("unrelated_tracking=; Max-Age=0"),
    );

    expect(session.lost).toBe(false);
  });

  it("marks the session lost on a 401 from an in-scope request", () => {
    const session = new ScanSession({
      origin: "https://app.example.com",
      authType: "header",
    });
    session.observe("https://app.example.com/api/data", 401, new Headers());
    expect(session.lost).toBe(true);
    expect(session.reason).toMatch(/401/);
  });

  it("marks the session lost on a 403 from an in-scope request", () => {
    const session = new ScanSession({
      origin: "https://app.example.com",
      authType: "header",
    });
    session.observe("https://app.example.com/api/data", 403, new Headers());
    expect(session.lost).toBe(true);
  });

  it("marks the session lost when redirected back to the login page", () => {
    const session = new ScanSession({
      origin: "https://app.example.com",
      authType: "form",
      loginPath: "/login",
    });
    const headers = new Headers();
    headers.set("location", "/login");
    session.observe("https://app.example.com/dashboard", 302, headers);
    expect(session.lost).toBe(true);
    expect(session.reason).toMatch(/login page/i);
  });

  it("ignores status codes and cookies from a different origin entirely", () => {
    const session = new ScanSession({
      origin: "https://app.example.com",
      authType: "header",
    });
    session.observe("https://other.example.com/api/data", 401, new Headers());
    expect(session.lost).toBe(false);
  });

  it("keeps the first loss reason when multiple losses are observed", () => {
    const session = new ScanSession({
      origin: "https://app.example.com",
      authType: "header",
    });
    session.observe("https://app.example.com/a", 401, new Headers());
    const firstReason = session.reason;
    session.observe("https://app.example.com/b", 403, new Headers());
    expect(session.reason).toBe(firstReason);
  });

  it("describe() never includes cookie or header values", () => {
    const session = new ScanSession({
      origin: "https://app.example.com",
      authType: "header",
      staticHeaders: { Authorization: "Bearer super-secret" },
    });
    session.jar.seed("https://app.example.com", [
      { name: "sid", value: "also-secret" },
    ]);
    const description = session.describe();
    const serialized = JSON.stringify(description);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("also-secret");
    expect(description.cookieCount).toBe(1);
    expect(description.staticHeaderNames).toEqual(["Authorization"]);
  });
});
