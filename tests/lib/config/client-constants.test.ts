import { describe, it, expect, afterEach, vi } from "vitest";
import {
  STAFF_ROLES,
  STAFF_ROLE_HIERARCHY,
  STAFF_ROLE_LABELS,
  ROLE_BADGE_STYLES,
  SOCIAL_LINKS,
  SOCIAL_PLATFORM_IDS,
  SOCIAL_PROFILE_URLS,
  type SocialPlatformId,
} from "@/lib/config/client-constants";
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
