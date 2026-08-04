import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/seo/metadata";

// noindex: this page requires a session, so a crawled copy is just the login
// redirect. Keeping it out of the index also saves crawl budget for the
// public pages that can actually rank.
export const metadata: Metadata = privatePageMetadata("Teams", "/teams");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
