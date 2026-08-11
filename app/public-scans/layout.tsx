import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Public Scans",
  description:
    "Browse security scans other people chose to share publicly: the URL, verdict, who ran it, and its findings, most recent first.",
  path: "/public-scans",
  keywords: [
    "public security scans",
    "shared vulnerability reports",
    "website security directory",
  ],
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
