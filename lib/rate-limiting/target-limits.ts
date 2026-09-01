/**
 * Per-TARGET scan volume limit.
 *
 * Every other limiter in this codebase is keyed on the caller: `${userId}` or
 * `${ip}`, plus two per-account email buckets. Nothing was keyed on the
 * victim, so total inbound volume to one third-party site was bounded only by
 * how many accounts a requester was willing to create, and each account's cap
 * applied independently. One single-URL scan sends roughly 40 to 60 requests
 * to the target (checkExposedFiles alone is ~23), and a crawl multiplies that
 * by the page count, so a handful of free accounts converging on one domain is
 * real traffic from VulnRadar's IP, which the operator then absorbs the abuse
 * reports and the blocklisting for. ref: AUDIT-012#abuse-05
 *
 * This bucket is shared across ALL accounts and keyed on the registrable
 * domain, not the hostname: `a.example.com` and `b.example.com` are the same
 * victim, and per-hostname keying would be trivially defeated by pointing at
 * subdomains.
 */

import { checkRateLimit } from "./rate-limit";
import { extractRootDomain } from "@/lib/scanner/root-domain";

/**
 * Scans of one registrable domain per hour, across every account.
 *
 * Sized off the largest legitimate single submission rather than off typical
 * use: the Elite tier sells a 100-URL bulk batch, and those 100 URLs are very
 * often 100 paths on one domain, so anything at or under 100 would reject a
 * feature the account paid for. 120/hour leaves room for that batch plus
 * ordinary rescans and still bounds a coordinated flood to roughly two scans a
 * minute at one victim.
 *
 * Deliberately a constant rather than an admin setting: making it editable
 * needs a registry entry and two keys in lib/config/registry.ts, which is
 * outside this change. The number is the one thing an operator would want to
 * tune, so that is the follow-up.
 */
const TARGET_SCANS_PER_HOUR = 120;
const TARGET_WINDOW_SECONDS = 60 * 60;

export interface TargetScanLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  /** The registrable domain the bucket was keyed on, for the error message. */
  rootDomain: string;
}

/**
 * Count one scan against its target's bucket and report whether it may
 * proceed.
 *
 * Counts BEFORE the answer is known to the caller (the shared limiter is an
 * atomic increment-and-read), which is what makes it race-safe across the
 * concurrent requests this exists to bound. A caller that decides to let a
 * rejected scan through anyway (a verified domain owner: see the scan routes)
 * therefore still contributes to the count, which is the intended reading --
 * an owner hammering their own site is still traffic at that site, and the
 * exemption is about not blocking THEM, not about making their scans free.
 *
 * Fails OPEN on an unparseable URL: URL validity is the SSRF guard's job and
 * it runs on the same request, so a malformed target is refused there with a
 * useful message rather than here with a rate-limit one.
 */
export async function checkTargetScanLimit(
  url: string,
): Promise<TargetScanLimitResult> {
  let rootDomain: string;
  try {
    rootDomain = extractRootDomain(new URL(url).hostname).toLowerCase();
  } catch {
    return { allowed: true, retryAfterSeconds: 0, rootDomain: "" };
  }
  if (!rootDomain) {
    return { allowed: true, retryAfterSeconds: 0, rootDomain: "" };
  }

  const result = await checkRateLimit({
    key: `scantarget:${rootDomain}`,
    maxAttempts: TARGET_SCANS_PER_HOUR,
    windowSeconds: TARGET_WINDOW_SECONDS,
  });

  return {
    allowed: result.allowed,
    retryAfterSeconds: result.retryAfterSeconds,
    rootDomain,
  };
}

/** The message a rejected caller sees. Shared so every entry point agrees. */
export function targetScanLimitMessage(rootDomain: string): string {
  return `This target has been scanned too many times in the last hour. ${rootDomain} is temporarily rate limited to protect it from scan volume. Verify ownership of the domain in Profile > Domains to scan it without this limit, or try again later.`;
}
