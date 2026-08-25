import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import { BreadcrumbStructuredData } from "@/components/seo/structured-data";

const TITLE = "DMCA & Copyright Policy";
const DESCRIPTION =
  "How to file a copyright infringement notice or a counter-notification, and the designated agent to send it to.";

export const metadata: Metadata = pageMetadata({
  title: "DMCA & Copyright: How to File a Notice",
  description: DESCRIPTION,
  path: "/legal/dmca",
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
          { name: TITLE, path: "/legal/dmca" },
        ]}
        nonce={nonce}
      />
      {children}
    </>
  );
}
