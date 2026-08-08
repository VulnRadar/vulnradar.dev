import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Webhooks",
  description:
    "Receive scan results over HTTP. Covers event types, payload schema, signature verification, retry behaviour, and failure handling.",
  path: "/docs/webhooks",
  keywords: ["security scan webhooks", "vulnerability webhook integration"],
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
          { name: "Webhooks", path: "/docs/webhooks" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={"Webhooks"}
        description={
          "Receive scan results over HTTP. Covers event types, payload schema, signature verification, retry behaviour, and failure handling."
        }
        path="/docs/webhooks"
        nonce={nonce}
      />
      {children}
    </>
  );
}
