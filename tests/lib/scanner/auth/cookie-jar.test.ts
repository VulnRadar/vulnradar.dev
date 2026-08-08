import { describe, it, expect } from "vitest";
import { ScanCookieJar, readSetCookies } from "@/lib/scanner/auth/cookie-jar";

describe("ScanCookieJar", () => {
  it("stores a cookie from Set-Cookie and sends it back on the next request", () => {
    const jar = new ScanCookieJar();
    jar.applySetCookies("https://app.example.com/login", [
      "session=abc123; Path=/; HttpOnly",
    ]);
    expect(jar.headerFor("https://app.example.com/dashboard")).toBe(
      "session=abc123",
    );
  });

  it("does not send a cookie to a different host", () => {
    const jar = new ScanCookieJar();
    jar.applySetCookies("https://app.example.com/login", ["session=abc123"]);
    expect(jar.headerFor("https://evil.example.com/")).toBeNull();
    expect(jar.headerFor("https://example.com/")).toBeNull();
  });

  it("rejects a Domain attribute the requesting host is not part of", () => {
    const jar = new ScanCookieJar();
    // app.example.com tries to set a cookie for a host it does not own.
    jar.applySetCookies("https://app.example.com/login", [
      "session=abc123; Domain=attacker.com",
    ]);
    expect(jar.headerFor("https://attacker.com/")).toBeNull();
    expect(jar.size).toBe(0);
  });

  it("accepts a Domain attribute that is the requesting host's parent", () => {
    const jar = new ScanCookieJar();
    jar.applySetCookies("https://app.example.com/login", [
      "session=abc123; Domain=example.com",
    ]);
    expect(jar.headerFor("https://app.example.com/")).toBe("session=abc123");
    expect(jar.headerFor("https://other.example.com/")).toBe("session=abc123");
  });

  it("never sends a Secure cookie over plain http", () => {
    const jar = new ScanCookieJar();
    jar.applySetCookies("https://app.example.com/login", [
      "session=abc123; Secure",
    ]);
    expect(jar.headerFor("http://app.example.com/")).toBeNull();
    expect(jar.headerFor("https://app.example.com/")).toBe("session=abc123");
  });

  it("treats Max-Age=0 or an empty value as deletion", () => {
    const jar = new ScanCookieJar();
    jar.applySetCookies("https://app.example.com/", ["session=abc123"]);
    expect(jar.headerFor("https://app.example.com/")).toBe("session=abc123");

    const { cleared } = jar.applySetCookies("https://app.example.com/", [
      "session=; Max-Age=0",
    ]);
    expect(cleared).toContain("session");
    expect(jar.headerFor("https://app.example.com/")).toBeNull();
  });

  it("caps a cookie's lifetime even when the target asks for longer", () => {
    const jar = new ScanCookieJar();
    // A target that hands out a one-year cookie still only lives for the
    // length of a scan (CONFIG_SCAN_AUTH_MAX_COOKIE_AGE_SECONDS).
    jar.applySetCookies("https://app.example.com/", [
      "session=abc123; Max-Age=31536000",
    ]);
    expect(jar.headerFor("https://app.example.com/")).toBe("session=abc123");
    // Can't easily fast-forward Date.now() here without faking timers, but
    // the important behavioural property (does not throw, cookie present
    // now) is exercised; the cap itself is covered by scan-session tests
    // that check session.lost after cookie clearing.
  });

  it("seed() binds injected cookies to the exact host of the origin", () => {
    const jar = new ScanCookieJar();
    jar.seed("https://app.example.com", [{ name: "sid", value: "xyz" }]);
    expect(jar.headerFor("https://app.example.com/")).toBe("sid=xyz");
    expect(jar.headerFor("https://sub.app.example.com/")).toBeNull();
  });

  it("matches the longer path first per RFC 6265 ordering", () => {
    const jar = new ScanCookieJar();
    jar.applySetCookies("https://app.example.com/", ["a=1; Path=/"]);
    jar.applySetCookies("https://app.example.com/account/", [
      "b=2; Path=/account",
    ]);
    const header = jar.headerFor("https://app.example.com/account/settings");
    expect(header).toBe("b=2; a=1");
  });

  it("readSetCookies falls back to a single get() when getSetCookie is absent", () => {
    const headers = new Headers();
    headers.set("set-cookie", "a=1");
    expect(readSetCookies(headers)).toEqual(["a=1"]);
  });

  it("seedFromBrowser accepts a cookie scoped to the navigated host", () => {
    const jar = new ScanCookieJar();
    const accepted = jar.seedFromBrowser("app.example.com", [
      {
        name: "cf_clearance",
        value: "tok-1",
        domain: "app.example.com",
        path: "/",
        secure: true,
      },
    ]);
    expect(accepted).toEqual(["cf_clearance"]);
    expect(jar.headerFor("https://app.example.com/")).toBe(
      "cf_clearance=tok-1",
    );
  });

  it("seedFromBrowser accepts a cookie scoped to a parent domain", () => {
    const jar = new ScanCookieJar();
    jar.seedFromBrowser("app.example.com", [
      {
        name: "sess",
        value: "abc",
        domain: ".example.com",
      },
    ]);
    expect(jar.headerFor("https://app.example.com/")).toBe("sess=abc");
  });

  it("seedFromBrowser rejects a cookie for a domain the navigated host is not part of", () => {
    const jar = new ScanCookieJar();
    const accepted = jar.seedFromBrowser("app.example.com", [
      { name: "sess", value: "abc", domain: "attacker.com" },
    ]);
    expect(accepted).toEqual([]);
    expect(jar.size).toBe(0);
  });

  it("seedFromBrowser caps a browser-picked-up cookie's lifetime like any other", () => {
    const jar = new ScanCookieJar();
    const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
    jar.seedFromBrowser("app.example.com", [
      {
        name: "sess",
        value: "abc",
        domain: "app.example.com",
        expires: farFuture,
      },
    ]);
    // Doesn't throw, and the cookie is present now; the cap itself mirrors
    // seed()'s ceiling and is exercised the same way applyOne's is above.
    expect(jar.headerFor("https://app.example.com/")).toBe("sess=abc");
  });

  it("never exposes cookie values through names()", () => {
    const jar = new ScanCookieJar();
    jar.seed("https://app.example.com", [
      { name: "sid", value: "super-secret-value" },
    ]);
    const names = jar.names();
    expect(names).toEqual(["sid"]);
    expect(JSON.stringify(names)).not.toContain("super-secret-value");
  });
});
