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

const {
  findVerifiedDomainForHost,
  isUrlOwnedByUser,
  coveringDomainCandidates,
} = await import("@/lib/domains/scope");

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
    // AUDIT-012#perf-16: the match is an indexable equality test against the
    // host's own suffix list, not a LIKE pattern built from the column.
    expect(sql).toContain("domain = ANY($1::text[])");
    expect(sql).not.toContain("LIKE");
    expect(params).toEqual([["example.com", "com"], 1, []]);
  });

  it("lowercases the hostname before matching", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await findVerifiedDomainForHost("Example.COM", 1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toEqual(["example.com", "com"]);
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
    // example.net is not a subdomain of example.com, and the candidate list
    // sent to the database never contains example.com, so no row for it can
    // ever be returned.
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await isUrlOwnedByUser("https://example.net", 1)).toBe(false);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toEqual(["example.net", "net"]);
    expect(params[0]).not.toContain("example.com");
  });
});

describe("coveringDomainCandidates", () => {
  it("lists the host and every parent suffix, most specific first", () => {
    expect(coveringDomainCandidates("a.b.example.com")).toEqual([
      "a.b.example.com",
      "b.example.com",
      "example.com",
      "com",
    ]);
  });

  it("returns just the host for a single label", () => {
    expect(coveringDomainCandidates("localhost")).toEqual(["localhost"]);
  });

  it("never produces a sibling domain", () => {
    expect(coveringDomainCandidates("evil-example.com")).not.toContain(
      "example.com",
    );
  });

  // The old `$1 LIKE '%.' || domain` predicate read a stored underscore as a
  // single-character wildcard, so a verified `a_b.com` matched `x.axb.com`.
  it("cannot be widened by LIKE metacharacters in a stored domain", () => {
    expect(coveringDomainCandidates("x.axb.com")).toEqual([
      "x.axb.com",
      "axb.com",
      "com",
    ]);
  });
});
