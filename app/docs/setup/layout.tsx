import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Setup Guide",
  description:
    "Install and configure VulnRadar: prerequisites, environment variables, database migration, and first run.",
  path: "/docs/setup",
  keywords: ["vulnerability scanner setup", "security scanner installation"],
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbStructuredData
        items={[
          { name: "Docs", path: "/docs" },
          { name: "Setup Guide", path: "/docs/setup" },
        ]}
      />
      <TechArticleStructuredData
        title={"Setup Guide"}
        description={
          "Install and configure VulnRadar: prerequisites, environment variables, database migration, and first run."
        }
        path="/docs/setup"
      />
      {children}
    </>
  );
}
