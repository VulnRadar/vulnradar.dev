import { describe, it, expect } from "vitest";
import {
  hostOfUrlSql,
  PUBLIC_HOST_SQL,
  URL_ORIGIN_PATH_SQL,
} from "@/lib/database/sql-fragments";
import { SCHEMA_STEPS, stepQueries } from "@/lib/database/schema/index.mjs";

/**
 * The URL expressions queries and indexes share.
 *
 * What these tests can and cannot prove: Postgres is not available to the unit
 * tier, so the patterns are lifted out of the generated SQL and run through
 * JavaScript's regex engine. For these patterns (anchors, bracket classes, one
 * optional non-capturing group) the two engines agree, which makes this a real
 * check on the pattern and not on SQL syntax. Whether the server returns the
 * same thing is asserted against real rows in
 * tests/integration/blocked-domain-scans.test.ts and
 * tests/integration/domain-owner-control.test.ts.
 */

function patternOf(sql: string): RegExp {
  const match = /from '([^']+)'\)/.exec(sql);
  if (!match) throw new Error(`no substring() pattern in: ${sql}`);
  return new RegExp(match[1]);
}

function hostOf(url: string): string | null {
  const m = patternOf(hostOfUrlSql("x")).exec(url);
  return m ? m[1].toLowerCase() : null;
}

describe("hostOfUrlSql", () => {
  it("wraps the column it is given, so a caller can pass an alias", () => {
    expect(hostOfUrlSql("sh.url")).toMatch(/^LOWER\(substring\(sh\.url from /);
    expect(hostOfUrlSql("url")).toMatch(/^LOWER\(substring\(url from /);
  });

  it.each([
    ["https://example.com/", "example.com"],
    ["https://example.com", "example.com"],
    ["HTTPS://Example.COM/Path", "example.com"],
    ["http://example.com/deep/path?q=1", "example.com"],
    ["ftp://files.example.com/pub", "files.example.com"],
  ])("takes the host out of %s", (url, host) => {
    expect(hostOf(url)).toBe(host);
  });

  it.each([
    ["https://example.com:8443/x", "example.com"],
    ["https://example.com:8443", "example.com"],
    ["https://sub.example.com:8080/", "sub.example.com"],
    ["https://example.com?x=1", "example.com"],
    ["https://example.com#frag", "example.com"],
    ["https://example.com/a?b=c#d", "example.com"],
  ])("stops at the port, a bare query and a fragment in %s", (url, host) => {
    expect(hostOf(url)).toBe(host);
  });

  it.each([
    ["https://user@example.com/", "example.com"],
    ["https://user:pw@example.com/", "example.com"],
    ["https://user:pw@example.com:8443/x", "example.com"],
    // The userinfo names a lookalike; the host is what comes after the @.
    ["https://x.victim.com:pw@evil.com/", "evil.com"],
    ["https://victim.com@evil.com/", "evil.com"],
    // Several @ in the authority: a URL parser splits on the last one.
    ["https://a@b@example.com/", "example.com"],
  ])("skips userinfo in %s", (url, host) => {
    expect(hostOf(url)).toBe(host);
  });

  it.each([
    ["https://example.com/a@evil.com", "example.com"],
    ["https://example.com?next=a@evil.com", "example.com"],
    ["https://example.com#a@evil.com", "example.com"],
    ["https://other.test/?next=example.com", "other.test"],
  ])(
    "does not read an @ or a name that belongs to the path or query: %s",
    (url, host) => {
      expect(hostOf(url)).toBe(host);
    },
  );

  it("matches nothing for a value that is not an absolute URL", () => {
    expect(hostOf("example.com/path")).toBeNull();
    expect(hostOf("")).toBeNull();
  });

  it("needs no backslash, so no escape has to survive a template literal", () => {
    expect(hostOfUrlSql("url")).not.toContain("\\");
    expect(PUBLIC_HOST_SQL).not.toContain("\\");
    expect(URL_ORIGIN_PATH_SQL).not.toContain("\\");
  });
});

describe("PUBLIC_HOST_SQL", () => {
  it("is the host expression with one leading www. removed, over the bare url column", () => {
    expect(PUBLIC_HOST_SQL).toBe(
      `regexp_replace(${hostOfUrlSql("url")}, '^www[.]', '')`,
    );
  });

  it("reads a www host and its bare form as the same site", () => {
    const strip = (url: string) => (hostOf(url) ?? "").replace(/^www[.]/, "");
    expect(strip("https://www.example.com/")).toBe("example.com");
    expect(strip("https://WWW.Example.com:8443/x")).toBe("example.com");
    expect(strip("https://example.com/")).toBe("example.com");
    // Only a LEADING www. is removed.
    expect(strip("https://notwww.example.com/")).toBe("notwww.example.com");
    expect(strip("https://example.com.attacker.test/")).toBe(
      "example.com.attacker.test",
    );
  });
});

describe("URL_ORIGIN_PATH_SQL", () => {
  const cut = (url: string) => patternOf(URL_ORIGIN_PATH_SQL).exec(url)?.[0];

  it("cuts the query string and the fragment off and keeps the rest", () => {
    expect(cut("https://example.com/page?utm=1#top")).toBe(
      "https://example.com/page",
    );
    expect(cut("https://example.com/page#top")).toBe(
      "https://example.com/page",
    );
    expect(cut("https://example.com?x=1")).toBe("https://example.com");
    expect(cut("https://example.com/a/b/")).toBe("https://example.com/a/b/");
  });

  it("does not normalise anything else", () => {
    expect(cut("https://Example.com/Page")).toBe("https://Example.com/Page");
    expect(cut("https://example.com:8443/p")).toBe(
      "https://example.com:8443/p",
    );
  });
});

describe("the boot schema builds its expression indexes from these exact strings", () => {
  const sql = SCHEMA_STEPS.flatMap((step: unknown) => stepQueries(step)).join(
    "\n",
  );

  it("indexes PUBLIC_HOST_SQL, newest first, for public completed scans only", () => {
    expect(sql).toContain(
      `CREATE INDEX IF NOT EXISTS idx_scan_history_public_host\n          ON scan_history ((${PUBLIC_HOST_SQL}), scanned_at DESC)\n          WHERE is_public = true AND status = 'completed'`,
    );
  });

  it("indexes URL_ORIGIN_PATH_SQL, newest first, for public completed scans only", () => {
    expect(sql).toContain(
      `CREATE INDEX IF NOT EXISTS idx_scan_history_public_origin_path\n          ON scan_history ((${URL_ORIGIN_PATH_SQL}), scanned_at DESC)\n          WHERE is_public = true AND status = 'completed'`,
    );
  });
});
