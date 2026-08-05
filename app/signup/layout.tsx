import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Create Account",
  description:
    "Create a free VulnRadar account. 25 scans a day, full API access, and scan history retained for 30 days. No card required.",
  path: "/signup",
  keywords: ["free security scanner account", "sign up vulnerability scanner"],
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
