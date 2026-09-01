import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";
import { APP_NAME } from "@/lib/config/constants";

const TITLE = "API Playground";
const DESCRIPTION = `Send real requests to the ${APP_NAME} REST API from your browser and copy the same call as ready-to-run code in cURL, JavaScript, Python, Go, PHP, Java, Ruby, or C#.`;

export const metadata: Metadata = pageMetadata({
  title: "API Playground: Try Requests in the Browser",
  description: `Send real requests to the ${APP_NAME} REST API from your browser and copy each call as ready-to-run code: cURL, JavaScript, Python, Go, PHP, and more.`,
  path: "/docs/api/playground",
  keywords: [
    "api playground",
    "api explorer",
    "vulnradar api",
    "rest api code samples",
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
          { name: "API Reference", path: "/docs/api" },
          { name: "API Playground", path: "/docs/api/playground" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={TITLE}
        description={DESCRIPTION}
        path="/docs/api/playground"
        nonce={nonce}
      />
      {children}
    </>
  );
}
