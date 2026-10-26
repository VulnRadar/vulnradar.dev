import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";
import { APP_NAME } from "@/lib/config/constants";

export const metadata: Metadata = pageMetadata({
  title: "Sign In to History, API Keys, and Scans",
  description: `Sign in to ${APP_NAME} to view scan history, manage API keys, schedule recurring scans, and share reports with your team.`,
  path: "/login",
  // Clean /login stays indexable and in the sitemap. Its ?redirect=<path>
  // variants (a protected page bouncing an anonymous visitor here) canonicalise
  // to the clean /login, and middleware.ts sends them with X-Robots-Tag:
  // noindex. They used to be Disallowed in robots.txt instead, which only made
  // Search Console list them as "Blocked by robots.txt".
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
