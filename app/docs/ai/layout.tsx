import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";
import { APP_NAME } from "@/lib/config/constants";

// Hoisted because the metadata and the JSON-LD both need it and they had
// drifted apart once already.
const DESCRIPTION = `How ${APP_NAME}'s AI works: the Vera assistant, AI finding verification, scan summaries, auto-tags, bring-your-own-key providers, and token budgets.`;

export const metadata: Metadata = pageMetadata({
  title: "AI Assistant, Scan Verification, and Budgets",
  description: DESCRIPTION,
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
          { name: "Home", path: "/landing" },
          { name: "Docs", path: "/docs" },
          { name: "AI Features", path: "/docs/ai" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={"AI Features"}
        description={DESCRIPTION}
        path="/docs/ai"
        nonce={nonce}
      />
      {children}
    </>
  );
}
