import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Contact: Bugs, False Positives, and Support",
  description:
    "Get in touch with the VulnRadar team about bugs, false positives, feature requests, security disclosures, or enterprise and self-hosted deployments.",
  path: "/contact",
  keywords: ["contact support", "report false positive", "security disclosure"],
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
