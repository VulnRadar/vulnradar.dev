import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Public Scans: Shared Reports Directory",
  description:
    "Browse security scans other people chose to share publicly: the URL, verdict, who ran it, and its findings, most recent first.",
  path: "/public-scans",
  // A list of other people's scan results, and every report it links to is
  // noindex. Its rows also load in the browser, so the HTML a crawler gets is
  // a skeleton. Out of the index and the sitemap, like the reports.
  noIndex: true,
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
