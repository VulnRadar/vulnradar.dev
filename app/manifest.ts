import type { MetadataRoute } from "next";
import {
  APP_NAME,
  APP_DESCRIPTION,
  BRANDING_PRIMARY_COLOR,
  BRANDING_BACKGROUND_DARK,
  SEO_TAGLINE,
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
    // "/" rather than ROUTES.DASHBOARD. The dashboard is auth-gated, so
    // installing the app and launching it while signed out opened straight
    // onto a login redirect. Root does the right thing for both cases
    // already: middleware sends a signed-out visitor to /landing and leaves
    // a signed-in one on the dashboard.
    start_url: "/",
    // Without an explicit id, the browser derives the app's identity from
    // start_url, so changing start_url (as above) would have registered a
    // second, unrelated app for anyone who had already installed this one.
    // Pinned so the identity is stable from here on.
    id: "/",
    display: "standalone",
    background_color: BRANDING_BACKGROUND_DARK,
    theme_color: BRANDING_PRIMARY_COLOR,
    categories: ["developer", "security", "utilities"],
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
      // public/favicon.png really is 1024x1024 (checked in the file's IHDR).
      // It was declared 512x512 here, and a size that does not match the
      // image is worse than none: a browser picking an icon by declared size
      // then rescales from the wrong assumption.
      { src: "/favicon.png", sizes: "1024x1024", type: "image/png" },
    ],
  };
}
