/**
 * Tests for the admin-configurable access-rules blacklist/whitelist layer.
 *
 * IMPORTANT SCOPE NOTE (read before extending these tests): access-rules.ts
 * is NOT the scanner's private-IP / SSRF guard. It is a DB-backed policy
 * layer that lets an admin blacklist or whitelist specific hosts/IPs
 * (compliance, abuse response, "lock the scanner to these targets for a
 * pentest engagement", etc). The actual SSRF protection (RFC1918, loopback,
 * link-local, IPv4-mapped IPv6, DNS-rebinding) lives in
 * lib/scanner/safe-fetch.ts (`isPrivateIP` / `isPrivateHostname` /
 * `validateScanTarget`), which is exercised by tests/lib/scanner/safe-fetch.test.ts
 * and is ALWAYS invoked in addition to checkAccessRules at every call site
 * (app/api/v3/scan/route.ts, scan/authenticated/route.ts, scan/bulk/route.ts
 * call both directly; demo-scan/route.ts and crawl/route.ts call
 * checkAccessRules for an early friendly 403 and then reach validateScanTarget
 * via safeFetch before any network request is made). The code's own comment
 * in the fail-closed catch block says as much: "The SSRF guard via
 * validateScanTarget still runs, so private-IP targets remain blocked
 * regardless."
 *
 * So the adversarial cases below (RFC1918, loopback, link-local, decimal/
 * octal/hex IPv4 obfuscation, IPv4-mapped IPv6) are tested against what this
 * module actually does: with no rules configured it allows everything
 * (documented, by design, not a bug), and when an "ip"-type rule exists it
 * correctly matches obfuscated IPv4 literals because `new URL(...).hostname`
 * itself normalizes decimal/octal/hex forms to canonical dotted-decimal
 * before this module ever sees the string — see the dedicated describe
 * block below that proves this.
 *
 * Per this repo's mocking rule (mock at the network/DB boundary, not below
 * it — see tests/README.md), we mock `@/lib/database/db`'s pool.query and
 * exercise the real checkAccessRules/checkAccessRulesMultiple logic against
 * it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { checkAccessRules, checkAccessRulesMultiple, clearAccessRulesCache } =
  await import("@/lib/scanner/access-rules");

beforeEach(() => {
  mockQuery.mockReset();
  // The module memoizes a completed evaluation per hostname for a short TTL
  // (AUDIT-012#perf-23). Every test below drives its own query sequence, so
  // the memo has to start empty or one test's decision answers the next.
  clearAccessRulesCache();
});

/** No blacklist match, no whitelist rules active -> allowed. */
function mockNoRulesConfigured() {
  mockQuery.mockResolvedValueOnce({ rows: [] }); // blacklist SELECT
  mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] }); // whitelist COUNT
}

describe("checkAccessRules: no rules configured", () => {
  it("allows a genuine public host", async () => {
    mockNoRulesConfigured();
    const result = await checkAccessRules("https://example.com/");
    expect(result.allowed).toBe(true);
  });

  it.each([
    ["loopback", "http://127.0.0.1/"],
    ["RFC1918 10.0.0.0/8", "http://10.1.2.3/"],
    ["RFC1918 172.16.0.0/12", "http://172.16.5.5/"],
    ["RFC1918 192.168.0.0/16", "http://192.168.1.1/"],
    ["link-local / cloud metadata", "http://169.254.169.254/"],
    ["IPv6 loopback", "http://[::1]/"],
    ["IPv4-mapped IPv6 loopback", "http://[::ffff:127.0.0.1]/"],
  ])(
    "does NOT block %s on its own (private-IP blocking is validateScanTarget's job, not this module's)",
    async (_label, url) => {
      mockNoRulesConfigured();
      const result = await checkAccessRules(url);
      // Documented, intentional behaviour: this module only enforces
      // admin-configured rules. With none configured, everything passes
      // through to the real SSRF guard elsewhere.
      expect(result.allowed).toBe(true);
    },
  );
});

