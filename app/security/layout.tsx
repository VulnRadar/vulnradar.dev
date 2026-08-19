import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import { BreadcrumbStructuredData } from "@/components/seo/structured-data";

const TITLE = "Security & Responsible Disclosure";
const DESCRIPTION =
  "How to report a security vulnerability, what is in and out of scope, our safe-harbor terms, and the response times you can expect.";

export const metadata: Metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/security",
  keywords: [
    "responsible disclosure",
    "report a vulnerability",
    "security contact",
    "vulnerability disclosure policy",
    "safe harbor",
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
        items={[{ name: "Security", path: "/security" }]}
        nonce={nonce}
      />
      {children}
    </>
  );
}
