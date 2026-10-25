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