describe("checkAccessRules: URL/domain normalization before hitting the query", () => {
  it("lowercases the hostname used as the LIKE right-hand value", async () => {
    mockNoRulesConfigured();
    await checkAccessRules("https://EXAMPLE.com/Path");
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe("example.com");
  });

  it.each([
    ["decimal", "http://2130706433/"],
    ["hex", "http://0x7f000001/"],
    ["octal", "http://0177.0.0.1/"],
    ["shorthand dotted", "http://127.1/"],
  ])(
    "normalizes %s-obfuscated 127.0.0.1 to dotted-decimal before the IP-rule query param is built",
    async (_label, url) => {
      mockNoRulesConfigured();
      await checkAccessRules(url);
      const [, params] = mockQuery.mock.calls[0];
      // params[0] is the hostname used for the URL-type LIKE match,
      // params[1] (when present) is the extracted IP used for the
      // IP-type exact match. Both must have already been normalized to
      // "127.0.0.1" by the WHATWG URL parser by the time this module
      // runs its own regex — it never has to un-obfuscate anything itself.
      expect(params[0]).toBe("127.0.0.1");
      expect(params[1]).toBe("127.0.0.1");
    },
  );

  it("an admin ip-type blacklist rule for 127.0.0.1 DOES catch the decimal-obfuscated form", async () => {
    // Blacklist SELECT returns a hit because the query used the
    // normalized "127.0.0.1" as $2, matching an ip-type rule.
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          value: "127.0.0.1",
          value_type: "ip",
          reason: "internal-only",
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // fire-and-forget hit_count UPDATE

    const result = await checkAccessRules("http://2130706433/admin");
    expect(result.allowed).toBe(false);
    expect(result.ruleType).toBe("blacklist");
    expect(result.matchedValue).toBe("127.0.0.1");
  });

  it("does not extract an IP parameter for a non-IPv4-literal hostname", async () => {
    mockNoRulesConfigured();
    await checkAccessRules("https://example.com/");
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(["example.com"]);
  });

  it("IPv6 literals are not recognized by the ip-type regex (dotted-decimal only), so an ip-type rule cannot match them", async () => {
    mockNoRulesConfigured();
    await checkAccessRules("http://[2001:4860:4860::8888]/");
    const [, params] = mockQuery.mock.calls[0];
    // No second query param -> ipCondition stayed "false" in the SQL,
    // meaning an admin cannot write an ip-type rule to block/allow this
    // IPv6 literal through this module. (validateScanTarget still
    // classifies IPv6 literals correctly; this is a narrower limitation
    // of the admin rule-matching feature, not an SSRF bypass.)
    expect(params).toEqual(["[2001:4860:4860::8888]"]);
  });
});

describe("checkAccessRules: blacklist", () => {
  it("blocks when a blacklist rule matches and returns its reason", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          value: "malicious.example.com",
          value_type: "url",
          reason: "Reported for abuse",
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // hit_count UPDATE

    const result = await checkAccessRules("https://malicious.example.com/x");
    expect(result.allowed).toBe(false);
    expect(result.ruleType).toBe("blacklist");
    expect(result.reason).toBe("Reported for abuse");
    expect(result.matchedValue).toBe("malicious.example.com");
  });

  it("falls back to a generic reason for a url-type match with no admin reason set", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: "bad.example.com", value_type: "url", reason: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await checkAccessRules("https://bad.example.com/");
    expect(result.reason).toMatch(/URL\/domain/i);
  });

  it("falls back to a generic IP reason for an ip-type match with no admin reason set", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: "203.0.113.5", value_type: "ip", reason: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await checkAccessRules("http://203.0.113.5/");
    expect(result.reason).toMatch(/IP address/i);
  });

  it("fires the hit-count UPDATE without letting its failure affect the result", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: "bad.example.com", value_type: "url", reason: "x" }],
    });
    mockQuery.mockRejectedValueOnce(new Error("update failed"));

    const result = await checkAccessRules("https://bad.example.com/");
    expect(result.allowed).toBe(false);
    // Give the fire-and-forget .catch(() => {}) a tick to run so it
    // doesn't produce an unhandled rejection after the test finishes.
    await new Promise((r) => setTimeout(r, 0));
  });

  it("blacklist wins over an active whitelist (blacklist checked first, short-circuits)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: "example.com", value_type: "url", reason: "blocked" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // hit_count UPDATE

    const result = await checkAccessRules("https://example.com/");
    expect(result.allowed).toBe(false);
    expect(result.ruleType).toBe("blacklist");
    // Whitelist COUNT query must never even run.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe("checkAccessRules: whitelist", () => {
  it("allows through when no whitelist rules are active at all", async () => {
    mockNoRulesConfigured();
    const result = await checkAccessRules("https://anything.example.com/");
    expect(result.allowed).toBe(true);
  });

  it("blocks a host that is not on an active whitelist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // blacklist: no match
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 2 }] }); // whitelist active
    mockQuery.mockResolvedValueOnce({ rows: [] }); // whitelist SELECT: no match

    const result = await checkAccessRules("https://not-on-list.example.com/");
    expect(result.allowed).toBe(false);
    expect(result.ruleType).toBe("whitelist");
    expect(result.reason).toMatch(/not on the active whitelist/i);
  });

  it("allows a host that matches an active whitelist entry", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // blacklist: no match
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] }); // whitelist active
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: "allowed.example.com", value_type: "url" }],
    });

    const result = await checkAccessRules("https://allowed.example.com/x");
    expect(result.allowed).toBe(true);
  });
});

