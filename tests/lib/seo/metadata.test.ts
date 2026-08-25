import { describe, it, expect } from "vitest";
import { pageMetadata, privatePageMetadata } from "@/lib/seo/metadata";
import {
  APP_NAME,
  APP_URL,
  APP_DESCRIPTION,
  SEO_OG_IMAGE,
  SEO_OG_IMAGE_WIDTH,
  SEO_OG_IMAGE_HEIGHT,
  SEO_TWITTER_HANDLE,
  SEO_LOCALE,
} from "@/lib/config/constants";

/**
 * pageMetadata() is pure (no DB/network), so this exercises the real
 * function against the real config constants rather than mocking anything.
 */

// Metadata['openGraph'] and ['twitter'] are unions of per-content-type
// shapes (OpenGraphWebsite | OpenGraphArticle | ... | OpenGraphMetadata),
// so `type`/`card` aren't on every union member and plain property access
// doesn't typecheck. pageMetadata() always sets these fields, so a narrow
// read-only view is enough for assertions here.
type OpenGraphLike = { type?: string; locale?: string; siteName?: string };
type TwitterLike = { card?: string };

describe("pageMetadata", () => {
  it("builds the canonical URL from APP_URL + path", () => {
    const meta = pageMetadata({
      title: "Pricing",
      description: "Plans and pricing.",
      path: "/pricing",
    });
    expect(meta.alternates?.canonical).toBe(`${APP_URL}/pricing`);
  });

  it("keeps title as a plain string for a normal (non-section-root) page", () => {
    const meta = pageMetadata({
      title: "Pricing",
      description: "Plans and pricing.",
      path: "/pricing",
    });
    expect(meta.title).toBe("Pricing");
  });

  it("emits the object title form for a section root, so children keep the site-name template", () => {
    // Real bug class this session: a plain string `title` consumes the root
    // "%s | <app>" template and children render bare with no site name.
    // isSectionRoot must produce the { default, template } object form.
    const meta = pageMetadata({
      title: "Docs",
      description: "Documentation.",
      path: "/docs",
      isSectionRoot: true,
    });
    expect(meta.title).toEqual({
      default: "Docs",
      template: `%s | ${APP_NAME}`,
    });
  });

  it("does not emit the object title form when isSectionRoot is not set", () => {
    const meta = pageMetadata({
      title: "Docs",
      description: "Documentation.",
      path: "/docs",
    });
    expect(meta.title).toBe("Docs");
    expect(meta.title).not.toEqual(
      expect.objectContaining({ default: "Docs" }),
    );
  });

  it("appends the site name to the OpenGraph and Twitter titles regardless of isSectionRoot", () => {
    const meta = pageMetadata({
      title: "Docs",
      description: "Documentation.",
      path: "/docs",
      isSectionRoot: true,
    });
    expect(meta.openGraph?.title).toBe(`Docs | ${APP_NAME}`);
    expect(meta.twitter?.title).toBe(`Docs | ${APP_NAME}`);
  });

  it("defaults to a fully indexable robots policy", () => {
    const meta = pageMetadata({ title: "Home", description: "d", path: "/" });
    expect(meta.robots).toEqual({
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    });
  });

  it("sets a noindex/nofollow/nocache robots policy when noIndex is true", () => {
    const meta = pageMetadata({
      title: "Account",
      description: "d",
      path: "/account",
      noIndex: true,
    });
    expect(meta.robots).toEqual({
      index: false,
      follow: false,
      nocache: true,
    });
  });

  it("omits the keywords field when none are given", () => {
    const meta = pageMetadata({ title: "Home", description: "d", path: "/" });
    expect(meta.keywords).toBeUndefined();
  });

  it("omits the keywords field when given an empty array", () => {
    const meta = pageMetadata({
      title: "Home",
      description: "d",
      path: "/",
      keywords: [],
    });
    expect(meta.keywords).toBeUndefined();
  });

  it("includes keywords when given", () => {
    const meta = pageMetadata({
      title: "Home",
      description: "d",
      path: "/",
      keywords: ["scanner", "security"],
    });
    expect(meta.keywords).toEqual(["scanner", "security"]);
  });

  it("uses the configured OG image and dimensions by default", () => {
    const meta = pageMetadata({ title: "Home", description: "d", path: "/" });
    expect(meta.openGraph?.images).toEqual([
      {
        url: SEO_OG_IMAGE,
        width: SEO_OG_IMAGE_WIDTH,
        height: SEO_OG_IMAGE_HEIGHT,
        alt: `Home | ${APP_NAME}`,
        type: "image/png",
      },
    ]);
    expect(meta.twitter?.images).toEqual([SEO_OG_IMAGE]);
  });

  it("uses a custom image override when given", () => {
    const meta = pageMetadata({
      title: "Home",
      description: "d",
      path: "/",
      image: "/custom.png",
    });
    expect(meta.openGraph?.images).toEqual([
      {
        url: "/custom.png",
        width: SEO_OG_IMAGE_WIDTH,
        height: SEO_OG_IMAGE_HEIGHT,
        alt: `Home | ${APP_NAME}`,
        type: "image/png",
      },
    ]);
    expect(meta.twitter?.images).toEqual(["/custom.png"]);
  });

  it("includes publishedTime in openGraph only when given", () => {
    const withDate = pageMetadata({
      title: "Post",
      description: "d",
      path: "/blog/post",
      type: "article",
      publishedTime: "2026-01-01T00:00:00Z",
    });
    expect(withDate.openGraph).toMatchObject({
      publishedTime: "2026-01-01T00:00:00Z",
    });

    const withoutDate = pageMetadata({
      title: "Home",
      description: "d",
      path: "/",
    });
    expect(withoutDate.openGraph).not.toHaveProperty("publishedTime");
  });

  it("sets the openGraph type and locale", () => {
    const meta = pageMetadata({
      title: "Post",
      description: "d",
      path: "/blog/post",
      type: "article",
    });
    const openGraph = meta.openGraph as OpenGraphLike | null | undefined;
    expect(openGraph?.type).toBe("article");
    expect(openGraph?.locale).toBe(SEO_LOCALE);
    expect(openGraph?.siteName).toBe(APP_NAME);
  });

  it("defaults the openGraph type to website", () => {
    const meta = pageMetadata({ title: "Home", description: "d", path: "/" });
    const openGraph = meta.openGraph as OpenGraphLike | null | undefined;
    expect(openGraph?.type).toBe("website");
  });

  it("omits twitter.site when SEO_TWITTER_HANDLE is unconfigured, and includes it otherwise", () => {
    const meta = pageMetadata({ title: "Home", description: "d", path: "/" });
    if (SEO_TWITTER_HANDLE) {
      expect(meta.twitter?.site).toBe(SEO_TWITTER_HANDLE);
    } else {
      expect(meta.twitter).not.toHaveProperty("site");
    }
  });

  it("always uses the summary_large_image twitter card", () => {
    const meta = pageMetadata({ title: "Home", description: "d", path: "/" });
    const twitter = meta.twitter as TwitterLike | null | undefined;
    expect(twitter?.card).toBe("summary_large_image");
  });
});

describe("privatePageMetadata", () => {
  it("marks the page noindex/nofollow/nocache", () => {
    const meta = privatePageMetadata("Dashboard", "/dashboard");
    expect(meta.robots).toEqual({
      index: false,
      follow: false,
      nocache: true,
    });
  });

  it("uses the app-wide description and the given path's canonical URL", () => {
    const meta = privatePageMetadata("Dashboard", "/dashboard");
    expect(meta.description).toBe(APP_DESCRIPTION);
    expect(meta.alternates?.canonical).toBe(`${APP_URL}/dashboard`);
  });

  it("does not set isSectionRoot: title stays a plain string", () => {
    const meta = privatePageMetadata("Dashboard", "/dashboard");
    expect(meta.title).toBe("Dashboard");
  });
});
