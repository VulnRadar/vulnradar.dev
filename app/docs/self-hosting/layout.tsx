import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Self-Hosting Guide",
  description:
    "Run your own VulnRadar instance under GPL-3.0. Covers deployment, database setup, SMTP, environment configuration, and upgrades.",
  path: "/docs/self-hosting",
  keywords: [
    "self-hosted vulnerability scanner",
    "self-host security scanner",
    "open source scanner hosting",
  ],
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbStructuredData
        items={[
          { name: "Docs", path: "/docs" },
          { name: "Self-Hosting Guide", path: "/docs/self-hosting" },
        ]}
      />
      <TechArticleStructuredData
        title={"Self-Hosting Guide"}
        description={
          "Run your own VulnRadar instance under GPL-3.0. Covers deployment, database setup, SMTP, environment configuration, and upgrades."
        }
        path="/docs/self-hosting"
      />
      {children}
    </>
  );
}
