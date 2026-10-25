import { describe, it, expect } from "vitest";
import { classifyChatLink } from "@/lib/ai/chat/links";

const APP = "https://vulnradar.example";

describe("classifyChatLink", () => {
  it("keeps paths inside the app clickable", () => {
    expect(classifyChatLink("/history?scan=abc", APP)).toEqual({
      kind: "internal",
      href: "/history?scan=abc",
    });
    expect(classifyChatLink(`${APP}/checks/hsts-missing`, APP).kind).toBe(
      "internal",
    );
  });

  it("keeps known references clickable", () => {
    expect(
      classifyChatLink(
        "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security",
        APP,
      ).kind,
    ).toBe("reference");
  });

  it("does not link an arbitrary host, which is where exfiltration goes", () => {
    expect(
      classifyChatLink("https://attacker.example/?plan=elite&scans=12", APP)
        .kind,
    ).toBe("plain");
  });

  it("does not link a protocol-relative or script URL", () => {
    expect(classifyChatLink("//attacker.example/x", APP).kind).toBe("plain");
    expect(classifyChatLink("javascript:alert(1)", APP).kind).toBe("plain");
  });

  it("does not trust a lookalike of a reference host", () => {
    expect(
      classifyChatLink("https://github.com.attacker.example/x", APP).kind,
    ).toBe("plain");
    expect(classifyChatLink("http://github.com/x", APP).kind).toBe("plain");
  });
});

describe("classifyChatLink: what a clickable link may still carry", () => {
  it("drops query parameters a page would act on", () => {
    expect(classifyChatLink("/demo?url=https://attacker.example", APP)).toEqual(
      {
        kind: "internal",
        href: "/demo",
      },
    );
    expect(
      classifyChatLink("/login?redirect=https://attacker.example", APP).href,
    ).toBe("/login");
  });

  it("keeps the parameters Vera has a reason to write", () => {
    expect(
      classifyChatLink("/profile?tab=developer&dtab=api-keys&x=1", APP).href,
    ).toBe("/profile?tab=developer&dtab=api-keys");
  });

  it("never links an API path, or a backslash path the browser reads as a host", () => {
    expect(classifyChatLink("/api/v3/history", APP).kind).toBe("plain");
    const backslash = String.fromCharCode(92);
    expect(classifyChatLink(`/${backslash}attacker.example/x`, APP).kind).toBe(
      "plain",
    );
  });

  it("never links a path that a browser would read as another host", () => {
    for (const raw of [
      "/.//attacker.example",
      "/a/..//attacker.example",
      `${APP}/..//attacker.example/x`,
    ])
      expect(classifyChatLink(raw, APP).kind, raw).toBe("plain");
  });

  it("does not let normalising a path get it past the API check", () => {
    for (const raw of ["//api/v3/history", "/.//api/v3/x", "/%61pi/v3/keys"])
      expect(classifyChatLink(raw, APP).kind, raw).toBe("plain");
  });

  it("strips the query from a reference link but keeps the page and anchor", () => {
    expect(
      classifyChatLink(
        "https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP?leak=abc#directives",
        APP,
      ).href,
    ).toBe("https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP#directives");
  });

  it("trusts GitHub only under the project's own organisation", () => {
    expect(
      classifyChatLink("https://github.com/VulnRadar/vulnradar.dev/issues", APP)
        .kind,
    ).toBe("reference");
    expect(
      classifyChatLink(
        "https://github.com/login/oauth/authorize?client_id=x",
        APP,
      ).kind,
    ).toBe("plain");
    expect(classifyChatLink("https://github.com/attacker/repo", APP).kind).toBe(
      "plain",
    );
  });
});
