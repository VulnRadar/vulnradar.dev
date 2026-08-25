import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import { BreadcrumbStructuredData } from "@/components/seo/structured-data";

const TITLE = "Disclaimer";
const DESCRIPTION =
  "Scan results are informational, not a warranty or a penetration test. What the scanner does and does not guarantee, and where legal responsibility sits.";

export const metadata: Metadata = pageMetadata({
  title: "Disclaimer: Scan Results Are Informational",
  description: DESCRIPTION,
  path: "/legal/disclaimer",
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
          { name: TITLE, path: "/legal/disclaimer" },
        ]}
        nonce={nonce}
      />
      {children}
    </>
  );
}
