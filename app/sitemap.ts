import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/config/constants";
import { PUBLIC_ROUTES } from "@/lib/seo/routes";

// Served at /sitemap.xml. Referenced from robots.txt so crawlers find it
// without the URL having to be submitted by hand.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  // Fallback only, for the routes with no derivable source date (the
  // hand-listed marketing and legal pages). Every route that CAN say when its
  // source last changed does: this used to be the value for all ~820 URLs,
  // which, on a force-static route rebuilt on every deploy, told crawlers the
  // entire site changed at the same instant several times a week. Google
  // ignores lastmod site-wide when it is not consistently accurate, so the
  // field was costing the sitemap its one freshness signal.
  const buildTime = new Date();

  return PUBLIC_ROUTES.map((route) => ({
    url: `${APP_URL}${route.path}`,
    lastModified: route.lastModified ? new Date(route.lastModified) : buildTime,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
