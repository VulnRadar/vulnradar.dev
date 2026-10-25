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

// The token column is a UUID, so a token has to look like one to be looked up.
const GOOD = "11111111-2222-4333-8444-555555555555";
const UNKNOWN = "99999999-8888-4777-8666-555555555555";

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
    const res = await GET(req(`?token=${UNKNOWN}`));
    expect(res.status).toBe(404);
  });

  it("answers a token that is not shaped like a UUID with the same 404, without querying", async () => {
    // The column is a UUID, so Postgres would raise 22P02 on the comparison:
    // a 500 and an error-log row for every probe of a public endpoint.
    const res = await GET(req("?token=not-a-uuid"));
    expect(res.status).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();

    const post = await POST(
      req("?token=not-a-uuid&type=email_scan_complete", { method: "POST" }),
    );
    expect(post.status).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns defaults merged with any stored row, forcing email_security on", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, email: "a@example.com" }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ email_security: false, email_product_updates: false }],
    });
    const res = await GET(req(`?token=${GOOD}`));
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
    const res = await GET(req(`?token=${GOOD}`));
    const json = await res.json();
    // The schema starts Tips & Guides off, so an account with no row is shown
    // as NOT subscribed to it. This said true, and /unsubscribe told people
    // they were subscribed to something they had never opted into.
    expect(json.prefs.email_tips_guides).toBe(false);
    expect(json.prefs.email_product_updates).toBe(true);
  });
});

/**
 * The one-click unsubscribe a mail client sends (RFC 8058) from the
 * List-Unsubscribe header. It names ONE preference column in `type` and has no
 * JSON body, only "List-Unsubscribe=One-Click". It used to name
 * action=unsubscribe_all, so pressing Gmail's Unsubscribe on a scan report
 * also switched off the sign-in, password and two-factor warnings.
 */
describe("POST /api/v3/account/unsubscribe (one-click, scoped to one category)", () => {
  function oneClick(query: string, token = GOOD) {
    return req(`?token=${token}&${query}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
  }

  it("turns off that column and no other", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] }); // token lookup
    mockQuery.mockResolvedValueOnce({ rows: [] }); // upsert

    const res = await POST(oneClick("type=email_scan_complete"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      type: "email_scan_complete",
    });
    const [query, params] = mockQuery.mock.calls[1];
    expect(query).toContain("INSERT INTO notification_preferences");
    expect(query).toContain("email_scan_complete = false");
    expect(query).toContain("ON CONFLICT (user_id)");
    // One column named, one user bound: nothing else is touched.
    expect(query).not.toContain("email_new_login");
    expect(query).not.toContain("email_password_change");
    expect(params).toEqual([5]);
  });

  it("does not read the body, so the bodyless form post is not a 400", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await POST(oneClick("type=email_posture_digest"));
    expect(res.status).toBe(200);
  });

  it("refuses a column that is not a preference, before it reaches SQL", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const res = await POST(
      oneClick("type=email_scan_complete%3B%20DROP%20TABLE%20users"),
    );
    expect(res.status).toBe(400);
    // Only the token lookup ran.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("refuses to switch off the always-on security column", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const res = await POST(oneClick("type=email_security"));
    expect(res.status).toBe(400);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown token without writing anything", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await POST(oneClick("type=email_scan_complete", UNKNOWN));
    expect(res.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(1);
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
      req(`?token=${UNKNOWN}&action=unsubscribe_all`, { method: "POST" }),
    );
    expect(res.status).toBe(404);
  });

  it("turns every preference off except the always-on security column", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] }); // token lookup
    mockQuery.mockResolvedValueOnce({ rows: [] }); // upsert
    const res = await POST(
      req(`?token=${GOOD}&action=unsubscribe_all`, { method: "POST" }),
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
      req(`?token=${GOOD}`, {
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
      req(`?token=${GOOD}`, {
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
      req(`?token=${GOOD}`, {
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
      req(`?token=${GOOD}`, {
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
