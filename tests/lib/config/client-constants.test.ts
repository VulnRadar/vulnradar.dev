import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  API,
  STAFF_ROLES,
  STAFF_ROLE_HIERARCHY,
  STAFF_ROLE_LABELS,
  ROLE_BADGE_STYLES,
  SOCIAL_LINKS,
  SOCIAL_PLATFORM_IDS,
  SOCIAL_PROFILE_URLS,
  type SocialPlatformId,
} from "@/lib/config/client-constants";
import { FROZEN } from "@/lib/api/frozen-paths";
import {
  CONFIG_DISCORD_INVITE_URL,
  CONFIG_SOCIAL_BLUESKY_URL,
  CONFIG_SOCIAL_INSTAGRAM_URL,
  CONFIG_SOCIAL_LINKEDIN_URL,
  CONFIG_SOCIAL_MASTODON_URL,
  CONFIG_SOCIAL_REDDIT_URL,
  CONFIG_SOCIAL_RSS_URL,
  CONFIG_SOCIAL_TIKTOK_URL,
  CONFIG_SOCIAL_X_URL,
  CONFIG_SOCIAL_YOUTUBE_URL,
} from "@/lib/config/config-values";

/**
 * Focused regression coverage for the super_admin role tier added to the
 * staff role model. The full hierarchy/permission *behavior* is exercised
 * where it's actually consumed (tests/lib/auth/authorization.test.ts,
 * tests/lib/auth/permissions-client.test.ts, and the admin route suites);
 * this file only pins the raw data these all read from, so a future edit
 * that reorders or removes super_admin fails loudly here first.
 */
describe("STAFF_ROLES / STAFF_ROLE_HIERARCHY (super_admin tier)", () => {
  it("exposes SUPER_ADMIN as 'super_admin'", () => {
    expect(STAFF_ROLES.SUPER_ADMIN).toBe("super_admin");
  });

  it("places super_admin strictly above admin, which is above every other role", () => {
    expect(STAFF_ROLE_HIERARCHY.super_admin).toBeGreaterThan(
      STAFF_ROLE_HIERARCHY.admin,
    );
    expect(STAFF_ROLE_HIERARCHY.admin).toBeGreaterThan(
      STAFF_ROLE_HIERARCHY.moderator,
    );
    expect(STAFF_ROLE_HIERARCHY.moderator).toBeGreaterThan(
      STAFF_ROLE_HIERARCHY.support,
    );
    expect(STAFF_ROLE_HIERARCHY.support).toBeGreaterThan(
      STAFF_ROLE_HIERARCHY.user,
    );
  });

  it("gives super_admin its own label distinct from admin's", () => {
    expect(STAFF_ROLE_LABELS.super_admin).toBe("Super Admin");
    expect(STAFF_ROLE_LABELS.super_admin).not.toBe(STAFF_ROLE_LABELS.admin);
  });

  it("gives super_admin its own badge style, not a reuse of admin's", () => {
    expect(ROLE_BADGE_STYLES.super_admin).toBeTruthy();
    expect(ROLE_BADGE_STYLES.super_admin).not.toBe(ROLE_BADGE_STYLES.admin);
  });
});

/**
 * The social-account registry: one list that the footer, the landing page's
 * open-source section, and the JSON-LD Organization node all read, so those
 * three cannot disagree about which accounts exist.
 *
 * The environment-stubbing tests below are real, not decorative. Next.js
 * inlines NEXT_PUBLIC_* at build time, but under Vitest these are ordinary
 * `process.env` reads at module load, so `vi.stubEnv` + `vi.resetModules` +
 * a fresh dynamic import exercises the override path a self-hoster actually
 * uses.
 */
