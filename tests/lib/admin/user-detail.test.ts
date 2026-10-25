import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { buildUserDetailSql, fetchUserDetailBundle } =
  await import("@/lib/admin/user-detail");

const ALL = {
  scans: true,
  apiKeys: true,
  webhooks: true,
  sessions: true,
  credits: true,
};
const NONE = {
  scans: false,
  apiKeys: false,
  webhooks: false,
  sessions: false,
  credits: false,
};

beforeEach(() => {
  mockQuery.mockReset();
});

/**
 * The request ran eleven queries in one Promise.all against a pool of ten that
 * serves every other request too. What each flag does to the statement is the
 * permission model, so it is pinned here; whether the statement is valid and
 * returns the right rows is tests/integration/admin-user-detail.test.ts.
 */
describe("buildUserDetailSql", () => {
  it("is a single SELECT bound to one id", () => {
    const sql = buildUserDetailSql(ALL);
    expect(sql.match(/\$\d+/g)).toEqual(["$1"]);
    expect(sql.trimStart().startsWith("SELECT u.id")).toBe(true);
    expect(sql).toContain("WHERE u.id = $1");
  });

  it("always includes the lookups every caller with VIEW_USERS may have", () => {
    const sql = buildUserDetailSql(NONE);
    for (const column of [
      "badges",
      "notes",
      "discord_connection",
      "github_repo_connection",
    ]) {
      expect(sql, column).toContain(`AS ${column}`);
    }
  });

  // A fragment that is not asked for is not in the SQL at all, so the rows it
  // would return are never read rather than read and then dropped.
  it.each([
    ["scans", ["recent_scans", "schedules", "host_reputation"]],
    ["apiKeys", ["AS api_keys", "key_prefix"]],
    ["webhooks", ["AS webhooks", "split_part(url"]],
    ["sessions", ["active_sessions", "ip_address"]],
    ["credits", ["AS credits", "browserbase_credit_seconds_balance"]],
  ] as const)(
    "leaves %s out of the statement entirely when it is not granted",
    (flag, fragments) => {
      const without = buildUserDetailSql({ ...ALL, [flag]: false });
      const withIt = buildUserDetailSql(ALL);
      for (const fragment of fragments) {
        expect(withIt, fragment).toContain(fragment);
        expect(without, fragment).not.toContain(fragment);
      }
    },
  );

  it("never selects a connection's access or refresh token", () => {
    const sql = buildUserDetailSql(ALL);
    expect(sql).not.toMatch(/access_token|refresh_token/);
  });

  it("selects a webhook's host and not its URL, which is the credential", () => {
    const sql = buildUserDetailSql(ALL);
    expect(sql).toContain("split_part(url, '/', 3) AS url_host");
    expect(sql).not.toMatch(/SELECT id, name, url,/);
  });

  it("selects the scan status that keeps a failed scan from reading as clean", () => {
    expect(buildUserDetailSql(ALL)).toContain(
      "SELECT id, public_id, url, status, failure_kind, findings_count, source, scanned_at",
    );
  });
});

describe("fetchUserDetailBundle", () => {
  it("returns null for a user that does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await fetchUserDetailBundle(404, ALL)).toBeNull();
  });

  it("separates the account from the json columns the statement adds", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 9,
          email: "u@example.test",
          scan_count: 4,
          recent_scans: [{ id: 1 }],
          schedules: [{ id: 2 }],
          api_keys: [{ id: 3 }],
          webhooks: [{ id: 4 }],
          active_sessions: [{ id: "s" }],
          badges: [{ id: 5 }],
          notes: [{ id: 6 }],
          discord_connection: { discord_id: "d" },
          github_repo_connection: { github_username: "g" },
          credits: {
            ai_credit_balance: "1500",
            github_credit_balance: 2500,
            browserbase_credit_seconds_balance: "600",
          },
        },
      ],
    });
    const bundle = await fetchUserDetailBundle(9, ALL);
    expect(mockQuery.mock.calls[0][1]).toEqual([9]);
    // The account keeps its own columns and none of the added ones.
    expect(bundle?.user).toEqual({
      id: 9,
      email: "u@example.test",
      scan_count: 4,
    });
    expect(bundle).toMatchObject({
      recentScans: [{ id: 1 }],
      schedules: [{ id: 2 }],
      apiKeys: [{ id: 3 }],
      webhooks: [{ id: 4 }],
      activeSessions: [{ id: "s" }],
      badges: [{ id: 5 }],
      notes: [{ id: 6 }],
      discordConnection: { discord_id: "d" },
      githubRepoConnection: { github_username: "g" },
      // BIGINT balances arrive as strings; the panel needs numbers.
      credits: {
        aiCreditBalance: 1500,
        githubCreditBalance: 2500,
        browserbaseCreditSecondsBalance: 600,
      },
    });
  });

  it("reads absent columns as empty lists and null, never undefined", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 9, email: "u@e.test" }] });
    const bundle = await fetchUserDetailBundle(9, NONE);
    expect(bundle).toMatchObject({
      recentScans: [],
      apiKeys: [],
      webhooks: [],
      schedules: [],
      activeSessions: [],
      badges: [],
      notes: [],
      discordConnection: null,
      githubRepoConnection: null,
      credits: null,
    });
  });
});
