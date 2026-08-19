import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/config/constants";
import { DISALLOWED_PATHS } from "@/lib/seo/routes";

// Served at /robots.txt.
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...DISALLOWED_PATHS],
      },
      {
        // GPTBot and friends read the docs to answer questions about the
        // product, which is useful to us. They are still kept out of the
        // authenticated and tokenised surfaces.
        userAgent: [
          "GPTBot",
          "ClaudeBot",
          "PerplexityBot",
          "Applebot-Extended",
        ],
        allow: [
          "/landing",
          "/docs",
          "/pricing",
          "/changelog",
          "/compare",
          "/checks",
          "/alternatives",
          "/tools",
        ],
        disallow: [...DISALLOWED_PATHS],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
    host: APP_URL,
  };
}