describe("checkAccessRules: fail-closed behaviour", () => {
  it("blocks and reports unavailability when the blacklist query throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("connection terminated"));

    const result = await checkAccessRules("https://example.com/");
    expect(result.allowed).toBe(false);
    expect(result.ruleType).toBe("blacklist");
    expect(result.reason).toMatch(/temporarily unavailable/i);
    logged.mockRestore();
  });

  it("blocks and reports unavailability when the whitelist-count query throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockResolvedValueOnce({ rows: [] }); // blacklist ok
    mockQuery.mockRejectedValueOnce(new Error("connection terminated"));

    const result = await checkAccessRules("https://example.com/");
    expect(result.allowed).toBe(false);
    logged.mockRestore();
  });

  it("fails closed (does not crash or silently allow) for an unparseable URL", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await checkAccessRules("not a url at all");
    expect(result.allowed).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("checkAccessRules: per-hostname memo (AUDIT-012#perf-23)", () => {
  it("answers a repeat check of the same host without re-querying", async () => {
    mockNoRulesConfigured();

    const first = await checkAccessRules("https://repeat.example.com/one");
    const second = await checkAccessRules("https://repeat.example.com/two");
    const third = await checkAccessRules("https://repeat.example.com/three");

    expect(first.allowed).toBe(true);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    // Two queries total for three checks: the blacklist SELECT and the
    // whitelist COUNT ran once, not once per URL.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("still evaluates a different host on its own", async () => {
    mockNoRulesConfigured();
    mockNoRulesConfigured();

    await checkAccessRules("https://one.example.com/");
    await checkAccessRules("https://two.example.com/");

    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  it("keeps counting hits on a cached block so hit_count stays honest", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: "blocked.example.com", value_type: "url", reason: "no" }],
    });
    mockQuery.mockResolvedValue({ rows: [] }); // every hit_count UPDATE

    const first = await checkAccessRules("https://blocked.example.com/a");
    const second = await checkAccessRules("https://blocked.example.com/b");

    expect(first.allowed).toBe(false);
    expect(second.allowed).toBe(false);
    // 1 blacklist SELECT + 2 hit_count UPDATEs: the second decision came
    // from the memo but still recorded the hit.
    expect(mockQuery).toHaveBeenCalledTimes(3);
    await new Promise((r) => setTimeout(r, 0));
  });

  it("never memoizes the fail-closed result, so recovery is immediate", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("connection terminated"));

    const duringOutage = await checkAccessRules("https://flaky.example.com/");
    expect(duringOutage.allowed).toBe(false);

    mockNoRulesConfigured();
    const afterRecovery = await checkAccessRules("https://flaky.example.com/");
    expect(afterRecovery.allowed).toBe(true);
    logged.mockRestore();
  });
});

describe("checkAccessRulesMultiple", () => {
  it("returns allowed: true when every URL clears the rules", async () => {
    mockNoRulesConfigured();
    mockNoRulesConfigured();

    const result = await checkAccessRulesMultiple([
      "https://a.example.com/",
      "https://b.example.com/",
    ]);
    expect(result.allowed).toBe(true);
    expect(result.blockedUrl).toBeUndefined();
  });

  it("stops at and reports the first blocked URL", async () => {
    mockNoRulesConfigured(); // a.example.com passes
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: "b.example.com", value_type: "url", reason: "nope" }],
    }); // b.example.com blacklisted
    mockQuery.mockResolvedValueOnce({ rows: [] }); // hit_count UPDATE

    const result = await checkAccessRulesMultiple([
      "https://a.example.com/",
      "https://b.example.com/",
      "https://c.example.com/",
    ]);
    expect(result.allowed).toBe(false);
    expect(result.blockedUrl).toBe("https://b.example.com/");
    // c.example.com must never be checked once b.example.com blocked.
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });
});
