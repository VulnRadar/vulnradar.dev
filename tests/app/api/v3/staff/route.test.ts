/**
 * Route-level tests for GET /api/v3/staff, the public (unauthenticated)
 * staff listing.
 *
 * The database is mocked (network/DB boundary). The mock's `query`
 * implementation actually applies the `role = ANY($1)` predicate against a
 * seed dataset that includes non-staff roles, so a passing suite proves the
 * route sends the right allowlist to Postgres rather than merely trusting
 * that it does. Nothing else needs mocking: the route touches only pool.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Seed "table" of users, including roles that must never show up on the
// public staff page (beta_tester is a badge, not a staff role; user is the
// default role for everyone).
const ALL_USERS = [
  {
    name: "Alice Admin",
    role: "admin",
    email: "alice@example.com",
    avatar_url: "https://example.com/alice.png",
    created_at: "2020-01-01T00:00:00.000Z",
  },
  {
    name: "Mo Mod",
    role: "moderator",
    email: "mo@example.com",
    avatar_url: null,
    created_at: "2020-02-01T00:00:00.000Z",
  },
  {
    name: "Sam Support",
    role: "support",
    email: "sam@example.com",
    avatar_url: null,
    created_at: "2020-03-01T00:00:00.000Z",
  },
  {
    name: null,
    role: "support",
    email: "noname@example.com",
    avatar_url: null,
    created_at: "2020-03-02T00:00:00.000Z",
  },
  {
    name: "Beta Tester",
    role: "beta_tester",
    email: "beta@example.com",
    avatar_url: null,
    created_at: "2020-04-01T00:00:00.000Z",
  },
  {
    name: "Regular User",
    role: "user",
    email: "user@example.com",
    avatar_url: null,
    created_at: "2020-05-01T00:00:00.000Z",
  },
];

const mockQuery = vi.fn(async (sql: string, params: unknown[]) => {
  // Mimic the real `WHERE role = ANY($1)` predicate against the seed data,
  // so a row with an unlisted role never reaches the response even though
  // it exists in the mocked "table".
  const allowedRoles = params[0] as string[] | undefined;
  if (!allowedRoles || !/role = ANY\(\$1\)/.test(sql)) {
    return { rows: [] };
  }
  return { rows: ALL_USERS.filter((u) => allowedRoles.includes(u.role)) };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params: unknown[]) => mockQuery(sql, params),
  },
}));

const { GET } = await import("@/app/api/v3/staff/route");

beforeEach(() => {
  mockQuery.mockClear();
});

describe("GET /api/v3/staff", () => {
  it("queries only the admin/moderator/support role allowlist", async () => {
    await GET();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE role = ANY($1)");
    expect(params).toEqual([["admin", "moderator", "support"]]);
  });

  it("excludes non-staff roles (beta_tester, user) even though they exist in the table", async () => {
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    // 4 seeded rows have an allowed role; beta_tester and user are excluded.
    expect(json.staff).toHaveLength(4);
    expect(
      json.staff.some((s: { role: string }) => s.role === "beta_tester"),
    ).toBe(false);
    expect(json.staff.some((s: { role: string }) => s.role === "user")).toBe(
      false,
    );
  });

  it("returns only displayName and role, never email, avatar, or created_at", async () => {
    const res = await GET();
    const json = await res.json();

    for (const entry of json.staff) {
      expect(Object.keys(entry).sort()).toEqual(["displayName", "role"]);
    }
  });

  it("falls back to 'Staff Member' when name is null", async () => {
    const res = await GET();
    const json = await res.json();

    const unnamed = json.staff.find(
      (s: { displayName: string }) => s.displayName === "Staff Member",
    );
    expect(unnamed).toBeDefined();
    expect(unnamed.role).toBe("support");
  });

  it("maps display names for named staff correctly", async () => {
    const res = await GET();
    const json = await res.json();

    const admin = json.staff.find((s: { role: string }) => s.role === "admin");
    expect(admin.displayName).toBe("Alice Admin");
  });

  it("returns an empty staff list with a 500 status on a database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ staff: [] });
  });
});
