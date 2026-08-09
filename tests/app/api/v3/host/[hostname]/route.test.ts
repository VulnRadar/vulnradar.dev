/**
 * Route-level tests for GET /api/v3/host/[hostname].
 *
 * Public, unauthenticated counterpart to GET /api/v3/scan/reputation: backs
 * the no-login report page at /host/[hostname]. No session/API-key check
 * and no rate limiting (same as GET /api/v3/shared/[token], the closest
 * existing precedent for a public no-login report), just host_reputation
 * looked up by the normalized hostname.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { GET } = await import("@/app/api/v3/host/[hostname]/route");

function getRequest(hostname: string) {
  return new NextRequest(
    `http://localhost/api/v3/host/${encodeURIComponent(hostname)}`,
    { method: "GET" },
  );
}

function params(hostname: string) {
  return { params: Promise.resolve({ hostname }) };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("GET /api/v3/host/[hostname]", () => {
  it("requires no auth at all -- no session or API key mock is even wired up", async () => {
    const res = await GET(getRequest("example.com"), params("example.com"));
    expect(res.status).toBe(200);
  });

  it("400s for a raw-IP hostname (host_reputation only tracks domains)", async () => {
    const res = await GET(getRequest("192.168.1.1"), params("192.168.1.1"));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("normalizes the hostname the same way storage does before looking it up", async () => {
    await GET(getRequest("www.Example.com"), params("www.Example.com"));
    const [sql, queryParams] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM host_reputation");
    expect(queryParams).toEqual(["example.com"]);
  });

  it("returns known: false with an empty findings array when the host has no public scan", async () => {
    const res = await GET(getRequest("neverseen.com"), params("neverseen.com"));
    const body = await res.json();
    expect(body).toEqual({
      known: false,
      host: "neverseen.com",
      dangerScore: null,
      severityCounts: null,
      findings: [],
      responseHeaders: null,
      lastScannedAt: null,
      authenticated: false,
    });
  });

  it("returns the full findings snapshot when the host has a public scan on record", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          danger_score: 7,
          severity_counts: { critical: 1, high: 0, medium: 2, low: 0, info: 1 },
          findings: [
            { id: "a", severity: "critical", title: "Exposed .env file" },
          ],
          response_headers: { "x-frame-options": "DENY" },
          last_scanned_at: "2026-01-01T00:00:00.000Z",
          result_meta: { checksRun: 42 },
          authenticated: true,
        },
      ],
      rowCount: 1,
    });

    const res = await GET(getRequest("bad-site.com"), params("bad-site.com"));
    const body = await res.json();
    expect(body).toEqual({
      known: true,
      host: "bad-site.com",
      dangerScore: 7,
      severityCounts: { critical: 1, high: 0, medium: 2, low: 0, info: 1 },
      findings: [{ id: "a", severity: "critical", title: "Exposed .env file" }],
      responseHeaders: { "x-frame-options": "DENY" },
      lastScannedAt: "2026-01-01T00:00:00.000Z",
      authenticated: true,
      checksRun: 42,
    });
  });

  it("never reflects a scan its owner marked private -- that's enforced upstream by not populating host_reputation, so an empty row here just means 'nothing public yet'", async () => {
    // host_reputation has no row at all for this host (upsertHostReputation
    // was skipped or the row was deleted on the public->private flip), so
    // this route has nothing more to check -- it's a plain cache lookup.
    const res = await GET(
      getRequest("wentprivate.com"),
      params("wentprivate.com"),
    );
    const body = await res.json();
    expect(body.known).toBe(false);
  });

  it("500s and does not leak the raw error when the query throws", async () => {
    mockQuery.mockRejectedValue(new Error("db exploded"));
    const res = await GET(getRequest("example.com"), params("example.com"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain("db exploded");
  });
});