describe("SOCIAL_LINKS / SOCIAL_PROFILE_URLS (social account registry)", () => {
  /**
   * Which shipped constant backs each platform. Note Discord: it reads the
   * pre-existing CONFIG_DISCORD_INVITE_URL rather than a CONFIG_SOCIAL_*
   * constant of its own, so one invite cannot end up in the footer while a
   * different one is published as the organisation's Discord.
   */
  const SHIPPED_URL: Record<SocialPlatformId, string> = {
    youtube: CONFIG_SOCIAL_YOUTUBE_URL,
    tiktok: CONFIG_SOCIAL_TIKTOK_URL,
    instagram: CONFIG_SOCIAL_INSTAGRAM_URL,
    x: CONFIG_SOCIAL_X_URL,
    discord: CONFIG_DISCORD_INVITE_URL,
    mastodon: CONFIG_SOCIAL_MASTODON_URL,
    bluesky: CONFIG_SOCIAL_BLUESKY_URL,
    linkedin: CONFIG_SOCIAL_LINKEDIN_URL,
    reddit: CONFIG_SOCIAL_REDDIT_URL,
    rss: CONFIG_SOCIAL_RSS_URL,
  };

  /** Every platform's environment override, in declaration order. */
  const ENV_VAR: Record<SocialPlatformId, string> = {
    youtube: "NEXT_PUBLIC_SOCIAL_YOUTUBE_URL",
    tiktok: "NEXT_PUBLIC_SOCIAL_TIKTOK_URL",
    instagram: "NEXT_PUBLIC_SOCIAL_INSTAGRAM_URL",
    x: "NEXT_PUBLIC_SOCIAL_X_URL",
    discord: "NEXT_PUBLIC_DISCORD_INVITE_URL",
    mastodon: "NEXT_PUBLIC_SOCIAL_MASTODON_URL",
    bluesky: "NEXT_PUBLIC_SOCIAL_BLUESKY_URL",
    linkedin: "NEXT_PUBLIC_SOCIAL_LINKEDIN_URL",
    reddit: "NEXT_PUBLIC_SOCIAL_REDDIT_URL",
    rss: "NEXT_PUBLIC_SOCIAL_RSS_URL",
  };

  async function reimport() {
    vi.resetModules();
    return import("@/lib/config/client-constants");
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("backs every declared platform id with exactly one shipped constant", () => {
    expect(Object.keys(SHIPPED_URL).sort()).toEqual(
      [...SOCIAL_PLATFORM_IDS].sort(),
    );
    expect(Object.keys(ENV_VAR).sort()).toEqual(
      [...SOCIAL_PLATFORM_IDS].sort(),
    );
  });

  it("renders exactly the platforms whose shipped URL is set, in declaration order", () => {
    const configured = SOCIAL_PLATFORM_IDS.filter(
      (id) => SHIPPED_URL[id] !== "",
    );

    expect(SOCIAL_LINKS.map((link) => link.id)).toEqual(configured);
    expect(SOCIAL_LINKS.map((link) => link.url)).toEqual(
      configured.map((id) => SHIPPED_URL[id]),
    );
  });

  it("omits an unconfigured platform from the links and from sameAs alike", () => {
    const unconfigured = SOCIAL_PLATFORM_IDS.filter(
      (id) => SHIPPED_URL[id] === "",
    );

    // Guards against this becoming vacuous if every platform is configured
    // one day: the point is that the list ships with real "off" entries.
    expect(unconfigured.length).toBeGreaterThan(0);
    for (const id of unconfigured) {
      expect(
        SOCIAL_LINKS.some((link) => link.id === id),
        `${id} should not render`,
      ).toBe(false);
    }
    expect(SOCIAL_PROFILE_URLS).not.toContain("");
  });

  it("gives every configured platform an absolute https URL and a label", () => {
    for (const link of SOCIAL_LINKS) {
      expect(new URL(link.url).protocol, link.id).toBe("https:");
      expect(link.url.startsWith("https://"), link.id).toBe(true);
      expect(link.label.trim(), link.id).not.toBe("");
    }
  });

  it("publishes exactly the configured profile URLs as sameAs", () => {
    // Derived from config-values, not from SOCIAL_LINKS: asserting one
    // export against the other would pass with the filter deleted.
    const expected = SOCIAL_PLATFORM_IDS.filter(
      (id) => id !== "rss" && SHIPPED_URL[id] !== "",
    ).map((id) => SHIPPED_URL[id]);

    expect(SOCIAL_PROFILE_URLS).toEqual(expected);
  });

  it("keeps a configured RSS feed out of sameAs while still rendering it", async () => {
    const feed = "https://example.test/feed.xml";
    vi.stubEnv("NEXT_PUBLIC_SOCIAL_RSS_URL", feed);

    const fresh = await reimport();

    expect(fresh.SOCIAL_LINKS.map((link) => link.id)).toContain("rss");
    expect(fresh.SOCIAL_PROFILE_URLS).not.toContain(feed);
  });

  it("lets the environment override each platform independently", async () => {
    // Also the branch coverage for all ten `env || constant` fallbacks: the
    // default import above only ever exercises the constant side.
    for (const id of SOCIAL_PLATFORM_IDS) {
      vi.stubEnv(ENV_VAR[id], `https://example.test/${id}`);
    }

    const fresh = await reimport();

    expect(fresh.SOCIAL_LINKS.map((link) => link.url)).toEqual(
      SOCIAL_PLATFORM_IDS.map((id) => `https://example.test/${id}`),
    );
    // Every platform now configured, so every one but the feed is published.
    expect(fresh.SOCIAL_PROFILE_URLS).toEqual(
      SOCIAL_PLATFORM_IDS.filter((id) => id !== "rss").map(
        (id) => `https://example.test/${id}`,
      ),
    );
  });

  it("ignores a value that is not an absolute https URL", async () => {
    for (const bad of [
      "bsky.app/profile/example.test",
      "http://bsky.app/profile/example.test",
      "javascript:alert(1)",
      "   ",
    ]) {
      vi.stubEnv("NEXT_PUBLIC_SOCIAL_BLUESKY_URL", bad);
      const fresh = await reimport();

      expect(
        fresh.SOCIAL_LINKS.some((link) => link.id === "bluesky"),
        bad,
      ).toBe(false);
      expect(fresh.SOCIAL_PROFILE_URLS, bad).not.toContain(bad);
      vi.unstubAllEnvs();
    }
  });

  it("deduplicates sameAs when two platforms point at the same URL", async () => {
    const shared = "https://example.test/one-account";
    vi.stubEnv("NEXT_PUBLIC_SOCIAL_MASTODON_URL", shared);
    vi.stubEnv("NEXT_PUBLIC_SOCIAL_BLUESKY_URL", shared);

    const fresh = await reimport();

    expect(
      fresh.SOCIAL_PROFILE_URLS.filter((url) => url === shared),
    ).toHaveLength(1);
  });
});

/**
 * The footer's "Hosted by" credit. A claim about one deployment rather than
 * about the software, so it must be removable and must never render a link
 * that is not an absolute https URL.
 */
describe("HOSTING_PROVIDER (footer hosting credit)", () => {
  async function reimport() {
    vi.resetModules();
    return import("@/lib/config/client-constants");
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("ships vulnradar.dev's own host", async () => {
    const fresh = await reimport();
    expect(fresh.HOSTING_PROVIDER).toEqual({
      name: "WSLATL",
      url: "https://wslatl.com",
    });
  });

  it("lets a deployment name its own host", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOSTING_PROVIDER_NAME", "  Example Host ");
    vi.stubEnv("NEXT_PUBLIC_HOSTING_PROVIDER_URL", "https://host.example.test");
    const fresh = await reimport();
    expect(fresh.HOSTING_PROVIDER).toEqual({
      name: "Example Host",
      url: "https://host.example.test",
    });
  });

  it("drops the credit when the URL is not absolute https", async () => {
    for (const bad of [
      "wslatl.com",
      "http://wslatl.com",
      "javascript:alert(1)",
      "//wslatl.com",
    ]) {
      vi.stubEnv("NEXT_PUBLIC_HOSTING_PROVIDER_URL", bad);
      const fresh = await reimport();
      expect(fresh.HOSTING_PROVIDER, bad).toBeNull();
      vi.unstubAllEnvs();
    }
  });

  it("drops the credit when the name is only whitespace", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOSTING_PROVIDER_NAME", "   ");
    const fresh = await reimport();
    expect(fresh.HOSTING_PROVIDER).toBeNull();
  });
});

