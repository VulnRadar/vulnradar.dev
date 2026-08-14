/**
 * Route-level tests for GET /api/v3/host/[hostname]/trend.
 *
 * Public, unauthenticated: backs the risk-score history chart on
 * /host/[hostname] (components/host/danger-score-trend.tsx). Reads
 * scan_history directly (host_reputation only ever keeps the latest scan),
 * scoped to is_public = true AND status = 'completed', same privacy
 * boundary as getExactUrlReputation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { GET } = await import("@/app/api/v3/host/[hostname]/trend/route");

function getRequest(hostname: string) {
  return new NextRequest(
    `http://localhost/api/v3/host/${encodeURIComponent(hostname)}/trend`,
    { method: "GET" },
  );
}

function params(hostname: string) {
  return { params: Promise.resolve({ hostname }) };
}

function findingRow(overrides: {
  id: number;
  scanned_at: string;
  severity?: string | null;
}) {
  return {
    id: overrides.id,
    scanned_at: overrides.scanned_at,
    findings:
      overrides.severity === null
        ? []
        : [
            {
              severity: overrides.severity ?? "critical",
              title: "Some finding",
            },
          ],
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("GET /api/v3/host/[hostname]/trend", () => {
  it("requires no auth at all -- no session or API key mock is even wired up", async () => {
    const res = await GET(getRequest("example.com"), params("example.com"));
    expect(res.status).toBe(200);
  });

  it("400s for a raw-IP hostname", async () => {
    const res = await GET(getRequest("192.168.1.1"), params("192.168.1.1"));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("normalizes the hostname the same way host_reputation does before querying", async () => {
    await GET(getRequest("www.Example.com"), params("www.Example.com"));
    const [, queryParams] = mockQuery.mock.calls[0];
    expect((queryParams as unknown[])[0]).toBe(
      "^https?://(www\\.)?example\\.com([:/?]|$)",
    );
  });

  it("scopes the query to public, completed scans only", async () => {
    await GET(getRequest("example.com"), params("example.com"));
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM scan_history");
    expect(sql).toContain("is_public = true");
    expect(sql).toContain("status = 'completed'");
  });

  it("caps the query at the 30-scan LIMIT", async () => {
    await GET(getRequest("example.com"), params("example.com"));
    const [, queryParams] = mockQuery.mock.calls[0];
    expect((queryParams as unknown[])[1]).toBe(30);
  });

  it("escapes regex-special characters in the hostname", async () => {
    // normalizeHostForReputation lowercases and only ever returns a
    // domain-shaped hostname, but the dot(s) in it are regex metachars
    // that must be escaped literally, not left to match any character.
    await GET(getRequest("my-site.co.uk"), params("my-site.co.uk"));
    const [, queryParams] = mockQuery.mock.calls[0];
    expect((queryParams as unknown[])[0]).toBe(
      "^https?://(www\\.)?my-site\\.co\\.uk([:/?]|$)",
    );
  });

  it("returns an empty points array when the host has no matching scan history", async () => {
    const res = await GET(getRequest("neverseen.com"), params("neverseen.com"));
    const body = await res.json();
    expect(body).toEqual({ host: "neverseen.com", points: [] });
  });

  it("computes a danger score per row and returns points oldest-first", async () => {
    // Query orders DESC (newest first) for an efficient LIMIT; the route
    // must reverse this back to chronological order for the chart.
    mockQuery.mockResolvedValue({
      rows: [
        findingRow({ id: 3, scanned_at: "2026-01-03T00:00:00.000Z" }),
        findingRow({
          id: 2,
          scanned_at: "2026-01-02T00:00:00.000Z",
          severity: null,
        }),
        findingRow({ id: 1, scanned_at: "2026-01-01T00:00:00.000Z" }),
      ],
      rowCount: 3,
    });

    const res = await GET(getRequest("bad-site.com"), params("bad-site.com"));
    const body = await res.json();

    expect(body.host).toBe("bad-site.com");
    expect(body.points).toHaveLength(3);
    expect(body.points.map((p: { scanId: number }) => p.scanId)).toEqual([
      1, 2, 3,
    ]);
    expect(body.points[0].scannedAt).toBe("2026-01-01T00:00:00.000Z");
    // Row 2 has no findings at all -> danger score 0.
    expect(body.points[1].dangerScore).toBe(0);
    // Rows with a critical finding score above 0.
    expect(body.points[0].dangerScore).toBeGreaterThan(0);
    expect(body.points[2].dangerScore).toBeGreaterThan(0);
  });

  it("parses a JSON-string findings column the same way getExactUrlReputation does", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        // Real Postgres returns these ORDER BY scanned_at DESC (newest
        // first) -- the route reverses them back to chronological order,
        // so this mock must supply DESC order for that reversal to land
        // the older, non-empty-findings row at points[0].
        {
          id: 2,
          scanned_at: "2026-01-02T00:00:00.000Z",
          findings: JSON.stringify([]),
        },
        {
          id: 1,
          scanned_at: "2026-01-01T00:00:00.000Z",
          findings: JSON.stringify([
            { severity: "critical", title: "Exposed .env file" },
          ]),
        },
      ],
      rowCount: 2,
    });

    const res = await GET(getRequest("bad-site.com"), params("bad-site.com"));
    const body = await res.json();
    expect(body.points[0].dangerScore).toBeGreaterThan(0);
    expect(body.points[1].dangerScore).toBe(0);
  });

  it("500s and does not leak the raw error when the query throws", async () => {
    mockQuery.mockRejectedValue(new Error("db exploded"));
    const res = await GET(getRequest("example.com"), params("example.com"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain("db exploded");
  });
});
