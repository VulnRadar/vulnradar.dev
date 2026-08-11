/**
 * Route-level tests for /api/v3/admin/engine-feedback/ai-tag-candidates:
 * GET aggregates scan_tags rows with source = 'ai' into candidates an
 * admin can promote; POST ("Promote") inserts a permanent row into
 * promoted_auto_tag_rules.
 *
 * Auth mocking mirrors tests/app/api/v3/admin/engine-feedback/tags/route.test.ts.
 * @/lib/tags/auto-tags is NOT mocked -- invalidatePromotedRulesCache is a
 * pure in-memory reset with no I/O, so the real implementation runs.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const { GET, POST } =
  await import("@/app/api/v3/admin/engine-feedback/ai-tag-candidates/route");

function withAdmin(userId = 7, role = "admin") {
  mockGetSession.mockResolvedValue({ userId });
  mockQuery.mockResolvedValueOnce({ rows: [{ id: userId, role }] });
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost/api/v3/admin/engine-feedback/ai-tag-candidates",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
});

describe("GET /api/v3/admin/engine-feedback/ai-tag-candidates", () => {
  it("requires a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a caller below admin", async () => {
    mockGetSession.mockResolvedValue({ userId: 3 });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3, role: "support" }] });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("only surfaces a tag once it clears the minimum distinct-scan floor (enforced by the SQL HAVING clause)", async () => {
    withAdmin();
    // The route's own SQL filters via HAVING COUNT(DISTINCT scan_id) >= $1
    // -- this test just verifies the query shape asks for that, since the
    // mock can't itself execute a HAVING clause.
    mockQuery.mockResolvedValueOnce({ rows: [] }); // counts query
    await GET();

    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("WHERE source = 'ai'");
    expect(sql).toContain("HAVING COUNT(DISTINCT scan_id) >= $1");
    expect(params[0]).toBeGreaterThanOrEqual(1);
  });

  it("returns scanCount/userCount, examples, and a frequency-based suggestion per candidate", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({
      rows: [{ tag: "DNS Email Hygiene Gaps", scan_count: 5, user_count: 3 }],
    }); // counts query
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          scan_id: 101,
          url: "https://a.example.com",
          scanned_at: "2026-01-01",
        },
        {
          scan_id: 102,
          url: "https://b.example.com",
          scanned_at: "2026-01-02",
        },
      ],
    }); // examples query
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          findings: [
            { cwe: "CWE-350", category: "dns", severity: "high" },
            { cwe: "CWE-350", category: "dns", severity: "medium" },
            { cwe: undefined, category: "email", severity: "low" },
          ],
        },
      ],
    }); // findings query

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.candidates).toHaveLength(1);
    const candidate = json.candidates[0];
    expect(candidate.tag).toBe("DNS Email Hygiene Gaps");
    expect(candidate.scanCount).toBe(5);
    expect(candidate.userCount).toBe(3);
    expect(candidate.examples).toEqual([
      { scanId: 101, url: "https://a.example.com", scannedAt: "2026-01-01" },
      { scanId: 102, url: "https://b.example.com", scannedAt: "2026-01-02" },
    ]);
    // CWE-350 is the most frequent cwe (2 of 3 findings); dns is the most
    // frequent category (2 of 3); high is the most frequent severity tied
    // with... actually high(1)/medium(1)/low(1) are equal, so whichever
    // this simple frequency scan picks first is fine -- just assert the
    // dominant cwe/category made it in.
    expect(candidate.suggested.cwes).toContain("CWE-350");
    expect(candidate.suggested.categories).toContain("dns");
  });

  it("returns a graceful 500 when the aggregation query fails", async () => {
    withAdmin();
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("POST /api/v3/admin/engine-feedback/ai-tag-candidates (promote)", () => {
  it("requires a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest({ tag: "Some Tag" }));
    expect(res.status).toBe(403);
  });

  it("rejects a missing or empty tag", async () => {
    withAdmin();
    const res = await POST(
      postRequest({ tag: "", cwes: ["CWE-79"], minSeverity: "high" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a promotion with neither cwes nor categories", async () => {
    withAdmin();
    const res = await POST(
      postRequest({
        tag: "Some Tag",
        cwes: [],
        categories: [],
        minSeverity: "high",
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/CWE or category/i);
  });

  it("rejects an invalid minSeverity", async () => {
    withAdmin();
    const res = await POST(
      postRequest({
        tag: "Some Tag",
        cwes: ["CWE-79"],
        minSeverity: "extreme",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("filters out a malformed CWE id and an unknown category before saving", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT

    await POST(
      postRequest({
        tag: "Some Tag",
        cwes: ["CWE-79", "not-a-cwe", "DROP TABLE users;"],
        categories: ["dns", "not-a-real-category"],
        minSeverity: "medium",
      }),
    );

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO promoted_auto_tag_rules"),
    );
    expect(insertCall).toBeDefined();
    const [, params] = insertCall!;
    expect(JSON.parse(params[1])).toEqual(["CWE-79"]);
    expect(JSON.parse(params[2])).toEqual(["dns"]);
  });

  it("saves a valid promotion with source_ai_tag and created_by set, and upserts on a repeat promotion", async () => {
    withAdmin(9);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT

    const res = await POST(
      postRequest({
        tag: "DNS Email Hygiene Gaps",
        cwes: ["CWE-350"],
        categories: ["dns"],
        requireBoth: false,
        minSeverity: "high",
        minCount: 2,
      }),
    );

    expect(res.status).toBe(200);
    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO promoted_auto_tag_rules"),
    );
    const [sql, params] = insertCall!;
    expect(sql).toContain("ON CONFLICT (tag) DO UPDATE");
    expect(params).toEqual([
      "DNS Email Hygiene Gaps",
      JSON.stringify(["CWE-350"]),
      JSON.stringify(["dns"]),
      false,
      "high",
      2,
      "DNS Email Hygiene Gaps",
      9,
    ]);
  });

  it("defaults minCount to 1 when omitted or invalid", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await POST(
      postRequest({
        tag: "Some Tag",
        cwes: ["CWE-79"],
        minSeverity: "medium",
        minCount: -5,
      }),
    );

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO promoted_auto_tag_rules"),
    );
    const [, params] = insertCall!;
    expect(params[5]).toBe(1);
  });

  it("returns a graceful 500 when the INSERT fails", async () => {
    withAdmin();
    mockQuery.mockRejectedValueOnce(new Error("unique violation"));
    const res = await POST(
      postRequest({ tag: "Some Tag", cwes: ["CWE-79"], minSeverity: "high" }),
    );
    expect(res.status).toBe(500);
  });

  it("rejects an unparseable request body", async () => {
    withAdmin();
    const req = new NextRequest(
      "http://localhost/api/v3/admin/engine-feedback/ai-tag-candidates",
      { method: "POST", body: "{not json" },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
