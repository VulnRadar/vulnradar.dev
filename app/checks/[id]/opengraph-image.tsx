import { ImageResponse } from "next/og";
import { APP_NAME } from "@/lib/config/constants";
import { BRAND } from "@/lib/config/brand";
import { OgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/app/_og/card";
import { getCheckById, getCategoryLabel } from "@/lib/seo/checks-content";

export const alt = `Security check reference on ${APP_NAME}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// The ~749 check pages are the main organic surface and every one of them used
// to unfurl with the same marketing card, so nothing in a search or social
// preview distinguished "Missing HSTS" from "Exposed .git directory".
export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const check = getCheckById(id);

  if (!check) {
    return new ImageResponse(
      <OgCard
        eyebrow="Security check"
        headline="That check"
        accentTail="does not exist"
      />,
      size,
    );
  }

  const severityColor =
    BRAND.severity[check.severity as keyof typeof BRAND.severity] ??
    BRAND.severity.info;

  return new ImageResponse(
    <OgCard
      eyebrow="How to fix"
      headline={check.title}
      subline={check.description}
      chips={[
        { label: check.severity.toUpperCase(), color: severityColor },
        { label: getCategoryLabel(check.category) },
      ]}
    />,
    size,
  );
}
