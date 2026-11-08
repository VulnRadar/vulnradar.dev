import { getClientIp, getUserAgent } from "@/lib/api/request-utils";
import { profileNameChangedEmail } from "@/lib/email/email";
import { sendNotificationEmail } from "@/lib/notifications/notifications";

/**
 * Tells the account holder their display name just changed. Syncing it from
 * Discord or GitHub is the same event as typing a new one on the profile page,
 * and those routes write the column without going through PATCH /auth/update,
 * which is where this mail is sent for a typed name.
 *
 * Not awaited on purpose: the name has already changed, so a mail failure must
 * not turn the save into an error.
 */
export function noticeProfileNameChanged(
  session: { userId: number; email: string; name: string | null },
  newName: string,
): void {
  if (newName === session.name) return;
  void (async () => {
    try {
      await sendNotificationEmail({
        userId: session.userId,
        userEmail: session.email,
        type: "account_changes",
        emailContent: profileNameChangedEmail(
          session.name || "Not set",
          newName,
          {
            ipAddress: (await getClientIp()) || "Unknown",
            userAgent: await getUserAgent(),
          },
        ),
      });
    } catch (err) {
      console.error("Failed to send profile name change notification:", err);
    }
  })();
}
