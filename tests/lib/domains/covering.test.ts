import { describe, it, expect } from "vitest";
import {
  coveringDomainCandidates,
  domainListCovers,
  hostFromScanTarget,
} from "@/lib/domains/covering";

/**
 * The client-side half of the verified-domain gate.
 *
 * It exists because the port-sweep refusal rejects the WHOLE scan: ticking
 * "Scan common ports" against a domain you have not verified did not give you
 * a scan without the sweep, it gave you no scan at all, and only after you had
 * picked your options and pressed the button. The same sweep offered from a
 * finished result said so up front and cost nothing when refused. This is what
 * lets the form say it up front too.
 *
 * It is a HINT. The server re-runs findVerifiedDomainForHost against the
 * database on every request and that is what actually refuses the work, so
 * these tests care most about the direction that fails safe: never claiming
 * coverage that does not exist.
 */

describe("domainListCovers", () => {
  it("covers the exact domain", () => {
    expect(domainListCovers("example.com", ["example.com"])).toBe(true);
  });

  it("covers every subdomain beneath a verified apex", () => {
    for (const host of [
      "app.example.com",
      "staging.app.example.com",
      "a.b.c.d.example.com",
    ]) {
      expect(domainListCovers(host, ["example.com"])).toBe(true);
    }
  });

  it("does not cover the parent of a verified subdomain", () => {
    // Verifying app.example.com proves control of that name, not of the zone
    // above it. Reading it the other way would let a subdomain grant a sweep
    // of the whole registrable domain.
    expect(domainListCovers("example.com", ["app.example.com"])).toBe(false);
  });

  it("does not cover a different domain that merely looks similar", () => {
    expect(domainListCovers("evil-example.com", ["example.com"])).toBe(false);
    expect(domainListCovers("notexample.com", ["example.com"])).toBe(false);
    expect(domainListCovers("example.com.attacker.net", ["example.com"])).toBe(
      false,
    );
  });

  it("is case insensitive on both sides", () => {
    expect(domainListCovers("APP.Example.COM", ["example.com"])).toBe(true);
    expect(domainListCovers("app.example.com", ["Example.COM"])).toBe(true);
  });

  it("claims nothing when the list is empty", () => {
    // The list is empty while the fetch is in flight, when the user is signed
    // out, and when the request failed. All three have to read as "not
    // covered", or a failed fetch would arm a control the API then refuses.
    expect(domainListCovers("example.com", [])).toBe(false);
  });

  it("claims nothing for an empty host", () => {
    expect(domainListCovers("", ["example.com"])).toBe(false);
  });

  it("agrees with the candidate list the server query is built from", () => {
    // Same rule, one implementation: scope.ts re-exports this function and
    // feeds its output straight into `domain = ANY($1)`.
    const candidates = coveringDomainCandidates("a.b.example.com");
    expect(candidates).toEqual([
      "a.b.example.com",
      "b.example.com",
      "example.com",
      "com",
    ]);
    for (const c of candidates) {
      expect(domainListCovers("a.b.example.com", [c])).toBe(true);
    }
  });
});

describe("hostFromScanTarget", () => {
  it("reads the bare hostname most people actually type", () => {
    // new URL() rejects this outright, which is why the form needs its own
    // parse rather than reusing the URL constructor directly.
    expect(hostFromScanTarget("example.com")).toBe("example.com");
    expect(hostFromScanTarget("app.example.com")).toBe("app.example.com");
  });

  it("reads a full URL, with any scheme the API accepts", () => {
    expect(hostFromScanTarget("https://example.com/a/b?c=d")).toBe(
      "example.com",
    );
    expect(hostFromScanTarget("http://example.com")).toBe("example.com");
    expect(hostFromScanTarget("wss://ws.example.com/socket")).toBe(
      "ws.example.com",
    );
  });

  it("drops the port, the credentials and the path", () => {
    expect(hostFromScanTarget("example.com:8443/admin")).toBe("example.com");
    expect(hostFromScanTarget("https://user:pass@example.com")).toBe(
      "example.com",
    );
  });

  it("lowercases, so the comparison never depends on how it was typed", () => {
    expect(hostFromScanTarget("EXAMPLE.com")).toBe("example.com");
  });

  it("trims surrounding whitespace from a pasted target", () => {
    expect(hostFromScanTarget("  example.com  ")).toBe("example.com");
  });

  it("returns null rather than throwing on anything unparseable", () => {
    for (const bad of ["", "   ", "http://", "https://:80"]) {
      expect(hostFromScanTarget(bad)).toBeNull();
    }
  });

  it("never reports a host the user did not type", () => {
    // The failure that matters: returning something wrong here would compare
    // the WRONG host against the verified list and could arm the toggle for a
    // domain the account does not own.
    expect(hostFromScanTarget("not a url at all")).not.toBe("example.com");
  });
});
