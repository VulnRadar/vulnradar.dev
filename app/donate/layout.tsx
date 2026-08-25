import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";
import { APP_NAME } from "@/lib/config/constants";

export const metadata: Metadata = pageMetadata({
  title: "Donate: Fund Open-Source Scanner Development",
  description: `${APP_NAME} is GPL-3.0 and free to self-host. Donations fund scanner development, detection research, and hosting for the public instance.`,
  path: "/donate",
  keywords: ["support open source security", "donate open source"],
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
