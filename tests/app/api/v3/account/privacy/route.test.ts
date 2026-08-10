/**
 * Route-level tests for GET/PUT /api/v3/account/privacy -- the account-level
 * "scans are private by default" setting (users.scans_private_by_default),
 * read by lib/scanner/scan-privacy.ts's resolveScanIsPublic.
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

const { GET, PUT } = await import("@/app/api/v3/account/privacy/route");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 9 });
});

function putRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/account/privacy", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/v3/account/privacy", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns false by default when the account has no preference set", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.scansPrivateByDefault).toBe(false);
  });

  it("returns the stored value", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: true }],
    });
    const res = await GET();
    const json = await res.json();
    expect(json.scansPrivateByDefault).toBe(true);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("scans_private_by_default");
    expect(params).toEqual([9]);
  });

  it("returns 500 (via withErrorHandling) when the query fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("PUT /api/v3/account/privacy", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await PUT(putRequest({ scansPrivateByDefault: true }));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/v3/account/privacy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it("rejects a non-boolean value", async () => {
    const res = await PUT(putRequest({ scansPrivateByDefault: "yes" }));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a missing value", async () => {
    const res = await PUT(putRequest({}));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("persists the new value scoped to the session's user id and returns it", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: true }],
    });

    const res = await PUT(putRequest({ scansPrivateByDefault: true }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.scansPrivateByDefault).toBe(true);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("UPDATE users");
    expect(sql).toContain("scans_private_by_default = $1");
    expect(params).toEqual([true, 9]);
  });

  it("returns 500 (via withErrorHandling) when the write fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await PUT(putRequest({ scansPrivateByDefault: false }));
    expect(res.status).toBe(500);
  });
});
