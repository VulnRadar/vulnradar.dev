import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import { BreadcrumbStructuredData } from "@/components/seo/structured-data";

const TITLE = "Accessibility Statement";
const DESCRIPTION =
  "Conformance target, accessibility features, known limitations, and how to report a barrier.";

export const metadata: Metadata = pageMetadata({
  title: TITLE,
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
