import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/seo/metadata";

// noindex: tokenised URL, unlisted by design. Indexing it would defeat the
// point of the token, and the page renders on a per-token basis so there is
// no single canonical to publish.
export const metadata: Metadata = privatePageMetadata(
  "Shared Scan Report",
  "/shared",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
