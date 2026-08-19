import type { Vulnerability } from "@/lib/scanner/types";

/**
 * A finding counts as AI-reviewed once it carries a verdict (see
 * lib/ai/verify-findings.ts's applyVerdicts): "confirmed", "possible_fp",
 * or "uncertain". There is no separate reviewed/unreviewed column anywhere,
 * on the scan or the finding: presence of aiVerdict is the only signal.
 */
export function hasUnreviewedFindings(findings: Vulnerability[]): boolean {
  return findings.some((f) => !f.aiVerdict);
}

export interface AiReviewGateInput {
  /** Undefined/null for a scan that has not been saved to history yet: verify
   *  has nothing to attach verdicts to. The opaque public_id (a string) or a
   *  numeric id -- only its truthiness is read here. */
  scanId?: string | number | null;
  /** True only when the server has a configured AI endpoint and this account has not turned AI off. */
  aiAvailable: boolean;
  findings: Vulnerability[];
}

/**
 * Whether to offer the "Verify with AI" action for this scan. Read this
 * fresh on every render (not memoized/cached): once verification finishes,
 * the caller updates `findings` in place with the new verdicts, and this
 * function naturally goes false, which is what hides the action again.
 */
export function canOfferAiReview({
  scanId,
  aiAvailable,
  findings,
}: AiReviewGateInput): boolean {
  return Boolean(scanId) && aiAvailable && hasUnreviewedFindings(findings);
}
