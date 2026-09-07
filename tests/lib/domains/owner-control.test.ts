import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What proving you own a domain lets you do about scans of it.
 *
 * The unit tier fakes pool.query (see tests/README.md), so these assert the
 * SHAPE of the SQL and the decisions around it rather than what Postgres does
 * with it. That is the right tier for this module: every rule worth pinning
 * here is a rule about scope and about what is deliberately NOT done, and both
 * are visible in the statement.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockClearCache = vi.fn();
vi.mock("@/lib/scanner/access-rules", () => ({
  clearAccessRulesCache: () => mockClearCache(),
}));

const {
  resolveOwnedDomain,
  listDomainScans,
  applyDomainScanAction,
  readDomainBlock,
  blockDomain,
  unblockDomain,
} = await import("@/lib/domains/owner-control");

/** The SQL text of the nth pool.query call. */
function sql(n = 0): string {
  return String(mockQuery.mock.calls[n][0]);
}

/** The bound parameters of the nth pool.query call. */
function args(n = 0): unknown[] {
  return mockQuery.mock.calls[n][1] as unknown[];
}

beforeEach(() => {
  mockQuery.mockReset();
  mockClearCache.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("resolveOwnedDomain", () => {
  it("requires the row to be the caller's own AND verified", async () => {
    await resolveOwnedDomain(7, 42);
    expect(sql()).toContain("user_id = $2");
    expect(sql()).toContain("status = 'verified'");
    expect(args()).toEqual([7, 42]);
  });

  it("does not accept a team-assigned domain", async () => {
    // Every other domain read lets a teammate see the row, which is right for
    // reading. This gates unpublishing other people's scans and switching off
    // scanning for a whole zone, so it stays with the account that proved the
    // ownership rather than spreading to everyone in their team.
    await resolveOwnedDomain(7, 42);
    expect(sql()).not.toContain("team_id");
  });

  it("returns null when nothing matches", async () => {
    expect(await resolveOwnedDomain(7, 42)).toBeNull();
  });
});

describe("listDomainScans", () => {
  beforeEach(async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await listDomainScans("example.com", 42, 100);
  });

  it("lists only what a stranger can already read", () => {
    // Public rows appear on /public-scans and /host; a share_token row is
    // unlisted but readable by anyone holding the link. A PRIVATE scan someone
    // else ran is their own record and exposes nothing about the domain, so
    // listing it would turn domain verification into a surveillance tool over
    // other accounts.
    expect(sql()).toContain(
      "sh.is_public = true OR sh.share_token IS NOT NULL",
    );
  });

  it("matches on the host parsed out of the URL, not on the URL", () => {
    // Matching the URL text would make "https://evil.com/?x=example.com" a
    // scan of example.com, and hand its owner control over a stranger's scan
    // of a completely different site.
    expect(sql()).toContain("substring(sh.url from");
    expect(sql()).toContain("LIKE '%.' || LOWER($1)");
  });

  it("covers subdomains, the same scope verification proved", () => {
    expect(sql()).toContain("= LOWER($1)");
    expect(sql()).toContain("LIKE '%.' || LOWER($1)");
  });

  it("says whether a scan is the caller's own without naming anyone else", () => {
    expect(sql()).toContain("(sh.user_id = $2) AS is_own_scan");
    // No join to users, no email, no display name. That a scan exists is
    // already public; who ran it is not.
    expect(sql()).not.toContain("JOIN users");
    expect(sql()).not.toContain("email");
  });

  it("bounds the list", () => {
    expect(sql()).toContain("LIMIT $3");
    expect(args()[2]).toBe(100);
  });
});

describe("applyDomainScanAction", () => {
  it("unpublish clears is_public and never deletes", async () => {
    await applyDomainScanAction("example.com", "unpublish", null);
    expect(sql()).toContain("SET is_public = false");
    expect(sql()).toMatch(/^\s*UPDATE scan_history/);
    expect(sql()).not.toContain("DELETE");
  });

  it("revoke-shares clears the token and never deletes", async () => {
    await applyDomainScanAction("example.com", "revoke-shares", null);
    expect(sql()).toContain("SET share_token = NULL");
    expect(sql()).not.toContain("DELETE");
  });

  it("skips rows that are already in the requested state", async () => {
    // Without this, "unpublish all" reports every covered scan as affected on
    // every press, including the ones that were already private.
    await applyDomainScanAction("example.com", "unpublish", null);
    expect(sql()).toContain("WHERE sh.is_public = true");
    mockQuery.mockClear();
    await applyDomainScanAction("example.com", "revoke-shares", null);
    expect(sql()).toContain("WHERE sh.share_token IS NOT NULL");
  });

  it("is always scoped by the domain, even when specific scans are named", async () => {
    // The id list narrows the set; it can never widen it past the domain the
    // caller verified.
    await applyDomainScanAction("example.com", "unpublish", ["abc", "def"]);
    expect(sql()).toContain("LOWER($1)");
    expect(sql()).toContain("sh.public_id = ANY($2::text[])");
    expect(args()).toEqual(["example.com", ["abc", "def"]]);
  });

  it("applies to every covered scan when no ids are given", async () => {
    await applyDomainScanAction("example.com", "unpublish", null);
    expect(sql()).not.toContain("public_id = ANY");
    expect(args()).toEqual(["example.com"]);
  });

  it("reports how many rows actually changed", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 3 });
    expect(
      await applyDomainScanAction("example.com", "unpublish", null),
    ).toEqual({ affected: 3 });
  });
});

