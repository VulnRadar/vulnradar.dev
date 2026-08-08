/**
 * Route-level tests for GET/POST /api/v3/account/unsubscribe. This route is
 * token-authenticated (unsubscribe_token), not session-authenticated, so
 * "authorization" here means a valid vs. invalid/missing token. Only the
 * database is mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { GET, POST } = await import("@/app/api/v3/account/unsubscribe/route");

beforeEach(() => {
  mockQuery.mockReset();
});

function req(
  path: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
) {
  return new NextRequest(
    `http://localhost/api/v3/account/unsubscribe${path}`,
    init,
  );
}

describe("GET /api/v3/account/unsubscribe", () => {
  it("requires a token", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an invalid token", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET(req("?token=bogus"));
    expect(res.status).toBe(404);
  });

  it("returns defaults merged with any stored row, forcing email_security on", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, email: "a@example.com" }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ email_security: false, email_product_updates: false }],
    });
    const res = await GET(req("?token=good"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.email).toBe("a@example.com");
    // email_security is forced true even though the stored row says false.
    expect(json.prefs.email_security).toBe(true);
    expect(json.prefs.email_product_updates).toBe(false);
    // Columns never explicitly stored still fall back to the default (true).
    expect(json.prefs.email_webhooks).toBe(true);
  });

  it("returns all-default prefs when the user has no preferences row yet", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, email: "a@example.com" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET(req("?token=good"));
    const json = await res.json();
    expect(json.prefs.email_tips_guides).toBe(true);
  });
});

describe("POST /api/v3/account/unsubscribe (unsubscribe_all)", () => {
  it("requires a token", async () => {
    const res = await POST(req("?action=unsubscribe_all", { method: "POST" }));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid token", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await POST(
      req("?token=bogus&action=unsubscribe_all", { method: "POST" }),
    );
    expect(res.status).toBe(404);
  });

  it("turns every preference off except the always-on security column", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] }); // token lookup
    mockQuery.mockResolvedValueOnce({ rows: [] }); // upsert
    const res = await POST(
      req("?token=good&action=unsubscribe_all", { method: "POST" }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.prefs.email_security).toBe(true);
    expect(json.prefs.email_product_updates).toBe(false);
    expect(json.prefs.email_tips_guides).toBe(false);
  });
});

describe("POST /api/v3/account/unsubscribe (selective update)", () => {
  it("rejects an invalid JSON body", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const res = await POST(
      req("?token=good", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects when no valid preferences are provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const res = await POST(
      req("?token=good", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefs: { not_a_column: true } }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("ignores an attempt to turn off the always-on security column", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] }); // token lookup
    mockQuery.mockResolvedValueOnce({ rows: [] }); // upsert
    const res = await POST(
      req("?token=good", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prefs: { email_security: false, email_product_updates: false },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const [query, params] = mockQuery.mock.calls[1];
    // email_security is filtered out before the update is built: only the
    // user id and the one legitimate column value are bound.
    expect(query).not.toContain("email_security = $");
    expect(params).toEqual([5, false]);
  });

  it("updates the requested preferences", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await POST(
      req("?token=good", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefs: { email_product_updates: false } }),
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    const [query, params] = mockQuery.mock.calls[1];
    expect(query).toContain("email_product_updates");
    expect(params[0]).toBe(5);
  });
});
