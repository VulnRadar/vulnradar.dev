import type { Metadata } from "next";
import {
  pageMetadata,
  privatePageMetadata,
  clampText,
} from "@/lib/seo/metadata";
import { APP_NAME } from "@/lib/config/constants";
import { getHostSummary, decodeHostParam } from "./host-summary";

/**
 * noindex: a per-host page for every hostname anyone has ever scanned isn't
 * enumerable ahead of time (no fixed list to publish a canonical for), same
 * reasoning as app/shared/[token]/layout.tsx. It's still a real, linkable
 * URL, just not one search engines should crawl on their own, and a link
 * someone pastes should describe the host it is about rather than unfurling
 * as the site-wide marketing card with a title of "Host Report".
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ hostname: string }>;
}): Promise<Metadata> {
  const { hostname } = await params;
  const summary = await getHostSummary(hostname);

  if (!summary) {
    return privatePageMetadata("Host Report", `/host/${hostname}`);
  }

  const counts = [
    summary.critical ? `${summary.critical} critical` : null,
    summary.high ? `${summary.high} high` : null,
    summary.medium ? `${summary.medium} medium` : null,
  ].filter(Boolean);

  const score =
    summary.dangerScore === null
      ? ""
      : ` Risk score ${summary.dangerScore} of 10.`;

  return pageMetadata({
    title: `Security report for ${summary.host}`,
    description: clampText(
      `${
        counts.length
          ? `${counts.join(", ")} findings`
          : "No critical, high or medium findings"
      } on ${summary.host}, from the latest public ${APP_NAME} scan.${score}`,
    ),
    path: `/host/${decodeHostParam(hostname)}`,
    noIndex: true,
    image: `/host/${hostname}/opengraph-image`,
  });
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
