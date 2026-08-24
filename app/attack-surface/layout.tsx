import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/seo/metadata";

// noindex: this page requires a session, so a crawled copy is just the login
// redirect. Same reasoning as app/assets/layout.tsx.
export const metadata: Metadata = privatePageMetadata(
  "Attack Surface",
  "/attack-surface",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
