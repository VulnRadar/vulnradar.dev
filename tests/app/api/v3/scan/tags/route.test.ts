/**
 * Route-level tests for /api/v3/scan/tags (list a user's tags, add/remove a
 * tag on one of their scans). Only the DB and session boundary are mocked.
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
    expect(sql).toContain("FROM scan_history WHERE id = $1 AND user_id = $2");
    expect(params).toEqual([999, 42]);
  });

  it("normalizes the tag (trim, lowercase, 30-char cap) and inserts it after confirming ownership", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // existing tag count
      .mockResolvedValueOnce({ rows: [] }) // insert
      .mockResolvedValueOnce({
        rows: [{ tag: "verylongtagnamethatgetstruncat" }],
      }); // final select

    const longTag = "  VeryLongTagNameThatGetsTruncatedForSure  ";
    const res = await POST(postRequest({ scanId: 5, tag: longTag }));
    expect(res.status).toBe(200);

    const [ownershipSql, ownershipParams] = mockQuery.mock.calls[0];
    expect(ownershipSql).toContain("WHERE id = $1 AND user_id = $2");
    expect(ownershipParams).toEqual([5, 42]);

    const [insertSql, insertParams] = mockQuery.mock.calls[2];
    expect(insertSql).toContain("INSERT INTO scan_tags");
    expect(insertParams[0]).toBe(5);
    expect(insertParams[1]).toBe(42);
    expect(insertParams[2]).toBe("verylongtagnamethatgetstruncat"); // trimmed, lowercased, sliced to 30
    expect((insertParams[2] as string).length).toBe(30);
  });

  it("removes a tag scoped to scanId, user_id, and tag when action is 'remove'", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [] }) // delete
      .mockResolvedValueOnce({ rows: [] }); // final select

    const res = await POST(
      postRequest({ scanId: 5, tag: "prod", action: "remove" }),
    );
    expect(res.status).toBe(200);

    const [deleteSql, deleteParams] = mockQuery.mock.calls[1];
    expect(deleteSql).toContain("DELETE FROM scan_tags");
    expect(deleteSql).toContain(
      "WHERE scan_id = $1 AND user_id = $2 AND tag = $3",
    );
    expect(deleteParams).toEqual([5, 42, "prod"]);
  });

  it("returns the scan's updated tag list scoped to the user after the mutation", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // existing tag count
      .mockResolvedValueOnce({ rows: [] }) // insert
      .mockResolvedValueOnce({ rows: [{ tag: "prod" }, { tag: "staging" }] }); // final select

    const res = await POST(postRequest({ scanId: 5, tag: "staging" }));
    const json = await res.json();
    expect(json.tags).toEqual(["prod", "staging"]);

    const [finalSql, finalParams] = mockQuery.mock.calls[3];
    expect(finalSql).toContain("WHERE scan_id = $1 AND user_id = $2");
    expect(finalParams).toEqual([5, 42]);
  });
});
