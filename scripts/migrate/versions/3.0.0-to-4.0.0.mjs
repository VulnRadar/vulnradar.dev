/**
 * v3.0.0 → v4.0.0 — Scanner learning: finding feedback table.
 *
 * What this upgrade adds:
 *   - `scan_finding_feedback` table: stores user verdicts on individual
 *     findings (confirmed, false_positive, not_applicable). Used to
 *     build per-check false-positive rates and enable adaptive confidence
 *     scoring in the scanner engine.
 *
 *   Unique constraint on (user_id, finding_id, finding_url) so
 *   repeated feedback on the same finding is an upsert, not an insert.
 *
 * Reversible: DROP TABLE scan_finding_feedback.
 */

export const from = "3.0.0";
export const to = "4.0.0";

const SCAN_FINDING_FEEDBACK_SQL = `
  CREATE TABLE IF NOT EXISTS scan_finding_feedback (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    scan_history_id INTEGER REFERENCES scan_history(id) ON DELETE SET NULL,
    finding_id TEXT NOT NULL,
    finding_url TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK (verdict IN ('confirmed', 'false_positive', 'not_applicable')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_finding_feedback_unique
    ON scan_finding_feedback (user_id, finding_id, finding_url);

  CREATE INDEX IF NOT EXISTS idx_scan_finding_feedback_finding_id
    ON scan_finding_feedback (finding_id, verdict);

  CREATE INDEX IF NOT EXISTS idx_scan_finding_feedback_user
    ON scan_finding_feedback (user_id, created_at DESC);
`;

export const upgrade = {
  description:
    "Add scan_finding_feedback table for scanner learning and false-positive tracking.",

  addTables: [
    { name: "scan_finding_feedback", sql: SCAN_FINDING_FEEDBACK_SQL },
  ],

  addIndexes: [],

  addColumns: [],

  runAfter: [],
};

export const downgrade = {
  description: "Drop scan_finding_feedback table.",

  dropTables: ["scan_finding_feedback"],
  dropColumns: [],
};
