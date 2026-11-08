/**
 * Header-logic behaviour that only shows once the detectors, the page checks
 * and the dedupe table run together, through the real engine.
 */

import { describe, it, expect } from "vitest";
import { runSyncChecks } from "@/lib/scanner/engine";
import { checkIdOf } from "@/lib/scanner/dedupe";

function scan(headers: Record<string, string>, body = "<html></html>") {
  const { findings } = runSyncChecks(
    "https://example.com/",
    new Headers(headers),
    body,
  );
  return findings;
}

function ids(findings: ReturnType<typeof scan>): string[] {
  return findings.map(checkIdOf);
}

describe("a CSP that only restricts framing", () => {
  it("gets csp-no-default-src and neither frame-src nor object-src findings", () => {
    const found = ids(
      scan(
        {
          "content-type": "text/html",
          "content-security-policy": "frame-ancestors 'none'",
        },
        '<html><iframe src="https://widgets.other.test/x"></iframe></html>',
      ),
    );
    expect(found).toContain("csp-no-default-src");
    expect(found).not.toContain("csp-frame-src-missing");
    expect(found).not.toContain("csp-object-src-missing");
    expect(found).not.toContain("page-csp-object-src-unrestricted");
  });
});

describe("a content policy on a page with a third-party iframe", () => {
  it("keeps csp-frame-src-missing and reports object-src once", () => {
    const findings = scan(
      {
        "content-type": "text/html",
        "content-security-policy": "script-src 'self'",
      },
      '<html><iframe src="https://widgets.other.test/x"></iframe></html>',
    );
    const found = ids(findings);
    expect(found).toContain("csp-frame-src-missing");
    const objectSrc = found.filter(
      (id) =>
        id === "csp-object-src-missing" ||
        id === "page-csp-object-src-unrestricted",
    );
    expect(objectSrc).toHaveLength(1);
  });
});

describe("a site sending only a Report-Only policy", () => {
  it("is one finding, with the report-only check credited", () => {
    const findings = scan({
      "content-type": "text/html",
      "content-security-policy-report-only":
        "default-src 'self'; frame-ancestors 'none'",
    });
    expect(ids(findings)).not.toContain("csp-report-only");
    const missing = findings.find((f) => checkIdOf(f) === "csp-missing");
    expect(missing?.evidence).toContain("blocks nothing");
    expect(missing?.alsoReportedBy).toContain("csp-report-only");
  });
});

describe("a page with a CSP but no framing protection", () => {
  it("is one clickjacking finding", () => {
    const findings = scan({
      "content-type": "text/html",
      "content-security-policy": "default-src 'self'",
    });
    expect(ids(findings)).not.toContain("csp-frame-ancestors-missing");
    const clickjack = findings.find(
      (f) => checkIdOf(f) === "clickjack-missing",
    );
    expect(clickjack?.alsoReportedBy).toContain("csp-frame-ancestors-missing");
  });
});

describe("the document gate", () => {
  it("keeps document-only headers off a JSON response and nosniff on it", () => {
    const found = ids(scan({ "content-type": "application/json" }, "{}"));
    expect(found).toContain("xcto-missing");
    for (const id of [
      "clickjack-missing",
      "permissions-policy-missing",
      "coop-missing",
      "coep-missing",
      "cross-origin-resource-policy-report-only-missing",
    ]) {
      expect(found).not.toContain(id);
    }
  });

  it("still reports a bare HTML page with no protection at all", () => {
    const found = ids(scan({ "content-type": "text/html" }));
    expect(found).toContain("clickjack-missing");
    expect(found).toContain("csp-missing");
    expect(found).toContain("hsts-missing");
    expect(found).toContain("xcto-missing");
  });
});
