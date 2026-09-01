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

const { GET } = await import("@/app/api/v3/badge/[token]/route");

function makeRequest() {
  return new NextRequest("http://localhost/api/v3/badge/token");
}

function callGet(token: string) {
  return GET(makeRequest(), { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  mockQuery.mockReset();
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
    expect(body).toContain("#22c55e");
    expect(body).not.toContain("example.com");
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
    expect(body).toContain("#eab308");
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
    expect(body).toContain("#ef4444");
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
