import { ImageResponse } from "next/og";
import { APP_NAME } from "@/lib/config/constants";
import { OgCard, OG_SIZE, OG_CONTENT_TYPE, severityRow } from "@/app/_og/card";
import { OG_LIVE_DATA_HEADERS } from "@/app/_og/cache";
import { getHostSummary, decodeHostParam } from "./host-summary";

export const alt = `Host security report on ${APP_NAME}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ hostname: string }>;
}) {
  const { hostname } = await params;
  const summary = await getHostSummary(hostname);
  // Bounded cache, not next/og's default year of `immutable`: see
  // OG_LIVE_DATA_HEADERS. The row behind this card is deleted the moment the
  // scan that sourced it is made private, and the card has to follow.
  const options = { ...size, headers: OG_LIVE_DATA_HEADERS };

  if (!summary) {
    return new ImageResponse(
      <OgCard
        eyebrow="Host report"
        headline={decodeHostParam(hostname)}
        subline="No public scan on record for this host yet."
      />,
      options,
    );
  }

  const scanned = summary.lastScannedAt
    ? summary.lastScannedAt.toISOString().slice(0, 10)
    : null;

  return new ImageResponse(
    <OgCard
      eyebrow="Host report"
      headline={summary.host}
      subline={`${
        summary.dangerScore === null
          ? "Risk score not yet rated"
          : `Risk score ${summary.dangerScore} of 10`
      }${scanned ? `, last scanned ${scanned}` : ""}`}
      severities={severityRow(summary)}
    />,
    options,
  );
}
