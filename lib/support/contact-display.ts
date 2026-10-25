import type { ContactEmailStatus } from "./contact-submissions";

/**
 * How the staff inbox words a contact submission's notification email.
 *
 * Client-safe on purpose (a type import only): the contact view renders from
 * it, and lib/support/contact-submissions.ts pulls in the database pool.
 */

/**
 * A row is written as `pending` before the email is sent and moved to `sent`
 * or `failed` when the send settles. A send takes seconds, so a row still
 * pending after this long means the process died between the insert and the
 * outcome, and the message may never have reached anyone's inbox.
 */
export const CONTACT_PENDING_STALE_MS = 10 * 60 * 1000;

export type ContactEmailTone = "ok" | "crit" | "warn" | "info";

export interface ContactEmailState {
  tone: ContactEmailTone;
  label: string;
}

export function contactEmailState(
  row: { email_status: ContactEmailStatus; created_at: string },
  now: number = Date.now(),
): ContactEmailState {
  if (row.email_status === "sent") {
    return { tone: "ok", label: "Staff emailed" };
  }
  if (row.email_status === "failed") {
    return { tone: "crit", label: "Email failed" };
  }
  const age = now - new Date(row.created_at).getTime();
  return age > CONTACT_PENDING_STALE_MS
    ? { tone: "warn", label: "Send never finished" }
    : { tone: "info", label: "Sending" };
}

/**
 * Whether an address can go into a `mailto:` link exactly as it is.
 *
 * The contact form takes anything shaped like `local@domain.tld`, and that
 * shape allows `?`, `&`, `#`, `%` and `,`. A submitted address such as
 * `a@b.co?cc=someone@else.example&body=...` would make the Reply link open a
 * draft with a Cc and a body the sender chose, in a staff member's own mail
 * client. An address with any of those characters is shown as text instead.
 */
export function isPlainMailAddress(address: string): boolean {
  return (
    address.length <= 254 &&
    /^[^\s@?&#%,;<>"\\]+@[^\s@?&#%,;<>"\\]+$/.test(address)
  );
}
