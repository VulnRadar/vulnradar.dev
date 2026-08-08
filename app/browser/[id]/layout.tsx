import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/seo/metadata";

// noindex: tokenised URL, unlisted by design. Indexing it would defeat the
// point of the token.
export const metadata: Metadata = privatePageMetadata(
  "Live Browser Session",
  "/browser",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
