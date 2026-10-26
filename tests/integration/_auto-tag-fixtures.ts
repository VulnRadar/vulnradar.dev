import pool from "@/lib/database/db";
import { unique } from "./_db";

/**
 * Fixtures shared by the two suites that exercise promoted auto-tag rules
 * (ai-tag-candidates.test.ts, promoted-auto-tag-rules.test.ts). Not named
 * *.test.ts, so the integration config does not collect it.
 */

const tracked: string[] = [];

/** A tag name unique to this run, so a leftover row from another suite cannot be mistaken for ours. */
export function trackedTag(label: string): string {
  const tag = unique(label);
  tracked.push(tag);
  return tag;
}

/** Register names built by hand (a prefix plus a suffix) for cleanup. */
export function track(...tags: string[]): void {
  tracked.push(...tags);
}

/** One completed scan carrying the given AI tags. Returns the scan id. */
export async function addAiTaggedScan(
  userId: number,
  tags: string[],
  findings: unknown = [],
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_history (user_id, url, status, started_at, scanned_at, scan_type, findings)
     VALUES ($1, $2, 'completed', NOW(), NOW(), 'web', $3::jsonb)
     RETURNING id`,
    [
      userId,
      `https://${unique("host")}.example.test/`,
      JSON.stringify(findings),
    ],
  );
  const scanId = rows[0].id;
  for (const tag of tags) {
    await pool.query(
      `INSERT INTO scan_tags (scan_id, user_id, tag, source) VALUES ($1, $2, $3, 'ai')`,
      [scanId, userId, tag],
    );
  }
  return scanId;
}

/** A promoted rule on CWE-350 at high severity, as the promote route writes it. */
export async function insertPromotedRule(
  tag: string,
  opts: {
    createdBy?: number | null;
    sourceAiTag?: string;
    ageDays?: number;
  } = {},
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO promoted_auto_tag_rules
       (tag, cwes, categories, require_both, min_severity, min_count, source_ai_tag, created_by, created_at)
     VALUES ($1, $2::jsonb, NULL, false, 'high', 2, $3, $4, NOW() - ($5 * INTERVAL '1 day'))
     RETURNING id`,
    [
      tag,
      JSON.stringify(["CWE-350"]),
      opts.sourceAiTag ?? tag,
      opts.createdBy ?? null,
      opts.ageDays ?? 0,
    ],
  );
  return rows[0].id;
}

/**
 * Candidates are global (every user's AI tags) and the list is capped, so
 * another suite's leftover rows could crowd ours out of it. Suites run one
 * file at a time against this database, so clearing the AI tags before a test
 * cannot pull a row out from under one that is still using it.
 */
export async function clearAiTags(): Promise<void> {
  await pool.query("DELETE FROM scan_tags WHERE source = 'ai'");
}

/** Remove every rule and tag this file created. */
export async function cleanupTracked(): Promise<void> {
  await pool.query("DELETE FROM promoted_auto_tag_rules WHERE tag = ANY($1)", [
    tracked,
  ]);
  await pool.query("DELETE FROM scan_tags WHERE tag = ANY($1)", [tracked]);
}
