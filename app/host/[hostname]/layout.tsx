import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/seo/metadata";

// noindex: a per-host page for every hostname anyone has ever scanned isn't
// enumerable ahead of time (no fixed list to publish a canonical for), same
// reasoning as app/shared/[token]/layout.tsx. It's still a real, linkable
// URL -- just not one search engines should crawl on their own.
export const metadata: Metadata = privatePageMetadata("Host Report", "/host");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
