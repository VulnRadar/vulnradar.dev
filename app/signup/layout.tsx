import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";
import { APP_NAME } from "@/lib/config/constants";

export const metadata: Metadata = pageMetadata({
  title: "Create a Free Scanner Account, No Card",
  description: `Create a free ${APP_NAME} account. 25 scans a day, full API access, and scan history kept for as long as your account is open. No card required.`,
  path: "/signup",
  keywords: ["free security scanner account", "sign up vulnerability scanner"],
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
