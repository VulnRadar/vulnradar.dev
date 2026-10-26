import pool from "@/lib/database/db";
import {
  ALL_CATEGORIES,
  type Category,
  type Severity,
} from "@/lib/scanner/types";

/**
 * The read side of "promote an AI tag": which AI-suggested tags keep recurring,
 * with an example scan or two and a starting point for the rule's fields.
 * Admin > Engine Feedback > AI Tag Candidates renders it, and
 * app/api/v3/admin/engine-feedback/ai-tag-candidates/route.ts serves it.
 *
 * This used to be the route's own GET: one query for the candidate tags with
 * no LIMIT, then two more per tag, all started at once. Twenty candidates was
 * forty queries queued on a ten-connection pool, and every one of the 20
 * findings queries pulled up to 50 whole findings arrays into Node only to
 * count three fields on them. Now it is three queries however many candidates
 * there are, and the counting happens in Postgres.
 */

/**
 * Minimum distinct scans an AI tag must have appeared on before it surfaces
 * here at all -- a plain constant rather than a SETTINGS_REGISTRY entry:
 * unlike ENGINE_FEEDBACK_MIN_SAMPLE_SIZE/ENGINE_FEEDBACK_NOISE_THRESHOLD_PERCENT
 * on the sibling Check Accuracy / Auto-Tag Dismissals panels (which flag an
 * EXISTING row as noisy), this threshold controls whether a candidate is even
 * listed, a different enough concept that reusing those settings would be a
 * stretch. 3 is a reasonable, if arbitrary, floor for "not a one-off" and a
 * product-owner call to revisit if it turns out too strict or too loose.
 */
export const MIN_CANDIDATE_SCANS = 3;

/**
 * How many candidates the panel lists. AI tags are free text, so the set of
 * distinct tags only grows; the busiest ones are the ones worth promoting, and
 * a promoted tag drops out of the list, so the next one moves up.
 */
export const MAX_CANDIDATES = 25;

/** Example scan links shown per candidate, so an admin can sanity-check what triggered it without opening a database console. */
export const MAX_EXAMPLES = 3;

/**
 * How many recent scans' findings are counted per candidate to derive the
 * suggested CWE/category/severity fields. A recent sample answers "what does
 * this tag usually mean" as well as the whole history does, at a fixed cost.
 */
export const MAX_FINDINGS_SAMPLE = 50;

/** Severities a rule's minimum may take. The promote route validates against the same list. */
export const RULE_SEVERITIES: readonly Severity[] = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
];

/** Suggestions offered per field: the promote form pre-fills two CWEs and two categories. */
const SUGGESTED_PER_FIELD = 2;

interface CandidateCountRow {
  tag: string;
  scan_count: number;
  user_count: number;
}

interface ExampleScanRow {
  tag: string;
  scan_id: number;
  url: string;
  scanned_at: Date | string | null;
}

interface FacetRow {
  tag: string;
  facet: "cwe" | "category" | "severity";
  val: string;
}

export interface AiTagCandidateExample {
  scanId: number;
  url: string;
  scannedAt: string | null;
}

export interface AiTagCandidateSuggestion {
  cwes: string[];
  categories: Category[];
  minSeverity: Severity;
}

export interface AiTagCandidate {
  tag: string;
  /** Distinct scans this AI tag has appeared on. */
  scanCount: number;
  /** Distinct users whose scans produced this AI tag. */
  userCount: number;
  examples: AiTagCandidateExample[];
  suggested: AiTagCandidateSuggestion;
}

/**
 * Tags that cleared the floor, busiest first, minus the ones already promoted.
 *
 * The NOT EXISTS is what keeps a promoted tag from sitting in this list for
 * ever: the old scans still carry their `source = 'ai'` row, so without it the
 * tag a rule was just written for kept looking like a candidate. It checks
 * source_ai_tag as well as tag, so a rule saved under a different name than
 * the AI's still retires the suggestion it came from. Deleting the rule makes
 * the tag a candidate again, which is the way to redo a rule that was promoted
 * with the wrong fields.
 */
const CANDIDATES_SQL = `
  SELECT st.tag,
         COUNT(DISTINCT st.scan_id)::int AS scan_count,
         COUNT(DISTINCT st.user_id)::int AS user_count
    FROM scan_tags st
   WHERE st.source = 'ai'
   GROUP BY st.tag
  HAVING COUNT(DISTINCT st.scan_id) >= $1
     AND NOT EXISTS (
       SELECT 1
         FROM promoted_auto_tag_rules p
        WHERE p.tag = st.tag OR p.source_ai_tag = st.tag
     )
   ORDER BY COUNT(DISTINCT st.scan_id) DESC, st.tag ASC
   LIMIT $2
`;

/**
 * The newest `$2` AI-tagged scans of every candidate, windowed in one pass.
 * Ranked on scan_tags alone and joined to scan_history afterwards, so the
 * large findings column is only touched for scans that made the cut.
 */
