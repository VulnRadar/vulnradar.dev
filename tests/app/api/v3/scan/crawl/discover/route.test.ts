/**
 * Route-level tests for POST /api/v3/scan/crawl/discover.
 *
 * Covers auth (session or API key), rate limiting, request validation, and
 * the same-origin link discovery crawl itself. The network boundary
 * (safeFetch) is mocked; the crawl/filtering logic in the route is real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { SCANNING } from "@/lib/config/constants";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

// Not used directly by this route, but lib/rate-limiting/rate-limit.ts (kept
// real below via importOriginal, for RATE_LIMITS) imports pool from here, so
// it needs a mock to avoid requiring a real DATABASE_URL in the test env.
vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn() },
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  };
});

const mockValidateApiKey = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

const mockSafeFetch = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));

const { POST } = await import("@/app/api/v3/scan/crawl/discover/route");

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v3/scan/crawl/discover", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function htmlResponse(
  url: string,
  body: string,
  contentType = "text/html; charset=utf-8",
): Response {
  const res = new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
  Object.defineProperty(res, "url", { value: url, configurable: true });
  return res;
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 9,
    retryAfterSeconds: 0,
  });
  mockValidateApiKey.mockReset();
  mockSafeFetch.mockReset();
  mockSafeFetch.mockImplementation(async (url: string) =>
    htmlResponse(url, "<html><body>empty</body></html>"),
  );
});

describe("POST /api/v3/scan/crawl/discover: auth", () => {
  it("rejects an unauthenticated request before rate limiting or fetching", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(401);
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("rejects an invalid or revoked API key", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateApiKey.mockResolvedValue(null);

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_live_bad" },
      ),
    );

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Invalid or revoked API key.");
  });

  it("rejects an API key whose owner has not accepted updated terms", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateApiKey.mockResolvedValue({
      userId: 7,
      needsTermsAcceptance: true,
    });

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_live_good" },
      ),
    );

    expect(res.status).toBe(403);
  });

  it("accepts a valid API key and uses its userId for rate limiting", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateApiKey.mockResolvedValue({
      userId: 77,
      needsTermsAcceptance: false,
    });

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_live_good" },
      ),
    );

    expect(res.status).toBe(200);
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "crawl-discover:77", limit: "scan" }),
    );
  });
});

describe("POST /api/v3/scan/crawl/discover: rate limiting", () => {
  it("returns 429 when the rate limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 30,
    });

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(429);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/scan/crawl/discover: request validation", () => {
  it("rejects a missing URL", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("URL is required");
  });

  it("rejects a URL longer than the configured maximum", async () => {
    const longUrl = `https://example.com/${"a".repeat(SCANNING.MAX_URL_LENGTH)}`;
    const res = await POST(postRequest({ url: longUrl }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("exceeds maximum length");
  });

  it("rejects a malformed URL", async () => {
    const res = await POST(postRequest({ url: "not a url" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid URL");
  });

  it("rejects a non-http(s) protocol", async () => {
    const res = await POST(postRequest({ url: "ftp://example.com/file" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Only http and https URLs are allowed");
  });
});

describe("POST /api/v3/scan/crawl/discover: crawl behavior", () => {
  it("discovers same-host links, skips assets/API paths/off-host/non-web links, and dedupes", async () => {
    mockSafeFetch.mockImplementation(async (url: string) => {
      if (url === "https://example.com/") {
        return htmlResponse(
          url,
          `
            <a href="/about">About</a>
            <a href="https://example.com/contact">Contact</a>
            <a href="/about">About again</a>
            <a href="/style.css">Stylesheet</a>
            <a href="https://other.com/page">External</a>
            <a href="mailto:test@example.com">Mail</a>
            <a href="/api/internal">Internal API</a>
            <a href="/api-data">Api-ish data page</a>
          `,
        );
      }
      if (url === "https://example.com/api-data") {
        return htmlResponse(url, "{}", "application/json");
      }
      return htmlResponse(url, "<html><body>leaf</body></html>");
    });

    const res = await POST(postRequest({ url: "https://example.com/" }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.urls).toEqual(
      expect.arrayContaining([
        "https://example.com/",
        "https://example.com/about",
        "https://example.com/contact",
        "https://example.com/api-data",
      ]),
    );
    expect(json.urls).not.toContain("https://example.com/style.css");
    expect(json.urls).not.toContain("https://other.com/page");
    expect(json.urls).not.toContain("https://example.com/api/internal");
    // /about was linked twice but must be deduped.
    expect(
      json.urls.filter((u: string) => u === "https://example.com/about"),
    ).toHaveLength(1);
  });

  it("calls safeFetch with the entry hostname as the only allowed redirect target", async () => {
    await POST(postRequest({ url: "https://example.com/" }));

    expect(mockSafeFetch).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({ method: "GET", redirect: "follow" }),
      ["example.com"],
    );
  });

  it("drops a page whose response redirected off the entry hostname", async () => {
    mockSafeFetch.mockImplementation(async () =>
      htmlResponse(
        "https://redirected-elsewhere.com/",
        "<a href='/should-not-be-found'>x</a>",
      ),
    );

    const res = await POST(postRequest({ url: "https://example.com/" }));
    const json = await res.json();

    expect(json.urls).toEqual(["https://example.com/"]);
  });

  it("skips a page whose fetch throws and keeps crawling the rest of the queue", async () => {
    mockSafeFetch.mockImplementation(async (url: string) => {
      if (url === "https://example.com/") {
        throw new Error("connection reset");
      }
      return htmlResponse(url, "<html></html>");
    });

    const res = await POST(postRequest({ url: "https://example.com/" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.urls).toEqual(["https://example.com/"]);
  });
});
