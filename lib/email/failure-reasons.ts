import pool from "@/lib/database/db";

/** How long a failure counts as recent for the Email Logs summary strip. */
export const FAILURE_WINDOW_HOURS = 24;
const FAILURE_REASONS_SHOWN = 5;
const FAILURE_SAMPLE_CHARS = 200;

export interface EmailFailureReason {
  smtpCode: number | null;
  smtpCommand: string | null;
  errorCode: string | null;
  /** The newest message in the group, cut short. */
  sample: string | null;
  count: number;
  /** Which templates were hit, so "it is every broadcast" reads at a glance. */
  templates: string[];
}

interface FailureReasonRow {
  smtp_code: number | null;
  smtp_command: string | null;
  error_code: string | null;
  sample: string | null;
  count: number;
  templates: string[] | null;
}

/**
 * Failed sends of the last day, grouped by what refused them.
 *
 * "Blocked by SpamAssassin" arrives as a burst, and the Email Logs list shows
 * one row per message, so the cause had to be found by opening rows one at a
 * time. This puts a burst on one line with a count.
 *
 * The group is the SMTP reply code, the command that was refused, and
 * nodemailer's own error code. "550 at DATA" is a verdict on the content and
 * "550 at RCPT TO" is a verdict on the address, and they must not merge. A row
 * from before those columns existed, or an error that never reached a relay
 * (a timeout, a DNS failure), carries none of the three, so it groups on the
 * start of its message instead of collapsing into one anonymous bucket.
 */
export async function getRecentFailureReasons(): Promise<EmailFailureReason[]> {
  const result = await pool.query<FailureReasonRow>(
    `SELECT smtp_code,
            smtp_command,
            error_code,
            LEFT((array_agg(error_message ORDER BY created_at DESC))[1], ${FAILURE_SAMPLE_CHARS}) AS sample,
            COUNT(*)::int AS count,
            array_agg(DISTINCT template) FILTER (WHERE template IS NOT NULL) AS templates
       FROM email_logs
      WHERE status = 'failed'
        AND created_at > NOW() - INTERVAL '${FAILURE_WINDOW_HOURS} hours'
      GROUP BY smtp_code, smtp_command, error_code,
               CASE WHEN smtp_code IS NULL AND error_code IS NULL
                    THEN LEFT(error_message, 60) END
      ORDER BY count DESC, MAX(created_at) DESC
      LIMIT ${FAILURE_REASONS_SHOWN}`,
  );
  return result.rows.map((row) => ({
    smtpCode: row.smtp_code,
    smtpCommand: row.smtp_command,
    errorCode: row.error_code,
    sample: row.sample,
    count: row.count,
    templates: row.templates ?? [],
  }));
}
