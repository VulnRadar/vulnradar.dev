/**
 * Route-level tests for GET /api/v3/teams/teammates: the people the caller
 * shares a team with, for the remediation assignee picker. DB mocked at the
 * pool boundary.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

let rows: Record<string, unknown>[] = [];
const calls: { sql: string; params: unknown[] }[] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  // The FEATURE_TEAMS kill switch (lib/teams/feature-gate.ts) loads the
  // runtime-config table first on every teams route. It is infrastructure,
  // not part of what this route does, so it stays out of `calls`. An empty
  // result means "no admin override", so the flag falls back to its
  // compiled default (on).
  if (sql.includes("FROM system_settings")) return { rows: [] };
  calls.push({ sql, params });
  return { rows };
});
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params ?? []),
  },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const { GET } = await import("@/app/api/v3/teams/teammates/route");

beforeEach(() => {
  mockQuery.mockClear();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  rows = [];
  calls.length = 0;
});

describe("GET /api/v3/teams/teammates", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the caller's teammates, scoped to the caller and excluding self", async () => {
    rows = [
      { id: 7, name: "Alice", email: "alice@example.com", avatar_url: null },
    ];
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.teammates).toHaveLength(1);
    expect(json.teammates[0].name).toBe("Alice");

    const [call] = calls;
    expect(call.params).toEqual([42]);
    // Excludes the caller and is scoped through a shared team.
    expect(call.sql).toContain("other.user_id <> me.user_id");
    expect(call.sql).toContain("me.user_id = $1");
  });
});
