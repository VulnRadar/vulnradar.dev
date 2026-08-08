import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Architecture",
  description:
    "How the scanner is built: request pipeline, parallel check execution, password hashing, session handling, and the data model behind scans and findings.",
  path: "/docs/architecture",
  keywords: ["security scanner architecture", "vulnerability scanner design"],
});

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <>
      <BreadcrumbStructuredData
        items={[
          { name: "Docs", path: "/docs" },
          { name: "Architecture", path: "/docs/architecture" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={"Architecture"}
        description={
          "How the scanner is built: request pipeline, parallel check execution, password hashing, session handling, and the data model behind scans and findings."
        }
        path="/docs/architecture"
        nonce={nonce}
      />
      {children}
    </>
  );
}
