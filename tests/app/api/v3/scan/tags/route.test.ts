/**
 * Route-level tests for /api/v3/scan/tags (list a user's tags, add/remove a
 * tag on one of their scans). Only the DB, session, and rate-limit
 * boundaries are mocked.
 *
 * checkRateLimit (lib/rate-limiting/rate-limit.ts) is mocked at its module
 * boundary rather than exercised for real: it is itself DB-backed (via the
 * same pool this file already mocks for the route's own queries), and
 * letting it run for real would consume mockQuery call slots the "not
 * called" / call-sequence assertions below depend on, the same reasoning
 * tests/app/api/v3/scan/verify/route.test.ts documents.
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

// MAX_TAG_LENGTH and MAX_TAGS_PER_SCAN are read via getSetting. Mock it at
// its own module boundary (rather than letting it fall through to the real
// runtime-config -> pool.query("...system_settings") path) so it doesn't
// consume one of the queued mockQuery.mockResolvedValueOnce() values meant
// for the route's own scan_tags queries below.
const SETTING_DEFAULTS: Record<string, number> = {
  MAX_TAG_LENGTH: 30,
  MAX_TAGS_PER_SCAN: 10,
};
const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  };
});

const { GET, POST } = await import("@/app/api/v3/scan/tags/route");

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/scan/tags", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockGetSetting.mockReset();
  mockGetSetting.mockImplementation(
    async (key: string) => SETTING_DEFAULTS[key],
  );
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 59,
    retryAfterSeconds: 0,
  });
});

describe("GET /api/v3/scan/tags", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("scopes the tag list to the session user", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tag: "prod" }, { tag: "qa" }] });

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tags).toEqual(["prod", "qa"]);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE user_id = $1");
    expect(params).toEqual([42]);
  });
});

describe("POST /api/v3/scan/tags: rate limiting", () => {
  it("rate limits per-user before doing any DB work", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 120,
    });

    const res = await POST(postRequest({ scanId: 1, tag: "prod" }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain("Too many tag changes");
    expect(json.error).toContain("2 minute(s)");
    expect(mockQuery).not.toHaveBeenCalled();

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "scan-tags:42" }),
    );
  });
});

describe("POST /api/v3/scan/tags", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest({ scanId: 1, tag: "prod" }));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a missing scanId", async () => {
    const res = await POST(postRequest({ tag: "prod" }));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a missing tag", async () => {
    const res = await POST(postRequest({ scanId: 1 }));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a non-string tag", async () => {
    const res = await POST(postRequest({ scanId: 1, tag: 42 }));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a tag that is empty after trimming, before checking scan ownership", async () => {
    const res = await POST(postRequest({ scanId: 1, tag: "   " }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid tag.");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 404 without mutating anything when the scan does not belong to the user", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ownership check fails

    const res = await POST(postRequest({ scanId: 999, tag: "prod" }));
    expect(res.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM scan_history");
    expect(sql).toContain("public_id = $1");
    expect(sql).toContain("user_id = $3");
    // [publicIdParam, numericFallback, userId] -- a numeric id resolves via
    // the fallback.
    expect(params).toEqual(["999", 999, 42]);
  });

  it("normalizes the tag (trim, lowercase, 30-char cap), inserts it with source='user', and returns tag+source objects", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // existing user-tag count
      .mockResolvedValueOnce({ rows: [] }) // insert
      .mockResolvedValueOnce({
        rows: [{ tag: "verylongtagnamethatgetstruncat", source: "user" }],
      }); // final select

    const longTag = "  VeryLongTagNameThatGetsTruncatedForSure  ";
    const res = await POST(postRequest({ scanId: 5, tag: longTag }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tags).toEqual([
      { tag: "verylongtagnamethatgetstruncat", source: "user" },
    ]);

    const [ownershipSql, ownershipParams] = mockQuery.mock.calls[0];
    expect(ownershipSql).toContain("public_id = $1");
    expect(ownershipSql).toContain("user_id = $3");
    expect(ownershipParams).toEqual(["5", 5, 42]);

    const [countSql] = mockQuery.mock.calls[1];
    // Only a scan's own user tags count against the per-scan cap.
    expect(countSql).toContain("source = 'user'");

    const [insertSql, insertParams] = mockQuery.mock.calls[2];
    expect(insertSql).toContain("INSERT INTO scan_tags");
    expect(insertSql).toContain("'user'");
    expect(insertParams[0]).toBe(5);
    expect(insertParams[1]).toBe(42);
    expect(insertParams[2]).toBe("verylongtagnamethatgetstruncat"); // trimmed, lowercased, sliced to 30
    expect((insertParams[2] as string).length).toBe(30);
  });

  it("removes a user tag scoped to scanId, user_id, tag, and source='user' when action is 'remove'", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [] }) // auto-tag match check (none)
      .mockResolvedValueOnce({ rows: [] }) // delete
      .mockResolvedValueOnce({ rows: [] }); // final select

    const res = await POST(
      postRequest({ scanId: 5, tag: "prod", action: "remove" }),
    );
    expect(res.status).toBe(200);

    const [autoCheckSql, autoCheckParams] = mockQuery.mock.calls[1];
    expect(autoCheckSql).toContain("source IN ('auto', 'ai')");
    expect(autoCheckSql).toContain("LOWER(tag) = LOWER($3)");
    expect(autoCheckParams).toEqual([5, 42, "prod"]);

    const [deleteSql, deleteParams] = mockQuery.mock.calls[2];
    expect(deleteSql).toContain("DELETE FROM scan_tags");
    expect(deleteSql).toContain(
      "WHERE scan_id = $1 AND user_id = $2 AND tag = $3 AND source = 'user'",
    );
    expect(deleteParams).toEqual([5, 42, "prod"]);
  });

  it("dismisses an auto tag (matched case-insensitively): logs it to auto_tag_dismissals, then deletes the scan_tags row", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ tag: "Secrets Exposed" }] }) // auto-tag match found
      .mockResolvedValueOnce({ rows: [] }) // insert dismissal
      .mockResolvedValueOnce({ rows: [] }) // delete
      .mockResolvedValueOnce({ rows: [] }); // final select

    // The client can never send this through the UI in a different case
    // (no remove control on an auto tag previously; now the chip sends its
    // own exact tag text), but a direct API call might send lowercase --
    // "Secrets Exposed" gets lowercased to "secrets exposed" like any
    // other tag before this point, so the lookup must still catch it
    // case-insensitively and dismiss using the row's exact stored text.
    const res = await POST(
      postRequest({ scanId: 5, tag: "Secrets Exposed", action: "remove" }),
    );
    expect(res.status).toBe(200);

    const [autoCheckSql, autoCheckParams] = mockQuery.mock.calls[1];
    expect(autoCheckSql).toContain("SELECT tag FROM scan_tags");
    expect(autoCheckSql).toContain("source IN ('auto', 'ai')");
    expect(autoCheckSql).toContain("LOWER(tag) = LOWER($3)");
    expect(autoCheckParams).toEqual([5, 42, "secrets exposed"]);

    const [insertSql, insertParams] = mockQuery.mock.calls[2];
    expect(insertSql).toContain("INSERT INTO auto_tag_dismissals");
    expect(insertSql).toContain(
      "(scan_id, tag, dismissed_by_user_id) VALUES ($1, $2, $3)",
    );
    expect(insertParams).toEqual([5, "Secrets Exposed", 42]);

    const [deleteSql, deleteParams] = mockQuery.mock.calls[3];
    expect(deleteSql).toContain("DELETE FROM scan_tags");
    expect(deleteSql).toContain(
      "WHERE scan_id = $1 AND user_id = $2 AND source IN ('auto', 'ai') AND tag = $3",
    );
    expect(deleteParams).toEqual([5, 42, "Secrets Exposed"]);
  });

  it("dismisses an AI-suggested tag (source='ai'): logs it to auto_tag_dismissals, then deletes the scan_tags row", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ tag: "Weak TLS Cipher Suite" }] }) // ai-tag match found
      .mockResolvedValueOnce({ rows: [] }) // insert dismissal
      .mockResolvedValueOnce({ rows: [] }) // delete
      .mockResolvedValueOnce({ rows: [] }); // final select

    const res = await POST(
      postRequest({
        scanId: 5,
        tag: "Weak TLS Cipher Suite",
        action: "remove",
      }),
    );
    expect(res.status).toBe(200);

    const [autoCheckSql, autoCheckParams] = mockQuery.mock.calls[1];
    expect(autoCheckSql).toContain("source IN ('auto', 'ai')");
    expect(autoCheckParams).toEqual([5, 42, "weak tls cipher suite"]);

    const [deleteSql, deleteParams] = mockQuery.mock.calls[3];
    expect(deleteSql).toContain(
      "WHERE scan_id = $1 AND user_id = $2 AND source IN ('auto', 'ai') AND tag = $3",
    );
    expect(deleteParams).toEqual([5, 42, "Weak TLS Cipher Suite"]);
  });

  it("returns the scan's updated tags (tag+source objects) scoped to the user after the mutation", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // existing user-tag count
      .mockResolvedValueOnce({ rows: [] }) // insert
      .mockResolvedValueOnce({
        rows: [
          { tag: "Secrets Exposed", source: "auto" },
          { tag: "staging", source: "user" },
        ],
      }); // final select

    const res = await POST(postRequest({ scanId: 5, tag: "staging" }));
    const json = await res.json();
    expect(json.tags).toEqual([
      { tag: "Secrets Exposed", source: "auto" },
      { tag: "staging", source: "user" },
    ]);

    const [finalSql, finalParams] = mockQuery.mock.calls[3];
    expect(finalSql).toContain("WHERE scan_id = $1 AND user_id = $2");
    expect(finalParams).toEqual([5, 42]);
  });
});
