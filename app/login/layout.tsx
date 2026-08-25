import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";
import { APP_NAME } from "@/lib/config/constants";

export const metadata: Metadata = pageMetadata({
  title: "Sign In to History, API Keys, and Scans",
  description: `Sign in to ${APP_NAME} to view scan history, manage API keys, schedule recurring scans, and share reports with your team.`,
  path: "/login",
  // Clean /login stays indexable and in the sitemap. Only its ?redirect=<path>
  // query variants (produced when a protected page bounces an anonymous visitor
  // here) caused the "duplicate without user-selected canonical" reports; those
  // are handled two ways without hiding /login itself: this page's canonical
  // already points at the clean /login, and robots.ts disallows /*?redirect= so
  // the variants are never crawled in the first place.
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
