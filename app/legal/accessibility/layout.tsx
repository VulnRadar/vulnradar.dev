import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import { BreadcrumbStructuredData } from "@/components/seo/structured-data";

const TITLE = "Accessibility Statement";
const DESCRIPTION =
  "VulnRadar's accessibility conformance target, the features that support it, known limitations we are still working on, and how to report a barrier.";

export const metadata: Metadata = pageMetadata({
  title: "Accessibility Statement and Conformance",
  description: DESCRIPTION,
  path: "/legal/accessibility",
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
          { name: TITLE, path: "/legal/accessibility" },
        ]}
        nonce={nonce}
      />
      {children}
    </>
  );
}