/**
 * The seven routes the web app used to request by a hand-written path. Each
 * now has an entry in the API map, and each entry has to be the path the call
 * site used, name a route that is on disk, and be a route that answers the
 * method the caller sends. The path is spelled out here once, on purpose: this
 * is the table that has to change when a route moves, and a test that derived
 * it from the map would pass whatever the map said.
 */
describe("API entries for routes that were spelled out at the call site", () => {
  const ENTRIES: Array<
    [name: string, url: string, path: string, methods: string[]]
  > = [
    [
      "AUTH.TWO_FA.EMAIL_SEND",
      API.AUTH.TWO_FA.EMAIL_SEND,
      "/api/v3/auth/2fa/email-send",
      ["POST"],
    ],
    [
      "BILLING_VERIFY_SEND",
      API.BILLING_VERIFY_SEND,
      "/api/v3/billing/verify/send",
      ["POST"],
    ],
    ["BILLING_VERIFY", API.BILLING_VERIFY, "/api/v3/billing/verify", ["POST"]],
    [
      "NOTIFICATIONS_ACTIVE",
      API.NOTIFICATIONS_ACTIVE,
      "/api/v3/notifications/active",
      ["GET"],
    ],
    [
      "CHECKOUT_VERIFY_SUBSCRIPTION",
      API.CHECKOUT_VERIFY_SUBSCRIPTION,
      "/api/v3/checkout/verify-subscription",
      ["GET"],
    ],
    ["CONFIG_CLIENT", API.CONFIG_CLIENT, "/api/v3/config/client", ["GET"]],
    [
      "ACCOUNT_UNSUBSCRIBE",
      API.ACCOUNT_UNSUBSCRIBE,
      "/api/v3/account/unsubscribe",
      ["GET", "POST"],
    ],
  ];

  it.each(ENTRIES)(
    "API.%s is the path the call site used",
    (_n, url, expected) => {
      expect(url).toBe(expected);
    },
  );

  it.each(ENTRIES)(
    "API.%s names a route file that exports the methods callers send",
    (_n, url, _expected, methods) => {
      const file = path.resolve(__dirname, "../../..", `app${url}/route.ts`);
      expect(fs.existsSync(file), file).toBe(true);
      const source = fs.readFileSync(file, "utf8");
      for (const method of methods) {
        expect(source).toMatch(
          new RegExp(
            String.raw`export\s+(?:async\s+function|const)\s+${method}\b`,
          ),
        );
      }
    },
  );

  it("takes the unsubscribe link from FROZEN, because it is printed into mail", () => {
    expect(API.ACCOUNT_UNSUBSCRIBE).toBe(FROZEN.UNSUBSCRIBE);
  });
});

