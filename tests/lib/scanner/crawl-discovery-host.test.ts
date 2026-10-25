import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSafeFetch = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));

import {
  normalizeHost,
  isSameHost,
  landedPageUrl,
  discoverPages,
  collectSitemapUrls,
} from "@/lib/scanner/crawl-discovery";

/**
 * A response that reports `finalUrl` as where it landed. `Response.url` is a
 * prototype getter that is empty on a constructed Response, so it is defined
 * on the instance the way safeFetch's real responses carry it.
 */
function reply(body: string, finalUrl: string, init: ResponseInit = {}) {
  const response = new Response(body, {
    status: 200,
    headers: { "content-type": "text/html" },
    ...init,
  });
  Object.defineProperty(response, "url", { value: finalUrl });
  return response;
}

const SETTINGS = { maxPages: 10, fetchTimeoutMs: 1000, maxBodySize: 100_000 };

beforeEach(() => {
  mockSafeFetch.mockReset();
});

describe("normalizeHost", () => {
  it("lower-cases, and drops the root-label dot and IPv6 brackets", () => {
    expect(normalizeHost("EXAMPLE.com.")).toBe("example.com");
    expect(normalizeHost("[::1]")).toBe("::1");
    expect(normalizeHost("example.com")).toBe("example.com");
  });
});

describe("isSameHost", () => {
  it("compares by normalised host, so a trailing dot is still the same site", () => {
    expect(isSameHost("https://example.com./about", "example.com")).toBe(true);
    expect(isSameHost("https://example.com/about", "example.com.")).toBe(true);
  });

  it("does not fold www into the apex: those are different hosts to the crawl", () => {
    expect(isSameHost("https://www.example.com/", "example.com")).toBe(false);
  });

  it("is false for another host, a bare IP, or something that is not a URL", () => {
    expect(isSameHost("https://evil.test/", "example.com")).toBe(false);
    expect(isSameHost("http://93.184.216.34/", "example.com")).toBe(false);
    expect(isSameHost("not a url", "example.com")).toBe(false);
  });
});

describe("landedPageUrl", () => {
  it("says nothing when the fetch ended where it started", () => {
    expect(
      landedPageUrl("https://example.com/about", "https://example.com/about"),
    ).toBeUndefined();
  });

  it("does not call the same page spelled two ways a redirect", () => {
    expect(
      landedPageUrl("https://example.com", "https://example.com/"),
    ).toBeUndefined();
    expect(
      landedPageUrl("https://example.com/about", "https://example.com/about/"),
    ).toBeUndefined();
  });

  it("reports a same-host redirect to another page", () => {
    expect(
      landedPageUrl("https://example.com/old", "https://example.com/new"),
    ).toBe("https://example.com/new");
  });

  it("reports a www redirect, which is a real hop safeFetch allows", () => {
    expect(
      landedPageUrl("https://example.com/", "https://www.example.com/"),
    ).toBe("https://www.example.com/");
  });

  it("ignores the resolved IP a plain-http fetch is pinned to", () => {
    // safeFetch connects to the IP and names the host only in the Host header,
    // so the response can report http://<ip>/ for a request that named a host.
    expect(
      landedPageUrl("http://example.com/about", "http://93.184.216.34/about"),
    ).toBeUndefined();
    expect(
      landedPageUrl("http://example.com/", "http://[2606:2800:220:1::1]/"),
    ).toBeUndefined();
  });

  it("still reports a redirect when the request itself named an IP", () => {
    expect(landedPageUrl("http://10.0.0.1/a", "http://10.0.0.1/b")).toBe(
      "http://10.0.0.1/b",
    );
  });

  it("says nothing for an empty or unparseable landing", () => {
    expect(landedPageUrl("https://example.com/", "")).toBeUndefined();
    expect(landedPageUrl("https://example.com/", undefined)).toBeUndefined();
    expect(landedPageUrl("https://example.com/", "not a url")).toBeUndefined();
  });
});

describe("discoverPages: the host a response reports", () => {
  it("follows a page's links when the response spells the entry host with a trailing dot", async () => {
    mockSafeFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/robots.txt") || url.endsWith("/sitemap.xml")) {
        return reply("", url, { status: 404 });
      }
      return reply(
        '<a href="https://example.com/about">About</a>',
        "https://example.com./",
      );
    });

    const pages = await discoverPages("https://example.com/", SETTINGS);

    expect(pages).toContain("https://example.com/about");
    // The spelling the response used never becomes a page of its own.
    expect(pages.some((p) => p.includes("example.com."))).toBe(false);
  });

  it("resolves a relative link against the entry host, not the response's spelling", async () => {
    mockSafeFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/robots.txt") || url.endsWith("/sitemap.xml")) {
        return reply("", url, { status: 404 });
      }
      return reply('<a href="/pricing">Pricing</a>', "https://example.com./");
    });

    const pages = await discoverPages("https://example.com/", SETTINGS);

    expect(pages).toContain("https://example.com/pricing");
  });

  it("still refuses a response that landed on another host", async () => {
    mockSafeFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/robots.txt") || url.endsWith("/sitemap.xml")) {
        return reply("", url, { status: 404 });
      }
      return reply(
        '<a href="https://example.com/about">About</a>',
        "https://evil.test/",
      );
    });

    const pages = await discoverPages("https://example.com/", SETTINGS);

    expect(pages).toEqual(["https://example.com/"]);
  });
});

describe("collectSitemapUrls: the host a response reports", () => {
  it("reads a sitemap whose response spells the entry host with a trailing dot", async () => {
    mockSafeFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/sitemap.xml")) {
        return reply(
          "<urlset><url><loc>/pricing</loc></url><url><loc>https://example.com/docs</loc></url></urlset>",
          "https://example.com./sitemap.xml",
          { headers: { "content-type": "application/xml" } },
        );
      }
      return reply("", url, { status: 404 });
    });

    const urls = await collectSitemapUrls("https://example.com/", SETTINGS);

    // A relative <loc> resolves against the entry host as well.
    expect(urls).toEqual([
      "https://example.com/pricing",
      "https://example.com/docs",
    ]);
  });
});
