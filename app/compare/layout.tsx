import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/seo/metadata";

// Auth-gated tool: comparing your own scans requires signing in, so the page
// redirects anon visitors to /login. Marked noindex (and dropped from the
// sitemap + disallowed in robots via lib/seo/routes.ts) so search engines
// don't index a thin login-redirect duplicate.
export const metadata: Metadata = privatePageMetadata(
  "Compare Scans",
  "/compare",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
