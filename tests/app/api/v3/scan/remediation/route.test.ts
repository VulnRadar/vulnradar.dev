/**
 * Route-level tests for /api/v3/scan/remediation. POST upserts a finding's
 * remediation status (status 'open' clears it), DELETE clears it, GET reads
 * the caller's own statuses back. zod validation is real; only the DB and
 * session boundary are mocked, exactly like the feedback route's tests.
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

const { POST, GET, DELETE } = await import(
  "@/app/api/v3/scan/remediation/route"
);

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/scan/remediation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function paramRequest(
  method: "GET" | "DELETE",
  params: Record<string, string> = {},
): NextRequest {
  const url = new URL("http://localhost/api/v3/scan/remediation");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url, { method });
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    findingId: "csp-missing--abc123",
    findingUrl: "https://example.com/",
    status: "fixed",
    note: "Patched in release 4.2.",
    assignee: "alice",
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
});

describe("POST /api/v3/scan/remediation", () => {
  it("requires authentication (401, no DB call)", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest(validPayload()));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON before touching the database", async () => {
    const req = new NextRequest("http://localhost/api/v3/scan/remediation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown status", { status: "maybe" }],
    ["empty findingId", { findingId: "" }],
    ["malformed findingUrl", { findingUrl: "not-a-url" }],
    ["note too long", { note: "x".repeat(2001) }],
    ["assignee too long", { assignee: "x".repeat(121) }],
  ])("rejects payload with %s (400, no DB call)", async (_label, override) => {
    const res = await POST(postRequest(validPayload(override)));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid request");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("upserts a status scoped to the session user and returns it", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          status: "fixed",
          note: "Patched in release 4.2.",
          assignee: "alice",
          updated_at: "2026-01-01",
        },
      ],
    });

    const res = await POST(postRequest(validPayload()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.remediation.status).toBe("fixed");

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO finding_remediation");
    expect(sql).toContain(
      "ON CONFLICT (user_id, finding_id, finding_url)",
    );
    expect(params).toEqual([
      42,
      "csp-missing--abc123",
      "https://example.com/",
      "fixed",
      "Patched in release 4.2.",
      "alice",
    ]);
  });

  it("clears the row (DELETE) when status is set back to 'open'", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest(validPayload({ status: "open" })));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("open");

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("DELETE FROM finding_remediation");
    expect(sql).not.toContain("INSERT");
    expect(params).toEqual([42, "csp-missing--abc123", "https://example.com/"]);
  });

  it("returns 503 when the remediation table has not been migrated yet", async () => {
    mockQuery.mockRejectedValueOnce(
      new Error('relation "finding_remediation" does not exist'),
    );
    const res = await POST(postRequest(validPayload()));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toContain("migrate");
  });
});

describe("DELETE /api/v3/scan/remediation", () => {
  it("requires authentication (401, no DB call)", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await DELETE(
      paramRequest("DELETE", {
        url: "https://example.com/",
        findingId: "csp-missing--abc123",
      }),
    );
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("requires url and findingId (400, no DB call)", async () => {
    const res = await DELETE(
      paramRequest("DELETE", { url: "https://example.com/" }),
    );
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("clears the row scoped to the session user", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await DELETE(
      paramRequest("DELETE", {
        url: "https://example.com/",
        findingId: "csp-missing--abc123",
      }),
    );
    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("DELETE FROM finding_remediation");
    expect(params).toEqual([42, "csp-missing--abc123", "https://example.com/"]);
  });
});

describe("GET /api/v3/scan/remediation", () => {
  it("requires authentication (401, no DB call)", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(paramRequest("GET"));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("scopes the read to the session user and returns rows", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ finding_id: "csp-missing--abc123", status: "fixed" }],
    });
    const res = await GET(
      paramRequest("GET", {
        url: "https://example.com/",
        findingId: "csp-missing--abc123",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.remediation).toHaveLength(1);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM finding_remediation");
    expect(sql).toContain("WHERE user_id = $1");
    expect(params[0]).toBe(42);
  });

  it("returns 500 on an unrelated database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection terminated"));
    const res = await GET(paramRequest("GET"));
    expect(res.status).toBe(500);
  });
});
