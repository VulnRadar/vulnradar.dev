import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import { BreadcrumbStructuredData } from "@/components/seo/structured-data";
import { ROUTES } from "@/lib/config/client-constants";
import { LOCKUP_SLOTS, LOGO_SIZES } from "@/lib/brand/kit";

const DESCRIPTION = `The VulnRadar logo as transparent PNGs at ${LOGO_SIZES.length} sizes, the lockup cut to ${LOCKUP_SLOTS.length} banner slots, avatars, SVG sources and one ZIP, with the clear space, colours, type and voice rules. No sign-in.`;

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