const EXAMPLES_SQL = `
  SELECT r.tag, r.scan_id, sh.url, sh.scanned_at
    FROM (
      SELECT ranked.tag, ranked.scan_id, ranked.pos
        FROM (
          SELECT st.tag, st.scan_id,
                 ROW_NUMBER() OVER (PARTITION BY st.tag ORDER BY st.id DESC) AS pos
            FROM scan_tags st
           WHERE st.source = 'ai' AND st.tag = ANY($1::text[])
        ) ranked
       WHERE ranked.pos <= $2::int
    ) r
    JOIN scan_history sh ON sh.id = r.scan_id
   ORDER BY r.tag, r.pos
`;

/**
 * The most common CWEs, categories and severity across the findings of each
 * candidate's newest `$2` scans, counted where the data lives.
 *
 * jsonb_array_elements unnests each scan's findings array and the VALUES list
 * fans every finding out into its three fields, so Postgres does the counting
 * that Node used to do over up to 50 shipped arrays per tag. Only the top rows
 * per tag and field come back.
 *
 * Values are checked against the same sets the promote route accepts (a CWE id
 * pattern, the category list, the severity list), so a suggestion is never
 * something the form would then refuse. A findings value that is not an array
 * counts as empty rather than raising, because one malformed row must not
 * take the whole panel down.
 */
const FACETS_SQL = `
  WITH recent AS (
    SELECT ranked.tag, ranked.scan_id
      FROM (
        SELECT st.tag, st.scan_id,
               ROW_NUMBER() OVER (PARTITION BY st.tag ORDER BY st.id DESC) AS pos
          FROM scan_tags st
         WHERE st.source = 'ai' AND st.tag = ANY($1::text[])
      ) ranked
     WHERE ranked.pos <= $2::int
  ),
  seen AS (
    SELECT r.tag, f.facet, f.val
      FROM recent r
      JOIN scan_history sh ON sh.id = r.scan_id
     CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(sh.findings) = 'array'
                  THEN sh.findings ELSE '[]'::jsonb END
           ) AS finding(elem)
     CROSS JOIN LATERAL (VALUES
             ('cwe', finding.elem ->> 'cwe'),
             ('category', finding.elem ->> 'category'),
             ('severity', finding.elem ->> 'severity')
           ) AS f(facet, val)
     WHERE (f.facet = 'cwe' AND f.val ~ '^CWE-[0-9]+$')
        OR (f.facet = 'category' AND f.val = ANY($3::text[]))
        OR (f.facet = 'severity' AND f.val = ANY($4::text[]))
  ),
  counted AS (
    SELECT tag, facet, val,
           ROW_NUMBER() OVER (
             PARTITION BY tag, facet ORDER BY COUNT(*) DESC, val ASC
           ) AS pos
      FROM seen
     GROUP BY tag, facet, val
  )
  SELECT tag, facet, val
    FROM counted
   WHERE pos <= ${SUGGESTED_PER_FIELD}
   ORDER BY tag, facet, pos
`;

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * A starting point for the rule's fields, not a verdict: the AI step that
 * produced the tag (lib/ai/auto-tag-suggest.ts) never recorded which findings
 * it was reacting to, so the most common CWEs, categories and severity across
 * the scans that carry the tag are the best available proxy. The admin reviews
 * and edits every field before saving. `rows` arrive best-first.
 */
function suggestionFor(rows: FacetRow[]): AiTagCandidateSuggestion {
  const values = (facet: FacetRow["facet"]) =>
    rows.filter((r) => r.facet === facet).map((r) => r.val);
  return {
    cwes: values("cwe"),
    categories: values("category") as Category[],
    minSeverity: (values("severity")[0] as Severity | undefined) ?? "medium",
  };
}

function groupByTag<T extends { tag: string }>(rows: T[]): Map<string, T[]> {
  const byTag = new Map<string, T[]>();
  for (const row of rows) {
    const list = byTag.get(row.tag);
    if (list) list.push(row);
    else byTag.set(row.tag, [row]);
  }
  return byTag;
}

/**
 * Three queries however many candidates there are: the candidate list, then
 * the examples and the finding counts for all of them together (those two do
 * not depend on each other, so they overlap, which holds two connections at
 * most).
 */
export async function loadAiTagCandidates(): Promise<AiTagCandidate[]> {
  const counts = await pool.query<CandidateCountRow>(CANDIDATES_SQL, [
    MIN_CANDIDATE_SCANS,
    MAX_CANDIDATES,
  ]);
  if (counts.rows.length === 0) return [];

  const tags = counts.rows.map((r) => r.tag);
  const [examples, facets] = await Promise.all([
    pool.query<ExampleScanRow>(EXAMPLES_SQL, [tags, MAX_EXAMPLES]),
    pool.query<FacetRow>(FACETS_SQL, [
      tags,
      MAX_FINDINGS_SAMPLE,
      ALL_CATEGORIES,
      RULE_SEVERITIES,
    ]),
  ]);

  const examplesByTag = groupByTag(examples.rows);
  const facetsByTag = groupByTag(facets.rows);

  return counts.rows.map((row) => ({
    tag: row.tag,
    scanCount: row.scan_count,
    userCount: row.user_count,
    examples: (examplesByTag.get(row.tag) ?? []).map((e) => ({
      scanId: e.scan_id,
      url: e.url,
      scannedAt: toIso(e.scanned_at),
    })),
    suggested: suggestionFor(facetsByTag.get(row.tag) ?? []),
  }));
}
