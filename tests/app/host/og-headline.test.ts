/**
 * The social card for a host with no public scan used to print whatever the
 * path said, at 62px, in the brand frame. These pin the two things that keep
 * it from being a free "VulnRadar says ..." banner: only a hostname-shaped
 * string is ever shown, and anything else gets a headline with no user text.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// host-summary and host-reputation both import the pool at module load.
vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn() },
}));

const { unscannedHostHeadline, OG_GENERIC_HOST_HEADLINE } =
  await import("@/app/host/[hostname]/og-headline");

describe("unscannedHostHeadline", () => {
  it("shows the normalized hostname for a real, unscanned host", () => {
    expect(unscannedHostHeadline("Example.COM")).toBe("example.com");
    expect(unscannedHostHeadline("www.example.com")).toBe("example.com");
    expect(unscannedHostHeadline("shop.example.co.uk")).toBe(
      "shop.example.co.uk",
    );
  });

  it("reduces a pasted URL to its host and drops the path", () => {
    expect(
      unscannedHostHeadline("https%3A%2F%2Fexample.com%2Fa%2Fb%3Fq%3D1"),
    ).toBe("example.com");
  });

  it("never echoes a sentence from the path", () => {
    const sentence = "Your%20account%20is%20locked%3A%20visit%20evil.example";
    expect(unscannedHostHeadline(sentence)).toBe(OG_GENERIC_HOST_HEADLINE);
  });

  it("does not let a scheme turn text into an opaque host", () => {
    // `foo://Your%20account%20is%20locked` parses, and the host keeps its
    // percent escapes as readable words. The shape check is what stops it.
    const headline = unscannedHostHeadline(
      encodeURIComponent("foo://Your%20account%20is%20locked"),
    );
    expect(headline).toBe(OG_GENERIC_HOST_HEADLINE);
  });

  it("falls back for input that is not a domain", () => {
    expect(unscannedHostHeadline("")).toBe(OG_GENERIC_HOST_HEADLINE);
    expect(unscannedHostHeadline("%20%20")).toBe(OG_GENERIC_HOST_HEADLINE);
    expect(unscannedHostHeadline("203.0.113.9")).toBe(OG_GENERIC_HOST_HEADLINE);
    expect(unscannedHostHeadline("%5B%3A%3A1%5D")).toBe(
      OG_GENERIC_HOST_HEADLINE,
    );
    // Malformed percent escape: decodeHostParam hands the raw text back.
    expect(unscannedHostHeadline("%E0%A4%A")).toBe(OG_GENERIC_HOST_HEADLINE);
  });

  it("caps the length of a very long hostname", () => {
    const long = `${"a".repeat(60)}.${"b".repeat(60)}.example.com`;
    const headline = unscannedHostHeadline(long);
    expect(headline.length).toBeLessThanOrEqual(64);
    expect(headline.endsWith("...")).toBe(true);
    expect(headline.startsWith("aaaa")).toBe(true);
  });

  it("leaves a hostname at the cap untouched", () => {
    const host = `${"a".repeat(52)}.example.com`;
    expect(host.length).toBe(64);
    expect(unscannedHostHeadline(host)).toBe(host);
  });

  it("uses a generic line that carries no input", () => {
    expect(OG_GENERIC_HOST_HEADLINE).toBe("Website security report");
  });
});

describe("opengraph-image.tsx wiring", () => {
  // The generator is a .tsx and this config has no JSX transform, so it is
  // read as text (the same approach as tests/app/_og/cache.test.ts). What
  // regresses is passing the decoded path back in as the headline.
  const source = readFileSync(
    fileURLToPath(
      new URL(
        "../../../app/host/[hostname]/opengraph-image.tsx",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  it("routes the not-found headline through unscannedHostHeadline", () => {
    expect(source).toContain("headline={unscannedHostHeadline(hostname)}");
  });

  it("no longer renders the raw decoded path anywhere", () => {
    expect(source).not.toMatch(/headline=\{decodeHostParam/);
    expect(source).not.toContain("decodeHostParam");
  });
});
