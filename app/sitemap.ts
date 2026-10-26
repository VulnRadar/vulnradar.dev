import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/config/constants";
import { PUBLIC_ROUTES } from "@/lib/seo/routes";

// Served at /sitemap.xml. Referenced from robots.txt so crawlers find it
// without the URL having to be submitted by hand.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  // A route with no source date gets no lastmod at all. The hand-listed
  // marketing, docs and legal pages (49 of them) used to fall back to the
  // build time, so every deploy told crawlers they had all changed that
  // second whether or not anything on them had. Google and Bing both stop
  // trusting lastmod on a site whose dates do not match reality, and that
  // would have cost the check pages their real per-category dates too.
  return PUBLIC_ROUTES.map((route) => ({
    url: `${APP_URL}${route.path}`,
    ...(route.lastModified
      ? { lastModified: new Date(route.lastModified) }
      : {}),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
