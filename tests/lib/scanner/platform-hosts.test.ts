import { describe, it, expect } from "vitest";
import {
  isPlatformSubdomain,
  mailDomainFor,
  platformOf,
} from "@/lib/scanner/platform-hosts";

describe("mailDomainFor", () => {
  it("strips www and subdomains down to the registrable domain", () => {
    expect(mailDomainFor("www.fastmail.com")).toBe("fastmail.com");
    expect(mailDomainFor("app.staging.example.com")).toBe("example.com");
    expect(mailDomainFor("example.com")).toBe("example.com");
  });

  it("keeps the multi-label suffixes extractRootDomain knows", () => {
    expect(mailDomainFor("shop.example.co.uk")).toBe("example.co.uk");
  });

  it("keeps a country second level the root-domain table does not list", () => {
    // extractRootDomain alone answers com.sg, a public suffix nobody owns, so
    // SPF, DMARC and MX were checked against it.
    expect(mailDomainFor("example.com.sg")).toBe("example.com.sg");
    expect(mailDomainFor("www.example.com.sg")).toBe("example.com.sg");
    expect(mailDomainFor("mail.shop.co.id")).toBe("shop.co.id");
    expect(mailDomainFor("app.example.com.tr")).toBe("example.com.tr");
  });

  it("lower-cases and drops a trailing dot", () => {
    expect(mailDomainFor("WWW.Example.COM.")).toBe("example.com");
  });

  it("never climbs a bare label or an address into something a resolver reads as a TLD", () => {
    expect(mailDomainFor("localhost")).toBe("localhost");
    expect(mailDomainFor("203.0.113.7")).toBe("203.0.113.7");
    expect(mailDomainFor("[2001:db8::1]")).toBe("[2001:db8::1]");
  });
});

describe("platformOf", () => {
  it.each([
    ["civilian-operations.vercel.app", "vercel.app"],
    ["marcel-tv.blogspot.com", "blogspot.com"],
    ["r-j-r.jimdofree.com", "jimdofree.com"],
    ["syntaxsorgu.great-site.net", "great-site.net"],
    ["veloxamarket.mysellauth.com", "mysellauth.com"],
    ["vulnradar.lovable.app", "lovable.app"],
    ["jay-doc.selfhost.eu", "selfhost.eu"],
    ["user.github.io", "github.io"],
    ["deep.nested.name.netlify.app", "netlify.app"],
  ])("names the platform for %s", (host, suffix) => {
    expect(platformOf(host)?.suffix).toBe(suffix);
    expect(isPlatformSubdomain(host)).toBe(true);
  });

  it.each([
    ["x.wordpress.com", "wordpress.com"],
    ["x.appspot.com", "appspot.com"],
    ["bucket.s3.amazonaws.com", "amazonaws.com"],
    ["x.azureedge.net", "azureedge.net"],
    ["x.b-cdn.net", "b-cdn.net"],
    ["x.deno.dev", "deno.dev"],
    ["x.r2.dev", "r2.dev"],
  ])("also covers the zones the SRI check used to list: %s", (host, suffix) => {
    expect(platformOf(host)?.suffix).toBe(suffix);
  });

  it("returns an operator name a message can use", () => {
    expect(platformOf("x.vercel.app")?.name).toBe("Vercel");
  });

  it("does not treat the platform's own zone as a tenant", () => {
    expect(platformOf("vercel.app")).toBeNull();
    expect(isPlatformSubdomain("github.io")).toBe(false);
  });

  it("matches on label boundaries only", () => {
    expect(platformOf("notvercel.app")).toBeNull();
    expect(platformOf("xvercel.app")).toBeNull();
    expect(platformOf("vercel.app.example.com")).toBeNull();
    expect(platformOf("example.com")).toBeNull();
    expect(platformOf("www.example.com")).toBeNull();
  });

  it("ignores case and a trailing dot", () => {
    expect(platformOf("Shop.Vercel.App.")?.suffix).toBe("vercel.app");
  });

  it("returns null for an empty or address-like host", () => {
    expect(platformOf("")).toBeNull();
    expect(platformOf("203.0.113.7")).toBeNull();
  });
});
