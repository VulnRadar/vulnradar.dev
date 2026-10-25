import pool from "@/lib/database/db";

/**
 * Storage for contact-form submissions: /api/v3/contact (the signed-out
 * contact page) writes them, and the staff inbox reads them back through
 * listContactSubmissions. Rows with source 'landing' came from the short form
 * on the marketing page, which no longer exists; they stay readable.
 *
 * The form used to build two emails, fire them with a `void` inside a
 * `queueMicrotask`, catch any failure into a `console.error`, and answer
 * "Thanks for reaching out. We will get back to you soon." The message existed
 * nowhere else. A DNS failure at the mail host, an expired SMTP credential, a
 * bounce or a spam filter therefore lost it outright, and both sides believed
 * it had arrived. One of the categories on that form is "Security Issue".
 *
 * So the row is written first, and the send reports back to it. If the write
 * fails the caller is told the truth rather than thanked, because at that
 * point nothing has recorded their message and telling them otherwise is the
 * whole bug.
 */

export type ContactSource = "contact" | "landing";

export interface ContactSubmission {
  source: ContactSource;
  name: string;
  email: string;
  subject: string | null;
  category: string;
  message: string;
  ipAddress: string | null;
}

/**
 * Records the submission and returns its id.
 *
 * Deliberately not swallowing its own failure: the caller has to know, since
 * the response it sends depends on whether anything was kept.
 */
export async function recordContactSubmission(
  submission: ContactSubmission,
): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO contact_submissions
       (source, name, email, subject, category, message, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      submission.source,
      submission.name,
      submission.email,
      submission.subject,
      submission.category,
      submission.message,
      submission.ipAddress,
    ],
  );
  return result.rows[0].id;
}

export type ContactEmailStatus = "pending" | "sent" | "failed";

export const CONTACT_EMAIL_STATUSES: readonly ContactEmailStatus[] = [
  "pending",
  "sent",
  "failed",
];

/** Submissions per page in the staff inbox. */
export const CONTACT_PAGE_SIZE = 50;

/**
 * A stored submission as staff read it. The submitter's IP is not part of it:
 * it is kept for abuse handling and reaches staff only through the database,
 * not through a screen that exists to answer the message.
 */
export interface ContactSubmissionRow {
  id: number;
  source: ContactSource;
  name: string;
  email: string;
  subject: string | null;
  category: string;
  message: string;
  email_status: ContactEmailStatus;
  email_error: string | null;
  handled_at: string | null;
  created_at: string;
}

export interface ContactSubmissionPage {
  submissions: ContactSubmissionRow[];
  /** Pass as `before` for the next page, or null when this was the last. */
  nextBefore: number | null;
}

/**
 * One page of submissions, newest first, optionally only those whose staff
 * email is in one state.
 *
 * This is the only place the table is read for display, and it exists because
 * the staff email stopped carrying the message (it is a pointer to this list
 * now). A submission whose email never arrived is the case that matters most:
 * `email_status = 'failed'` is the filter that finds it.
 *
 * Keyset on `id` rather than an offset. The serial id is monotonic with
 * created_at, it is already the primary key, and a row arriving while someone
 * pages cannot shift the rows they have yet to see.
 */
export async function listContactSubmissions(opts: {
  status?: ContactEmailStatus | null;
  before?: number | null;
  limit?: number;
}): Promise<ContactSubmissionPage> {
  const limit = opts.limit ?? CONTACT_PAGE_SIZE;
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.status) {
    params.push(opts.status);
    where.push(`email_status = $${params.length}`);
  }
  if (opts.before != null) {
    params.push(opts.before);
    where.push(`id < $${params.length}`);
  }
  params.push(limit + 1);

  const result = await pool.query<ContactSubmissionRow>(
    `SELECT id, source, name, email, subject, category, message,
            email_status, email_error, handled_at, created_at
       FROM contact_submissions
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY id DESC
      LIMIT $${params.length}`,
    params,
  );

  const submissions = result.rows.slice(0, limit);
  const last = submissions[submissions.length - 1];
  return {
    submissions,
    nextBefore: result.rows.length > limit && last ? last.id : null,
  };
}

/** How many submissions are in each email state, across the whole table. */
export async function countContactSubmissions(): Promise<
  Record<ContactEmailStatus, number>
> {
  const result = await pool.query<{
    email_status: ContactEmailStatus;
    n: number;
  }>(
    `SELECT email_status, COUNT(*)::int AS n
       FROM contact_submissions
      GROUP BY email_status`,
  );
  const counts: Record<ContactEmailStatus, number> = {
    pending: 0,
    sent: 0,
    failed: 0,
  };
  for (const row of result.rows) counts[row.email_status] = row.n;
  return counts;
}

/**
 * Marks how the notification email went, once it settles.
 *
 * Its own failure is swallowed, and that is the right way round: the message
 * is already stored, so losing the delivery status costs a column, not the
 * submission. A row left at 'pending' long after its created_at means the
 * process died between the insert and here.
 */
export async function recordContactEmailOutcome(
  id: number,
  outcome: { delivered: boolean; error?: string },
): Promise<void> {
  try {
    await pool.query(
      `UPDATE contact_submissions
          SET email_status = $1, email_error = $2
        WHERE id = $3`,
      [
        outcome.delivered ? "sent" : "failed",
        // Truncated: an SMTP error can carry the whole rejected message back.
        outcome.error ? outcome.error.slice(0, 2000) : null,
        id,
      ],
    );
  } catch (error) {
    console.error(
      "[Contact] Could not record the email outcome for submission",
      id,
      error instanceof Error ? error.message : error,
    );
  }
}
