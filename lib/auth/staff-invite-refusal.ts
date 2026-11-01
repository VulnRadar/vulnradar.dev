import { isIP } from "node:net";
import pool from "@/lib/database/db";

/** The one answer for an invite the route will not complete, whatever the
 *  reason, so the response does not say which check the account failed. */
export const STAFF_INVITE_REFUSED_MESSAGE =
  "This invite can no longer be accepted.";

const ALERT_TYPE = "staff_invite_unverified_email";

/**
 * Record that a staff invite was refused because the account holding the
 * invited address never verified it.
 *
 * Either someone pointed their account at the invitee's address (PATCH
 * /api/v3/auth/update allows any unclaimed address and only clears
 * email_verified_at), or the invitee has an account they never verified. An
 * admin needs to know about both, and the refusal alone says nothing to
 * anyone: the invitee's link just stops working.
 *
 * A security alert rather than an admin_audit_log row because no admin acted,
 * and the account it is filed against is the one that claimed the address.
 * One open alert per invite and account: the acceptance page reloads, and
 * each load of a refused invite would otherwise add another row.
 *
 * Never throws. The refusal is the control; this only reports it.
 */
export async function recordUnverifiedInviteRefusal(opts: {
  userId: number;
  inviteId: number;
  role: string;
  ip: string | null | undefined;
  userAgent: string | null | undefined;
}): Promise<void> {
  const ip = opts.ip && isIP(opts.ip) ? opts.ip : null;
  await pool
    .query(
      `INSERT INTO security_alerts
         (user_id, alert_type, severity, description, details, ip_address, user_agent)
       SELECT $1::int, $2::text, 'high', $3::text, $4::jsonb, $5::inet, $6::text
       WHERE NOT EXISTS (
         SELECT 1 FROM security_alerts
          WHERE user_id = $1::int
            AND alert_type = $2::text
            AND resolved_at IS NULL
            AND details->>'inviteId' = $7::text
       )`,
      [
        opts.userId,
        ALERT_TYPE,
        "A staff invite to this account's email address was refused because the account has not verified that address. Either the address was set on this account by someone who does not own it, or the invitee never verified it. The invite is still open.",
        JSON.stringify({ inviteId: String(opts.inviteId), role: opts.role }),
        ip,
        opts.userAgent || null,
        String(opts.inviteId),
      ],
    )
    .catch((err) => {
      console.error("[staff-invite] Failed to record refused invite:", err);
    });
}