describe("readDomainBlock", () => {
  it("asks about every covering name, not just the exact domain", async () => {
    await readDomainBlock("app.example.com", 42);
    // A block on the apex blocks this host too. Reporting "not blocked" here
    // would be a lie the scan API immediately contradicts.
    expect(args()[0]).toEqual(["app.example.com", "example.com", "com"]);
  });

  it("reports a staff block rather than hiding it", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 9,
          reason: "abuse",
          created_at: "2026-01-01T00:00:00Z",
          created_by: 1,
        },
      ],
    });
    const block = await readDomainBlock("example.com", 42);
    expect(block).not.toBeNull();
    // Told the truth, and told they cannot lift it, rather than being shown a
    // control that would silently do nothing.
    expect(block?.liftable).toBe(false);
  });

  it("marks the caller's own block as liftable", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 9,
          reason: null,
          created_at: "2026-01-01T00:00:00Z",
          created_by: 42,
        },
      ],
    });
    expect((await readDomainBlock("example.com", 42))?.liftable).toBe(true);
  });

  it("ignores an expired or deactivated rule", async () => {
    await readDomainBlock("example.com", 42);
    expect(sql()).toContain("is_active = true");
    expect(sql()).toContain("expires_at IS NULL OR expires_at > NOW()");
  });
});

describe("blockDomain", () => {
  it("writes the same kind of rule the admin blocklist writes", async () => {
    await blockDomain("example.com", 42, "opting out");
    expect(sql()).toContain("INSERT INTO access_rules");
    expect(sql()).toContain("'blacklist', 'url'");
    // Same table, same enforcement path: checkAccessRules refuses the target
    // before any scan starts, on every route.
    expect(args()).toContain(42);
  });

  it("records who created it, which is what makes it liftable later", async () => {
    await blockDomain("example.com", 42, "opting out");
    expect(sql()).toContain("created_by");
  });

  it("pressing it twice is not an error", async () => {
    await blockDomain("example.com", 42, "opting out");
    expect(sql()).toContain(
      "ON CONFLICT (rule_type, value_type, value) DO NOTHING",
    );
  });

  it("drops the rule memo so the block takes effect now", async () => {
    // checkAccessRules memoizes per hostname for 30 seconds. Without this an
    // owner who has just switched scanning off watches scans of their domain
    // succeed for the next half minute.
    await blockDomain("example.com", 42, "opting out");
    expect(mockClearCache).toHaveBeenCalled();
  });
});

describe("unblockDomain", () => {
  it("only lifts a rule this account created", async () => {
    await unblockDomain("example.com", 42);
    // A staff block exists because someone decided this target should not be
    // scanned from this deployment, and proving you own the domain is not an
    // answer to that.
    expect(sql()).toContain("created_by = $2");
    expect(args()).toEqual(["example.com", 42]);
  });

  it("reports whether anything was actually lifted", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    expect(await unblockDomain("example.com", 42)).toBe(false);
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    expect(await unblockDomain("example.com", 42)).toBe(true);
  });

  it("drops the rule memo so scanning resumes now", async () => {
    await unblockDomain("example.com", 42);
    expect(mockClearCache).toHaveBeenCalled();
  });
});
