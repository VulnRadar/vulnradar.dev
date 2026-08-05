import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Contact",
  description:
    "Get in touch about bugs, false positives, feature requests, security disclosures, or enterprise deployments.",
  path: "/contact",
  keywords: ["contact support", "report false positive", "security disclosure"],
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
