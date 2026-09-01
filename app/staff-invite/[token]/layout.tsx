import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/seo/metadata";

// noindex, same reasoning as app/teams/join/layout.tsx: reached only from a
// tokenised invite email, and the token is in the path here, so it must never
// be crawled or canonicalised to a real URL. The canonical names the bare
// route rather than this invite's own path for the same reason.
export const metadata: Metadata = privatePageMetadata(
  "Accept a Staff Invite",
  "/staff-invite",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
