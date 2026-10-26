/**
 * Route-level tests for /api/v3/admin/engine-feedback/promoted-tags: GET
 * lists the auto-tag rules an admin has promoted, DELETE takes one back out.
 *
 * Promotion (POST on ./ai-tag-candidates) changes what every future scan of
 * every user is labelled with, and was a one-way door until this route. The
 * claims worth testing are the ones that make removal safe: it is gated, it
 * validates its id, it drops the rule cache so the rule stops tagging, and it
 * leaves an audit row naming what was removed.
 *
 * Auth mocking mirrors ../ai-tag-candidates/route.test.ts.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockLogAction = vi.fn();
vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return {
    ...actual,
    logAction: (...args: unknown[]) => mockLogAction(...args),
  };
});

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const mockInvalidate = vi.fn();
vi.mock("@/lib/tags/auto-tags", () => ({
  invalidatePromotedRulesCache: () => mockInvalidate(),
}));

const { GET, DELETE } =
  await import("@/app/api/v3/admin/engine-feedback/promoted-tags/route");

function withAdmin(userId = 7, role = "admin") {
  mockGetSession.mockResolvedValue({ userId });
  // totp_enabled: true so requirePermission's 2FA-enforcement check
  // short-circuits before it asks for the ENFORCE_STAFF_2FA setting through
  // this same mocked pool, which would consume a query slot these tests count.
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: userId, role, totp_enabled: true }],
  });
}

function deleteRequest(id?: string): NextRequest {
  const qs = id === undefined ? "" : `?id=${id}`;
  return new NextRequest(
    `http://localhost/api/v3/admin/engine-feedback/promoted-tags${qs}`,
    { method: "DELETE" },
  );
}

function removedRow() {
  return {
    tag: "DNS Email Hygiene Gaps",
    cwes: ["CWE-350"],
    categories: ["dns"],
    min_severity: "high",
    min_count: 2,
  };
}

const deleteStatements = () =>
  mockQuery.mock.calls.filter(([sql]) =>
    String(sql).includes("DELETE FROM promoted_auto_tag_rules"),
  );

let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockLogAction.mockReset();
  mockInvalidate.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("GET /api/v3/admin/engine-feedback/promoted-tags", () => {
  it("requires a session", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a staff role without MANAGE_ENGINE_FEEDBACK", async () => {
    mockGetSession.mockResolvedValue({ userId: 3 });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3, role: "support" }] });

    const res = await GET();

    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("lists the rules in effect, with who promoted each", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 4,
          tag: "DNS Email Hygiene Gaps",
          cwes: ["CWE-350"],
          categories: null,
          require_both: false,
          min_severity: "high",
          min_count: 2,
          created_at: new Date("2026-05-06T07:08:09.000Z"),
          created_by_name: "Sam Admin",
          created_by_email: "sam@example.test",
        },
      ],
    });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.rules).toEqual([
      {
        id: 4,
        tag: "DNS Email Hygiene Gaps",
        cwes: ["CWE-350"],
        categories: [],
        requireBoth: false,
        minSeverity: "high",
        minCount: 2,
        createdBy: "Sam Admin",
        createdAt: "2026-05-06T07:08:09.000Z",
      },
    ]);
  });

  it("answers an empty list, not an error, when nothing has been promoted", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await GET();

    expect(res.status).toBe(200);
    expect((await res.json()).rules).toEqual([]);
  });

  it("returns a 500 and logs it with the admin when the query fails", async () => {
    withAdmin(9);
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));

    const res = await GET();

    expect(res.status).toBe(500);
    const logged = errorSpy.mock.calls.find(([first]: unknown[]) =>
      String(first).includes("promoted auto-tag rules"),
    );
    expect(logged).toBeDefined();
    expect(logged).toContainEqual({ adminId: 9 });
    expect(logged?.some((arg) => arg instanceof Error)).toBe(true);
  });
});

describe("DELETE /api/v3/admin/engine-feedback/promoted-tags", () => {
  it("requires a session, and deletes nothing", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await DELETE(deleteRequest("4"));

    expect(res.status).toBe(403);
    expect(deleteStatements()).toHaveLength(0);
  });

  it("rejects a staff role without MANAGE_ENGINE_FEEDBACK, and deletes nothing", async () => {
    mockGetSession.mockResolvedValue({ userId: 3 });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3, role: "support" }] });

    const res = await DELETE(deleteRequest("4"));

    expect(res.status).toBe(403);
    expect(deleteStatements()).toHaveLength(0);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it.each([
    ["no id at all", undefined],
    ["an empty id", ""],
    ["a word", "all"],
    ["zero", "0"],
    ["a negative number", "-3"],
    ["a decimal", "4.5"],
    ["an id with trailing text", "4abc"],
    ["more than a SERIAL can hold", "2147483648"],
    ["an absurdly long number", "99999999999999999999"],
  ])("answers 400 for %s and deletes nothing", async (_label, id) => {
    withAdmin();

    const res = await DELETE(deleteRequest(id));

    expect(res.status).toBe(400);
    expect(deleteStatements()).toHaveLength(0);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("answers 404 for a rule that does not exist, with no audit row and no cache churn", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(deleteRequest("999"));

    expect(res.status).toBe(404);
    expect(mockLogAction).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it("removes the rule by id and drops the rule cache so it stops tagging", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [removedRow()] });

    const res = await DELETE(deleteRequest("4"));

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    const [[sql, params]] = deleteStatements();
    expect(sql).toContain("WHERE id = $1");
    expect(params).toEqual([4]);
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });

  it("audit-logs the removal as demote_ai_tag, naming the rule and what it matched", async () => {
    withAdmin(9);
    mockQuery.mockResolvedValueOnce({ rows: [removedRow()] });

    await DELETE(deleteRequest("4"));

    expect(mockLogAction).toHaveBeenCalledTimes(1);
    const [adminId, targetUserId, action, details, ip] =
      mockLogAction.mock.calls[0];
    expect(adminId).toBe(9);
    // Site-wide: the rule applied to everyone's scans, not one account's.
    expect(targetUserId).toBeNull();
    expect(action).toBe("demote_ai_tag");
    // The row is the only record of what the rule was once it is deleted.
    expect(details).toContain("DNS Email Hygiene Gaps");
    expect(details).toContain("CWE-350");
    expect(details).toContain("dns");
    expect(details).toContain("high");
    expect(ip).toBe("127.0.0.1");
  });

  it("still reports the removal when the audit write fails, and logs that it did", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [removedRow()] });
    mockLogAction.mockRejectedValueOnce(new Error("audit table missing"));

    const res = await DELETE(deleteRequest("4"));

    expect(res.status).toBe(200);
    const logged = errorSpy.mock.calls.find(([first]: unknown[]) =>
      String(first).includes("demote_ai_tag"),
    );
    expect(logged).toBeDefined();
    expect(logged?.some((arg) => arg instanceof Error)).toBe(true);
  });

  it("answers 500 and writes no audit row when the delete itself fails", async () => {
    withAdmin();
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));

    const res = await DELETE(deleteRequest("4"));

    expect(res.status).toBe(500);
    expect(mockLogAction).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});
