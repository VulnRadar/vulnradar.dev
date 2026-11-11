/**
 * The statements behind the admin stats strip and the admin teams list cast
 * every COUNT to int. COUNT is a bigint, which node-postgres returns as a
 * string, so the panel received "3" where its types say 3. What Postgres
 * sends back is proved in tests/integration/admin-counters.test.ts; this only
 * pins the statements the unit tier can see.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const STAFF = { id: 1, userId: 1, role: "super_admin", email: "s@example.com" };
vi.mock("@/lib/auth/authorization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/authorization")>()),
  requireStaff: vi.fn(async () => STAFF),
  requirePermission: vi.fn(async () => STAFF),
}));

const admin = await import("@/app/api/v3/admin/route");
const teams = await import("@/app/api/v3/admin/teams/route");

/** Every COUNT(...) in a statement that is not immediately cast to int. */
function uncastCounts(sql: string): string[] {
  return [...sql.matchAll(/COUNT\([^)]*\)(::int)?/g)]
    .filter((m) => !m[1])
    .map((m) => m[0]);
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [{ count: 0 }], rowCount: 0 });
});

describe("admin counters", () => {
  it("casts every stats counter to int", async () => {
    mockQuery.mockResolvedValue({ rows: [{}] });
    const res = await admin.GET(
      new Request("http://localhost/api/v3/admin?section=stats") as never,
    );
    expect(res.status).toBe(200);
    const sql = String(
      mockQuery.mock.calls.find((c) => /total_users/.test(String(c[0])))![0],
    );
    expect(sql.match(/COUNT\(/g)).toHaveLength(10);
    expect(uncastCounts(sql)).toEqual([]);
  });

  it("casts the team total and each member_count to int", async () => {
    const res = await teams.GET(
      new Request("http://localhost/api/v3/admin/teams"),
    );
    expect(res.status).toBe(200);
    const statements = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(statements).toHaveLength(2);
    for (const sql of statements) expect(uncastCounts(sql)).toEqual([]);
  });
});
