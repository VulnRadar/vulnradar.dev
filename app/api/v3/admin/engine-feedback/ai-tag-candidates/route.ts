import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { requirePermission } from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";
import {
  invalidatePromotedRulesCache,
  RESERVED_AUTO_TAG_NAMES,
} from "@/lib/tags/auto-tags";
import {
  ALL_CATEGORIES,
  type Category,
  type Severity,
  type Vulnerability,
} from "@/lib/scanner/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/v3/admin/engine-feedback/ai-tag-candidates
 *
 * The admin-facing half of the layered auto-tag design (see
 * lib/tags/auto-tags.ts and lib/ai/auto-tag-suggest.ts's own comments).
 * GET aggregates `scan_tags` rows with `source = 'ai'` -- tags
 * lib/ai/auto-tag-suggest.ts generated for a scan whose findings matched
 * none of the ~50 hardcoded AUTO_TAG_RULES -- grouped by tag text, so an
 * admin can see which AI-suggested concepts keep recurring across
 * distinct scans rather than showing up once and never again. POST
 * ("Promote") turns one candidate into a permanent row in
 * `promoted_auto_tag_rules`: from then on, computeAutoTags matches it as a
 * real, free, deterministic rule (see lib/tags/auto-tags.ts's
 * loadPromotedRules), and lib/ai/auto-tag-suggest.ts never needs to be
 * called for that concept again (well, until a genuinely new scan trips a
 * concept the hardcoded rules AND every promoted rule still miss).
 */

/**
 * Minimum distinct scans an AI tag must have appeared on before it
 * surfaces here at all -- a plain constant rather than a new
 * SETTINGS_REGISTRY entry (see lib/config/registry.ts): unlike
 * ENGINE_FEEDBACK_MIN_SAMPLE_SIZE/ENGINE_FEEDBACK_NOISE_THRESHOLD_PERCENT
 * on the sibling Check Accuracy / Auto-Tag Dismissals panels (which flag
 * an EXISTING row as noisy), this threshold controls whether a candidate
 * is even listed, a different enough concept that reusing those settings
 * would be a stretch. 3 is a reasonable, if arbitrary, floor for "not a
 * one-off" -- flagged in this feature's own report as a product-owner call
 * to revisit if it turns out too strict or too loose in practice.
 */
const MIN_CANDIDATE_SCANS = 3;

/** Example scan links shown per candidate, so an admin can sanity-check what triggered it without opening a database console. */
const MAX_EXAMPLES = 3;

/**
 * How many recent scans' findings blobs are sampled per candidate to derive
 * the suggested CWE/category/severity fields. The query used to be unbounded,
 * so listing this page transferred every findings JSONB of every AI-tagged
 * scan, for every candidate tag. suggestRuleFields only wants the two most
 * common CWEs and categories plus the lowest severity seen, so a recent
 * sample answers the same question at a fixed cost.
 */
const MAX_FINDINGS_SAMPLE = 50;

const VALID_SEVERITIES: readonly Severity[] = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
];

interface CandidateCountRow {
  tag: string;
  scan_count: number;
  user_count: number;
}

interface ExampleScanRow {
  scan_id: number;
  url: string;
  scanned_at: string;
}

interface FindingsRow {
  findings: unknown;
}

export interface AiTagCandidateExample {
  scanId: number;
  url: string;
  scannedAt: string;
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
 * Simple frequency analysis over every finding from every scan carrying
 * this AI tag (not an AI call): the most common CWE(s) and category(ies)
 * are the best available proxy for "what plausibly triggered this tag",
 * since the AI generation step (lib/ai/auto-tag-suggest.ts) doesn't itself
 * record which specific findings it was reacting to. The admin reviews and
 * can freely edit every suggested field before saving -- this only has to
 * be a reasonable starting point, not a correct one.
 */
function suggestRuleFields(
  findings: Vulnerability[],
): AiTagCandidateSuggestion {
  const cweCounts = new Map<string, number>();
  const categoryCounts = new Map<Category, number>();
  const severityCounts = new Map<Severity, number>();

  for (const f of findings) {
    if (f?.cwe) cweCounts.set(f.cwe, (cweCounts.get(f.cwe) ?? 0) + 1);
    if (f?.category) {
      categoryCounts.set(f.category, (categoryCounts.get(f.category) ?? 0) + 1);
    }
    if (f?.severity) {
      severityCounts.set(f.severity, (severityCounts.get(f.severity) ?? 0) + 1);
    }
  }

  const topEntries = <T>(counts: Map<T, number>, limit: number): T[] =>
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key]) => key);

  let minSeverity: Severity = "medium";
  let bestCount = -1;
  for (const [severity, count] of severityCounts.entries()) {
    if (count > bestCount) {
      bestCount = count;
      minSeverity = severity;
    }
  }

  return {
    cwes: topEntries(cweCounts, 2),
    categories: topEntries(categoryCounts, 2),
    minSeverity,
  };
}

