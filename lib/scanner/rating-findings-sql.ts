import type { Vulnerability } from "./types";

/** The part of a finding that getSafetyRating and getDangerScore read. */
export type RatingFinding = Pick<
  Vulnerability,
  "title" | "severity" | "aiVerdict" | "aiConfidence"
>;

/**
 * A scan's `findings` column cut down to the fields a safety rating needs.
 *
 * A stored finding also carries its description, explanation, fix steps and
 * code examples, which makes the column tens of KB per scan. A list that only
 * wants one verdict per row should not ship all of that to Node and parse it.
 *
 * Refers to the bare column `findings`, so it works against scan_history and
 * host_reputation alike, in a query where only one table in scope has that
 * column. tests/lib/scanner/rating-findings-sql.test.ts fails if the rating
 * code starts reading a field this leaves out.
 */
export const RATING_FINDINGS_SQL = `(SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'title', e->>'title',
    'severity', e->>'severity',
    'aiVerdict', e->'aiVerdict',
    'aiConfidence', e->'aiConfidence')), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(findings, '[]'::jsonb)) e)`;
