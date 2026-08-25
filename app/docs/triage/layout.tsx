import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

const description =
  "Track each finding from open to fixed with assignees and due dates that survive rescans, and open a tracked support ticket with staff on any plan.";

export const metadata: Metadata = pageMetadata({
  title: "Finding Remediation and Support Ticket Tracking",
  description,
  path: "/docs/triage",
  keywords: [
    "remediation tracking",
    "vulnerability triage workflow",
    "support tickets",
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
          { name: "Triage & Remediation", path: "/docs/triage" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={"Triage & Remediation"}
        description={description}
        path="/docs/triage"
        nonce={nonce}
      />
      {children}
    </>
  );
}
