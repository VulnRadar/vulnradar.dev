import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/seo/metadata";

// noindex: this page requires a session, so a crawled copy is just the login
// redirect. Same reasoning as app/attack-surface/layout.tsx, which is where
// this page is reached from.
//
// Deliberately NOT added to DISALLOWED_PATHS in lib/seo/routes.ts: the rule at
// the bottom of that list is that auth-gated app routes are not listed, and a
// per-domain URL is not enumerable anyway.
export const metadata: Metadata = privatePageMetadata("Domain", "/domains");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
