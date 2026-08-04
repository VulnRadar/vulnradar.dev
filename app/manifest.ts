import type { MetadataRoute } from "next";
import {
  APP_NAME,
  APP_DESCRIPTION,
  BRANDING_PRIMARY_COLOR,
  BRANDING_BACKGROUND_DARK,
  SEO_TAGLINE,
  ROUTES,
} from "@/lib/config/constants";

// Served at /manifest.webmanifest. Lets the scanner be installed as a PWA and
// gives Android and Chrome proper install metadata instead of guessing from
// the page title.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} - ${SEO_TAGLINE}`,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: ROUTES.DASHBOARD,
    display: "standalone",
    background_color: BRANDING_BACKGROUND_DARK,
    theme_color: BRANDING_PRIMARY_COLOR,
    categories: ["developer", "security", "utilities"],
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/favicon.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
