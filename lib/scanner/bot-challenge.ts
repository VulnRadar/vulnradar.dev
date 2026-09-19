/**
 * A site that answers the scanner with a bot challenge instead of its page.
 *
 * Behind Cloudflare's bot protection (and similar services) an automated
 * request gets a "Just a moment..." interstitial with a 403, and every check
 * that reads the response was grading that interstitial as the site. A scan
 * of such a site reported Cloudflare's missing Vary header and Cloudflare's
 * Server-Timing as the site's own findings, which an AI re-check that got
 * through to the real page then marked as false positives. None of it was
 * about the site.
 *
 * The response is only treated as a challenge on a signal that means exactly
 * that: Cloudflare's `cf-mitigated: challenge` header, or a blocking status
 * together with a challenge page's title or bootstrap. Cloudflare injects
 * /cdn-cgi/challenge-platform/ scripts into ordinary pages it serves, so that
 * path alone is not a challenge and is deliberately not a marker here.
 */

/** The area a challenged scan lists as not checked (lib/scanner/incomplete-labels.ts). */
export const BOT_CHALLENGE_INCOMPLETE = "bot-challenge";

/** Titles challenge interstitials are served with. Shared with the login flow. */
export const CHALLENGE_TITLE_MARKERS: readonly RegExp[] = [
  /just a moment/i,
  /attention required.*cloudflare/i,
  /checking your browser/i,
  /verifying you are human/i,
  /one more step/i,
  /please wait.*redirecting/i,
];

/** Markup only a Cloudflare challenge page's bootstrap contains. */
const CHALLENGE_BOOTSTRAP =
  /cf_chl_opt|window\._cf_chl|cf-browser-verification/i;

const BLOCKING_STATUSES = new Set([403, 429, 503]);

/**
 * The signal that identified a bot challenge, or null when the response looks
 * like the site's own page.
 */
export function detectBotChallenge(
  status: number,
  headers: Headers,
  body: string,
): string | null {
  const mitigated = headers.get("cf-mitigated");
  if (mitigated && /challenge/i.test(mitigated)) {
    return "cf-mitigated: challenge";
  }
  if (!BLOCKING_STATUSES.has(status)) return null;

  const head = body.slice(0, 32_768);
  const title = /<title[^>]*>([^<]{0,200})<\/title>/i.exec(head)?.[1] ?? "";
  const titleMarker = CHALLENGE_TITLE_MARKERS.find((re) => re.test(title));
  if (titleMarker) return `HTTP ${status} with a challenge page title`;
  if (CHALLENGE_BOOTSTRAP.test(head)) {
    return `HTTP ${status} with a challenge page script`;
  }
  return null;
}
