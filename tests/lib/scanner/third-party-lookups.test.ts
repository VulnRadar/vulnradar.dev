import { describe, it, expect } from "vitest";
import {
  resolveLookups,
  LOOKUP_SERVICES,
  LOOKUP_GROUPS,
} from "@/lib/scanner/third-party-lookups";

/**
 * The third-party lookup links.
 *
 * These are links and nothing else: no request leaves the app, no API key
 * exists, nothing is stored. So what is worth pinning is not a response, it is
 * the two properties that make a link safe to render. The target has to be
 * encoded into the URL rather than concatenated into it, because a scanned URL
 * is attacker-supplied text that the reader is about to click. And a private
 * or non-routable target has to produce no links at all, because sending
 * http://192.168.1.1/admin to a third party publishes an internal address as a
 * side effect of a click that could not have answered anything.
 */

const TARGET = "https://example.com/a/b?q=1";

describe("resolveLookups", () => {
  it("builds one link per service", () => {
    expect(resolveLookups(TARGET)).toHaveLength(LOOKUP_SERVICES.length);
  });

  it("encodes the target rather than concatenating it", () => {
    // A scanned URL is text somebody else chose. A quote or an ampersand that
    // survives into the query string of a link the reader clicks is somebody
    // else's parameter riding along.
    const hostile = "https://evil.test/?x=1&y=2#frag";
    for (const lookup of resolveLookups(hostile)) {
      const parsed = new URL(lookup.href);
      // Whatever the target contributed, the link still points where it says.
      expect(["https:", "http:"]).toContain(parsed.protocol);
      expect(parsed.hostname).not.toBe("evil.test");
    }
  });

  it("keeps a target with a quote in it inside one parameter", () => {
    const quoted = 'https://example.com/?q="><script>';
    for (const lookup of resolveLookups(quoted)) {
      expect(lookup.href).not.toContain("<script>");
      expect(lookup.href).not.toContain('"');
    }
  });

  it("every href is a well-formed https URL", () => {
    for (const lookup of resolveLookups(TARGET)) {
      expect(() => new URL(lookup.href)).not.toThrow();
      expect(lookup.href.startsWith("https://")).toBe(true);
    }
  });

  it("hands VirusTotal the full URL, as its search box expects", () => {
    const vt = resolveLookups(TARGET).find((l) => l.id === "virustotal");
    expect(vt?.href).toBe(
      `https://www.virustotal.com/gui/search?query=${encodeURIComponent(TARGET)}`,
    );
  });

  it("hands the certificate log a wildcard on the registrable domain", () => {
    const crt = resolveLookups("https://deep.sub.example.com/").find(
      (l) => l.id === "crtsh",
    );
    // Not deep.sub.example.com: the reason to open crt.sh is to find the
    // subdomains nobody meant to publish, and querying one subdomain finds
    // only itself.
    expect(crt?.href).toContain(encodeURIComponent("%.example.com"));
  });

  it("keeps the third label for a multi-part TLD", () => {
    const crt = resolveLookups("https://shop.example.co.uk/").find(
      (l) => l.id === "crtsh",
    );
    expect(crt?.href).toContain(encodeURIComponent("%.example.co.uk"));
  });

  it("hands host-scoped services the host, not the whole URL", () => {
    const shodan = resolveLookups(TARGET).find((l) => l.id === "shodan");
    expect(shodan?.href).toContain(encodeURIComponent("hostname:example.com"));
    expect(shodan?.href).not.toContain("%2Fa%2Fb");
  });

  describe("targets that must produce nothing", () => {
    // Every one of these would publish something private to a third party as
    // a side effect of a click that could not have told the reader anything.
    const SILENT = [
      "http://localhost:3000/admin",
      "http://127.0.0.1/",
      "https://192.168.1.1/admin",
      "https://10.0.0.5/",
      "http://router.local/",
      "https://vault.internal/secrets",
      "http://box.home.arpa/",
      "https://fixture.test/",
      "http://[::1]/",
      "https://intranet/",
    ];
    for (const target of SILENT) {
      it(`offers nothing for ${target}`, () => {
        expect(resolveLookups(target)).toEqual([]);
      });
    }
  });

  it("offers nothing for a scheme a browser would not follow", () => {
    expect(resolveLookups("javascript:alert(1)")).toEqual([]);
    expect(resolveLookups("file:///etc/passwd")).toEqual([]);
    expect(resolveLookups("data:text/html,<script>alert(1)</script>")).toEqual(
      [],
    );
  });

  it("offers nothing for something that is not a URL", () => {
    expect(resolveLookups("")).toEqual([]);
    expect(resolveLookups("not a url")).toEqual([]);
  });
});

describe("the service list", () => {
  it("has a unique id per service", () => {
    const ids = LOOKUP_SERVICES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts every service in a group the panel renders", () => {
    const groups = new Set(LOOKUP_GROUPS.map((g) => g.id));
    for (const service of LOOKUP_SERVICES) {
      expect(groups, `${service.id} is in no rendered group`).toContain(
        service.group,
      );
    }
  });

  it("says what the reader will find, not just that the service exists", () => {
    for (const service of LOOKUP_SERVICES) {
      expect(
        service.description.length,
        `${service.id} needs a real description`,
      ).toBeGreaterThan(40);
    }
  });

  it("marks the services that fetch the target themselves", () => {
    // The reader is about to cause traffic to somebody else's site, and they
    // should know that before they click rather than after.
    const visiting = LOOKUP_SERVICES.filter((s) => s.visitsTarget).map(
      (s) => s.id,
    );
    expect(visiting).toContain("ssllabs");
    expect(visiting).toContain("mozilla-observatory");
    // A pure lookup against somebody's existing database is not a visit.
    expect(visiting).not.toContain("virustotal");
    expect(visiting).not.toContain("wayback");
  });
});
