import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/config/constants";
import { PUBLIC_ROUTES } from "@/lib/seo/routes";

// Served at /sitemap.xml. Referenced from robots.txt so crawlers find it
// without the URL having to be submitted by hand.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  // One timestamp for the whole generation. Using a per-entry `new Date()`
  // would claim every page changed at a slightly different moment on every
  // build, which is noise rather than signal.
  const lastModified = new Date();

  return PUBLIC_ROUTES.map((route) => ({
    url: `${APP_URL}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