/**
 * Helpers that put an id, a token or a hostname into a request path. Several
 * of those values reach the client from a URL the visitor followed
 * (/host/[hostname], /history?scan=, /staff-invite/[token], /admin/scans/[id]),
 * and the browser resolves dot segments before it sends the request, so an
 * unencoded "../keys/5/revoke?" turned a GET for one scan into a same-origin,
 * cookie-bearing request to another API route.
 */
describe("API helpers keep the value inside its own path segment", () => {
  const FORGED = "../keys/5/revoke?";
  const HELPERS: Array<[name: string, build: (id: string) => string]> = [
    ["AUTH.OAUTH_START", (v) => API.AUTH.OAUTH_START(v)],
    ["AUTH.STAFF_INVITE", (v) => API.AUTH.STAFF_INVITE(v)],
    ["AUTH.SESSION_REVOKE", (v) => API.AUTH.SESSION_REVOKE(v)],
    ["AUTH.TRUSTED_DEVICE_REVOKE", (v) => API.AUTH.TRUSTED_DEVICE_REVOKE(v)],
    ["HISTORY_ITEM", (v) => API.HISTORY_ITEM(v)],
    ["HISTORY_SHARE", (v) => API.HISTORY_SHARE(v)],
    [
      "HISTORY_SHARE_PUBLICLY_LISTED",
      (v) => API.HISTORY_SHARE_PUBLICLY_LISTED(v),
    ],
    ["HISTORY_SUMMARY", (v) => API.HISTORY_SUMMARY(v)],
    ["HISTORY_DELETE", (v) => API.HISTORY_DELETE(v)],
    ["HISTORY_REPORT", (v) => API.HISTORY_REPORT(v, "pdf")],
    ["SCAN_STATUS", (v) => API.SCAN_STATUS(v)],
    ["SCAN_SCREENSHOT", (v) => API.SCAN_SCREENSHOT(v)],
    ["SCAN_REFRESH_DNS", (v) => API.SCAN_REFRESH_DNS(v)],
    ["SCAN_REFRESH_PORTS", (v) => API.SCAN_REFRESH_PORTS(v)],
    ["SCAN_REFRESH_SCREENSHOT", (v) => API.SCAN_REFRESH_SCREENSHOT(v)],
    ["SCAN_DISCOVER_PROGRESS", (v) => API.SCAN_DISCOVER_PROGRESS(v)],
    ["DOMAIN_SCANS", (v) => API.DOMAIN_SCANS(v)],
    ["DOMAIN_BLOCK", (v) => API.DOMAIN_BLOCK(v)],
    ["SUPPORT_TICKET", (v) => API.SUPPORT_TICKET(v)],
    ["SUPPORT_TICKET_SHARES", (v) => API.SUPPORT_TICKET_SHARES(v)],
    ["ADMIN_SCAN", (v) => API.ADMIN_SCAN(v)],
    ["ACCOUNT_OAUTH_DISCONNECT", (v) => API.ACCOUNT_OAUTH_DISCONNECT(v)],
    ["HOST", (v) => API.HOST(v)],
    ["HOST_TREND", (v) => API.HOST_TREND(v)],
  ];

  /** What the browser would actually request for a helper's output. */
  function resolved(url: string) {
    const u = new URL(url, "https://app.example");
    return u.pathname + u.search + u.hash;
  }

  /**
   * The resolved request still has the helper's own prefix and suffix, and
   * whatever the value became sits between them as one segment: no slash to
   * open another, no question mark or hash to end the path early.
   */
  function expectOneSegment(build: (v: string) => string, value: string) {
    const [prefix, rest] = build("ID").split("ID");
    const actual = resolved(build(value));
    expect(actual.startsWith(prefix), actual).toBe(true);
    expect(actual.endsWith(rest), actual).toBe(true);
    const middle = actual.slice(prefix.length, actual.length - rest.length);
    expect(middle, actual).toMatch(/^[^/?#]+$/);
  }

  it("covers every API entry that takes an argument", () => {
    const named = new Set(HELPERS.map(([name]) => name));
    const missing: string[] = [];
    const walk = (node: Record<string, unknown>, at: string) => {
      for (const [key, value] of Object.entries(node)) {
        const name = at ? `${at}.${key}` : key;
        if (typeof value === "function") {
          if (!named.has(name)) missing.push(name);
        } else if (value && typeof value === "object") {
          walk(value as Record<string, unknown>, name);
        }
      }
    };
    walk(API as unknown as Record<string, unknown>, "");
    expect(missing).toEqual([]);
  });

  it.each(HELPERS)("%s leaves an ordinary id as it was", (_n, build) => {
    const url = build("0123456789abcdef0123456789abcdef");
    expect(url).toContain("/0123456789abcdef0123456789abcdef");
    expect(resolved(url)).toBe(url);
    expect(build("42")).toContain("/42");
  });

  it.each(HELPERS)(
    "%s cannot be walked out of its route by the id",
    (_n, build) => {
      expectOneSegment(build, FORGED);
      expect(resolved(build(FORGED))).not.toContain("/keys/");
    },
  );

  it.each(HELPERS)("%s encodes a slash", (_n, build) => {
    expectOneSegment(build, "a/b");
    expect(build("a/b")).toContain("a%2Fb");
  });

  it.each(HELPERS)("%s encodes a question mark", (_n, build) => {
    expectOneSegment(build, "a?b=1");
  });

  it.each(HELPERS)("%s encodes a hash", (_n, build) => {
    expectOneSegment(build, "a#b");
  });

  // "%2e" and "%2e%2e" are dot segments as well (WHATWG URL), so escaping the
  // dots once would still let ".." climb. The test resolves the path the way
  // the browser does rather than checking for one particular spelling.
  it.each(HELPERS)("%s does not let a dot-only value climb", (_n, build) => {
    for (const dots of [".", "..", "...", "...."]) {
      expectOneSegment(build, dots);
    }
  });

  it("names one scan's history route", () => {
    expect(API.HISTORY_ITEM("abc")).toBe(`${API.HISTORY}/abc`);
    expect(API.HISTORY_ITEM(7)).toBe(`${API.HISTORY}/7`);
  });

  it("builds a report URL only for the formats the report route serves", () => {
    expect(API.HISTORY_REPORT(7, "sarif")).toBe(
      `${API.HISTORY}/7/report?format=sarif`,
    );
    // @ts-expect-error a format the route does not serve
    API.HISTORY_REPORT(7, "html");
  });
});

/**
 * Each per-scan sub-route is its own entry rather than text appended to
 * HISTORY_ITEM. The scan itself and its share, listing, summary and delete
 * routes do not stay under one prefix once the API moves, and a suffix tacked
 * onto HISTORY_ITEM would then point at a route that does not exist.
 */
describe("per-scan history entries", () => {
  const ENTRIES: Array<
    [name: string, build: (id: string) => string, sub: string, method: string]
  > = [
    ["HISTORY_SHARE", (id) => API.HISTORY_SHARE(id), "/share", "POST"],
    [
      "HISTORY_SHARE_PUBLICLY_LISTED",
      (id) => API.HISTORY_SHARE_PUBLICLY_LISTED(id),
      "/share/publicly-listed",
      "PUT",
    ],
    ["HISTORY_SUMMARY", (id) => API.HISTORY_SUMMARY(id), "/summary", "POST"],
    ["HISTORY_DELETE", (id) => API.HISTORY_DELETE(id), "/delete", "DELETE"],
  ];

  it.each(ENTRIES)("API.%s is the route the UI calls", (_n, build, sub) => {
    expect(build("7")).toBe(`/api/v3/history/7${sub}`);
  });

  it.each(ENTRIES)(
    "API.%s names a route file that answers the method the UI sends",
    (_n, _build, sub, method) => {
      const file = path.resolve(
        __dirname,
        "../../..",
        `app/api/v3/history/[id]${sub}/route.ts`,
      );
      expect(fs.existsSync(file), file).toBe(true);
      expect(fs.readFileSync(file, "utf8")).toMatch(
        new RegExp(String.raw`export\s+async\s+function\s+${method}\b`),
      );
    },
  );

  it("keeps one name for the public-listing toggle", () => {
    expect("SHARE_PUBLICLY_LISTED" in API).toBe(false);
  });
});
