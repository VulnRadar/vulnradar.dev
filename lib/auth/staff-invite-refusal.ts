import pool from "@/lib/database/db";

/** The one answer for an invite the route will not complete, whatever the
 *  reason, so the response does not say which check the account failed. */
export const STAFF_INVITE_REFUSED_MESSAGE =
  "This invite can no longer be accepted.";

/**
 * File a high-severity security alert for a refused way into staff access: a
 * staff invite or a staff SSO sign-in. Both refusals say nothing to anyone on
 * their own (the link stops working, the sign-in bounces), and an admin needs
 * to hear about them.
 *
 * A security alert rather than an admin_audit_log row because no admin acted.
 *
 * No IP address or user agent. The request that gets here belongs to whoever
 * holds the invite link or the provider account, which in the cases these
 * exist for is not the account the alert is filed against: the admin panel
 * would show that person's address as the account's, and the data export
 * hands an account its own alerts, so whoever set the address would receive
 * the other person's IP and browser.
 *
 * `dedupeOn` names a key of `details`: one open alert per account, type and
 * value of that key. Null means one open alert per account and type. Either
 * way a reload or a retry does not stack rows.
 *
 * Never throws. The refusal is the control; this only reports it.
 */
async function recordStaffAccessRefusal(opts: {
  userId: number;
  alertType: string;
  description: string;
  details: Record<string, string>;
  dedupeOn: string | null;
  logMessage: string;
}): Promise<void> {
  await pool
    .query(
      `INSERT INTO security_alerts
         (user_id, alert_type, severity, description, details)
       SELECT $1::int, $2::text, 'high', $3::text, $4::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM security_alerts
          WHERE user_id = $1::int
            AND alert_type = $2::text
            AND resolved_at IS NULL
            AND ($5::text IS NULL
                 OR details->>$5::text = $4::jsonb->>$5::text)
       )`,
      [
        opts.userId,
        opts.alertType,
        opts.description,
        JSON.stringify(opts.details),
        opts.dedupeOn,
      ],
    )
    .catch((err) => {
      console.error(opts.logMessage, err);
    });
}

/**
 * Record that a staff invite was refused because the account holding the
 * invited address never verified it.
 *
 * Either someone pointed their account at the invitee's address (PATCH
 * /api/v3/auth/update allows any unclaimed address and only clears
 * email_verified_at), or the invitee has an account they never verified. The
 * alert is filed against the account that claimed the address, one open
 * alert per invite and account, since the acceptance page reloads.
 */
export async function recordUnverifiedInviteRefusal(opts: {
  userId: number;
  inviteId: number;
  role: string;
}): Promise<void> {
  await recordStaffAccessRefusal({
    userId: opts.userId,
    alertType: "staff_invite_unverified_email",
    description:
      "A staff invite to this account's email address was refused because the account has not verified that address. Either the address was set on this account by someone who does not own it, or the invitee never verified it. The invite is still open.",
    details: { inviteId: String(opts.inviteId), role: opts.role },
    dedupeOn: "inviteId",
    logMessage: "[staff-invite] Failed to record refused invite:",
  });
}

const STAFF_SSO_REFUSAL_DESCRIPTIONS = {
  account_unverified:
    "A staff SSO sign-in to this account was refused because the account has not verified its email address. Either the address was set on this account by someone who does not own it, or the account's owner never verified it.",
} as const;

/**
 * Record that staff SSO refused a staff account it matched by email.
 *
 * "account_unverified": the account never verified the address here, so
 * someone may have pointed it at an address they do not own, or its owner
 * never verified it.
 *
 * One open alert per account, since the same person will retry.
 */
export async function recordUnverifiedStaffSsoRefusal(opts: {
  userId: number;
  issuerHost: string;
  reason: keyof typeof STAFF_SSO_REFUSAL_DESCRIPTIONS;
}): Promise<void> {
  await recordStaffAccessRefusal({
    userId: opts.userId,
    alertType: "staff_sso_unverified_email",
    description: STAFF_SSO_REFUSAL_DESCRIPTIONS[opts.reason],
    details: { issuer: opts.issuerHost },
    dedupeOn: null,
    logMessage: "[staff-oidc] Failed to record refused sign-in:",
  });
}
