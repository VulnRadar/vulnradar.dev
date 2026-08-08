import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";
import { APP_NAME } from "@/lib/config/constants";

export const metadata: Metadata = pageMetadata({
  title: "Sign In",
  description: `Sign in to ${APP_NAME} to view scan history, manage API keys, schedule recurring scans, and share reports with your team.`,
  path: "/login",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
