import type { Metadata } from "next";
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
 * Trim a string to `max` characters on a word boundary, adding an ellipsis when
 * it had to cut. Used to keep generated meta descriptions and titles inside the
 * length search engines display (descriptions ~155, titles budgeted per page)
 * without cutting mid-word. The full text still renders on the page itself.
 */
export function clampText(text: string, max = 155): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
}

interface PageSeoOptions {
  title: string;
  description: string;
  /** Path with a leading slash, used for the canonical URL. */
  path: string;
  keywords?: string[];
  /** Set for authenticated or tokenised pages that must stay out of search. */
  noIndex?: boolean;
  /** Overrides the configured social card. */
  image?: string;
  type?: "website" | "article";
  publishedTime?: string;
  /**
   * Set on a section layout that has child routes, for example /docs.
   *
   * A layout that sets `title` as a plain string consumes the root template
   * and passes none to its children, so nested pages render a bare title with
   * no site name. Passing this emits the object form, which keeps the suffix
   * on both this page and everything beneath it.
   */
  isSectionRoot?: boolean;
}

/**
 * Builds page metadata with the pieces that are easy to forget: a canonical
 * URL, an OpenGraph card, and a Twitter card. Without a canonical, the same
 * page reachable at more than one URL competes with itself in search results.
 *
 * Everything brand-specific comes from lib/config, so a self-hosted
 * deployment rebrands by editing config-values.ts rather than page files.
 */
export function pageMetadata({
  title,
  description,
  path,
  keywords,
  noIndex = false,
  image = SEO_OG_IMAGE,
  type = "website",
  publishedTime,
  isSectionRoot = false,
}: PageSeoOptions): Metadata {
  const url = `${APP_URL}${path}`;
  // The root layout applies a "%s | <app>" template, so `title` here is the
  // page part only. Social cards do not inherit that template, so they get
  // the full string.
  const fullTitle = `${title} | ${APP_NAME}`;

  return {
    // `default` is still passed through the root template, so it stays the
    // bare page title. `template` is what child routes inherit.
    title: isSectionRoot
      ? { default: title, template: `%s | ${APP_NAME}` }
      : title,
    description,
    ...(keywords?.length ? { keywords } : {}),
    alternates: { canonical: url },
    robots: noIndex
      ? { index: false, follow: false, nocache: true }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
            "max-video-preview": -1,
          },
        },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: APP_NAME,
      type,
      locale: SEO_LOCALE,
      images: [
        {
          url: image,
          width: SEO_OG_IMAGE_WIDTH,
          height: SEO_OG_IMAGE_HEIGHT,
          alt: fullTitle,
          type: "image/png",
        },
      ],
      ...(publishedTime ? { publishedTime } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      // Omit the handle rather than emitting an empty tag when unconfigured.
      ...(SEO_TWITTER_HANDLE ? { site: SEO_TWITTER_HANDLE } : {}),
      images: [image],
    },
  };
}

/**
 * Metadata for authenticated pages. They render a redirect for anyone not
 * signed in, so an indexed copy would be a thin duplicate of the login page.
 */
export function privatePageMetadata(title: string, path: string): Metadata {
  return pageMetadata({
    title,
    description: APP_DESCRIPTION,
    path,
    noIndex: true,
  });
}
