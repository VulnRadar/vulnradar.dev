import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import { BreadcrumbStructuredData } from "@/components/seo/structured-data";

const TITLE = "Terms of Service";
const DESCRIPTION =
  "The terms that govern using the scanner: authorized use only, account responsibilities, API limits, data retention, and liability.";

export const metadata: Metadata = pageMetadata({
  title: "Terms of Service: Authorized Use and Limits",
  description: DESCRIPTION,
  path: "/legal/terms",
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
          { name: "Legal", path: "/legal" },
          { name: TITLE, path: "/legal/terms" },
        ]}
        nonce={nonce}
      />
      {children}
    </>
  );
}
