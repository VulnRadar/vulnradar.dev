import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/seo/metadata";

// noindex: this page requires a session and a live checkout intent, so a
// crawled copy is just the login redirect.
export const metadata: Metadata = privatePageMetadata("Checkout", "/checkout");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
