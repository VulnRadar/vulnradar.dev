import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description:
    "Free tier with 25 scans a day, no card required. Paid plans raise the daily limit and extend how long results are kept. Same detection engine on every plan.",
  path: "/pricing",
  keywords: [
    "vulnerability scanner pricing",
    "free security scanner",
    "web security scanner cost",
  ],
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
