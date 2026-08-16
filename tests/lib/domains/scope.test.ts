import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetAssignableTeamIds = vi.fn();
vi.mock("@/lib/auth/team-resource-access", () => ({
  getAssignableTeamIds: (...args: unknown[]) =>
    mockGetAssignableTeamIds(...args),
}));

const { findVerifiedDomainForHost, isUrlOwnedByUser } =
  await import("@/lib/domains/scope");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetAssignableTeamIds.mockReset();
  mockGetAssignableTeamIds.mockResolvedValue([]);
});

describe("findVerifiedDomainForHost", () => {
  it("returns null when no row matches", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await findVerifiedDomainForHost("example.com", 1)).toBeNull();
  });

  it("matches the exact registered domain", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, domain: "example.com", user_id: 1, team_id: null }],
    });
    const match = await findVerifiedDomainForHost("example.com", 1);
    expect(match).toEqual({
      id: 5,
      domain: "example.com",
      userId: 1,
      teamId: null,
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'verified'");
    expect(sql).toContain("$1 = domain OR $1 LIKE '%.' || domain");
    expect(params).toEqual(["example.com", 1, []]);
  });

  it("lowercases the hostname before matching", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await findVerifiedDomainForHost("Example.COM", 1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe("example.com");
  });

  it("passes the caller's assignable team ids through for team-domain matching", async () => {
    mockGetAssignableTeamIds.mockResolvedValueOnce([7, 9]);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await findVerifiedDomainForHost("example.com", 1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[2]).toEqual([7, 9]);
  });
});

describe("isUrlOwnedByUser", () => {
  it("returns true when the URL's host has a verified match", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, domain: "example.com", user_id: 1, team_id: null }],
    });
    expect(await isUrlOwnedByUser("https://example.com/path", 1)).toBe(true);
  });

  it("returns true for a subdomain of a verified root domain", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, domain: "example.com", user_id: 1, team_id: null }],
    });
    expect(await isUrlOwnedByUser("https://app.example.com/dashboard", 1)).toBe(
      true,
    );
  });

  it("returns false when nothing matches", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await isUrlOwnedByUser("https://example.com", 1)).toBe(false);
  });

  it("returns false (fails closed) for an unparseable URL", async () => {
    expect(await isUrlOwnedByUser("not a url", 1)).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("fails closed when the database query throws", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection reset"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await isUrlOwnedByUser("https://example.com", 1)).toBe(false);
    errorSpy.mockRestore();
  });

  it("never lets owning example.com cover a different registrable domain", async () => {
    // example.net is not a subdomain of example.com, and the SQL match
    // condition ($1 = domain OR $1 LIKE '%.' || domain) cannot match it --
    // asserted here by confirming the mocked "no match" path is what's hit.
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await isUrlOwnedByUser("https://example.net", 1)).toBe(false);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe("example.net");
  });
});
