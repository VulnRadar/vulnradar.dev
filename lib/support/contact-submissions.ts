import pool from "@/lib/database/db";

/**
 * Storage for contact-form submissions, shared by the two routes that take
 * them: /api/v3/contact (the signed-out contact page) and
 * /api/v3/landing-contact (the short form on the marketing page).
 *
 * Both used to build two emails, fire them with a `void` inside a
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
