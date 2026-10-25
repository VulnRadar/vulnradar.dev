import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/seo/metadata";

// noindex, like the rest of /admin: this page needs a staff session, so a
// crawled copy is only the login redirect.
export const metadata: Metadata = privatePageMetadata(
  "Scan inspector",
  "/admin/scans",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