export async function GET() {
  const admin = await requirePermission(
    STAFF_PERMISSIONS.MANAGE_ENGINE_FEEDBACK,
  );
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  try {
    const counts = await pool.query<CandidateCountRow>(
      `SELECT tag, COUNT(DISTINCT scan_id)::int AS scan_count, COUNT(DISTINCT user_id)::int AS user_count
       FROM scan_tags
       WHERE source = 'ai'
       GROUP BY tag
       HAVING COUNT(DISTINCT scan_id) >= $1
       ORDER BY COUNT(DISTINCT scan_id) DESC, tag ASC`,
      [MIN_CANDIDATE_SCANS],
    );

    // perf: this used to be a `for` loop with the Promise.all INSIDE it, so
    // the "parallel" pair ran strictly one tag after another: two round trips
    // per candidate, in series. The findings query also had no bound, pulling
    // the complete findings JSONB of every scan carrying the tag across the
    // wire only to flatMap it here. Now the per-tag work fans out across the
    // whole candidate list at once, and the findings sample is capped at the
    // most recent MAX_FINDINGS_SAMPLE scans: suggestRuleFields only ranks the
    // two most common CWEs/categories and the lowest severity, which a recent
    // sample answers as well as the full history.
    const candidates: AiTagCandidate[] = await Promise.all(
      counts.rows.map(async (row) => {
        const [examples, findingsRows] = await Promise.all([
          pool.query<ExampleScanRow>(
            `SELECT st.scan_id, sh.url, sh.scanned_at
           FROM scan_tags st
           JOIN scan_history sh ON sh.id = st.scan_id
           WHERE st.tag = $1 AND st.source = 'ai'
           ORDER BY st.id DESC
           LIMIT $2`,
            [row.tag, MAX_EXAMPLES],
          ),
          pool.query<FindingsRow>(
            `SELECT sh.findings
           FROM scan_tags st
           JOIN scan_history sh ON sh.id = st.scan_id
           WHERE st.tag = $1 AND st.source = 'ai'
           ORDER BY st.id DESC
           LIMIT $2`,
            [row.tag, MAX_FINDINGS_SAMPLE],
          ),
        ]);

        const allFindings = findingsRows.rows.flatMap((r) =>
          Array.isArray(r.findings) ? (r.findings as Vulnerability[]) : [],
        );

        return {
          tag: row.tag,
          scanCount: row.scan_count,
          userCount: row.user_count,
          examples: examples.rows.map((e) => ({
            scanId: e.scan_id,
            url: e.url,
            scannedAt: e.scanned_at,
          })),
          suggested: suggestRuleFields(allFindings),
        };
      }),
    );

    return NextResponse.json({
      candidates,
      minCandidateScans: MIN_CANDIDATE_SCANS,
    });
  } catch (error) {
    console.error(
      "[admin/engine-feedback/ai-tag-candidates] Failed to aggregate AI tag candidates:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to load AI tag candidates." },
      { status: 500 },
    );
  }
}

/** POST body for promoting a candidate into a permanent rule. */
interface PromoteBody {
  tag?: unknown;
  cwes?: unknown;
  categories?: unknown;
  requireBoth?: unknown;
  minSeverity?: unknown;
  minCount?: unknown;
}

const MAX_TAG_LENGTH = 50;

export async function POST(request: NextRequest) {
  const admin = await requirePermission(
    STAFF_PERMISSIONS.MANAGE_ENGINE_FEEDBACK,
  );
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  let body: PromoteBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const tag = typeof body.tag === "string" ? body.tag.trim() : "";
  if (!tag || tag.length > MAX_TAG_LENGTH) {
    return NextResponse.json(
      { error: `A tag name (1-${MAX_TAG_LENGTH} characters) is required.` },
      { status: 400 },
    );
  }
  // A promoted rule sharing a tag name (case-insensitively) with a
  // hardcoded rule or a holistic tag ("Critical Exposure"/"Clean"/"Needs
  // Hardening") builds a scan_tags INSERT with two rows for the same
  // (scan_id, tag) on any scan matching both -- Postgres rejects that
  // outright, silently leaving the scan stuck at pending/running forever
  // with its results discarded (computeAutoTags dedupes as a backstop,
  // but rejecting the collision here is clearer: at promotion time, not
  // whenever a scan happens to trip it).
  if (RESERVED_AUTO_TAG_NAMES.has(tag.toLowerCase())) {
    return NextResponse.json(
      {
        error: `"${tag}" is already a built-in tag name. Choose a different name for this rule.`,
      },
      { status: 400 },
    );
  }

  const cwes = Array.isArray(body.cwes)
    ? body.cwes.filter(
        (c): c is string => typeof c === "string" && /^CWE-\d+$/.test(c),
      )
    : [];
  const categories = Array.isArray(body.categories)
    ? body.categories.filter((c): c is Category =>
        ALL_CATEGORIES.includes(c as Category),
      )
    : [];

  if (cwes.length === 0 && categories.length === 0) {
    return NextResponse.json(
      { error: "At least one CWE or category is required." },
      { status: 400 },
    );
  }

  const minSeverity = body.minSeverity as Severity;
  if (!VALID_SEVERITIES.includes(minSeverity)) {
    return NextResponse.json(
      { error: "A valid minSeverity is required." },
      { status: 400 },
    );
  }

  const minCount =
    typeof body.minCount === "number" &&
    Number.isInteger(body.minCount) &&
    body.minCount > 0
      ? body.minCount
      : 1;

  try {
    await pool.query(
      `INSERT INTO promoted_auto_tag_rules
         (tag, cwes, categories, require_both, min_severity, min_count, source_ai_tag, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tag) DO UPDATE SET
         cwes = EXCLUDED.cwes,
         categories = EXCLUDED.categories,
         require_both = EXCLUDED.require_both,
         min_severity = EXCLUDED.min_severity,
         min_count = EXCLUDED.min_count`,
      [
        tag,
        cwes.length > 0 ? JSON.stringify(cwes) : null,
        categories.length > 0 ? JSON.stringify(categories) : null,
        Boolean(body.requireBoth),
        minSeverity,
        minCount,
        tag,
        admin.id,
      ],
    );

    // So the very next scan already sees this rule, instead of waiting out
    // lib/tags/auto-tags.ts's DB_RULES_CACHE_TTL_MS.
    invalidatePromotedRulesCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(
      "[admin/engine-feedback/ai-tag-candidates] Failed to promote tag:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to promote tag." },
      { status: 500 },
    );
  }
}
