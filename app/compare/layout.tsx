import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Compare Scans",
  description:
    "Diff two scans of the same site to see which findings are new, which were fixed, and which persist. Useful for verifying a deploy closed what you expected.",
  path: "/compare",
  keywords: [
    "compare security scans",
    "vulnerability regression testing",
    "security scan diff",
  ],
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
