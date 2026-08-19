/**
 * Route-level tests for POST /api/v3/keys/[id]/revoke.
 *
 * @/lib/api/api-keys is NOT mocked: revokeApiKey's real SQL is
 * `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2
 * RETURNING id`. The test proving a non-owned key ID gets 404 asserts the
 * exact params sent to pool.query for that statement -- concrete proof the
 * ownership predicate reaches the database, not just a mocked stand-in.
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

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
  getUserAgent: vi.fn(async () => "vitest"),
}));

const mockSendNotificationEmail = vi.fn();
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: (...args: unknown[]) =>
    mockSendNotificationEmail(...args),
}));

const { POST } = await import("@/app/api/v3/keys/[id]/revoke/route");

function params(id = "42") {
  return { params: Promise.resolve({ id }) };
}

function postRequest() {
  return new NextRequest("http://localhost/api/v3/keys/42/revoke", {
    method: "POST",
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7, email: "owner@example.com" });
  mockSendNotificationEmail.mockReset();
  mockSendNotificationEmail.mockResolvedValue(undefined);
});

describe("POST /api/v3/keys/[id]/revoke", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(postRequest(), params());

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric key id before touching the database", async () => {
    const res = await POST(postRequest(), params("not-a-number"));

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("looks up the caller's own keys scoped by user_id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getUserApiKeys
    mockQuery.mockResolvedValueOnce({ rows: [] }); // revokeApiKey UPDATE (no match)

    await POST(postRequest(), params());

    const [sql, sqlParams] = mockQuery.mock.calls[0];
    expect(sql).toContain("ak.user_id = $1");
    expect(sqlParams).toEqual([7]);
  });

  it("a key ID owned by another user returns 404, proving the ownership predicate reaches the DB", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getUserApiKeys: caller has no such key
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE ... WHERE id AND user_id: no row matched

    const res = await POST(postRequest(), params("42"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Key not found");

    const [sql, sqlParams] = mockQuery.mock.calls[1];
    expect(sql).toContain(
      "UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2",
    );
    expect(sqlParams).toEqual([42, 7]);
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("revokes the caller's own key and sends a notification email", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 42,
          key_prefix: "vr_live_aaaaaaaa",
          name: "Prod key",
          daily_limit: 25,
          revoked_at: null,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] });

    const res = await POST(postRequest(), params("42"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    const [, sqlParams] = mockQuery.mock.calls[1];
    expect(sqlParams).toEqual([42, 7]);

    expect(mockSendNotificationEmail).toHaveBeenCalledTimes(1);
    const emailCall = mockSendNotificationEmail.mock.calls[0][0];
    expect(emailCall.userId).toBe(7);
    expect(emailCall.type).toBe("api_keys");
    expect(emailCall.emailContent.subject).toContain("revoked");
  });
});
