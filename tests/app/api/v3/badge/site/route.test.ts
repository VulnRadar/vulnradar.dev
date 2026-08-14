/**
 * Route-level tests for /api/v3/badge/site: create/fetch (POST) or revoke
 * (DELETE) the stable, auto-updating badge token for one of the caller's
 * own scans' URL.
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

const { POST, PATCH, DELETE } = await import("@/app/api/v3/badge/site/route");

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/badge/site", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest(scanId: string | number): NextRequest {
  return new NextRequest(
    `http://localhost/api/v3/badge/site?scanId=${scanId}`,
    { method: "DELETE" },
  );
}

function patchRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/badge/site", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
});

describe("POST /api/v3/badge/site", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest({ scanId: 1 }));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a missing or non-positive scanId before touching the database", async () => {
    for (const scanId of [undefined, 0, -1, "not-a-number"]) {
      const res = await POST(postRequest({ scanId }));
      expect(res.status).toBe(400);
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("404s when the scan does not exist or belongs to a different user", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest({ scanId: 5 }));

    expect(res.status).toBe(404);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE id = $1 AND user_id = $2");
    expect(params).toEqual([5, 42]);
  });

  it("returns the existing token when one is already issued for that URL", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ url: "https://example.com" }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ badge_token: "existing-token" }],
    });

    const res = await POST(postRequest({ scanId: 5 }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      token: "existing-token",
      url: "https://example.com",
    });
    // No INSERT issued when a live token already exists.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("creates a new 64-char hex token when none exists yet, scoped to (user_id, url)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ url: "https://example.com" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no existing token
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT

    const res = await POST(postRequest({ scanId: 5 }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.url).toBe("https://example.com");
    expect(json.token).toMatch(/^[a-f0-9]{64}$/);

    const [sql, params] = mockQuery.mock.calls[2];
    expect(sql).toContain("INSERT INTO host_badges");
    expect(sql).toContain("ON CONFLICT (user_id, url)");
    expect(params).toEqual([42, "https://example.com", json.token]);
  });
});

describe("PATCH /api/v3/badge/site", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await PATCH(
      patchRequest({ url: "https://example.com", scope: "global" }),
    );
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a missing url before touching the database", async () => {
    const res = await PATCH(patchRequest({ scope: "global" }));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a scope that isn't 'user' or 'global'", async () => {
    const res = await PATCH(
      patchRequest({ url: "https://example.com", scope: "everyone" }),
    );
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("404s when the caller has no badge for that URL", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await PATCH(
      patchRequest({ url: "https://example.com", scope: "global" }),
    );

    expect(res.status).toBe(404);
  });

  it("updates the scope for the caller's own badge", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ scope: "global" }] });

    const res = await PATCH(
      patchRequest({ url: "https://example.com", scope: "global" }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ scope: "global" });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("UPDATE host_badges SET scope = $1");
    expect(sql).toContain("WHERE user_id = $2 AND url = $3");
    expect(params).toEqual(["global", 42, "https://example.com"]);
  });
});

describe("DELETE /api/v3/badge/site", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await DELETE(deleteRequest(5));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a missing or non-positive scanId", async () => {
    const res = await DELETE(deleteRequest("nope"));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("404s when the scan does not belong to the caller", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(deleteRequest(5));

    expect(res.status).toBe(404);
  });

  it("revokes the badge for that user's URL", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ url: "https://example.com" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(deleteRequest(5));

    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("UPDATE host_badges SET revoked_at = NOW()");
    expect(params).toEqual([42, "https://example.com"]);
  });
});
