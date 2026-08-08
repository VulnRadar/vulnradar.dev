import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/seo/metadata";

// noindex: this page is reached from a tokenised invite email. Without its
// own layout it inherited the /teams canonical, which pointed the invite at
// the wrong URL. /teams is already in DISALLOWED_PATHS, so this route is
// covered by robots.txt too.
export const metadata: Metadata = privatePageMetadata(
  "Join a Team",
  "/teams/join",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
