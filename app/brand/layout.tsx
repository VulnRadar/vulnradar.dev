import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import { BreadcrumbStructuredData } from "@/components/seo/structured-data";
import { ROUTES } from "@/lib/config/client-constants";

// No counts in here, unlike the page: scripts/knowledge/compile-features-
// knowledge.mjs reads this string for the assistant's feature inventory and
// drops a description whose ${} it cannot resolve.
const DESCRIPTION =
  "Download the VulnRadar logo as transparent PNGs, the lockup cut for common banner slots, avatars, SVG sources and one ZIP, with the clear space, colour, type and voice rules. No sign-in.";

export const metadata: Metadata = pageMetadata({
  title: "Brand kit",
  description: DESCRIPTION,
  path: ROUTES.BRAND,
  keywords: [
    "VulnRadar logo",
    "VulnRadar brand kit",
    "press kit",
    "logo download",
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
          { name: "Home", path: "/" },
          { name: "Brand kit", path: ROUTES.BRAND },
        ]}
        nonce={nonce}
      />
      {children}
    </>
  );
}
