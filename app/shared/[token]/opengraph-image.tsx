import { ImageResponse } from "next/og";
import { APP_NAME } from "@/lib/config/constants";
import { OgCard, OG_SIZE, OG_CONTENT_TYPE, severityRow } from "@/app/_og/card";
import { getShareSummary } from "./share-summary";

export const alt = `Shared security scan report on ${APP_NAME}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// The share link is the product's main organic distribution: someone pastes it
// into Slack or a ticket and everyone who sees it gets the unfurl. It used to
// be the static marketing card for a fictional domain, so a real report
// previewed exactly like the homepage.
export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const summary = await getShareSummary(token);

  if (!summary) {
    // Revoked, expired, or never valid: say nothing about which.
    return new ImageResponse(
      <OgCard
        eyebrow="Shared scan report"
        headline="This report link is"
        accentTail="no longer available"
        subline="The link has expired or been revoked by whoever shared it."
      />,
      size,
    );
  }

  const scanned = summary.scannedAt
    ? summary.scannedAt.toISOString().slice(0, 10)
    : null;

  return new ImageResponse(
    <OgCard
      eyebrow="Shared scan report"
      headline={summary.hostname}
      subline={`${summary.total} findings${scanned ? `, scanned ${scanned}` : ""}`}
      severities={severityRow(summary)}
    />,
    size,
  );
}
