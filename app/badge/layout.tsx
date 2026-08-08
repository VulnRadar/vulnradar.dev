import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/seo/metadata";

// noindex: this page requires a session, so a crawled copy is just the login
// redirect. /badge is already in DISALLOWED_PATHS in lib/seo/routes.ts.
export const metadata: Metadata = privatePageMetadata(
  "Security Badge",
  "/badge",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
