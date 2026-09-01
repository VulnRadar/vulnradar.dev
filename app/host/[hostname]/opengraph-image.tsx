import { ImageResponse } from "next/og";
import { APP_NAME } from "@/lib/config/constants";
import { OgCard, OG_SIZE, OG_CONTENT_TYPE, severityRow } from "@/app/_og/card";
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

  if (!summary) {
    return new ImageResponse(
      <OgCard
        eyebrow="Host report"
        headline={decodeHostParam(hostname)}
        subline="No public scan on record for this host yet."
      />,
      size,
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
    size,
  );
}
