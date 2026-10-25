/**
 * Route-level tests for GET /api/v3/badge/[token].
 *
 * This endpoint is unauthenticated and public (it backs an <img> badge
 * embedded on third-party sites), so the priority is that an invalid,
 * malformed, or unknown token never leaks scan data and always degrades to
 * a generic SVG rather than an error page or partial payload.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// The per-IP limiter writes to the database itself, which would shift every
// positional mockQuery assertion below, and getClientIp reads next/headers,
// which only exists inside a request. Both are mocked at their own boundary.
const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));
vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: async () => "203.0.113.9",
  rateLimitIpKey: (ip: string) => ip,
}));

const { GET } = await import("@/app/api/v3/badge/[token]/route");
const { BRAND } = await import("@/lib/config/brand");

function makeRequest() {
  return new NextRequest("http://localhost/api/v3/badge/token");
}

function callGet(token: string) {
  return GET(makeRequest(), { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 599,
    retryAfterSeconds: 0,
  });
});

describe("per-IP rate limit", () => {
  // The route is unauthenticated and every uncached hit parses a scan's whole
  // findings array to print a three-word rating. The sibling /host routes
  // already carry a per-IP cap; this one did not.
  it("answers 429 with a readable SVG and a Retry-After, without touching scan data", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 37,
    });

    const res = await callGet("d".repeat(64));

    expect(res.status).toBe(429);
    // Still an image, so a throttled <img> draws something instead of a
    // broken-image icon.
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(res.headers.get("Retry-After")).toBe("37");
    // Never cached: the next minute is a new bucket.
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toContain("Busy, retry later");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("keys the bucket on the caller's address, with a ceiling that image proxies will not reach", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await callGet("e".repeat(64));

    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1);
    const [config] = mockCheckRateLimit.mock.calls[0];
    expect(config.key).toBe("badge-svg:203.0.113.9");
    // Ten a second from one address. The /host routes allow 60 a minute and
    // say outright that badges must be more lenient than that, because embeds
    // are fetched through proxies that funnel many readers through few
    // addresses.
    expect(config.windowSeconds).toBe(60);
    expect(config.maxAttempts).toBeGreaterThanOrEqual(300);
  });

  it("does not spend the limiter on a token that is not even 64 characters", async () => {
    await callGet("short-token");
    await callGet("");

    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });
});

describe("error handling", () => {
  it("answers 500 instead of rejecting when the lookup throws", async () => {
    // The handler is wrapped in withErrorHandling, so a database failure is a
    // response (and a system_error_logs row tied to a request id) rather than
    // an exception escaping the route.
    mockQuery.mockRejectedValue(new Error("db unavailable"));

    const res = await callGet("f".repeat(64));

    expect(res.status).toBe(500);
  });
});

describe("GET /api/v3/badge/[token]", () => {
  it("returns the generic Invalid Link SVG for an empty token without querying the database", async () => {
    const res = await callGet("");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    const body = await res.text();
    expect(body).toContain("<svg");
    expect(body).toContain("Invalid Link");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns the generic Invalid Link SVG for a short, malformed token", async () => {
    const res = await callGet("short-token");

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Invalid Link");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a token one character short of 64 before touching the database", async () => {
    const res = await callGet("a".repeat(63));

    const body = await res.text();
    expect(body).toContain("Invalid Link");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a token one character over 64 before touching the database", async () => {
    const res = await callGet("a".repeat(65));

    const body = await res.text();
    expect(body).toContain("Invalid Link");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("looks up the SHA-256 hash of the token, never the plaintext", async () => {
    const token = "b".repeat(64);
    // Miss on the per-scan share_token_hash lookup falls through to the
    // host_badges lookup (see the next describe block) -- mock both.
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await callGet(token);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("share_token_hash = $1");
    const expectedHash = createHash("sha256").update(token).digest("hex");
    expect(params).toEqual([expectedHash]);
    expect(params[0]).not.toBe(token);
  });

  it("excludes an expired share link in SQL, so the badge falls back to the same Link Expired SVG", async () => {
    const token = "9".repeat(64);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await callGet(token);

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain(
      "AND (sh.share_expires_at IS NULL OR sh.share_expires_at > NOW())",
    );
  });

  it("returns the generic Link Expired SVG with a 200 status when the token matches neither a share link nor a site badge, leaking no scan data", async () => {
    const token = "c".repeat(64);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await callGet(token);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    const body = await res.text();
    expect(body).toContain("<svg");
    expect(body).toContain("Link Expired");
    expect(body).not.toContain("example.com");
  });

  it("falls back to the host_badges lookup when no per-scan share token matches, resolving to the latest completed scan of that URL", async () => {
    const token = "5".repeat(64);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // share_token_hash miss
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          url: "https://example.com",
          summary: {},
          findings: [{ severity: "critical", title: "SQL Injection" }],
          scanned_at: "2026-02-01T00:00:00.000Z",
        },
      ],
    });
    // getSetting("BADGE_CACHE_MAX_AGE_SECONDS")'s own system_settings read,
    // fired once a row is actually found -- only success-path tests reach it.
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await callGet(token);

    expect(mockQuery).toHaveBeenCalledTimes(3);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("FROM host_badges hb");
    expect(sql).toContain("badge_token_hash = $1");
    expect(sql).toContain("hb.revoked_at IS NULL");
    expect(sql).toContain("sh.status = 'completed'");
    expect(sql).toContain("ORDER BY sh.scanned_at DESC");
    // Resolves to the owner's own scans unless they've opted into
    // hb.scope = 'global', in which case a completed scan of the URL by
    // anyone can match -- but only if that scan is public (is_public =
    // true), never a private or authenticated scan someone else ran.
    expect(sql).toContain(
      "(sh.user_id = hb.user_id OR (hb.scope = 'global' AND sh.is_public = true))",
    );
    const expectedHash = createHash("sha256").update(token).digest("hex");
    expect(params).toEqual([expectedHash]);

    const body = await res.text();
    expect(body).toContain("F -");
  });

  it("renders an A+ grade on a green badge for a scan with no findings", async () => {
    const token = "d".repeat(64);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          url: "https://example.com",
          summary: {},
          findings: [],
          scanned_at: "2026-01-15T00:00:00.000Z",
        },
      ],
    });

    const res = await callGet(token);

    expect(res.status).toBe(200);
    const body = await res.text();
    // The letter grade is now the label; the safe/caution/unsafe rating still
    // picks the colour, so the badge's at-a-glance meaning is unchanged.
    // ref: AUDIT-014#comp-03
    expect(body).toContain("A+ -");
    expect(body).toContain(BRAND.success);
    expect(body).not.toContain("example.com");
  });

  /**
   * execute-scan.ts stores the grade in result_meta.siteGrade specifically so
   * "the public host report and the badge agree with the scan record even if
   * the mapping is ever retuned". The badge recomputed it from findings
   * instead, which is exactly the drift that comment exists to prevent: a
   * retune would silently change what an already-embedded badge printed for a
   * scan that ran months ago.
   *
   * The rows below all carry findings that would recompute to a DIFFERENT
   * letter, so a test can only pass by reading the stored value.
   */
  it("prints the grade the scan stored, not one recomputed from findings", async () => {
    const token = "7".repeat(64);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          url: "https://example.com",
          summary: {},
          findings: [
            { severity: "critical", title: "SQL Injection in login form" },
          ],
          scanned_at: "2026-01-15T00:00:00.000Z",
          result_meta: { siteGrade: "B" },
        },
      ],
    });

    const res = await callGet(token);

    const body = await res.text();
    expect(body).toContain("B -");
    expect(body).not.toContain("F -");
    // The safety rating still picks the colour, so a stored grade never
    // repaints a dangerous host green.
    expect(body).toContain(BRAND.severity.critical);
  });

  it("reads a stored grade out of a result_meta column returned as a JSON string", async () => {
    const token = "8".repeat(64);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          url: "https://example.com",
          summary: {},
          findings: [],
          scanned_at: "2026-01-15T00:00:00.000Z",
          result_meta: JSON.stringify({ siteGrade: "C" }),
        },
      ],
    });

    const body = await (await callGet(token)).text();
    expect(body).toContain("C -");
  });

  it.each([
    ["a scan that predates the stored grade", { dangerScore: 0 }],
    ["a null result_meta", null],
    ["unparseable result_meta", "{not json"],
    ["a grade that is not one of the six letters", { siteGrade: "Z" }],
    ["a non-string grade", { siteGrade: 3 }],
  ])("recomputes the grade for %s", async (_label, result_meta) => {
    const token = "9".repeat(64);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          url: "https://example.com",
          summary: {},
          findings: [
            { severity: "critical", title: "SQL Injection in login form" },
          ],
          scanned_at: "2026-01-15T00:00:00.000Z",
          result_meta,
        },
      ],
    });

    const body = await (await callGet(token)).text();
    expect(body).toContain("F -");
    expect(body).not.toContain("Z -");
  });

  it("falls back to an empty findings array when the column is null", async () => {
    const token = "2".repeat(64);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          url: "https://example.com",
          summary: {},
          findings: null,
          scanned_at: "2026-01-15T00:00:00.000Z",
        },
      ],
    });

    const res = await callGet(token);

    const body = await res.text();
    expect(body).toContain("A+ -");
  });

  it("keeps the caution colour while grading a single high-severity exploitable finding D", async () => {
    const token = "e".repeat(64);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          url: "https://example.com",
          summary: {},
          findings: [
            { severity: "high", title: "SQL Injection in search field" },
          ],
          scanned_at: "2026-01-15T00:00:00.000Z",
        },
      ],
    });

    const res = await callGet(token);

    const body = await res.text();
    expect(body).toContain("D -");
    // Was a transcribed "#eab308", stock Tailwind yellow-500, which is not
    // the product's amber (#e7b008) - so the suite asserted the badge
    // route's private copy of the colour rather than checking it against
    // the palette. Reading BRAND here means the test cannot agree with a
    // drifted value again.
    expect(body).toContain(BRAND.severity.medium);
  });

  it("grades a critical exploitable finding F and keeps the unsafe colour", async () => {
    const token = "f".repeat(64);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          url: "https://example.com",
          summary: {},
          findings: [
            { severity: "critical", title: "SQL Injection in login form" },
          ],
          scanned_at: "2026-01-15T00:00:00.000Z",
        },
      ],
    });

    const res = await callGet(token);

    const body = await res.text();
    expect(body).toContain("F -");
    expect(body).toContain(BRAND.severity.critical);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=3600, s-maxage=3600",
    );
  });

  it("parses findings stored as a JSON string", async () => {
    const token = "1".repeat(64);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          url: "https://example.com",
          summary: {},
          findings: JSON.stringify([
            { severity: "critical", title: "SQL Injection" },
          ]),
          scanned_at: "2026-01-15T00:00:00.000Z",
        },
      ],
    });

    const res = await callGet(token);

    const body = await res.text();
    expect(body).toContain("F -");
  });
});
