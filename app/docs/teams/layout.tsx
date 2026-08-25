import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

const description =
  "How VulnRadar teams work: create a team, invite members by email, assign one of the six roles, and share scan reports across the whole team.";

export const metadata: Metadata = pageMetadata({
  title: "Team Roles, Invitations, and Shared Scans",
  description,
  path: "/docs/teams",
  keywords: [
    "team collaboration security",
    "team roles and permissions",
    "invite team members",
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
          { name: "Teams", path: "/docs/teams" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={"Teams"}
        description={description}
        path="/docs/teams"
        nonce={nonce}
      />
      {children}
    </>
  );
}
