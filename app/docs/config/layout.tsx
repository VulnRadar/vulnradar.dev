import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

// One string for the meta description and the JSON-LD article, so the two
// cannot drift. It says what the page holds: the Settings tables are generated
// from the registry and list every admin setting, but the environment
// variables and CONFIG_* constants are the ones an operator is likely to
// change, not every one that exists.
const DESCRIPTION =
  "How configuration resolves, every admin setting with its tier and default, and the environment variables for secrets, OAuth, SMTP and backups.";

export const metadata: Metadata = pageMetadata({
  title: "Configuration Reference: Settings and Env Vars",
  description: DESCRIPTION,
  path: "/docs/config",
  keywords: ["scanner configuration", "environment variables reference"],
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
          { name: "Home", path: "/" },
          { name: "Docs", path: "/docs" },
          { name: "Configuration Reference", path: "/docs/config" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title="Configuration Reference"
        description={DESCRIPTION}
        path="/docs/config"
        nonce={nonce}
      />
      {children}
    </>
  );
}
