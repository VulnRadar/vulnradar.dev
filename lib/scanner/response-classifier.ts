import { detectBotChallenge } from "./bot-challenge";

/**
 * What came back when the scanner asked a site for its page.
 *
 * Checks that read a response assume it is the site's page. Hosts that refuse
 * the scanner with a load balancer's 403 or a proof-of-work 503 were graded on
 * that instead: 13 findings for 118 bytes of "403 Forbidden", none about the
 * site, which is why a re-check that reached the real page marked them false.
 *
 * A block page served with HTTP 200 and an unremarkable title cannot be told
 * apart from a page here, and is graded as one.
 */
export type PageVerdict =
  | { kind: "page" }
  | { kind: "challenge"; reason: string }
  | { kind: "blocked"; reason: string }
  | { kind: "error"; status: number };

/** The site, or something in front of it, declined to serve this request. */
const REFUSAL_STATUSES = new Set([401, 403, 407, 429, 451]);

export function classifyPageResponse(
  status: number,
  headers: Headers,
  body: string,
): PageVerdict {
  const challenge = detectBotChallenge(status, headers, body);
  if (challenge) return { kind: "challenge", reason: challenge };
  if (REFUSAL_STATUSES.has(status)) {
    return { kind: "blocked", reason: `HTTP ${status} refused the scanner` };
  }
  if (status >= 300) return { kind: "error", status };
  return { kind: "page" };
}

/**
 * Why this response must not be graded as the site's page, or null when it may
 * be.
 *
 * 404 and 410 stay gradable even though they classify as errors: a removed
 * page is still something the site served, an API root legitimately answers
 * 404 JSON, and some checks exist to read error output. Other 4xx statuses are
 * graded for the same reason unless they are a refusal.
 */
export function detectUnusablePage(
  status: number,
  headers: Headers,
  body: string,
): string | null {
  const verdict = classifyPageResponse(status, headers, body);
  if (verdict.kind === "page") return null;
  if (verdict.kind !== "error") return verdict.reason;
  if (verdict.status >= 500) return `HTTP ${verdict.status} server error`;
  // safeFetch follows redirects itself, so a 3xx that reaches a caller is the
  // hop cap, a missing or refused Location, or a 304: no page in any of them.
  if (verdict.status < 400) {
    return `HTTP ${verdict.status} redirect not followed to a page`;
  }
  return null;
}
