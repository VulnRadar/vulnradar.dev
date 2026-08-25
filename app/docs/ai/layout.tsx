import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "AI Assistant, Scan Verification, and Budgets",
  description:
    "How VulnRadar's AI works: the Vera assistant, AI finding verification, scan summaries, auto-tags, bring-your-own-key providers, and token budgets.",
  path: "/docs/ai",
  keywords: [
    "AI vulnerability assistant",
    "AI finding verification",
    "bring your own AI key",
  ],
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
          { name: "AI Features", path: "/docs/ai" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={"AI Features"}
        description={
          "How VulnRadar's AI works: the Vera assistant, AI finding verification, scan summaries, auto-tags, bring-your-own-key providers, and token budgets."
        }
        path="/docs/ai"
        nonce={nonce}
      />
      {children}
    </>
  );
}
