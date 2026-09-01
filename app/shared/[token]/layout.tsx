import type { Metadata } from "next";
import {
  pageMetadata,
  privatePageMetadata,
  clampText,
} from "@/lib/seo/metadata";
import { APP_NAME } from "@/lib/config/constants";
import { getShareSummary } from "./share-summary";

/**
 * Every share link used to unfurl identically: title "Shared Scan Report",
 * the site-wide app description, and the static marketing card showing a mock
 * scan of "your-domain.com". Pasting a real report into Slack said nothing
 * about which host had been scanned or what was found, on the flow that is the
 * product's main organic distribution.
 *
 * noindex stays on regardless: the URL is tokenised and unlisted by design.
 * A card is not an index entry, and the recipient already holds the token.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const summary = await getShareSummary(token);

  // A token that misses, has expired or has been revoked falls back to the
  // generic strings, so an invalid link reveals nothing, not even whether it
  // was ever valid.
  if (!summary) return privatePageMetadata("Shared Scan Report", "/shared");

  const scanned = summary.scannedAt
    ? summary.scannedAt.toISOString().slice(0, 10)
    : null;
  const counts = [
    summary.critical ? `${summary.critical} critical` : null,
    summary.high ? `${summary.high} high` : null,
    summary.medium ? `${summary.medium} medium` : null,
  ].filter(Boolean);

  const description = counts.length
    ? `${counts.join(", ")} findings on ${summary.hostname}${
        scanned ? `, scanned ${scanned}` : ""
      } by ${APP_NAME}. Open the full report.`
    : `No critical, high or medium findings on ${summary.hostname}${
        scanned ? `, scanned ${scanned}` : ""
      } by ${APP_NAME}. Open the full report.`;

  return pageMetadata({
    title: `Security scan of ${summary.hostname}`,
    description: clampText(description),
    // Canonical stays on the tokenised path rather than the old "/shared",
    // which has no route at all (there is no app/shared/page.tsx).
    path: `/shared/${token}`,
    noIndex: true,
    image: `/shared/${token}/opengraph-image`,
  });
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
