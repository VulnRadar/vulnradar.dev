/**
 * Route-level tests for GET/PUT /api/v3/account/share-privacy -- the
 * account-level "list new shares in Public Scans by default" setting
 * (users.share_publicly_listed_by_default), read by
 * lib/scanner/share-privacy.ts's resolveSharePubliclyListed.
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

const { GET, PUT } = await import("@/app/api/v3/account/share-privacy/route");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 9 });
});

function putRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/account/share-privacy", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/v3/account/share-privacy", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns true by default when the account has no preference set", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.sharePubliclyListedByDefault).toBe(true);
  });

  it("returns the stored value", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ share_publicly_listed_by_default: false }],
    });
    const res = await GET();
    const json = await res.json();
    expect(json.sharePubliclyListedByDefault).toBe(false);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("share_publicly_listed_by_default");
    expect(params).toEqual([9]);
  });

  it("returns 500 (via withErrorHandling) when the query fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("PUT /api/v3/account/share-privacy", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await PUT(putRequest({ sharePubliclyListedByDefault: false }));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an invalid JSON body", async () => {
    const req = new NextRequest(
      "http://localhost/api/v3/account/share-privacy",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{not json",
      },
    );
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it("rejects a non-boolean value", async () => {
    const res = await PUT(putRequest({ sharePubliclyListedByDefault: "yes" }));
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
      rows: [{ share_publicly_listed_by_default: false }],
    });

    const res = await PUT(putRequest({ sharePubliclyListedByDefault: false }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sharePubliclyListedByDefault).toBe(false);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("UPDATE users");
    expect(sql).toContain("share_publicly_listed_by_default = $1");
    expect(params).toEqual([false, 9]);
  });

  it("returns 500 (via withErrorHandling) when the write fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await PUT(putRequest({ sharePubliclyListedByDefault: true }));
    expect(res.status).toBe(500);
  });
});
