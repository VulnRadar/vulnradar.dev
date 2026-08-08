import { describe, it, expect } from "vitest";
import {
  buildPageContext,
  parseCsp,
  parseSetCookie,
} from "@/lib/scanner/page-context";

function ctx(url: string, headers: Record<string, string>, body: string) {
  return buildPageContext(url, new Headers(headers), body);
}

describe("buildPageContext", () => {
  it("resolves script src against the page URL and flags third-party origin", () => {
    const c = ctx(
      "https://example.com/page",
      {},
      `<script src="https://cdn.other.com/a.js"></script><script src="/local.js"></script>`,
    );
    expect(c.scripts).toHaveLength(2);
    const external = c.scripts.find((s) => s.src?.includes("cdn.other.com"))!;
    expect(external.thirdParty).toBe(true);
    expect(external.origin).toBe("https://cdn.other.com");
    const local = c.scripts.find((s) => s.src === "/local.js")!;
    expect(local.thirdParty).toBe(false);
    expect(local.resolved).toBe("https://example.com/local.js");
  });

  it("captures inline script source separately from external scripts", () => {
    const c = ctx(
      "https://example.com/",
      {},
      `<script>var x = 1;</script><script src="/a.js"></script>`,
    );
    expect(c.inlineScript).toContain("var x = 1;");
    expect(c.inlineScript).not.toContain("/a.js");
  });

  it("does not let markup inside an inline script fool form parsing", () => {
    const c = ctx(
      "https://example.com/",
      {},
      `<script>var t = '<form action="http://evil.example"><input type="password"></form>';</script>`,
    );
    expect(c.forms).toHaveLength(0);
  });

  it("parses a form's password fields, method, and resolved action", () => {
    const c = ctx(
      "https://example.com/login",
      {},
      `<form action="/submit" method="POST">
        <input type="password" name="pw">
        <input type="hidden" name="csrf_token" value="abc">
      </form>`,
    );
    expect(c.forms).toHaveLength(1);
    const form = c.forms[0];
    expect(form.method).toBe("post");
    expect(form.resolvedAction).toBe("https://example.com/submit");
    expect(form.passwordFields).toHaveLength(1);
    expect(form.csrfTokens).toHaveLength(1);
    expect(form.crossOrigin).toBe(false);
    expect(form.submitsOverHttp).toBe(false);
  });

  it("flags a form that submits a password over plain HTTP", () => {
    const c = ctx(
      "https://example.com/login",
      {},
      `<form action="http://example.com/submit" method="post"><input type="password" name="pw"></form>`,
    );
    expect(c.forms[0].submitsOverHttp).toBe(true);
  });

  it("detects a cross-origin form action", () => {
    const c = ctx(
      "https://example.com/",
      {},
      `<form action="https://other.example/submit" method="post"></form>`,
    );
    expect(c.forms[0].crossOrigin).toBe(true);
  });

  it("parses every Set-Cookie header independently", () => {
    const headers = new Headers();
    headers.append(
      "set-cookie",
      "session=abc; Secure; HttpOnly; SameSite=Lax; Path=/",
    );
    headers.append("set-cookie", "theme=dark; Path=/");
    const c = buildPageContext("https://example.com/", headers, "");
    expect(c.cookies).toHaveLength(2);
    const session = c.cookies.find((ck) => ck.name === "session")!;
    expect(session.secure).toBe(true);
    expect(session.httpOnly).toBe(true);
    expect(session.sameSite).toBe("lax");
    expect(session.sessionLike).toBe(true);
    const theme = c.cookies.find((ck) => ck.name === "theme")!;
    expect(theme.secure).toBe(false);
    expect(theme.sessionLike).toBe(false);
  });

  it("resolves CSP directive fallback to default-src via .effective()", () => {
    const c = ctx(
      "https://example.com/",
      { "content-security-policy": "default-src 'none'; script-src 'self'" },
      "",
    );
    expect(c.csp!.effective("script-src")).toEqual(["'self'"]);
    expect(c.csp!.effective("object-src")).toEqual(["'none'"]);
  });

  it("prefers a meta CSP when no header is present", () => {
    const c = ctx(
      "https://example.com/",
      {},
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'">`,
    );
    expect(c.csp).not.toBeNull();
    expect(c.csp!.directives["default-src"]).toEqual(["'self'"]);
  });

  it("detects a known framework shell from the body", () => {
    const c = ctx(
      "https://example.com/",
      {},
      `<html><body><div id="__next"></div><script>self.__NEXT_DATA__={}</script></body></html>`,
    );
    expect(c.isFrameworkPage).toBe(true);
    expect(c.framework).toBe("Next.js");
  });

  it("does not tokenize a JSON response body", () => {
    const c = ctx(
      "https://api.example.com/v1",
      { "content-type": "application/json" },
      `{"forms": "<form action=http://x></form>"}`,
    );
    expect(c.isHtml).toBe(false);
    expect(c.forms).toHaveLength(0);
    expect(c.scripts).toHaveLength(0);
  });

  it("handles an unparseable URL without throwing", () => {
    expect(() =>
      buildPageContext("not a url", new Headers(), "<p>x</p>"),
    ).not.toThrow();
  });
});

describe("parseCsp", () => {
  it("keeps the first occurrence of a repeated directive", () => {
    const csp = parseCsp("script-src 'self'; script-src *");
    expect(csp.directives["script-src"]).toEqual(["'self'"]);
  });

  it("marks a report-only policy", () => {
    const csp = parseCsp("default-src 'self'", true);
    expect(csp.reportOnly).toBe(true);
  });
});

describe("parseSetCookie", () => {
  it("recognises the __Host- prefix and its required attributes", () => {
    const c = parseSetCookie(
      "__Host-session=abc; Secure; Path=/; SameSite=Strict",
    );
    expect(c.prefix).toBe("__Host-");
    expect(c.secure).toBe(true);
    expect(c.path).toBe("/");
  });

  it("parses Max-Age as a number", () => {
    const c = parseSetCookie("id=1; Max-Age=3600");
    expect(c.maxAge).toBe(3600);
  });

  it("handles a cookie with no attributes", () => {
    const c = parseSetCookie("id=1");
    expect(c.name).toBe("id");
    expect(c.value).toBe("1");
    expect(c.secure).toBe(false);
  });
});
