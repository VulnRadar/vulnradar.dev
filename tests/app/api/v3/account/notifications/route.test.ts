/**
 * Route-level tests for GET/PUT /api/v3/account/notifications. The database
 * is mocked; lib/notifications/notifications.ts's getNotificationPreferences
 * (the route's only non-trivial dependency) runs for real against the
 * mocked pool, per this repo's mock-at-the-DB-boundary rule.
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

const { GET, PUT } = await import("@/app/api/v3/account/notifications/route");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 9 });
});

function putRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/account/notifications", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/v3/account/notifications", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns every preference true by default when no row exists", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.email_security).toBe(true);
    expect(json.email_product_updates).toBe(true);
  });

  it("returns the stored row when one exists", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ email_security: true, email_product_updates: false }],
    });
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.email_product_updates).toBe(false);
  });

  it("returns 500 (via withErrorHandling) when the query fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("PUT /api/v3/account/notifications", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await PUT(putRequest({ email_product_updates: false }));
    expect(res.status).toBe(401);
  });

  it("rejects an invalid JSON body", async () => {
    const req = new NextRequest(
      "http://localhost/api/v3/account/notifications",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{not json",
      },
    );
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it("rejects a non-boolean value for a known column", async () => {
    const res = await PUT(putRequest({ email_product_updates: "yes" }));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("ignores unknown keys and rejects when nothing valid remains", async () => {
    const res = await PUT(putRequest({ not_a_real_column: true }));
    expect(res.status).toBe(400);
  });

  it("upserts only the recognized columns and returns the updated row", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ email_product_updates: false, email_tips_guides: false }],
    });
    const res = await PUT(
      putRequest({
        email_product_updates: false,
        email_tips_guides: false,
        not_a_column: true,
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.email_product_updates).toBe(false);
    const [query, params] = mockQuery.mock.calls[0];
    expect(query).toContain("email_product_updates");
    expect(query).not.toContain("not_a_column");
    expect(params[0]).toBe(9);
  });

  it("returns 500 (via withErrorHandling) when the write fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await PUT(putRequest({ email_product_updates: false }));
    expect(res.status).toBe(500);
  });
});
